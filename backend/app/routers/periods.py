from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.access import require_school_access
from app.core.auth import get_current_user
from app.core.database import get_db
from app.models.school import Period
from app.models.user import User
from app.schemas.period import PeriodCreate, PeriodOut, PeriodUpdate

router = APIRouter(prefix="/api/periods", tags=["periods"])


@router.post("", response_model=PeriodOut, status_code=201)
def create_period(payload: PeriodCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    require_school_access(db, current_user, payload.school_id, min_role="admin")
    period = Period(**payload.model_dump())
    db.add(period)
    try:
        db.commit()
    except IntegrityError:
        # Period has a DB-level uniqueness rule on (school_id, day_of_week,
        # order) — two periods can't share the same slot on the same day.
        # Without this catch, a duplicate insert (e.g. clicking "Quick
        # setup" twice, or manually adding a slot that already exists)
        # surfaced as a raw 500 with a Postgres stack trace instead of a
        # message the admin can actually act on. db.rollback() is required
        # here — SQLAlchemy leaves the session unusable after a failed
        # flush until the transaction is explicitly rolled back, so any
        # *next* query on this session (even an unrelated one) would
        # otherwise also fail.
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail=f"A period already exists for day {payload.day_of_week}, slot {payload.order}.",
        )
    db.refresh(period)
    return period


@router.get("", response_model=list[PeriodOut])
def list_periods(school_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    require_school_access(db, current_user, school_id)
    return db.query(Period).filter(Period.school_id == school_id).order_by(Period.day_of_week, Period.order).all()


@router.get("/{period_id}", response_model=PeriodOut)
def get_period(period_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    period = db.get(Period, period_id)
    if not period:
        raise HTTPException(status_code=404, detail="Period not found")
    require_school_access(db, current_user, period.school_id)
    return period


@router.put("/{period_id}", response_model=PeriodOut)
def update_period(period_id: int, payload: PeriodUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    period = db.get(Period, period_id)
    if not period:
        raise HTTPException(status_code=404, detail="Period not found")
    require_school_access(db, current_user, period.school_id, min_role="admin")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(period, field, value)
    db.commit()
    db.refresh(period)
    return period


@router.delete("/{period_id}", status_code=204)
def delete_period(period_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    period = db.get(Period, period_id)
    if not period:
        raise HTTPException(status_code=404, detail="Period not found")
    require_school_access(db, current_user, period.school_id, min_role="admin")
    db.delete(period)
    db.commit()
