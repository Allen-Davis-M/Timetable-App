"""
CRUD endpoints for schools — the first vertical slice through the stack
(router -> schema -> model -> database). Later routers for teachers,
class groups, subjects, rooms, and constraints follow this same pattern.

Schools are owned by a user (see owner_id on the School model): creating
one attaches the logged-in user as owner. Beyond the owner, a school can
now have additional admins/viewers via SchoolMembership (see
app/core/access.py and app/routers/invites.py for how those rows get
created) — list_schools and get_school both include schools the current
user has a membership in, not just ones they own. Every OTHER router
(subjects, teachers, timetables, etc.) now goes through
app.core.access.require_school_access too — this file used to be the only
one that checked ownership at all; that gap is closed as of this feature,
see docs/ARCHITECTURE.md for the full writeup.
"""
import secrets

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.access import get_membership_role, require_school_access
from app.core.auth import get_current_user
from app.core.database import get_db
from app.models.school import School, SchoolInvite, SchoolMembership
from app.models.user import User
from app.schemas.membership import InviteCreate, InviteOut, MemberOut, MemberRoleUpdate
from app.schemas.school import SchoolCreate, SchoolOut

router = APIRouter(prefix="/api/schools", tags=["schools"])


@router.post("", response_model=SchoolOut, status_code=201)
def create_school(
    payload: SchoolCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    school = School(name=payload.name, owner_id=current_user.id, institution_type=payload.institution_type)
    db.add(school)
    db.commit()
    db.refresh(school)
    return SchoolOut(id=school.id, name=school.name, institution_type=school.institution_type, role="admin")


@router.get("", response_model=list[SchoolOut])
def list_schools(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    owned = db.query(School).filter(School.owner_id == current_user.id).all()
    member_school_ids = [
        m.school_id
        for m in db.query(SchoolMembership).filter(SchoolMembership.user_id == current_user.id).all()
    ]
    member_schools = (
        db.query(School).filter(School.id.in_(member_school_ids)).all() if member_school_ids else []
    )
    # A user could in theory own AND have a stray membership row for the
    # same school; de-dupe by id rather than assume that can't happen.
    by_id = {s.id: s for s in owned + member_schools}
    return [
        SchoolOut(
            id=s.id,
            name=s.name,
            institution_type=s.institution_type,
            role=get_membership_role(db, current_user, s.id) or "viewer",
        )
        for s in by_id.values()
    ]


@router.get("/{school_id}", response_model=SchoolOut)
def get_school(
    school_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    role = require_school_access(db, current_user, school_id)
    school = db.get(School, school_id)
    return SchoolOut(id=school.id, name=school.name, institution_type=school.institution_type, role=role)


@router.get("/{school_id}/members", response_model=list[MemberOut])
def list_members(school_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Admin-only: the owner (synthesized — never has its own
    SchoolMembership row) plus every SchoolMembership row for this
    school."""
    require_school_access(db, current_user, school_id, min_role="admin")
    school = db.get(School, school_id)
    members = [MemberOut(user_id=school.owner.id, email=school.owner.email, name=school.owner.name, role="admin", is_owner=True)] if school.owner else []
    rows = db.query(SchoolMembership).filter(SchoolMembership.school_id == school_id).all()
    for m in rows:
        members.append(MemberOut(user_id=m.user.id, email=m.user.email, name=m.user.name, role=m.role, is_owner=False))
    return members


@router.patch("/{school_id}/members/{user_id}", response_model=MemberOut)
def update_member_role(
    school_id: int, user_id: int, payload: MemberRoleUpdate,
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user),
):
    require_school_access(db, current_user, school_id, min_role="admin")
    if payload.role not in ("admin", "viewer"):
        raise HTTPException(status_code=400, detail="role must be 'admin' or 'viewer'")
    school = db.get(School, school_id)
    if school.owner_id == user_id:
        raise HTTPException(status_code=400, detail="The school owner's role can't be changed.")
    membership = (
        db.query(SchoolMembership)
        .filter(SchoolMembership.school_id == school_id, SchoolMembership.user_id == user_id)
        .first()
    )
    if not membership:
        raise HTTPException(status_code=404, detail="This user isn't a member of this school.")
    membership.role = payload.role
    db.commit()
    db.refresh(membership)
    return MemberOut(user_id=membership.user.id, email=membership.user.email, name=membership.user.name, role=membership.role, is_owner=False)


@router.delete("/{school_id}/members/{user_id}", status_code=204)
def remove_member(
    school_id: int, user_id: int,
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user),
):
    require_school_access(db, current_user, school_id, min_role="admin")
    school = db.get(School, school_id)
    if school.owner_id == user_id:
        raise HTTPException(status_code=400, detail="The school owner can't be removed.")
    membership = (
        db.query(SchoolMembership)
        .filter(SchoolMembership.school_id == school_id, SchoolMembership.user_id == user_id)
        .first()
    )
    if not membership:
        raise HTTPException(status_code=404, detail="This user isn't a member of this school.")
    db.delete(membership)
    db.commit()


@router.get("/{school_id}/invites", response_model=list[InviteOut])
def list_invites(school_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    require_school_access(db, current_user, school_id, min_role="admin")
    return (
        db.query(SchoolInvite)
        .filter(SchoolInvite.school_id == school_id, SchoolInvite.status == "pending")
        .all()
    )


@router.post("/{school_id}/invites", response_model=InviteOut, status_code=201)
def create_invite(
    school_id: int, payload: InviteCreate,
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user),
):
    """
    Admin-only. No email is actually sent yet — there's no email service
    wired up (same "documented, not silently wrong" pattern as the rest of
    this app's known limitations; see docs/ARCHITECTURE.md). The response
    includes the invite id; the frontend builds a shareable link from it
    (see api.js / TeamTab.jsx) that the admin copies and sends themselves.
    """
    require_school_access(db, current_user, school_id, min_role="admin")
    if payload.role not in ("admin", "viewer"):
        raise HTTPException(status_code=400, detail="role must be 'admin' or 'viewer'")
    existing_pending = (
        db.query(SchoolInvite)
        .filter(SchoolInvite.school_id == school_id, SchoolInvite.email == payload.email, SchoolInvite.status == "pending")
        .first()
    )
    if existing_pending:
        raise HTTPException(status_code=400, detail="There's already a pending invite for this email.")
    invite = SchoolInvite(
        school_id=school_id,
        email=payload.email,
        role=payload.role,
        token=secrets.token_urlsafe(32),
        invited_by_user_id=current_user.id,
    )
    db.add(invite)
    db.commit()
    db.refresh(invite)
    return invite


@router.delete("/{school_id}/invites/{invite_id}", status_code=204)
def revoke_invite(
    school_id: int, invite_id: int,
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user),
):
    require_school_access(db, current_user, school_id, min_role="admin")
    invite = db.get(SchoolInvite, invite_id)
    if not invite or invite.school_id != school_id:
        raise HTTPException(status_code=404, detail="Invite not found")
    invite.status = "revoked"
    db.commit()
