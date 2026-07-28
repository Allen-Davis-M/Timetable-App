"""
Auth endpoints: email/password signup and login.

Google sign-in isn't wired up yet — that needs a Google Cloud OAuth client
(client ID/secret) which only the project owner can create. The User model
already has a `google_sub` column reserved for it so adding it later is a
new router + a few lines here, not a schema change.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.auth import create_access_token, get_current_user, hash_password, verify_password
from app.core.database import get_db
from app.models.user import User
from app.schemas.auth import LoginRequest, SignupRequest, TokenResponse, UserOut

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/signup", response_model=TokenResponse, status_code=201)
def signup(payload: SignupRequest, db: Session = Depends(get_db)):
    existing = db.query(User).filter(User.email == payload.email).first()
    if existing:
        raise HTTPException(status_code=400, detail="An account with this email already exists")

    user = User(
        email=payload.email,
        hashed_password=hash_password(payload.password),
        name=payload.name,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    token = create_access_token(user.id)
    return TokenResponse(access_token=token, user=user)


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == payload.email).first()
    if not user or not user.hashed_password or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Incorrect email or password")

    token = create_access_token(user.id)
    return TokenResponse(access_token=token, user=user)


@router.get("/me", response_model=UserOut)
def me(current_user: User = Depends(get_current_user)):
    return current_user
