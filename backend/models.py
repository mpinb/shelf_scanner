from typing import Optional
from pydantic import BaseModel


class BookUpdate(BaseModel):
    """Pydantic schema for partial book record updates."""
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
