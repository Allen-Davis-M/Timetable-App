from sqlalchemy import Column, Integer, String
from sqlalchemy.orm import relationship

from app.core.database import Base


class User(Base):
    """
    A school admin account. Auth is email/password for now (hashed_password
    is set); the `google_sub` column is reserved for when Google sign-in is
    wired up (storing Google's stable subject ID), so no migration is needed
    to add it later.
    """
    __tablename__ = "users"

    id = Column(Integer, primary_key=True)
    email = Column(String, unique=True, nullable=False, index=True)
    hashed_password = Column(String, nullable=True)  # null once Google-only signup exists
    name = Column(String, nullable=True)
    google_sub = Column(String, unique=True, nullable=True)

    schools = relationship("School", back_populates="owner")
