from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.school import (
    ClassGroup,
    Period,
    Subject,
    Teacher,
    Timetable,
    TimetableEntry,
)
from app.schemas.timetable import GenerateTimetableResponse, TimetableOut
from app.services.solver import generate_school_timetable

router = APIRouter(prefix="/api/timetables", tags=["timetables"])


def _to_timetable_out(db: Session, timetable: Timetable) -> TimetableOut:
    """Attach human-readable names to each entry, since the DB only stores
    foreign keys. Done here (not in the DB model) to keep the model layer
    free of presentation concerns."""
    class_groups = {c.id: c for c in db.query(ClassGroup).filter(
        ClassGroup.school_id == timetable.school_id
    ).all()}
    subjects = {s.id: s for s in db.query(Subject).filter(
        Subject.school_id == timetable.school_id
    ).all()}
    teachers = {t.id: t for t in db.query(Teacher).filter(
        Teacher.school_id == timetable.school_id
    ).all()}
    periods = {p.id: p for p in db.query(Period).filter(
        Period.school_id == timetable.school_id
    ).all()}

    entries = []
    for e in timetable.entries:
        period = periods[e.period_id]
        entries.append({
            "id": e.id,
            "class_group_id": e.class_group_id,
            "class_group_name": class_groups[e.class_group_id].name,
            "subject_id": e.subject_id,
            "subject_name": subjects[e.subject_id].name,
            "teacher_id": e.teacher_id,
            "teacher_name": teachers[e.teacher_id].name,
            "period_id": e.period_id,
            "period_label": period.label,
            "day_of_week": period.day_of_week,
            "order": period.order,
            "locked": e.locked,
        })

    return TimetableOut(
        id=timetable.id,
        school_id=timetable.school_id,
        status=timetable.status,
        entries=entries,
    )


@router.post("/generate", response_model=GenerateTimetableResponse)
def generate_timetable(school_id: int, db: Session = Depends(get_db)):
    """
    Run the solver for a school and persist the result as a new Timetable
    (status="draft") if a schedule was found.

    Always returns 200 with a `solver_status` field rather than raising on
    infeasibility — infeasible is a normal, expected outcome (the admin's
    constraints don't fit), not a server error. See docs/ARCHITECTURE.md
    for why this distinction matters for the UX.
    """
    result = generate_school_timetable(db, school_id)

    if result.status not in ("optimal", "feasible"):
        return GenerateTimetableResponse(
            solver_status=result.status,
            errors=result.errors or [
                "No feasible timetable found with the current data and constraints."
            ],
        )

    timetable = Timetable(school_id=school_id, status="draft")
    db.add(timetable)
    db.flush()  # get timetable.id without committing yet

    for a in result.assignments:
        db.add(TimetableEntry(
            timetable_id=timetable.id,
            class_group_id=a["class_group_id"],
            subject_id=a["subject_id"],
            teacher_id=a["teacher_id"],
            period_id=a["period_id"],
        ))

    db.commit()
    db.refresh(timetable)

    return GenerateTimetableResponse(
        solver_status=result.status,
        timetable=_to_timetable_out(db, timetable),
    )


@router.get("/{timetable_id}", response_model=TimetableOut)
def get_timetable(timetable_id: int, db: Session = Depends(get_db)):
    timetable = db.get(Timetable, timetable_id)
    if not timetable:
        raise HTTPException(status_code=404, detail="Timetable not found")
    return _to_timetable_out(db, timetable)


@router.get("", response_model=list[TimetableOut])
def list_timetables(school_id: int, db: Session = Depends(get_db)):
    timetables = db.query(Timetable).filter(Timetable.school_id == school_id).all()
    return [_to_timetable_out(db, t) for t in timetables]
