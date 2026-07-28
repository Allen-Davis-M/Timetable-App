from pydantic import BaseModel, ConfigDict


class TeacherCreate(BaseModel):
    school_id: int
    name: str
    email: str | None = None
    qualified_subject_ids: list[int] = []
    unavailable_period_ids: list[int] = []
    max_periods_per_week: int | None = None


class TeacherUpdate(BaseModel):
    name: str | None = None
    email: str | None = None
    qualified_subject_ids: list[int] | None = None
    unavailable_period_ids: list[int] | None = None
    max_periods_per_week: int | None = None


class TeacherOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    school_id: int
    name: str
    email: str | None
    qualified_subject_ids: list[int]
    unavailable_period_ids: list[int]
    max_periods_per_week: int | None
