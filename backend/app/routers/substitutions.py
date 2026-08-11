"""
Endpoints for logging same-day teacher substitutions (e.g. "Ms. Iyer is
out today, Mr. Rao is covering her Period 3 class"). See
app/models/school.py's SubstitutionLog docstring — this is a simple audit
log an admin fills in by hand, not something the solver reads.

Note on the access-control pattern here vs. other routers:
require_school_access (app/core/access.py) is a plain function you call
inside a route body with an already-resolved db session and user, e.g.
`require_school_access(db, current_user, school_id)` — it is NOT itself a
FastAPI dependency, so it must never be wrapped in `Depends(...)`. Doing
that was a real bug in an earlier draft of this file: FastAPI tried to
resolve require_school_access's own `db: Session` parameter as request
input, which isn't a valid Pydantic field type, and crashed the whole app
at import time (backend wouldn't start at all, not just this endpoint).
Every other router in this codebase gets `db`/`current_user` from their
own real dependencies first, then calls require_school_access directly —
this file now follows that same pattern.
"""
from typing import List

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.access import require_school_access
from app.core.auth import get_current_user
from app.core.database import get_db
from app.models.school import SubstitutionLog
from app.models.user import User
from app.schemas.substitutions import SubstitutionLogCreate, SubstitutionLogOut

router = APIRouter(prefix="/api/schools/{school_id}/substitutions", tags=["substitutions"])


@router.get("", response_model=List[SubstitutionLogOut])
def list_substitutions(
    school_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return all substitution logs for a school, most recent first."""
    require_school_access(db, current_user, school_id)
    return (
        db.query(SubstitutionLog)
        .filter(SubstitutionLog.school_id == school_id)
        .order_by(SubstitutionLog.created_at.desc())
        .all()
    )


@router.post("", response_model=SubstitutionLogOut, status_code=201)
def create_substitution(
    school_id: int,
    data: SubstitutionLogCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Save a day's substitution log. Admin-only, same as every other
    write endpoint in this app (subjects, teachers, constraints, etc.) —
    a viewer can see substitution history but not add to it."""
    require_school_access(db, current_user, school_id, min_role="admin")
    log = SubstitutionLog(
        school_id=school_id,
        day_of_week=data.day_of_week,
        changes=[change.model_dump() for change in data.changes],
    )
    db.add(log)
    db.commit()
    db.refresh(log)
    return log

