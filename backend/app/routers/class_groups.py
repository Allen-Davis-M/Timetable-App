from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.school import ClassGroup, SubjectRequirement
from app.schemas.class_group import (
    ClassGroupCreate,
    ClassGroupOut,
    ClassGroupUpdate,
    SubjectRequirementCreate,
    SubjectRequirementOut,
    SubjectRequirementUpdate,
)

router = APIRouter(prefix="/api/class-groups", tags=["class groups"])


@router.post("", response_model=ClassGroupOut, status_code=201)
def create_class_group(payload: ClassGroupCreate, db: Session = Depends(get_db)):
    class_group = ClassGroup(**payload.model_dump())
    db.add(class_group)
    db.commit()
    db.refresh(class_group)
    return class_group


@router.get("", response_model=list[ClassGroupOut])
def list_class_groups(school_id: int | None = None, db: Session = Depends(get_db)):
    query = db.query(ClassGroup)
    if school_id is not None:
        query = query.filter(ClassGroup.school_id == school_id)
    return query.all()


@router.get("/{class_group_id}", response_model=ClassGroupOut)
def get_class_group(class_group_id: int, db: Session = Depends(get_db)):
    class_group = db.get(ClassGroup, class_group_id)
    if not class_group:
        raise HTTPException(status_code=404, detail="Class group not found")
    return class_group


@router.put("/{class_group_id}", response_model=ClassGroupOut)
def update_class_group(class_group_id: int, payload: ClassGroupUpdate, db: Session = Depends(get_db)):
    class_group = db.get(ClassGroup, class_group_id)
    if not class_group:
        raise HTTPException(status_code=404, detail="Class group not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(class_group, field, value)
    db.commit()
    db.refresh(class_group)
    return class_group


@router.delete("/{class_group_id}", status_code=204)
def delete_class_group(class_group_id: int, db: Session = Depends(get_db)):
    class_group = db.get(ClassGroup, class_group_id)
    if not class_group:
        raise HTTPException(status_code=404, detail="Class group not found")
    db.delete(class_group)
    db.commit()


# --- Subject requirements: "this class group needs N periods/week of subject X" ---
# Nested under class-groups since a requirement doesn't make sense without its
# class group, but subject_id/teacher_id reference the other generic tables.


@router.post(
    "/{class_group_id}/requirements",
    response_model=SubjectRequirementOut,
    status_code=201,
)
def add_requirement(
    class_group_id: int, payload: SubjectRequirementCreate, db: Session = Depends(get_db)
):
    if payload.class_group_id != class_group_id:
        raise HTTPException(
            status_code=400, detail="class_group_id in body must match URL"
        )
    class_group = db.get(ClassGroup, class_group_id)
    if not class_group:
        raise HTTPException(status_code=404, detail="Class group not found")

    # Upsert on (class_group_id, subject_id) rather than blind-insert: a
    # class group should only have one requirement per subject, and a
    # duplicate here (e.g. from a client-side race — two "create" calls in
    # quick succession before the first one's result comes back) would
    # silently inflate the real periods/week total past what the UI shows,
    # which can make the solver infeasible for no visible reason.
    existing = (
        db.query(SubjectRequirement)
        .filter(
            SubjectRequirement.class_group_id == class_group_id,
            SubjectRequirement.subject_id == payload.subject_id,
        )
        .first()
    )
    if existing:
        existing.periods_per_week = payload.periods_per_week
        existing.preferred_teacher_id = payload.preferred_teacher_id
        db.commit()
        db.refresh(existing)
        return existing

    requirement = SubjectRequirement(**payload.model_dump())
    db.add(requirement)
    db.commit()
    db.refresh(requirement)
    return requirement


@router.get("/{class_group_id}/requirements", response_model=list[SubjectRequirementOut])
def list_requirements(class_group_id: int, db: Session = Depends(get_db)):
    return (
        db.query(SubjectRequirement)
        .filter(SubjectRequirement.class_group_id == class_group_id)
        .all()
    )


@router.put("/requirements/{requirement_id}", response_model=SubjectRequirementOut)
def update_requirement(
    requirement_id: int, payload: SubjectRequirementUpdate, db: Session = Depends(get_db)
):
    requirement = db.get(SubjectRequirement, requirement_id)
    if not requirement:
        raise HTTPException(status_code=404, detail="Requirement not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(requirement, field, value)
    db.commit()
    db.refresh(requirement)
    return requirement


@router.delete("/requirements/{requirement_id}", status_code=204)
def delete_requirement(requirement_id: int, db: Session = Depends(get_db)):
    requirement = db.get(SubjectRequirement, requirement_id)
    if not requirement:
        raise HTTPException(status_code=404, detail="Requirement not found")
    db.delete(requirement)
    db.commit()
