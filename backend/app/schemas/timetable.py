from pydantic import BaseModel, ConfigDict


class TimetableEntryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    class_group_id: int
    class_group_name: str
    subject_id: int
    subject_name: str
    teacher_id: int
    teacher_name: str
    period_id: int
    period_label: str | None
    day_of_week: int
    order: int
    locked: bool


class TimetableOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    school_id: int
    status: str
    entries: list[TimetableEntryOut]


class GenerateTimetableResponse(BaseModel):
    """What /api/timetables/generate returns.

    `timetable` is populated when the solver finds a schedule (optimal or
    feasible). `solver_status` and `errors` are always populated so the
    frontend can show a useful message either way, including the
    infeasible case (see docs/ARCHITECTURE.md's note on infeasible-
    constraint UX being an open, hard problem).
    """

    solver_status: str
    errors: list[str] = []
    timetable: TimetableOut | None = None
