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

try:
    from backend.auth import supabase_admin as supabase, BUCKET_NAME
    from backend.pipeline import ShelfVisionPipeline
    from backend.openlibrary import openlibrary_client
except ImportError:
    from auth import supabase_admin as supabase, BUCKET_NAME
    from pipeline import ShelfVisionPipeline
    from openlibrary import openlibrary_client

pipeline = ShelfVisionPipeline()

_last_queue_err_time = 0
MAX_JOB_TRIES = 3


def process_enrichment_job(job: dict) -> bool:
    """
    Processes an Open Library enrichment job from the pipeline queue.
    - Sends up to 3 requests / s to Open Library (maximizing throughput).
    - If an individual request fails, retries with backoff up to max attempt limit.
    - If the job encounters transient server errors, schedules a retry up to MAX_JOB_TRIES.
    - Does NOT count towards the user's daily vision inference limit.
    """
    job_id = job["id"]
    user_id = job["user_id"]
    shelf_id = job.get("shelf_id")
    image_path = job.get("image_path", "")
    shelf_name = job.get("shelf_name", "Shelf")

    # Parse shelf_id and retry count from image_path:
    # Formats: "enrichment:<shelf_id>" or "enrichment:<shelf_id>:try<N>"
    parts = image_path.split(":")
    if not shelf_id and len(parts) >= 2:
        shelf_id = parts[1]

    current_try = 1
    if len(parts) >= 3 and parts[2].startswith("try"):
        try:
            current_try = int(parts[2].replace("try", ""))
        except Exception:
            current_try = 1

    print(f"\n[Worker] Claimed Open Library enrichment job {job_id} for shelf '{shelf_name}' (attempt {current_try}/{MAX_JOB_TRIES})...")
    logs = job.get("logs") or []
    if not isinstance(logs, list):
        logs = []

    def update_enrich_step(step, detail, new_log=None):
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
        update_enrich_step(1, f"Loading books for shelf '{shelf_name}'...", f"Starting Open Library catalog enrichment (attempt {current_try}/{MAX_JOB_TRIES})")

        # Fetch books for this shelf
        books_res = supabase.table("books").select("*").eq("shelf_id", shelf_id).order("book_index").execute()
        books = books_res.data or []

        # Only process books that are not suppressed/ignored and not already matched
        unenriched_books = [b for b in books if not b.get("is_ignored") and b.get("enrichment_status") != "matched"]

        if not unenriched_books:
            update_enrich_step(5, "All books on shelf are already verified against Open Library.", "No unenriched books remaining")
            supabase.table("pipeline_jobs").update({
                "status": "completed",
                "current_step": 5,
                "step_details": "All books already matched with Open Library",
                "logs": logs,
                "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            }).eq("id", job_id).execute()
            print(f"[Worker] Open Library job {job_id} COMPLETED: 0 unenriched books remaining.")
            return True

        total_to_process = len(unenriched_books)
        update_enrich_step(2, f"Enriching {total_to_process} books against Open Library (max 3 req/s)...", f"Beginning catalog queries for {total_to_process} books (3 req/s max)")

        matched_count = 0
        not_found_count = 0
        transient_error_count = 0

        for idx, b in enumerate(unenriched_books, start=1):
            title = b.get("title") or ""
            authors = b.get("authors") or ""

            meta, had_transient = openlibrary_client.enrich_book_metadata(title, authors)

            if meta:
                # Successfully matched against Open Library
                update_data = {
                    "ol_title": meta.get("ol_title"),
                    "ol_authors": meta.get("ol_authors"),
                    "ol_publisher": meta.get("ol_publisher"),
                    "isbn_primary": meta.get("isbn_primary") or b.get("isbn_primary"),
                    "isbns": meta.get("isbns") or b.get("isbns") or [],
                    "enrichment_status": "matched",
                    "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
                }
                supabase.table("books").update(update_data).eq("id", b["id"]).execute()
                matched_count += 1
                disp_title = (meta.get("ol_title") or title)[:35]
                print(f"[Worker-OL] #{b['book_index']} '{title[:25]}' -> MATCHED: '{disp_title}'")
            elif had_transient:
                transient_error_count += 1
                print(f"[Worker-OL] #{b['book_index']} '{title[:25]}' -> TRANSIENT ERROR (will retry later)")
            else:
                # Definitively not in Open Library catalog
                supabase.table("books").update({
                    "enrichment_status": "not_found",
                    "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
                }).eq("id", b["id"]).execute()
                not_found_count += 1
                print(f"[Worker-OL] #{b['book_index']} '{title[:25]}' -> NOT FOUND in Open Library")

            # Update progress periodically
            if idx % 5 == 0 or idx == total_to_process:
                update_enrich_step(3, f"Enriching: {idx}/{total_to_process} queried ({matched_count} matched)...")

            # Polite pause between consecutive books to avoid burst traffic
            time.sleep(0.1)

        # Check if retry is needed due to transient errors
        if transient_error_count > 0:
            if current_try < MAX_JOB_TRIES:
                next_try = current_try + 1
                backoff_seconds = 15 * current_try
                logs.append(f"[{time.strftime('%H:%M:%S')}] {transient_error_count} books had transient network/429 errors. Retrying in {backoff_seconds}s (attempt {next_try}/{MAX_JOB_TRIES}).")
                print(f"[Worker-OL] {transient_error_count} books had transient errors. Scheduling retry {next_try}/{MAX_JOB_TRIES} after {backoff_seconds}s...")
                time.sleep(backoff_seconds)
                supabase.table("pipeline_jobs").update({
                    "status": "queued",
                    "image_path": f"enrichment:{shelf_id}:try{next_try}",
                    "current_step": 1,
                    "step_details": f"Retrying Open Library enrichment (attempt {next_try}/{MAX_JOB_TRIES})...",
                    "logs": logs,
                    "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
                }).eq("id", job_id).execute()
                return True
            else:
                # Max try limit reached: mark remaining pending books as not_found
                for b in unenriched_books:
                    if b.get("enrichment_status") == "pending":
                        supabase.table("books").update({"enrichment_status": "not_found"}).eq("id", b["id"]).execute()
                logs.append(f"[{time.strftime('%H:%M:%S')}] Reached maximum try limit ({MAX_JOB_TRIES}/{MAX_JOB_TRIES}). Finished enrichment.")
                supabase.table("pipeline_jobs").update({
                    "status": "completed",
                    "current_step": 5,
                    "step_details": f"Completed (max tries reached): {matched_count} enriched, {not_found_count + transient_error_count} not found",
                    "logs": logs,
                    "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
                }).eq("id", job_id).execute()
                print(f"[Worker-OL] Job {job_id} reached max tries ({MAX_JOB_TRIES}). Completed with {matched_count} matched.")
                return True
        else:
            # Completed without any transient errors
            logs.append(f"[{time.strftime('%H:%M:%S')}] Enriched {matched_count} of {total_to_process} books against Open Library ({not_found_count} not found)")
            supabase.table("pipeline_jobs").update({
                "status": "completed",
                "current_step": 5,
                "step_details": f"Successfully enriched {matched_count} of {total_to_process} books against Open Library",
                "logs": logs,
                "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            }).eq("id", job_id).execute()
            print(f"[Worker-OL] Job {job_id} COMPLETED. {matched_count} matched, {not_found_count} not found.")
            return True

    except Exception as e:
        err_msg = str(e)
        print(f"[Worker-OL] Enrichment job {job_id} encountered error: {err_msg}")
        traceback.print_exc()
        if current_try < MAX_JOB_TRIES:
            next_try = current_try + 1
            logs.append(f"[{time.strftime('%H:%M:%S')}] Error: {err_msg}. Scheduling retry {next_try}/{MAX_JOB_TRIES}...")
            time.sleep(10)
            supabase.table("pipeline_jobs").update({
                "status": "queued",
                "image_path": f"enrichment:{shelf_id}:try{next_try}",
                "step_details": f"Retrying Open Library enrichment (attempt {next_try}/{MAX_JOB_TRIES})...",
                "logs": logs,
                "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            }).eq("id", job_id).execute()
        else:
            logs.append(f"[{time.strftime('%H:%M:%S')}] ERROR: {err_msg} (max retries reached)")
            supabase.table("pipeline_jobs").update({
                "status": "failed",
                "error_message": err_msg,
                "logs": logs,
                "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            }).eq("id", job_id).execute()
        return True


def process_next_job():
    """
    Pulls the next queued job from pipeline_jobs:
    - If image_path starts with 'enrichment:', runs Open Library catalog enrichment.
    - If image_path is an image, runs the vision pipeline, saves books, and queues enrichment.
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

    # Check if this is an Open Library enrichment job
    if image_path.startswith("enrichment:"):
        return process_enrichment_job(job)

    print(f"\n[Worker] Claimed vision scan job {job_id} for user {user_id} ({shelf_name})...")
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

        # 3. Execute Vision Pipeline (skip inline enrichment; queued as dedicated pipeline task)
        def pipeline_logger(step, msg):
            update_job_step(step, msg, msg)

        pipeline_result = pipeline.process_image(img_bytes, log_callback=pipeline_logger, skip_enrichment=True)
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

        # 7. Bulk Insert Books
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
            chunk_size = 50
            for i in range(0, len(db_books), chunk_size):
                supabase.table("books").insert(db_books[i:i + chunk_size]).execute()

        # 8. Complete Vision Scan Job
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

        # 9. Automatically enqueue Open Library catalog enrichment into pipeline queue
        try:
            enrichment_job = {
                "user_id": user_id,
                "shelf_id": created_shelf_id,
                "shelf_name": shelf_name,
                "room": room,
                "image_path": f"enrichment:{created_shelf_id}",
                "status": "queued",
                "current_step": 1,
                "step_details": f"Queued Open Library catalog enrichment for {len(db_books)} books",
                "logs": [f"[{time.strftime('%H:%M:%S')}] Enqueued Open Library enrichment job"]
            }
            supabase.table("pipeline_jobs").insert(enrichment_job).execute()
            print(f"[Worker] Enqueued Open Library enrichment job for shelf {created_shelf_id}")
        except Exception as eq_err:
            print(f"[Worker] Warning enqueuing enrichment job: {eq_err}")

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
