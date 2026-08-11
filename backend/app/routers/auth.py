"""
Auth endpoints: email/password signup and login, plus Google sign-in.

Google sign-in verifies the ID token Google's Sign-In button hands the
frontend (a JWT signed by Google, not something we issue) against Google's
public keys and our configured client ID, then finds-or-creates a User by
email. No password is ever involved for that path — `hashed_password` stays
null for Google-only accounts (the User model already allows this).
"""
import logging

from fastapi import APIRouter, Depends, HTTPException
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token
from sqlalchemy.orm import Session

from app.core.auth import create_access_token, get_current_user, hash_password, verify_password
from app.core.config import settings
from app.core.database import get_db
from app.models.user import User
from app.schemas.auth import GoogleLoginRequest, LoginRequest, SignupRequest, TokenResponse, UserOut

logger = logging.getLogger(__name__)

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


@router.post("/google", response_model=TokenResponse)
def google_login(payload: GoogleLoginRequest, db: Session = Depends(get_db)):
    if not settings.google_client_id:
        # Fails loudly rather than silently accepting an unverifiable
        # token — better than pretending Google sign-in works when the
        # server has no client ID to check the token's audience against.
        raise HTTPException(
            status_code=503,
            detail="Google sign-in isn't configured on this server yet.",
        )

    try:
        claims = google_id_token.verify_oauth2_token(
            payload.credential, google_requests.Request(), settings.google_client_id
        )
    except ValueError as exc:
        # verify_oauth2_token collapses every failure mode (audience
        # mismatch, expired token, bad signature, clock skew, ...) into a
        # generic ValueError — logging the real message here is the only
        # way to tell which one it actually was, since the client only
        # ever sees the generic 401 below (a client shouldn't learn
        # *why* a token was rejected, e.g. clock skew details).
        logger.warning("Google sign-in token verification failed: %s", exc)
        raise HTTPException(status_code=401, detail="Invalid Google sign-in token")

    email = claims.get("email")
    if not email or not claims.get("email_verified"):
        raise HTTPException(status_code=401, detail="Google account has no verified email")
    google_sub = claims["sub"]
    name = claims.get("name")

    # Match on google_sub first (a returning Google-sign-in user), then
    # fall back to email (an existing email/password account signing in
    # with Google for the first time — link it rather than creating a
    # duplicate account with the same email).
    user = db.query(User).filter(User.google_sub == google_sub).first()
    if not user:
        user = db.query(User).filter(User.email == email).first()
        if user:
            user.google_sub = google_sub
        else:
            user = User(email=email, name=name, google_sub=google_sub)
            db.add(user)
        db.commit()
        db.refresh(user)

    token = create_access_token(user.id)
    return TokenResponse(access_token=token, user=user)


@router.get("/me", response_model=UserOut)
def me(current_user: User = Depends(get_current_user)):
    return current_user
