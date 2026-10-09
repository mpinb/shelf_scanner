import os
import io
import json
import time
import base64
import re
from pathlib import Path
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BASE_DIR.parent
load_dotenv(PROJECT_ROOT / ".env")
load_dotenv(BASE_DIR / ".env")
load_dotenv()

from PIL import Image, ImageOps
try:
    from openai import OpenAI
except ImportError:
    OpenAI = None

try:
    from google import genai
    from google.genai import types as genai_types
except ImportError:
    genai = None
    genai_types = None

try:
    from backend.openlibrary import openlibrary_client, is_valid_isbn
except ImportError:
    from openlibrary import openlibrary_client, is_valid_isbn


def load_pipeline_prompt() -> str:
    """Loads vision segmentation and OCR prompt from prompt.txt."""
    for path in (BASE_DIR / "prompt.txt", PROJECT_ROOT / "prompt.txt"):
        if path.exists():
            try:
                return path.read_text(encoding="utf-8").strip()
            except Exception as e:
                print(f"[Pipeline] Notice reading {path}: {e}")
    raise FileNotFoundError("prompt.txt not found in backend/ or root directory")


def ensure_horizontal_shelf_image(pil_img: Image.Image) -> Image.Image:
    """Ensures that the bookshelf image respects EXIF metadata orientation."""
    pil_img = ImageOps.exif_transpose(pil_img)
    if pil_img.mode != "RGB":
        pil_img = pil_img.convert("RGB")
    return pil_img


class ShelfVisionPipeline:
    def __init__(self, openai_api_key: str = None, gemini_api_key: str = None, model_name: str = None):
        self.model_name = (model_name or os.getenv("MODEL_NAME", "gemini-3.8-flash")).strip()
        self.is_gemini = "gemini" in self.model_name.lower()
        self.prompt = load_pipeline_prompt()

        if self.is_gemini:
            self.gemini_api_key = gemini_api_key or os.getenv("GEMINI_API_KEY")
            if not self.gemini_api_key:
                raise ValueError("GEMINI_API_KEY must be set in .env when using Gemini models")
            if genai is None:
                raise ImportError("google-genai package is required for Gemini models")
            self.gemini_client = genai.Client(api_key=self.gemini_api_key)
            self.client = None
        else:
            self.api_key = openai_api_key or os.getenv("OPENAI_API_KEY")
            if not self.api_key:
                raise ValueError("OPENAI_API_KEY must be set in .env when using OpenAI models")
            if OpenAI is None:
                raise ImportError("openai package is required for OpenAI models")
            self.client = OpenAI(api_key=self.api_key)
            self.gemini_client = None

    def process_image(self, image_bytes: bytes, log_callback=None, skip_enrichment: bool = False):
        """
        Executes the vision segmentation, OCR, fore-edge suppression, and canonical enrichment pipeline.
        Calls log_callback(step_num, message) for real-time progress logging.
        """
        def log(step, msg):
            if log_callback:
                log_callback(step, msg)
            print(f"[Step {step}] {msg}")

        # --- STEP 1: Image Validation & Preprocessing ---
        log(1, "Validating and optimizing shelf image for vision inference...")
        img = Image.open(io.BytesIO(image_bytes))
        img = ensure_horizontal_shelf_image(img)
        orig_w, orig_h = img.size
        log(1, f"Horizontal shelf dimensions: {orig_w}x{orig_h}px")

        # Create web-optimized copy (max 2000px on long edge for fast mobile rendering)
        web_img = img.copy()
        max_dim = 2000
        if max(orig_w, orig_h) > max_dim:
            web_img.thumbnail((max_dim, max_dim), Image.Resampling.LANCZOS)
        
        web_w, web_h = web_img.size
        
        web_buf = io.BytesIO()
        web_img.save(web_buf, format="JPEG", quality=85, optimize=True)
        web_image_bytes = web_buf.getvalue()

        # --- STEP 2: Vision Model Query (Spine Segmentation & OCR) ---
        log(2, f"Querying {self.model_name} for 4-corner spine polygons and structured OCR...")
        t0 = time.time()

        if self.is_gemini:
            # Gemini models perform natively with normalized [0, 1000] vision coordinates
            prompt_with_dims = f"""{self.prompt}

### STRICT COORDINATE SYSTEM (NORMALIZED 0 TO 1000):
- The coordinate origin [0, 0] is located at the top-left corner. [1000, 1000] is the bottom-right corner.
- All 4-corner polygon coordinates [x, y] MUST be returned strictly in normalized [0, 1000] space: x in [0, 1000], y in [0, 1000].
- Order books strictly from left to right on the center shelf.
- Return ONLY a valid JSON object matching the requested schema.
"""
            response = None
            last_err = None
            for attempt in range(4):
                try:
                    response = self.gemini_client.models.generate_content(
                        model=self.model_name,
                        contents=[
                            genai_types.Part.from_bytes(data=image_bytes, mime_type="image/jpeg"),
                            prompt_with_dims
                        ],
                        config=genai_types.GenerateContentConfig(
                            response_mime_type="application/json",
                            temperature=0.2
                        )
                    )
                    break
                except Exception as e:
                    last_err = e
                    time.sleep(2 * (attempt + 1))
            if not response:
                log(2, f"Error querying {self.model_name}: {last_err}")
                raise last_err

            raw_text = (response.text or "").strip()
            coord_scale_x = web_w / 1000.0
            coord_scale_y = web_h / 1000.0
        else:
            # OpenAI models operate in pixel coordinate space
            img_buf = io.BytesIO()
            img.save(img_buf, format="JPEG", quality=92)
            base64_image = base64.b64encode(img_buf.getvalue()).decode("utf-8")

            prompt_with_dims = f"""{self.prompt}

### EXACT IMAGE DIMENSIONS & STRICT COORDINATE SYSTEM:
- The uploaded image has EXACT dimensions: width = {orig_w} pixels, height = {orig_h} pixels.
- The coordinate origin [0, 0] is located at the top-left corner.
- All 4-corner polygon coordinates [x, y] MUST be returned strictly in this EXACT pixel coordinate system: x in [0, {orig_w}], y in [0, {orig_h}].
- Do NOT normalize coordinates to [0, 1] or [0, 1000].
- Do NOT rescale, downsample, or modify coordinates. Use the exact {orig_w} x {orig_h} coordinate space.
"""
            try:
                response = self.client.chat.completions.create(
                    model=self.model_name,
                    messages=[
                        {
                            "role": "user",
                            "content": [
                                {"type": "text", "text": prompt_with_dims},
                                {
                                    "type": "image_url",
                                    "image_url": {
                                        "url": f"data:image/jpeg;base64,{base64_image}",
                                        "detail": "high"
                                    }
                                }
                            ]
                        }
                    ],
                    max_completion_tokens=16384
                )
                raw_text = (response.choices[0].message.content or "").strip()
            except Exception as e:
                log(2, f"Error querying {self.model_name}: {e}")
                raise e

            coord_scale_x = web_w / orig_w if orig_w > 0 else 1.0
            coord_scale_y = web_h / orig_h if orig_h > 0 else 1.0

        elapsed = time.time() - t0
        log(2, f"{self.model_name} vision inference completed in {elapsed:.1f}s")

        # Parse JSON robustly from model output
        clean_json = raw_text
        if "```json" in clean_json:
            clean_json = clean_json.split("```json", 1)[1].split("```", 1)[0].strip()
        elif "```" in clean_json:
            clean_json = clean_json.split("```", 1)[1].split("```", 1)[0].strip()
        else:
            first_brace = clean_json.find("{")
            last_brace = clean_json.rfind("}")
            if first_brace != -1 and last_brace != -1 and last_brace > first_brace:
                clean_json = clean_json[first_brace:last_brace + 1].strip()

        parsed_data = json.loads(clean_json)
        books_raw = parsed_data.get("books", [])
        log(2, f"Successfully parsed {len(books_raw)} book spine candidates")

        # --- STEP 3: Geometry & Fore-Edge Filtering ---
        log(3, "Evaluating spine geometries and filtering front-edge facing pages...")
        processed_books = []
        for idx, b in enumerate(books_raw, start=1):
            is_ignored = bool(b.get("is_ignored", False))
            title = (b.get("title") or "").strip()
            authors = (b.get("authors") or "").strip()
            raw_spine_text = (b.get("raw_text") or "").strip()

            # Rule: If no title and no authors and short raw text, likely a page edge
            if not title and not authors and len(raw_spine_text) < 3:
                is_ignored = True

            poly = b.get("polygon") or []
            clamped_poly = []
            for pt in poly:
                if isinstance(pt, (list, tuple)) and len(pt) >= 2:
                    cx = max(0, min(web_w, round(float(pt[0]) * coord_scale_x)))
                    cy = max(0, min(web_h, round(float(pt[1]) * coord_scale_y)))
                    clamped_poly.append([cx, cy])

            isbns_list = b.get("all_isbns") or []
            if b.get("isbn") and b.get("isbn") not in isbns_list:
                isbns_list.insert(0, b.get("isbn"))

            clean_isbns = [re.sub(r"[^0-9X]", "", str(i).upper()) for i in isbns_list if str(i).strip()]

            processed_books.append({
                "book_index": idx,
                "polygon_coords": clamped_poly,
                "title": title,
                "authors": authors,
                "publication": (b.get("publisher") or "").strip(),
                "pub_year": b.get("pub_year"),
                "isbn_primary": clean_isbns[0] if clean_isbns else None,
                "isbns": clean_isbns,
                "subjects": (b.get("subjects") or "").strip(),
                "misc": (b.get("series_misc") or "").strip(),
                "raw_text": raw_spine_text,
                "is_ignored": is_ignored,
                "enrichment_status": "pending"
            })

        ignored_count = sum(1 for b in processed_books if b["is_ignored"])
        log(3, f"Categorized {len(processed_books)} books ({ignored_count} suppressed as front-edges)")

        # --- STEP 4: Canonical Open Library Enrichment ---
        if skip_enrichment:
            log(4, "Queued Open Library catalog enrichment for pipeline queue...")
            for b in processed_books:
                if not b["is_ignored"]:
                    b["enrichment_status"] = "pending"
        else:
            log(4, "Performing Open Library bibliographic verification and canonical enrichment...")
            enriched_count = 0
            for b in processed_books:
                if b["is_ignored"]:
                    continue

                meta, _ = openlibrary_client.enrich_book_metadata(b.get("title"), b.get("authors"))
                if meta:
                    b["ol_title"] = meta.get("ol_title")
                    b["ol_authors"] = meta.get("ol_authors")
                    b["ol_publisher"] = meta.get("ol_publisher")
                    for isbn in meta.get("isbns", []):
                        if isbn not in b["isbns"]:
                            b["isbns"].append(isbn)
                    if not b["isbn_primary"] and b["isbns"]:
                        b["isbn_primary"] = b["isbns"][0]
                    b["enrichment_status"] = "matched"
                    enriched_count += 1
                else:
                    b["enrichment_status"] = "not_found"

            log(4, f"Enriched {enriched_count} books against canonical Open Library catalog")

        return {
            "orig_width": orig_w,
            "orig_height": orig_h,
            "web_image_bytes": web_image_bytes,
            "books": processed_books,
            "total_books": len(processed_books),
            "ignored_books": ignored_count
        }
