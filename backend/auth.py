import os
from pathlib import Path
from typing import Optional
from dotenv import load_dotenv
from fastapi import Header, HTTPException
from supabase import create_client, Client

BASE_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BASE_DIR.parent
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


async def get_current_user(authorization: Optional[str] = Header(None)) -> dict:
    """
    Validates the Supabase JWT Bearer token from the incoming client request.
    Returns user dict containing 'id' and 'email'.
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
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Authentication error: {str(e)}")
