"""Pydantic schemas for SubstitutionLog — see app/models/school.py's
SubstitutionLog docstring for what this feature is (a same-day manual
substitution record, not something the solver reads)."""
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class SubstitutionChange(BaseModel):
    period_id: int
    absent_teacher_id: int
    substituting_teacher_id: int
    class_group_id: int
    subject_id: int | None = None


class SubstitutionLogCreate(BaseModel):
    day_of_week: int
    changes: list[SubstitutionChange]


class SubstitutionLogOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    school_id: int
    day_of_week: int
    created_at: datetime
    changes: list[SubstitutionChange]
