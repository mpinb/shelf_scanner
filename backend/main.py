import os
import io
import time
import uuid
import threading
from pathlib import Path
from typing import Optional, List
from fastapi import FastAPI, Depends, HTTPException, Header, UploadFile, File, Form, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel
from dotenv import load_dotenv
from supabase import create_client, Client
import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BASE_DIR.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

try:
    from backend.exporter import generate_library_xlsx
except ImportError:
    from exporter import generate_library_xlsx
FRONTEND_DIR = PROJECT_ROOT / "frontend"

load_dotenv(PROJECT_ROOT / ".env")
load_dotenv(BASE_DIR / ".env")
load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or SUPABASE_ANON_KEY
BUCKET_NAME = "shelf-images"

if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
    raise ValueError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env")

# Admin client for database & worker operations
supabase_admin: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

import datetime
from PIL import Image

# Prevent PIL decompression bombs (limit to max 50 megapixels)
Image.MAX_IMAGE_PIXELS = 50_000_000

app = FastAPI(title="ShelfScanner Mobile API", version="1.0.0")

# CORS middleware: allow localhost/127.0.0.1 for development plus custom production origins
ALLOWED_ORIGINS_ENV = os.getenv("ALLOWED_ORIGINS", "")
allowed_origins = [
    "http://localhost",
    "http://localhost:8000",
    "http://localhost:3000",
    "http://localhost:5173",
    "http://localhost:8099",
    "http://127.0.0.1",
    "http://127.0.0.1:8000",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:8099",
]
if ALLOWED_ORIGINS_ENV:
    allowed_origins.extend([orig.strip() for orig in ALLOWED_ORIGINS_ENV.split(",") if orig.strip()])

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins if ALLOWED_ORIGINS_ENV or os.getenv("ENV") == "production" else ["*"],
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)


# --- Authentication Dependency ---
async def get_current_user(authorization: Optional[str] = Header(None)) -> dict:
    """
    Validates the Supabase JWT Bearer token from the client.
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid authentication token")
    
    token = authorization.split(" ")[1]
    try:
        user_res = supabase_admin.auth.get_user(token)
        if not user_res or not user_res.user:
            raise HTTPException(status_code=401, detail="Invalid session token")
        return {
            "id": user_res.user.id,
            "email": user_res.user.email
        }
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Authentication error: {str(e)}")


# --- Optional In-Process Worker for Single-Service Render Deployments ---
def start_background_worker_thread():
    from worker import process_next_job
    def loop():
        print("[App] In-process background task queue worker started.")
        while True:
            try:
                processed = process_next_job()
                if not processed:
                    time.sleep(3)
            except Exception as e:
                print(f"[App Worker Error] {e}")
                time.sleep(5)
    t = threading.Thread(target=loop, daemon=True)
    t.start()

start_background_worker_thread()


# --- Models ---
class BookUpdate(BaseModel):
    title: Optional[str] = None
    authors: Optional[str] = None
    publication: Optional[str] = None
    pub_year: Optional[int] = None
    isbn_primary: Optional[str] = None
    subjects: Optional[str] = None
    misc: Optional[str] = None
    raw_text: Optional[str] = None
    user_notes: Optional[str] = None
    is_ignored: Optional[bool] = None


# --- Public Configuration Endpoint ---
@app.get("/api/config")
def get_public_config():
    """Returns Supabase public URL and publishable key for mobile client init."""
    return {
        "supabase_url": SUPABASE_URL,
        "supabase_anon_key": SUPABASE_ANON_KEY
    }


# --- Task Queue: Upload & Enqueue Job ---
@app.post("/api/jobs")
async def create_scan_job(
    image: UploadFile = File(...),
    shelf_name: str = Form("My Bookshelf"),
    room: str = Form("General"),
    user: dict = Depends(get_current_user)
):
    """
    Uploads shelf image to Supabase Storage and enqueues a new background vision job.
    """
    user_id = user["id"]

    # 1. Daily rate limit: Max 50 scan jobs per day per user
    since_24h = (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=1)).isoformat()
    try:
        daily_count_res = supabase_admin.table("pipeline_jobs")\
            .select("id", count="exact")\
            .eq("user_id", user_id)\
            .not_.like("image_path", "enrichment:%")\
            .gte("created_at", since_24h)\
            .execute()
        if daily_count_res.count is not None and daily_count_res.count >= 50:
            raise HTTPException(
                status_code=429,
                detail="Daily limit reached: You cannot submit more than 50 shelf scans per 24 hours."
            )
    except HTTPException:
        raise
    except Exception as e:
        print(f"[Main] Warning checking daily scan count: {e}")

    # 2. File size validation (Max 15 MB)
    MAX_UPLOAD_SIZE = 15 * 1024 * 1024  # 15 MB
    contents = await image.read()
    if not contents:
        raise HTTPException(status_code=400, detail="Empty image uploaded")
    if len(contents) > MAX_UPLOAD_SIZE:
        raise HTTPException(status_code=400, detail="File too large. Maximum image size is 15 MB.")

    # 3. File magic / format validation (verify actual image integrity)
    try:
        img_check = Image.open(io.BytesIO(contents))
        img_check.verify()
        if img_check.format not in ("JPEG", "JPG", "PNG", "WEBP", "MPO"):
            raise HTTPException(status_code=400, detail=f"Unsupported image format: {img_check.format}. Please upload JPEG, PNG, or WEBP.")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid or corrupted image file: {str(e)}")

    # Clean and sanitize shelf name and room
    clean_shelf_name = (shelf_name or "My Bookshelf").strip()[:60]
    clean_room = (room or "General").strip()[:40]

    # Generate safe storage path: {user_id}/{timestamp}_{safe_filename}
    safe_suffix = Path(image.filename or "shelf.jpg").suffix.lower()
    if safe_suffix not in (".jpg", ".jpeg", ".png", ".webp"):
        safe_suffix = ".jpg"
    filename = f"{int(time.time())}_{uuid.uuid4().hex[:8]}{safe_suffix}"
    storage_path = f"{user_id}/{filename}"

    # Upload to Supabase Storage bucket
    try:
        supabase_admin.storage.from_(BUCKET_NAME).upload(
            path=storage_path,
            file=contents,
            file_options={"content-type": "image/jpeg" if safe_suffix in (".jpg", ".jpeg") else "image/png", "upsert": "true"}
        )
    except Exception as e:
        # Ignore if file already exists
        print(f"Storage upload notice: {e}")

    # Enqueue record in pipeline_jobs table
    job_record = {
        "user_id": user_id,
        "shelf_name": clean_shelf_name,
        "room": clean_room,
        "image_path": storage_path,
        "status": "queued",
        "current_step": 1,
        "step_details": "Image received, queued for vision inference...",
        "logs": [f"[{time.strftime('%H:%M:%S')}] Enqueued scan job"]
    }

    res = supabase_admin.table("pipeline_jobs").insert(job_record).execute()
    if not res.data:
        raise HTTPException(status_code=500, detail="Failed to enqueue scan job")

    job_data = res.data[0]
    return {
        "success": True,
        "job_id": job_data["id"],
        "status": job_data["status"],
        "message": "Scan job queued successfully!"
    }


@app.get("/api/jobs/{job_id}")
async def get_job_status(job_id: str, user: dict = Depends(get_current_user)):
    """Polls real-time progress and logs of a scan job."""
    res = supabase_admin.table("pipeline_jobs").select("*").eq("id", job_id).eq("user_id", user["id"]).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Job not found")
    return res.data[0]


# --- Daily Usage & Quota Endpoint ---
@app.get("/api/usage")
async def get_usage(user: dict = Depends(get_current_user)):
    """Returns the user's daily scan usage and remaining limit."""
    user_id = user["id"]
    since_24h = (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=1)).isoformat()
    try:
        daily_count_res = supabase_admin.table("pipeline_jobs")\
            .select("id", count="exact")\
            .eq("user_id", user_id)\
            .not_.like("image_path", "enrichment:%")\
            .gte("created_at", since_24h)\
            .execute()
        used = daily_count_res.count if daily_count_res.count is not None else 0
        limit = 50
        return {
            "used": used,
            "limit": limit,
            "remaining": max(0, limit - used)
        }
    except Exception as e:
        print(f"[Main] Error fetching usage: {e}")
        return {"used": 0, "limit": 50, "remaining": 50}


# --- Shelves Endpoints ---
@app.get("/api/shelves")
async def list_shelves(user: dict = Depends(get_current_user)):
    """Returns all shelves owned by the authenticated user."""
    res = supabase_admin.table("shelves").select("*").eq("user_id", user["id"]).order("created_at", desc=True).execute()
    return res.data or []


@app.get("/api/shelves/{shelf_id}")
async def get_shelf(shelf_id: str, user: dict = Depends(get_current_user)):
    """Returns shelf details along with all of its detected book records."""
    shelf_res = supabase_admin.table("shelves").select("*").eq("id", shelf_id).eq("user_id", user["id"]).execute()
    if not shelf_res.data:
        raise HTTPException(status_code=404, detail="Shelf not found")

    books_res = supabase_admin.table("books").select("*").eq("shelf_id", shelf_id).eq("user_id", user["id"]).order("book_index", desc=False).execute()
    
    return {
        "shelf": shelf_res.data[0],
        "books": books_res.data or []
    }


@app.post("/api/shelves/{shelf_id}/enrich")
async def trigger_shelf_enrichment(shelf_id: str, user: dict = Depends(get_current_user)):
    """
    Enqueues an Open Library bibliographic enrichment job for the shelf.
    Does not count against the user's daily vision inference scan limit.
    """
    shelf_res = supabase_admin.table("shelves").select("*").eq("id", shelf_id).eq("user_id", user["id"]).execute()
    if not shelf_res.data:
        raise HTTPException(status_code=404, detail="Shelf not found")

    shelf = shelf_res.data[0]

    # Check if an enrichment job is already queued or processing for this shelf
    active_jobs = supabase_admin.table("pipeline_jobs")\
        .select("id, status")\
        .eq("shelf_id", shelf_id)\
        .in_("status", ["queued", "processing"])\
        .like("image_path", "enrichment:%")\
        .execute()

    if active_jobs.data:
        return {
            "success": True,
            "job_id": active_jobs.data[0]["id"],
            "status": active_jobs.data[0]["status"],
            "message": "Enrichment job already queued or in progress for this shelf"
        }

    job_record = {
        "user_id": user["id"],
        "shelf_id": shelf_id,
        "shelf_name": shelf["name"],
        "room": shelf.get("room") or "General",
        "image_path": f"enrichment:{shelf_id}",
        "status": "queued",
        "current_step": 1,
        "step_details": "Queued for Open Library catalog enrichment...",
        "logs": [f"[{time.strftime('%H:%M:%S')}] Enqueued Open Library enrichment job"]
    }

    res = supabase_admin.table("pipeline_jobs").insert(job_record).execute()
    if not res.data:
        raise HTTPException(status_code=500, detail="Failed to enqueue enrichment job")

    return {
        "success": True,
        "job_id": res.data[0]["id"],
        "status": "queued",
        "message": "Open Library enrichment job queued successfully!"
    }


@app.delete("/api/shelves/{shelf_id}")
async def delete_shelf(shelf_id: str, user: dict = Depends(get_current_user)):
    """Deletes a shelf, its books, and associated image in storage. Preserves pipeline_jobs quota history."""
    shelf_res = supabase_admin.table("shelves").select("image_path").eq("id", shelf_id).eq("user_id", user["id"]).execute()
    if not shelf_res.data:
        raise HTTPException(status_code=404, detail="Shelf not found")

    image_path = shelf_res.data[0].get("image_path")
    if image_path:
        try:
            supabase_admin.storage.from_("shelf-images").remove([image_path])
        except Exception as e:
            print(f"[Main] Notice removing shelf image from storage: {e}")

    # Explicitly delete books on this shelf
    try:
        supabase_admin.table("books").delete().eq("shelf_id", shelf_id).eq("user_id", user["id"]).execute()
    except Exception as e:
        print(f"[Main] Notice deleting books: {e}")

    # Delete shelf record (pipeline_jobs is strictly untouched so daily API scan count is preserved)
    supabase_admin.table("shelves").delete().eq("id", shelf_id).eq("user_id", user["id"]).execute()
    return {"success": True, "deleted": shelf_id}


# --- Books Endpoints ---
@app.patch("/api/books/{book_id}")
async def update_book(book_id: str, updates: BookUpdate, user: dict = Depends(get_current_user)):
    """Updates metadata or ignored status of an individual book record."""
    data = {k: v for k, v in updates.dict().items() if v is not None}
    if not data:
        return {"success": True}

    data["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    res = supabase_admin.table("books").update(data).eq("id", book_id).eq("user_id", user["id"]).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Book not found")
    return {"success": True, "book": res.data[0]}


# --- All Books Catalog ---
@app.get("/api/catalog")
async def get_catalog(user: dict = Depends(get_current_user)):
    """Returns all books across all shelves for the user."""
    res = supabase_admin.table("books").select("*, shelves(name, room)").eq("user_id", user["id"]).order("created_at", desc=False).execute()
    books = []
    for item in (res.data or []):
        shelf_info = item.pop("shelves", {}) or {}
        item["shelf_name"] = shelf_info.get("name") or "Shelf"
        item["room"] = shelf_info.get("room") or "General"
        books.append(item)
    return books


# --- XLSX Export Endpoint ---
@app.get("/api/export/xlsx")
async def export_xlsx(user: dict = Depends(get_current_user)):
    """Exports user's complete catalog to a styled, auto-fitted Excel spreadsheet."""
    res = supabase_admin.table("books").select("*, shelves(name, room)").eq("user_id", user["id"]).order("created_at", desc=False).execute()
    books_data = []
    for item in (res.data or []):
        shelf_info = item.pop("shelves", {}) or {}
        item["shelf_name"] = shelf_info.get("name") or "Shelf"
        books_data.append(item)

    xlsx_bytes = generate_library_xlsx(books_data)
    
    return Response(
        content=xlsx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=my_library_catalog.xlsx"}
    )


# --- Serve Mobile Web-App Frontend ---
if FRONTEND_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")

    @app.get("/")
    def serve_index():
        return FileResponse(
            FRONTEND_DIR / "index.html",
            headers={"Cache-Control": "no-cache, no-store, must-revalidate"}
        )

    @app.get("/favicon.ico")
    @app.get("/favicon.svg")
    def serve_favicon():
        return FileResponse(FRONTEND_DIR / "favicon.svg", media_type="image/svg+xml")

    @app.get("/manifest.json")
    def serve_manifest():
        return FileResponse(FRONTEND_DIR / "manifest.json", media_type="application/manifest+json")

    @app.get("/sw.js")
    def serve_sw():
        return FileResponse(
            FRONTEND_DIR / "sw.js",
            media_type="application/javascript",
            headers={"Cache-Control": "no-cache, no-store, must-revalidate"}
        )
