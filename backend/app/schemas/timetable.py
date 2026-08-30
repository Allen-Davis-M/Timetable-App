from pydantic import BaseModel, ConfigDict


class TimetableEntryUpdate(BaseModel):
    """
    Manual edits to one already-generated entry: lock/unlock it (so it's
    kept in place on the next regenerate — see app/services/solver.py),
    and/or move it to a different period/teacher/room by hand. All fields
    optional and independent — a drag-to-move sends just `period_id`, the
    lock toggle sends just `locked`. See PATCH /api/timetables/entries/{id}
    in app/routers/timetables.py for the conflict checks applied before
    any of period_id/teacher_id/room_id actually change.
    """

    locked: bool | None = None
    period_id: int | None = None
    teacher_id: int | None = None
    room_id: int | None = None


class TimetableEntryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    class_group_id: int
    class_group_name: str
    subject_id: int
    subject_name: str
    teacher_id: int
    teacher_name: str
    assistant_teacher_id: int | None = None
    assistant_teacher_name: str | None = None
    period_id: int
    period_label: str | None
    day_of_week: int
    order: int
    room_id: int | None
    room_name: str | None
    locked: bool
    lab_batch: int | None = None


class TimetableOut(BaseModel):
    """
    Represents one generation job's current state. `status` is the job
    lifecycle: "generating" while the background solve is still running,
    then "draft" (succeeded — `entries` is populated) or "failed"
    (`error_message` explains why). The frontend polls GET
    /api/timetables/{id} using this shape until status != "generating".
    """

    model_config = ConfigDict(from_attributes=True)

    id: int
    school_id: int
    status: str
    solver_status: str | None
    error_message: str | None
    entries: list[TimetableEntryOut]
