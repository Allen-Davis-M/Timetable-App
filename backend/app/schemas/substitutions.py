from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime

class SubstitutionChange(BaseModel):
    period_id: int
    absent_teacher_id: int
    substituting_teacher_id: int
    class_group_id: int
    subject_id: Optional[int] = None

class SubstitutionLogCreate(BaseModel):
    day_of_week: int
    changes: List[SubstitutionChange]

class SubstitutionLogOut(BaseModel):
    id: int
    school_id: int
    day_of_week: int
    created_at: datetime
    changes: List[SubstitutionChange]

    class Config:
        from_attributes = True
