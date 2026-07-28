from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.school import Subject
from app.schemas.subject import SubjectCreate, SubjectOut, SubjectUpdate

router = APIRouter(prefix="/api/subjects", tags=["subjects"])


@router.post("", response_model=SubjectOut, status_code=201)
def create_subject(payload: SubjectCreate, db: Session = Depends(get_db)):
    subject = Subject(**payload.model_dump())
    db.add(subject)
    db.commit()
    db.refresh(subject)
    return subject


@router.get("", response_model=list[SubjectOut])
def list_subjects(school_id: int | None = None, db: Session = Depends(get_db)):
    query = db.query(Subject)
    if school_id is not None:
        query = query.filter(Subject.school_id == school_id)
    return query.all()


@router.get("/{subject_id}", response_model=SubjectOut)
def get_subject(subject_id: int, db: Session = Depends(get_db)):
    subject = db.get(Subject, subject_id)
    if not subject:
        raise HTTPException(status_code=404, detail="Subject not found")
    return subject


@router.put("/{subject_id}", response_model=SubjectOut)
def update_subject(subject_id: int, payload: SubjectUpdate, db: Session = Depends(get_db)):
    subject = db.get(Subject, subject_id)
    if not subject:
        raise HTTPException(status_code=404, detail="Subject not found")
    subject.name = payload.name
    db.commit()
    db.refresh(subject)
    return subject


@router.delete("/{subject_id}", status_code=204)
def delete_subject(subject_id: int, db: Session = Depends(get_db)):
    subject = db.get(Subject, subject_id)
    if not subject:
        raise HTTPException(status_code=404, detail="Subject not found")
    db.delete(subject)
    db.commit()
