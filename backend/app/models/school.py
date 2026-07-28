"""
Core database models.

Kept generic (not tied to one curriculum/board) per docs/ARCHITECTURE.md:
schools define their own periods, subjects, and constraints rather than the
schema assuming a fixed structure.
"""
from sqlalchemy import (
    Boolean, Column, ForeignKey, Integer, String, Text, JSON, UniqueConstraint
)
from sqlalchemy.orm import relationship

from app.core.database import Base


class School(Base):
    __tablename__ = "schools"

    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False)
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    owner = relationship("User", back_populates="schools")
    teachers = relationship("Teacher", back_populates="school", cascade="all, delete-orphan")
    class_groups = relationship("ClassGroup", back_populates="school", cascade="all, delete-orphan")
    subjects = relationship("Subject", back_populates="school", cascade="all, delete-orphan")
    rooms = relationship("Room", back_populates="school", cascade="all, delete-orphan")
    periods = relationship("Period", back_populates="school", cascade="all, delete-orphan")
    constraints = relationship("Constraint", back_populates="school", cascade="all, delete-orphan")


class Period(Base):
    """A schedulable time slot, e.g. 'Monday, slot 3 (9:00-9:45)'.

    Schools define their own list of periods instead of the app assuming a
    fixed daily structure, so different school types (half-day, shift-based,
    etc.) are supported without schema changes.
    """
    __tablename__ = "periods"

    id = Column(Integer, primary_key=True)
    school_id = Column(Integer, ForeignKey("schools.id"), nullable=False)
    day_of_week = Column(Integer, nullable=False)  # 0 = Monday ... 6 = Sunday
    order = Column(Integer, nullable=False)  # position within the day
    label = Column(String, nullable=True)  # e.g. "Period 3" or "9:00-9:45"

    school = relationship("School", back_populates="periods")

    __table_args__ = (UniqueConstraint("school_id", "day_of_week", "order"),)


class Subject(Base):
    __tablename__ = "subjects"

    id = Column(Integer, primary_key=True)
    school_id = Column(Integer, ForeignKey("schools.id"), nullable=False)
    name = Column(String, nullable=False)

    school = relationship("School", back_populates="subjects")


class Room(Base):
    __tablename__ = "rooms"

    id = Column(Integer, primary_key=True)
    school_id = Column(Integer, ForeignKey("schools.id"), nullable=False)
    name = Column(String, nullable=False)
    capacity = Column(Integer, nullable=True)
    room_type = Column(String, nullable=True)  # e.g. "lab", "regular", "auditorium"

    school = relationship("School", back_populates="rooms")


class Teacher(Base):
    __tablename__ = "teachers"

    id = Column(Integer, primary_key=True)
    school_id = Column(Integer, ForeignKey("schools.id"), nullable=False)
    name = Column(String, nullable=False)
    email = Column(String, nullable=True)
    # subject_ids this teacher is qualified to teach
    qualified_subject_ids = Column(JSON, default=list)
    # period_ids this teacher is NOT available (hard constraint shortcut)
    unavailable_period_ids = Column(JSON, default=list)
    max_periods_per_week = Column(Integer, nullable=True)

    school = relationship("School", back_populates="teachers")


class ClassGroup(Base):
    """A group of students that moves through the timetable together
    (a 'section', e.g. Section A of Grade 8).

    `grade` + `name` together form the Grade > Section hierarchy shown in
    the UI (e.g. grade="Grade 8", name="A"). `grade` is a free-text label
    rather than its own table for the same reason periods/subjects are
    generic — schools name grades differently (Grade 8, Class VIII, Year 9).
    """
    __tablename__ = "class_groups"

    id = Column(Integer, primary_key=True)
    school_id = Column(Integer, ForeignKey("schools.id"), nullable=False)
    grade = Column(String, nullable=True)
    name = Column(String, nullable=False)
    student_count = Column(Integer, nullable=True)

    school = relationship("School", back_populates="class_groups")
    requirements = relationship(
        "SubjectRequirement", back_populates="class_group", cascade="all, delete-orphan"
    )


class SubjectRequirement(Base):
    """How many periods per week a given class group needs of a given subject.

    Unique on (class_group_id, subject_id): a class group should only have
    one requirement per subject. This is enforced at the DB level as a
    backstop — the API layer also upserts on this pair (see
    app/routers/class_groups.py) rather than relying on the DB constraint
    alone, since a raw IntegrityError isn't a friendly API error.
    """
    __tablename__ = "subject_requirements"

    id = Column(Integer, primary_key=True)
    class_group_id = Column(Integer, ForeignKey("class_groups.id"), nullable=False)
    subject_id = Column(Integer, ForeignKey("subjects.id"), nullable=False)
    periods_per_week = Column(Integer, nullable=False)
    preferred_teacher_id = Column(Integer, ForeignKey("teachers.id"), nullable=True)

    __table_args__ = (UniqueConstraint("class_group_id", "subject_id"),)

    class_group = relationship("ClassGroup", back_populates="requirements")


class Constraint(Base):
    """A generic scheduling rule.

    Stored as (type, parameters) rather than one column per rule so new
    constraint types can ship without a schema migration each time. `type`
    is a string key the solver service knows how to interpret (e.g.
    'teacher_unavailable', 'no_subject_last_period', 'max_consecutive_periods').
    `is_hard` = must be satisfied; soft constraints are scored/optimized instead.
    """
    __tablename__ = "constraints"

    id = Column(Integer, primary_key=True)
    school_id = Column(Integer, ForeignKey("schools.id"), nullable=False)
    type = Column(String, nullable=False)
    parameters = Column(JSON, default=dict)
    is_hard = Column(Boolean, default=True)
    weight = Column(Integer, default=1)  # relevant for soft constraints only
    description = Column(Text, nullable=True)  # human-readable, shown in the UI

    school = relationship("School", back_populates="constraints")


class Timetable(Base):
    """A generated schedule (one solver run's output)."""
    __tablename__ = "timetables"

    id = Column(Integer, primary_key=True)
    school_id = Column(Integer, ForeignKey("schools.id"), nullable=False)
    status = Column(String, default="draft")  # draft, published, archived

    entries = relationship("TimetableEntry", back_populates="timetable", cascade="all, delete-orphan")


class TimetableEntry(Base):
    """One (class group, subject, teacher, room, period) assignment."""
    __tablename__ = "timetable_entries"

    id = Column(Integer, primary_key=True)
    timetable_id = Column(Integer, ForeignKey("timetables.id"), nullable=False)
    class_group_id = Column(Integer, ForeignKey("class_groups.id"), nullable=False)
    subject_id = Column(Integer, ForeignKey("subjects.id"), nullable=False)
    teacher_id = Column(Integer, ForeignKey("teachers.id"), nullable=False)
    room_id = Column(Integer, ForeignKey("rooms.id"), nullable=True)
    period_id = Column(Integer, ForeignKey("periods.id"), nullable=False)
    locked = Column(Boolean, default=False)  # admin locked this slot before regenerating

    timetable = relationship("Timetable", back_populates="entries")
