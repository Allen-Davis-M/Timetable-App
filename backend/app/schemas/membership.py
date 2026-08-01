"""Pydantic schemas for school membership and invites — see
app/models/school.py (SchoolMembership, SchoolInvite) and
app/routers/schools.py / app/routers/invites.py."""
from pydantic import BaseModel, ConfigDict, EmailStr


class MemberOut(BaseModel):
    """One row in a school's member list — the owner (synthesized, no
    SchoolMembership row required) plus any SchoolMembership rows."""

    user_id: int
    email: str
    name: str | None
    role: str  # "admin" | "viewer"
    is_owner: bool


class MemberRoleUpdate(BaseModel):
    role: str  # "admin" | "viewer"


class InviteCreate(BaseModel):
    email: EmailStr
    role: str = "viewer"  # "admin" | "viewer"


class InviteOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str
    role: str
    status: str
    # Safe to include here (unlike anywhere public) because every endpoint
    # that returns an InviteOut — create + list — is admin-only, gated by
    # require_school_access(min_role="admin"). An admin who can already
    # see/revoke an invite can also just re-derive its access by inviting
    # again, so exposing the token to them isn't a new capability, just a
    # convenience: the frontend builds the shareable link straight from
    # this instead of the admin having to dig a token out of the database.
    token: str


class InvitePreviewOut(BaseModel):
    """What the accept-invite screen shows before the invitee has done
    anything — doesn't require auth to fetch, since the invitee likely
    isn't logged in yet."""

    email: str
    role: str
    school_name: str
    status: str


class AcceptInviteRequest(BaseModel):
    """`name` is only required when accepting creates a brand-new account
    (no existing user with the invite's email). `password` is always
    required — either to set a new account's password, or to confirm an
    existing account's password, so accepting an invite link alone is
    never enough to log into someone else's existing account."""

    name: str | None = None
    password: str
