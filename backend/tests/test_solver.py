import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.models.school import ClassGroup, Constraint, Period, School, Subject, SubjectRequirement, Teacher
from app.models.user import User  # noqa: F401 — registers the `users` table that School.owner_id FKs to
from app.services.solver import generate_school_timetable, solve_example


def test_solve_example_is_feasible():
    """The worked example has an obvious valid solution, so the solver
    should always find it — this test mainly catches OR-Tools install
    or API-usage regressions."""
    result = solve_example()
    assert result.status in ("optimal", "feasible")
    assert len(result.assignments) == 2  # Math + English, both scheduled


def test_solve_example_no_double_booking():
    result = solve_example()
    periods_used = [a["period"] for a in result.assignments]
    assert len(periods_used) == len(set(periods_used))


@pytest.fixture
def db_session():
    """A fresh in-memory SQLite DB per test, so these tests don't touch
    dev.db and don't leak state between each other. generate_school_
    timetable() only takes a Session + school_id, so a real (if
    throwaway) database is simpler than mocking the ORM query chain."""
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    try:
        yield session
    finally:
        session.close()


def _make_school_with_periods(db, days=5, periods_per_day=2):
    """5 weekdays x periods_per_day periods, ordered 0..periods_per_day-1
    within each day — enough structure to exercise 'unavailable on a
    whole day' and 'last period of the day' constraints."""
    school = School(name="Test School")
    db.add(school)
    db.commit()
    db.refresh(school)
    for day in range(days):
        for order in range(periods_per_day):
            db.add(Period(school_id=school.id, day_of_week=day, order=order, label=f"D{day}P{order}"))
    db.commit()
    return school


def test_availability_constraint_is_respected(db_session):
    """A teacher marked unavailable on Monday (Teacher.unavailable_period_ids,
    set by the 'availability' constraint type — see
    app/routers/constraints.py) should never be scheduled on Monday, even
    though the requirement's periods_per_week leaves the solver free to
    pick from any of the 5 days."""
    db = db_session
    school = _make_school_with_periods(db, days=5, periods_per_day=2)

    subject = Subject(school_id=school.id, name="Math")
    db.add(subject)
    db.commit()
    db.refresh(subject)

    monday_period_ids = [
        p.id for p in db.query(Period).filter(Period.school_id == school.id, Period.day_of_week == 0).all()
    ]

    teacher = Teacher(
        school_id=school.id,
        name="Priya Sharma",
        qualified_subject_ids=[subject.id],
        unavailable_period_ids=monday_period_ids,
    )
    db.add(teacher)
    db.commit()
    db.refresh(teacher)

    class_group = ClassGroup(school_id=school.id, grade="Grade 8", name="A")
    db.add(class_group)
    db.commit()
    db.refresh(class_group)

    # 3 periods/week out of 10 available slots — plenty of room to avoid
    # Monday entirely, so if the solver ever lands on Monday it's because
    # unavailable_period_ids was ignored, not because it had no choice.
    db.add(SubjectRequirement(class_group_id=class_group.id, subject_id=subject.id, periods_per_week=3))
    db.commit()

    result = generate_school_timetable(db, school.id)

    assert result.status in ("optimal", "feasible"), result.errors
    assert len(result.assignments) == 3
    scheduled_period_ids = {a["period_id"] for a in result.assignments}
    assert scheduled_period_ids.isdisjoint(monday_period_ids), (
        "Teacher was scheduled during a period they were marked unavailable for"
    )


def test_no_subject_last_period_constraint_is_respected(db_session):
    """A 'no_subject_period' Constraint row (position='last') should keep
    the subject off the last period of every day, school-wide — see the
    req_restricted_periods handling in app/services/solver.py."""
    db = db_session
    school = _make_school_with_periods(db, days=5, periods_per_day=2)

    subject = Subject(school_id=school.id, name="PE")
    db.add(subject)
    db.commit()
    db.refresh(subject)

    last_period_ids = {
        p.id
        for p in db.query(Period).filter(Period.school_id == school.id).all()
        if p.order == 1  # periods_per_day=2, so order 1 is the last slot of the day
    }

    teacher = Teacher(school_id=school.id, name="Coach Rao", qualified_subject_ids=[subject.id])
    db.add(teacher)
    db.commit()
    db.refresh(teacher)

    class_group = ClassGroup(school_id=school.id, grade="Grade 8", name="A")
    db.add(class_group)
    db.commit()
    db.refresh(class_group)

    db.add(SubjectRequirement(class_group_id=class_group.id, subject_id=subject.id, periods_per_week=3))
    db.add(Constraint(
        school_id=school.id,
        type="no_subject_period",
        parameters={"subject_id": subject.id, "position": "last"},
        is_hard=True,
        description="PE should not be scheduled in the last period of the day",
    ))
    db.commit()

    result = generate_school_timetable(db, school.id)

    assert result.status in ("optimal", "feasible"), result.errors
    assert len(result.assignments) == 3
    scheduled_period_ids = {a["period_id"] for a in result.assignments}
    assert scheduled_period_ids.isdisjoint(last_period_ids), (
        "Subject was scheduled in the last period of the day despite a no_subject_period ban"
    )
