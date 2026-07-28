"""Pydantic schemas for School — what the API accepts/returns, separate from
the SQLAlchemy model that defines what the database stores."""
from pydantic import BaseModel, ConfigDict


class SchoolCreate(BaseModel):
    name: str


class SchoolOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
