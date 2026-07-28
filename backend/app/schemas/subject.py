from pydantic import BaseModel, ConfigDict


class SubjectCreate(BaseModel):
    school_id: int
    name: str


class SubjectUpdate(BaseModel):
    name: str


class SubjectOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    school_id: int
    name: str
