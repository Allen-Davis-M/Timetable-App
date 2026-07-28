from typing import Any

from pydantic import BaseModel, ConfigDict


class ConstraintCreate(BaseModel):
    school_id: int
    type: str
    parameters: dict[str, Any] = {}
    is_hard: bool = True
    weight: int = 1
    description: str | None = None


class ConstraintUpdate(BaseModel):
    type: str | None = None
    parameters: dict[str, Any] | None = None
    is_hard: bool | None = None
    weight: int | None = None
    description: str | None = None


class ConstraintOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    school_id: int
    type: str
    parameters: dict[str, Any]
    is_hard: bool
    weight: int
    description: str | None


class ConstraintParseRequest(BaseModel):
    school_id: int
    text: str


class ConstraintParseResponse(BaseModel):
    constraint: ConstraintOut
    # True if this constraint is actually enforced by the solver (currently
    # only workload_limit constraints with a matched teacher are). Lets the
    # UI be honest about which parsed rules actually affect generation.
    enforced: bool
