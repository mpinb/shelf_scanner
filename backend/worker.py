import os
import time
import json
import traceback
import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BASE_DIR.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from dotenv import load_dotenv
from supabase import create_client, Client
try:
    from backend.pipeline import ShelfVisionPipeline
except ImportError:
    from pipeline import ShelfVisionPipeline
load_dotenv(PROJECT_ROOT / ".env")
load_dotenv(BASE_DIR / ".env")
load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_ANON_KEY")
BUCKET_NAME = "shelf-images"

if not SUPABASE_URL or not SUPABASE_KEY:
    raise ValueError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
pipeline = ShelfVisionPipeline()


_last_queue_err_time = 0

def process_next_job():
    """
    Pulls the next queued job from pipeline_jobs, runs the vision pipeline,
    uploads web-optimized assets, and ingests records into PostgreSQL.
    """
    global _last_queue_err_time
    # 1. Dequeue job
    try:
        res = supabase.table("pipeline_jobs").select("*").eq("status", "queued").order("created_at", desc=False).limit(1).execute()
        jobs = res.data or []
        if not jobs:
            return False  # No jobs pending
        job = jobs[0]
        job_id = job["id"]
        user_id = job["user_id"]
        shelf_name = job["shelf_name"]
        room = job.get("room") or "General"
        image_path = job["image_path"]
    except Exception as e:
        now = time.time()
        if now - _last_queue_err_time > 60:
            print(f"[Worker] Queue polling notice (run supabase/schema.sql in dashboard if not already done): {e}")
            _last_queue_err_time = now
        return False

    print(f"\n[Worker] Claimed job {job_id} for user {user_id} ({shelf_name})...")
    logs = [f"[{time.strftime('%H:%M:%S')}] Job claimed by background worker"]

    def update_job_step(step, detail, new_log=None):
        if new_log:
            logs.append(f"[{time.strftime('%H:%M:%S')}] {new_log}")
        supabase.table("pipeline_jobs").update({
            "status": "processing",
            "current_step": step,
            "step_details": detail,
            "logs": logs,
            "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        }).eq("id", job_id).execute()

    try:
        update_job_step(1, "Downloading shelf image from cloud storage...", "Fetching raw image from storage bucket")

        # 2. Download raw image from Supabase Storage
        img_bytes = supabase.storage.from_(BUCKET_NAME).download(image_path)
        if not img_bytes:
            raise ValueError(f"Could not download image from bucket {BUCKET_NAME} at path {image_path}")

        # 3. Execute Vision Pipeline
        def pipeline_logger(step, msg):
            update_job_step(step, msg, msg)

        pipeline_result = pipeline.process_image(img_bytes, log_callback=pipeline_logger)
        books_data = pipeline_result["books"]
        web_image_bytes = pipeline_result["web_image_bytes"]

        update_job_step(4, "Uploading web-optimized preview image...", "Saving web-scaled copy to storage")

        # 4. Upload web image to Supabase Storage
        web_path = f"{user_id}/web/{Path(image_path).stem}_web.jpg"
        try:
            supabase.storage.from_(BUCKET_NAME).upload(
                path=web_path,
                file=web_image_bytes,
                file_options={"content-type": "image/jpeg", "upsert": "true"}
            )
        except Exception as e:
            print(f"[Worker] Warning uploading web image: {e}")

        # Construct public URLs
        web_url = supabase.storage.from_(BUCKET_NAME).get_public_url(web_path)

        # 5. Delete raw uncompressed image from storage to save free-tier quota
        try:
            supabase.storage.from_(BUCKET_NAME).remove([image_path])
            logs.append(f"[{time.strftime('%H:%M:%S')}] Removed raw image {image_path} from storage (retained compressed web image)")
            print(f"[Worker] Removed raw upload {image_path} to conserve storage")
        except Exception as e:
            print(f"[Worker] Warning deleting raw image {image_path}: {e}")

        update_job_step(5, "Saving shelf and books to PostgreSQL database...", "Writing records into database")

        # 6. Insert or Update Shelf record (pointing to web image)
        shelf_record = {
            "user_id": user_id,
            "name": shelf_name,
            "room": room,
            "image_path": web_path,
            "image_url": web_url,
            "web_image_url": web_url,
            "total_books": len(books_data),
            "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        }

        # Check if shelf already exists for this job
        if job.get("shelf_id"):
            shelf_res = supabase.table("shelves").update(shelf_record).eq("id", job["shelf_id"]).execute()
            created_shelf_id = job["shelf_id"]
        else:
            shelf_res = supabase.table("shelves").insert(shelf_record).execute()
            created_shelf_id = shelf_res.data[0]["id"]

        # 6. Bulk Insert Books
        # Remove any existing books on this shelf if re-processing
        supabase.table("books").delete().eq("shelf_id", created_shelf_id).execute()

        db_books = []
        for b in books_data:
            db_books.append({
                "shelf_id": created_shelf_id,
                "user_id": user_id,
                "book_index": b["book_index"],
                "polygon_coords": b["polygon_coords"],
                "title": b["title"] or "Untitled",
                "ol_title": b.get("ol_title"),
                "authors": b["authors"],
                "ol_authors": b.get("ol_authors"),
                "publication": b["publication"],
                "ol_publisher": b.get("ol_publisher"),
                "pub_year": b["pub_year"],
                "isbn_primary": b["isbn_primary"],
                "isbns": b["isbns"],
                "subjects": b["subjects"],
                "misc": b["misc"],
                "raw_text": b["raw_text"],
                "is_ignored": b["is_ignored"],
                "enrichment_status": b["enrichment_status"]
            })

        if db_books:
            # Batch insert in chunks of 50
            chunk_size = 50
            for i in range(0, len(db_books), chunk_size):
                supabase.table("books").insert(db_books[i:i + chunk_size]).execute()

        # 7. Complete Job
        logs.append(f"[{time.strftime('%H:%M:%S')}] Ingested {len(db_books)} books successfully")
        supabase.table("pipeline_jobs").update({
            "status": "completed",
            "shelf_id": created_shelf_id,
            "current_step": 5,
            "step_details": f"Successfully processed {len(db_books)} books",
            "logs": logs,
            "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        }).eq("id", job_id).execute()

        print(f"[Worker] Job {job_id} COMPLETED successfully. {len(db_books)} books saved.")
        return True

    except Exception as e:
        err_msg = str(e)
        print(f"[Worker] Job {job_id} FAILED: {err_msg}")
        traceback.print_exc()
        logs.append(f"[{time.strftime('%H:%M:%S')}] ERROR: {err_msg}")
        supabase.table("pipeline_jobs").update({
            "status": "failed",
            "error_message": err_msg,
            "logs": logs,
            "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        }).eq("id", job_id).execute()
        return True


def run_worker_loop():
    """Continuous polling loop with sleep backoff."""
    print("[Worker] ShelfScanner Background Task Worker started. Listening for jobs...")
    while True:
        try:
            processed = process_next_job()
            if not processed:
                time.sleep(3)  # Sleep when queue is empty
        except KeyboardInterrupt:
            print("[Worker] Stopping worker gracefully.")
            break
        except Exception as e:
            print(f"[Worker] Unexpected loop error: {e}")
            time.sleep(5)


if __name__ == "__main__":
    run_worker_loop()
