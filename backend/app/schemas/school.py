"""Pydantic schemas for School — what the API accepts/returns, separate from
the SQLAlchemy model that defines what the database stores."""
from pydantic import BaseModel, ConfigDict


class SchoolCreate(BaseModel):
    name: str
    # "school" or "college", chosen in the create-school modal. Not
    # validated against a strict enum here — the frontend only ever sends
    # one of the two, and treating anything else as "school" (see
    # institution_type's docstring on the model) is a safer default than
    # a 422 on a typo'd value from some future caller.
    institution_type: str | None = None


class SchoolOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    institution_type: str | None = None
    # The current user's role for THIS school specifically ("admin" or
    # "viewer") — not a column on the School model, computed per-request
    # by whichever router endpoint builds this (see app/core/access.py).
    # Lets the frontend gate write UI (hide "Add", "Generate", etc. for a
    # viewer) without a separate round-trip to find out.
    role: str = "admin"
