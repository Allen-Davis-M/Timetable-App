from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.school import Teacher
from app.schemas.teacher import TeacherCreate, TeacherOut, TeacherUpdate

router = APIRouter(prefix="/api/teachers", tags=["teachers"])


@router.post("", response_model=TeacherOut, status_code=201)
def create_teacher(payload: TeacherCreate, db: Session = Depends(get_db)):
    teacher = Teacher(**payload.model_dump())
    db.add(teacher)
    db.commit()
    db.refresh(teacher)
    return teacher


@router.get("", response_model=list[TeacherOut])
def list_teachers(school_id: int | None = None, db: Session = Depends(get_db)):
    query = db.query(Teacher)
    if school_id is not None:
        query = query.filter(Teacher.school_id == school_id)
    return query.all()


@router.get("/{teacher_id}", response_model=TeacherOut)
def get_teacher(teacher_id: int, db: Session = Depends(get_db)):
    teacher = db.get(Teacher, teacher_id)
    if not teacher:
        raise HTTPException(status_code=404, detail="Teacher not found")
    return teacher


@router.put("/{teacher_id}", response_model=TeacherOut)
def update_teacher(teacher_id: int, payload: TeacherUpdate, db: Session = Depends(get_db)):
    teacher = db.get(Teacher, teacher_id)
    if not teacher:
        raise HTTPException(status_code=404, detail="Teacher not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(teacher, field, value)
    db.commit()
    db.refresh(teacher)
    return teacher


@router.delete("/{teacher_id}", status_code=204)
def delete_teacher(teacher_id: int, db: Session = Depends(get_db)):
    teacher = db.get(Teacher, teacher_id)
    if not teacher:
        raise HTTPException(status_code=404, detail="Teacher not found")
    db.delete(teacher)
    db.commit()
