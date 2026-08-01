from pydantic import BaseModel, ConfigDict


class SubjectCreate(BaseModel):
    school_id: int
    name: str
    required_room_type: str | None = None


class SubjectUpdate(BaseModel):
    name: str | None = None
    required_room_type: str | None = None


class SubjectOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    school_id: int
    name: str
    required_room_type: str | None
