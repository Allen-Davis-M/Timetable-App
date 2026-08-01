"""Pydantic schemas for School — what the API accepts/returns, separate from
the SQLAlchemy model that defines what the database stores."""
from pydantic import BaseModel, ConfigDict


class SchoolCreate(BaseModel):
    name: str


class SchoolOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    # The current user's role for THIS school specifically ("admin" or
    # "viewer") — not a column on the School model, computed per-request
    # by whichever router endpoint builds this (see app/core/access.py).
    # Lets the frontend gate write UI (hide "Add", "Generate", etc. for a
    # viewer) without a separate round-trip to find out.
    role: str = "admin"
