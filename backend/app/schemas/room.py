from pydantic import BaseModel, ConfigDict


class RoomCreate(BaseModel):
    school_id: int
    name: str
    capacity: int | None = None
    room_type: str | None = None


class RoomUpdate(BaseModel):
    name: str | None = None
    capacity: int | None = None
    room_type: str | None = None


class RoomOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    school_id: int
    name: str
    capacity: int | None
    room_type: str | None
