from pydantic import BaseModel, ConfigDict


class TeacherCreate(BaseModel):
    school_id: int
    name: str
    email: str | None = None
    qualified_subject_ids: list[int] = []
    # Empty = teaches every grade (no restriction) — see the model's
    # docstring for why this is the default rather than "qualifies for
    # nothing", unlike qualified_subject_ids.
    qualified_grades: list[str] = []
    unavailable_period_ids: list[int] = []
    max_periods_per_week: int | None = None


class TeacherUpdate(BaseModel):
    name: str | None = None
    email: str | None = None
    qualified_subject_ids: list[int] | None = None
    qualified_grades: list[str] | None = None
    unavailable_period_ids: list[int] | None = None
    max_periods_per_week: int | None = None


class TeacherOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    school_id: int
    name: str
    email: str | None
    qualified_subject_ids: list[int]
    # `| None` purely to tolerate existing rows from before this column
    # existed, whose value is NULL until the migration's ALTER TABLE ...
    # DEFAULT backfills them (see docs/GETTING_STARTED.md) — the frontend
    # already treats a missing/None value the same as an empty list.
    qualified_grades: list[str] | None = None
    unavailable_period_ids: list[int]
    max_periods_per_week: int | None
