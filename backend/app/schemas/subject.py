from pydantic import BaseModel, ConfigDict


class SubjectCreate(BaseModel):
    school_id: int
    name: str
    required_room_type: str | None = None
    credits: int | None = None
    lab_batch_count: int | None = None


class SubjectUpdate(BaseModel):
    name: str | None = None
    required_room_type: str | None = None
    credits: int | None = None
    lab_batch_count: int | None = None


class SubjectOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    school_id: int
    name: str
    required_room_type: str | None
    credits: int | None = None
    lab_batch_count: int | None = None
