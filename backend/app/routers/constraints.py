from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.school import Constraint, Teacher
from app.schemas.constraint import (
    ConstraintCreate,
    ConstraintOut,
    ConstraintParseRequest,
    ConstraintParseResponse,
    ConstraintUpdate,
)
from app.services.constraint_parser import parse_constraint

router = APIRouter(prefix="/api/constraints", tags=["constraints"])


@router.post("", response_model=ConstraintOut, status_code=201)
def create_constraint(payload: ConstraintCreate, db: Session = Depends(get_db)):
    constraint = Constraint(**payload.model_dump())
    db.add(constraint)
    db.commit()
    db.refresh(constraint)
    return constraint


@router.get("", response_model=list[ConstraintOut])
def list_constraints(school_id: int | None = None, db: Session = Depends(get_db)):
    query = db.query(Constraint)
    if school_id is not None:
        query = query.filter(Constraint.school_id == school_id)
    return query.all()


@router.get("/{constraint_id}", response_model=ConstraintOut)
def get_constraint(constraint_id: int, db: Session = Depends(get_db)):
    constraint = db.get(Constraint, constraint_id)
    if not constraint:
        raise HTTPException(status_code=404, detail="Constraint not found")
    return constraint


@router.put("/{constraint_id}", response_model=ConstraintOut)
def update_constraint(constraint_id: int, payload: ConstraintUpdate, db: Session = Depends(get_db)):
    constraint = db.get(Constraint, constraint_id)
    if not constraint:
        raise HTTPException(status_code=404, detail="Constraint not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(constraint, field, value)
    db.commit()
    db.refresh(constraint)
    return constraint


@router.delete("/{constraint_id}", status_code=204)
def delete_constraint(constraint_id: int, db: Session = Depends(get_db)):
    constraint = db.get(Constraint, constraint_id)
    if not constraint:
        raise HTTPException(status_code=404, detail="Constraint not found")
    db.delete(constraint)
    db.commit()


@router.post("/parse", response_model=ConstraintParseResponse, status_code=201)
def parse_and_create_constraint(payload: ConstraintParseRequest, db: Session = Depends(get_db)):
    """
    Take plain-English constraint text, parse it (see
    app/services/constraint_parser.py), save it as a Constraint row, and —
    for the cases the solver actually understands today — apply it for
    real. Currently that's just workload limits: "X can teach max N
    periods/week" sets Teacher.max_periods_per_week, which the solver
    already enforces.
    """
    teachers = db.query(Teacher).filter(Teacher.school_id == payload.school_id).all()
    teacher_by_name = {t.name: t for t in teachers}

    parsed = parse_constraint(payload.text, [t.name for t in teachers])

    matched_teacher = teacher_by_name.get(parsed.teacher_name) if parsed.teacher_name else None
    enforced = False
    parameters = {}

    if parsed.type == "workload_limit" and matched_teacher and parsed.max_periods_per_week:
        matched_teacher.max_periods_per_week = parsed.max_periods_per_week
        parameters = {"teacher_id": matched_teacher.id, "max_periods_per_week": parsed.max_periods_per_week}
        enforced = True
    elif matched_teacher:
        parameters = {"teacher_id": matched_teacher.id}

    constraint = Constraint(
        school_id=payload.school_id,
        type=parsed.type,
        parameters=parameters,
        is_hard=True,
        description=parsed.description,
    )
    db.add(constraint)
    db.commit()
    db.refresh(constraint)

    return ConstraintParseResponse(constraint=constraint, enforced=enforced)
