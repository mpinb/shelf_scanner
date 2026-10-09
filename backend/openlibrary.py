import os
import re
import time
import urllib.parse
import threading
import requests
from typing import Optional, Dict, Any, List, Tuple


class OpenLibraryRateLimiter:
    """
    Enforces a strict rate limit (strictly <= requests_per_second)
    while maximizing throughput by dispatching requests as soon as the
    interval threshold has elapsed.
    """
    def __init__(self, requests_per_second: float = 3.0):
        self.interval = 1.0 / requests_per_second  # ~0.3333s for 3 req/sec
        self.last_dispatched = 0.0
        self.lock = threading.Lock()

    def wait(self):
        with self.lock:
            now = time.monotonic()
            elapsed = now - self.last_dispatched
            if elapsed < self.interval:
                time.sleep(self.interval - elapsed)
            self.last_dispatched = time.monotonic()


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
    Client for Open Library APIs with strict 3 req/s rate limiting
    and exponential backoff retry for HTTP 429/502/503/504 and network drops.
    """
    def __init__(self, requests_per_second: float = 3.0, max_request_retries: int = 4):
        self.rate_limiter = OpenLibraryRateLimiter(requests_per_second=requests_per_second)
        self.max_request_retries = max_request_retries
        self.session = requests.Session()
        self.session.headers.update({
            "User-Agent": "ShelfScannerApp/1.0 (academic/library; mailto:aiyer.aditya@gmail.com)",
            "Accept": "application/json"
        })

    def get(self, url_or_params, is_url: bool = False) -> Tuple[Optional[Dict[str, Any]], bool]:
        """
        Executes a rate-limited GET request with backoff retries.
        Returns (data_dict_or_None, had_transient_error_flag).
        """
        had_transient_error = False

        for attempt in range(1, self.max_request_retries + 1):
            self.rate_limiter.wait()

            try:
                if is_url:
                    target_url = url_or_params
                else:
                    query_str = urllib.parse.urlencode(url_or_params)
                    target_url = f"https://openlibrary.org/search.json?{query_str}"

                resp = self.session.get(target_url, timeout=9.0)

                if resp.status_code == 200:
                    try:
                        return resp.json(), False
                    except Exception as json_err:
                        print(f"[OpenLibrary] JSON decode error: {json_err}")
                        return None, False

                elif resp.status_code in (429, 502, 503, 504):
                    had_transient_error = True
                    backoff = min(15.0, 1.2 * attempt)
                    print(f"[OpenLibrary] Status {resp.status_code}. Backing off {backoff:.1f}s (attempt {attempt}/{self.max_request_retries})...")
                    time.sleep(backoff)

                elif resp.status_code == 404:
                    return None, False

                else:
                    print(f"[OpenLibrary] HTTP {resp.status_code} for {target_url}")
                    return None, False

            except (requests.exceptions.Timeout, requests.exceptions.ConnectionError) as net_err:
                had_transient_error = True
                backoff = min(15.0, 1.2 * attempt)
                print(f"[OpenLibrary] Network error ({net_err.__class__.__name__}). Retrying in {backoff:.1f}s (attempt {attempt}/{self.max_request_retries})...")
                time.sleep(backoff)

            except Exception as e:
                print(f"[OpenLibrary] Unexpected error during request: {e}")
                return None, False

        return None, had_transient_error

    def enrich_book_metadata(self, title: str, authors: Optional[str] = None) -> Tuple[Optional[Dict[str, Any]], bool]:
        """
        Searches Open Library for a single book and returns canonical metadata + ISBNs.
        Returns (enrichment_dict_or_None, had_transient_error_flag).
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

            # Check editions for canonical/edition ISBNs
            work_key = doc.get("key")
            if work_key and work_key.startswith("/works/"):
                ed_url = f"https://openlibrary.org{work_key}/editions.json?limit=30"
                ed_data, ed_transient = self.get(ed_url, is_url=True)
                if ed_transient:
                    overall_transient_error = True

                if ed_data:
                    entries = ed_data.get("entries", [])
                    title_lower = clean_t.lower()
                    edition_isbns = []
                    for entry in entries:
                        ed_title = (entry.get("title") or "").lower()
                        if title_lower in ed_title or ed_title in title_lower:
                            for cand in (entry.get("isbn_13") or []) + (entry.get("isbn_10") or []):
                                c_clean = re.sub(r"[^0-9X]", "", str(cand).upper())
                                if is_valid_isbn(c_clean) and c_clean not in edition_isbns:
                                    edition_isbns.append(c_clean)

                    if not edition_isbns and not valid_isbns:
                        for entry in entries:
                            for cand in (entry.get("isbn_13") or []) + (entry.get("isbn_10") or []):
                                c_clean = re.sub(r"[^0-9X]", "", str(cand).upper())
                                if is_valid_isbn(c_clean) and c_clean not in edition_isbns:
                                    edition_isbns.append(c_clean)

                    for ed_isbn in edition_isbns:
                        if ed_isbn not in valid_isbns:
                            valid_isbns.insert(0, ed_isbn)

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


# Singleton instance configured for 3 requests/s
openlibrary_client = OpenLibraryClient(requests_per_second=3.0, max_request_retries=4)
