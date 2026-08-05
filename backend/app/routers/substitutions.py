from typing import List
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.auth import get_current_user
from app.core.access import require_school_access
from app.models.school import SubstitutionLog
from app.models.user import User
from app.schemas.substitutions import SubstitutionLogCreate, SubstitutionLogOut

router = APIRouter(prefix="/api/schools/{school_id}/substitutions", tags=["substitutions"])

@router.get("", response_model=List[SubstitutionLogOut])
def list_substitutions(school_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Return all substitution logs for a school, ordered by most recent first."""
    require_school_access(db, current_user, school_id, min_role="viewer")
    return db.query(SubstitutionLog).filter(SubstitutionLog.school_id == school_id).order_by(SubstitutionLog.created_at.desc()).all()

@router.post("", response_model=SubstitutionLogOut)
def create_substitution(school_id: int, data: SubstitutionLogCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Save a daily substitution log."""
    require_school_access(db, current_user, school_id, min_role="admin")
    log = SubstitutionLog(
        school_id=school_id,
        day_of_week=data.day_of_week,
        changes=[change.model_dump() for change in data.changes]
    )
    db.add(log)
    db.commit()
    db.refresh(log)
    return log

