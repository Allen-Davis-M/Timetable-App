"""
CRUD endpoints for schools — the first vertical slice through the stack
(router -> schema -> model -> database). Later routers for teachers,
class groups, subjects, rooms, and constraints follow this same pattern.

Schools are owned by a user (see owner_id on the School model): creating
one attaches the logged-in user as owner, and listing only returns the
current user's own schools. Other resources (subjects, teachers, etc.)
are still just scoped by school_id without an ownership check — a known
simplification, fine while there's one admin per school, worth revisiting
before this supports multiple admins per school.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.core.database import get_db
from app.models.school import School
from app.models.user import User
from app.schemas.school import SchoolCreate, SchoolOut

router = APIRouter(prefix="/api/schools", tags=["schools"])


@router.post("", response_model=SchoolOut, status_code=201)
def create_school(
    payload: SchoolCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    school = School(name=payload.name, owner_id=current_user.id)
    db.add(school)
    db.commit()
    db.refresh(school)
    return school


@router.get("", response_model=list[SchoolOut])
def list_schools(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return db.query(School).filter(School.owner_id == current_user.id).all()


@router.get("/{school_id}", response_model=SchoolOut)
def get_school(
    school_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    school = db.get(School, school_id)
    if not school or school.owner_id != current_user.id:
        raise HTTPException(status_code=404, detail="School not found")
    return school
