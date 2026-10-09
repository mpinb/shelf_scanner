import os
import re
import time
import urllib.parse
import threading
import collections
import requests
from typing import Optional, Dict, Any, List, Tuple


class OpenLibraryRateLimiter:
    """
    Polite, burst-free rate limiter.
    Ensures we NEVER overload Open Library's API:
    1. Enforces a safe target rate of ~2.5 req/sec (minimum 400ms spacing).
    2. Enforces a strict sliding window limit: at most 2 requests within any rolling 1.0 second window.
    3. Supports a global backoff cooldown (e.g. if 429 or 503 is returned).
    """
    def __init__(self, min_interval: float = 0.40):
        self.min_interval = min_interval  # 400ms minimum spacing (<= 2.5 req/s)
        self.last_dispatched = 0.0
        self.timestamps = collections.deque()
        self.cooldown_until = 0.0
        self.lock = threading.Lock()

    def set_cooldown(self, seconds: float):
        """Halts all dispatches until the cooldown period expires."""
        with self.lock:
            now = time.monotonic()
            self.cooldown_until = max(self.cooldown_until, now + seconds)

    def wait(self):
        """Blocks until it is safe to dispatch the next request without exceeding limits."""
        with self.lock:
            while True:
                now = time.monotonic()
                # 1. Global backoff cooldown (after HTTP 429 or 503)
                if now < self.cooldown_until:
                    sleep_time = self.cooldown_until - now
                    time.sleep(sleep_time)
                    continue

                # 2. Minimum inter-request interval spacing
                time_since_last = now - self.last_dispatched
                if time_since_last < self.min_interval:
                    time.sleep(self.min_interval - time_since_last)
                    now = time.monotonic()

                # 3. Sliding 1.0 second window: purge timestamps older than 1.0s
                while self.timestamps and self.timestamps[0] <= now - 1.0:
                    self.timestamps.popleft()

                # Guarantee strictly at most 2 requests within any rolling 1.0 second window
                if len(self.timestamps) >= 2:
                    wait_time = 1.0 - (now - self.timestamps[0]) + 0.05
                    if wait_time > 0:
                        time.sleep(wait_time)
                        continue

                self.last_dispatched = time.monotonic()
                self.timestamps.append(self.last_dispatched)
                break


def is_valid_isbn(isbn_str: str) -> bool:
    """Validates ISBN-10 or ISBN-13 format and check digit."""
    if not isbn_str:
        return False
    clean = re.sub(r"[^0-9X]", "", str(isbn_str).upper())
    if len(clean) == 10:
        total = sum((10 - i) * (10 if c == 'X' else int(c)) for i, c in enumerate(clean))
        return total % 11 == 0
    elif len(clean) == 13:
        if not clean.isdigit():
            return False
        total = sum(int(c) * (1 if i % 2 == 0 else 3) for i, c in enumerate(clean))
        return total % 10 == 0
    return False


class OpenLibraryClient:
    """
    Client for Open Library APIs with polite rate limiting (2.5 req/s max, sliding window),
    in-memory query caching, and exponential backoff cooldowns to protect Open Library servers.
    """
    def __init__(self, min_interval: float = 0.40, max_request_retries: int = 4):
        self.rate_limiter = OpenLibraryRateLimiter(min_interval=min_interval)
        self.max_request_retries = max_request_retries
        self.session = requests.Session()
        self.session.headers.update({
            "User-Agent": "ShelfScannerApp/1.0 (academic/library cataloger; mailto:aiyer.aditya@gmail.com)",
            "Accept": "application/json"
        })
        # In-memory query cache to eliminate redundant requests across shelves/runs
        self._cache: Dict[str, Tuple[Optional[Dict[str, Any]], bool]] = {}
        self._cache_lock = threading.Lock()

    def get(self, url_or_params, is_url: bool = False) -> Tuple[Optional[Dict[str, Any]], bool]:
        """
        Executes a rate-limited GET request with backoff cooldowns.
        Returns (data_dict_or_None, had_transient_error_flag).
        """
        if is_url:
            cache_key = url_or_params
            target_url = url_or_params
        else:
            cache_key = urllib.parse.urlencode(sorted(url_or_params.items()))
            target_url = f"https://openlibrary.org/search.json?{cache_key}"

        with self._cache_lock:
            if cache_key in self._cache:
                return self._cache[cache_key]

        had_transient_error = False

        for attempt in range(1, self.max_request_retries + 1):
            self.rate_limiter.wait()

            try:
                resp = self.session.get(target_url, timeout=9.0)

                if resp.status_code == 200:
                    try:
                        data = resp.json()
                        with self._cache_lock:
                            self._cache[cache_key] = (data, False)
                        return data, False
                    except Exception as json_err:
                        print(f"[OpenLibrary] JSON decode error: {json_err}")
                        return None, False

                elif resp.status_code == 429:
                    had_transient_error = True
                    # Respect 429 with aggressive cooldown: 5s, 15s, 30s, 60s
                    cooldown = min(60.0, 5.0 * (attempt ** 2))
                    print(f"[OpenLibrary] HTTP 429 Rate Limit encountered. Triggering global cooldown of {cooldown:.1f}s (attempt {attempt}/{self.max_request_retries})...")
                    self.rate_limiter.set_cooldown(cooldown)
                    time.sleep(cooldown)

                elif resp.status_code in (502, 503, 504):
                    had_transient_error = True
                    cooldown = min(30.0, 3.0 * attempt)
                    print(f"[OpenLibrary] HTTP {resp.status_code} server busy. Global cooldown of {cooldown:.1f}s (attempt {attempt}/{self.max_request_retries})...")
                    self.rate_limiter.set_cooldown(cooldown)
                    time.sleep(cooldown)

                elif resp.status_code == 404:
                    with self._cache_lock:
                        self._cache[cache_key] = (None, False)
                    return None, False

                else:
                    print(f"[OpenLibrary] HTTP {resp.status_code} for {target_url}")
                    return None, False

            except (requests.exceptions.Timeout, requests.exceptions.ConnectionError) as net_err:
                had_transient_error = True
                cooldown = min(20.0, 2.5 * attempt)
                print(f"[OpenLibrary] Network issue ({net_err.__class__.__name__}). Retrying in {cooldown:.1f}s (attempt {attempt}/{self.max_request_retries})...")
                self.rate_limiter.set_cooldown(cooldown)
                time.sleep(cooldown)

            except Exception as e:
                print(f"[OpenLibrary] Unexpected error during request: {e}")
                return None, False

        return None, had_transient_error

    def enrich_book_metadata(self, title: str, authors: Optional[str] = None) -> Tuple[Optional[Dict[str, Any]], bool]:
        """
        Searches Open Library for a single book and returns canonical metadata + ISBNs.
        Optimized to minimize requests: only queries editions if work-level ISBNs are missing.
        """
        clean_t = re.sub(r"[\r\n\t]", " ", (title or "")).strip()
        clean_t = re.sub(r"\s+", " ", clean_t)[:100]
        clean_a = re.sub(r"[\r\n\t]", " ", (authors or "")).strip()
        clean_a = re.sub(r"\s+", " ", clean_a)[:60]

        if not clean_t or len(clean_t) < 2 or clean_t.lower() == "untitled":
            return None, False

        first_author = clean_a.split(",")[0].strip() if clean_a and len(clean_a) > 2 else ""

        # Prioritized query strategies
        queries = []
        if first_author:
            queries.append({
                "title": clean_t,
                "author": first_author,
                "fields": "key,title,subtitle,author_name,publisher,isbn",
                "limit": 3
            })
            queries.append({
                "q": f"{clean_t} {first_author}",
                "fields": "key,title,subtitle,author_name,publisher,isbn",
                "limit": 3
            })

        queries.append({
            "title": clean_t,
            "fields": "key,title,subtitle,author_name,publisher,isbn",
            "limit": 3
        })

        overall_transient_error = False

        for q_params in queries:
            data, transient_err = self.get(q_params)
            if transient_err:
                overall_transient_error = True

            if not data:
                continue

            docs = data.get("docs", [])
            if not docs:
                continue

            doc = docs[0]
            ol_title = doc.get("title")
            ol_auths = doc.get("author_name") or []
            ol_authors = ", ".join(ol_auths[:3]) if ol_auths else None
            ol_pubs = doc.get("publisher") or []
            ol_publisher = ol_pubs[0] if ol_pubs else None

            # Collect work-level ISBNs
            raw_isbns = doc.get("isbn") or []
            valid_isbns = [re.sub(r"[^0-9X]", "", str(i).upper()) for i in raw_isbns if is_valid_isbn(i)]

            # Polite optimization: ONLY query editions API if work record had zero valid ISBNs.
            # If the search doc already supplied ISBNs, skip editions query entirely to save API load!
            work_key = doc.get("key")
            if not valid_isbns and work_key and work_key.startswith("/works/"):
                ed_url = f"https://openlibrary.org{work_key}/editions.json?limit=20"
                ed_data, ed_transient = self.get(ed_url, is_url=True)
                if ed_transient:
                    overall_transient_error = True

                if ed_data:
                    entries = ed_data.get("entries", [])
                    edition_isbns = []
                    for entry in entries:
                        for cand in (entry.get("isbn_13") or []) + (entry.get("isbn_10") or []):
                            c_clean = re.sub(r"[^0-9X]", "", str(cand).upper())
                            if is_valid_isbn(c_clean) and c_clean not in edition_isbns:
                                edition_isbns.append(c_clean)

                    for ed_isbn in edition_isbns:
                        if ed_isbn not in valid_isbns:
                            valid_isbns.append(ed_isbn)

            # Deduplicate ISBNs preserving order
            seen_isbns = set()
            unique_isbns = []
            for i in valid_isbns:
                if i not in seen_isbns:
                    seen_isbns.add(i)
                    unique_isbns.append(i)

            return {
                "ol_title": ol_title,
                "ol_authors": ol_authors,
                "ol_publisher": ol_publisher,
                "isbn_primary": unique_isbns[0] if unique_isbns else None,
                "isbns": unique_isbns
            }, overall_transient_error

        return None, overall_transient_error


# Singleton instance configured with safe parameters (2.5 req/s max, sliding window protection)
openlibrary_client = OpenLibraryClient(min_interval=0.40, max_request_retries=4)
