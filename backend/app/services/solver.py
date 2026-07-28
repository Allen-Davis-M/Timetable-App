"""
Timetable solver service.

Wraps Google OR-Tools' CP-SAT solver. Kept separate from the API routers so
it can be unit tested and evolved independently (e.g. swapping in new
constraint types) without touching HTTP handling code.

`solve_example()` is the original small worked example, kept as a fast
sanity check that the OR-Tools install works (see /api/solver/test).
`generate_school_timetable()` is the real thing: it reads a school's
teachers, class groups, subject requirements, and periods from the
database and builds/solves a CP-SAT model from that real data.
"""
from dataclasses import dataclass, field

from ortools.sat.python import cp_model
from sqlalchemy.orm import Session

from app.models.school import ClassGroup, Period, SubjectRequirement, Teacher


@dataclass
class SolveResult:
    status: str  # "optimal", "feasible", "infeasible", "unknown"
    assignments: list[dict]  # list of {class_group, subject, teacher, period}


@dataclass
class TimetableSolveResult:
    """Result of solving a real school's timetable from database data."""

    status: str  # "optimal", "feasible", "infeasible", "no_periods", "no_requirements"
    # each entry: {class_group_id, subject_id, teacher_id, period_id}
    assignments: list[dict] = field(default_factory=list)
    # human-readable reasons the solve couldn't proceed (populated on failure
    # paths that happen before the solver even runs, e.g. missing data)
    errors: list[str] = field(default_factory=list)


def generate_school_timetable(db: Session, school_id: int) -> TimetableSolveResult:
    """
    Build a CP-SAT model from a school's real data and solve it.

    Model shape, mirroring the worked example in solve_example() but with
    real entities:
      - One boolean variable per (class_group, subject, teacher, period)
        combination that's even possible (teacher must be qualified for the
        subject and not marked unavailable for that period).
      - Each SubjectRequirement's periods_per_week is met exactly
        (sum of its variables across all teacher/period options == N).
      - A class group can have at most one subject/teacher in any one
        period (no double-booking a class).
      - A teacher can teach at most one class/subject in any one period
        (no double-booking a teacher).
      - If a teacher has max_periods_per_week set, their total assigned
        periods across everything must not exceed it.

    Deliberately not yet handled (documented limitation, not a bug):
      - Room assignment/room conflicts — TimetableEntry.room_id is left
        null for now. Adding room assignment is a straightforward
        extension of the same pattern once room capacity/type matching
        rules are decided.
      - The generic Constraint table (teacher_unavailable etc. stored as
        rows) — this version reads availability directly off
        Teacher.unavailable_period_ids instead. Wiring the generic
        Constraint rows into the model is the next step once the
        constraint "vocabulary" (which `type` values exist) is decided.
    """
    periods = db.query(Period).filter(Period.school_id == school_id).all()
    if not periods:
        return TimetableSolveResult(
            status="no_periods",
            errors=["This school has no periods defined yet. Add periods before generating a timetable."],
        )

    class_groups = db.query(ClassGroup).filter(ClassGroup.school_id == school_id).all()
    requirements: list[SubjectRequirement] = []
    for cg in class_groups:
        requirements.extend(cg.requirements)

    if not requirements:
        return TimetableSolveResult(
            status="no_requirements",
            errors=["No class group has any subject requirements yet. Add at least one before generating."],
        )

    teachers = db.query(Teacher).filter(Teacher.school_id == school_id).all()
    teachers_by_id = {t.id: t for t in teachers}

    errors = []
    model = cp_model.CpModel()

    # x[(requirement_id, teacher_id, period_id)] = this requirement's
    # subject is taught by this teacher in this period, for this class group.
    x: dict[tuple[int, int, int], cp_model.IntVar] = {}
    requirement_vars: dict[int, list] = {r.id: [] for r in requirements}
    class_group_period_vars: dict[tuple[int, int], list] = {}
    teacher_period_vars: dict[tuple[int, int], list] = {}
    teacher_total_vars: dict[int, list] = {t.id: [] for t in teachers}

    for req in requirements:
        if req.preferred_teacher_id:
            candidate_ids = [req.preferred_teacher_id] if req.preferred_teacher_id in teachers_by_id else []
        else:
            candidate_ids = [
                t.id for t in teachers
                if req.subject_id in (t.qualified_subject_ids or [])
            ]

        if not candidate_ids:
            errors.append(
                f"No qualified teacher found for subject_id={req.subject_id} "
                f"(class_group_id={req.class_group_id}). Assign a teacher qualified "
                f"for this subject, or set preferred_teacher_id on the requirement."
            )
            continue

        for teacher_id in candidate_ids:
            teacher = teachers_by_id[teacher_id]
            unavailable = set(teacher.unavailable_period_ids or [])
            for period in periods:
                if period.id in unavailable:
                    continue
                var = model.NewBoolVar(f"x_r{req.id}_t{teacher_id}_p{period.id}")
                x[(req.id, teacher_id, period.id)] = var
                requirement_vars[req.id].append(var)
                class_group_period_vars.setdefault((req.class_group_id, period.id), []).append(var)
                teacher_period_vars.setdefault((teacher_id, period.id), []).append(var)
                teacher_total_vars[teacher_id].append(var)

    if errors:
        return TimetableSolveResult(status="infeasible", errors=errors)

    # Each requirement must be met exactly (periods_per_week times).
    for req in requirements:
        model.Add(sum(requirement_vars[req.id]) == req.periods_per_week)

    # No class group double-booked in a period.
    for _, group_vars in class_group_period_vars.items():
        model.AddAtMostOne(group_vars)

    # No teacher double-booked in a period.
    for _, group_vars in teacher_period_vars.items():
        model.AddAtMostOne(group_vars)

    # Respect each teacher's max periods/week, if set.
    for teacher in teachers:
        if teacher.max_periods_per_week is not None and teacher_total_vars[teacher.id]:
            model.Add(sum(teacher_total_vars[teacher.id]) <= teacher.max_periods_per_week)

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 20
    status = solver.Solve(model)

    status_name = {
        cp_model.OPTIMAL: "optimal",
        cp_model.FEASIBLE: "feasible",
        cp_model.INFEASIBLE: "infeasible",
    }.get(status, "unknown")

    assignments = []
    if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        req_by_id = {r.id: r for r in requirements}
        for (req_id, teacher_id, period_id), var in x.items():
            if solver.Value(var):
                req = req_by_id[req_id]
                assignments.append(
                    {
                        "class_group_id": req.class_group_id,
                        "subject_id": req.subject_id,
                        "teacher_id": teacher_id,
                        "period_id": period_id,
                    }
                )

    return TimetableSolveResult(status=status_name, assignments=assignments)


def solve_example() -> SolveResult:
    """
    A tiny worked example used to prove the OR-Tools integration works
    end-to-end: 1 class group, 2 subjects, 2 teachers, 2 periods.
    Each subject needs exactly 1 period; a teacher can't teach two things
    at once.
    """
    model = cp_model.CpModel()

    class_groups = ["Grade8-A"]
    subjects = ["Math", "English"]
    teachers = {"Math": "Mr. Rao", "English": "Ms. Iyer"}
    periods = ["Mon-P1", "Mon-P2"]

    # One bool var per (class_group, subject, period): is this subject
    # taught to this class group in this period?
    x = {}
    for c in class_groups:
        for s in subjects:
            for p in periods:
                x[(c, s, p)] = model.NewBoolVar(f"x_{c}_{s}_{p}")

    # Each subject must be scheduled in exactly one period.
    for c in class_groups:
        for s in subjects:
            model.AddExactlyOne(x[(c, s, p)] for p in periods)

    # A class group can only have one subject per period.
    for c in class_groups:
        for p in periods:
            model.AddAtMostOne(x[(c, s, p)] for s in subjects)

    # A teacher can't teach two subjects at the same period (trivially true
    # here since each teacher only teaches one subject, but the pattern
    # generalizes once teachers can teach multiple subjects/classes).
    for p in periods:
        for teacher in set(teachers.values()):
            subjects_for_teacher = [s for s, t in teachers.items() if t == teacher]
            model.AddAtMostOne(
                x[(c, s, p)] for c in class_groups for s in subjects_for_teacher
            )

    solver = cp_model.CpSolver()
    status = solver.Solve(model)

    status_name = {
        cp_model.OPTIMAL: "optimal",
        cp_model.FEASIBLE: "feasible",
        cp_model.INFEASIBLE: "infeasible",
    }.get(status, "unknown")

    assignments = []
    if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        for c in class_groups:
            for s in subjects:
                for p in periods:
                    if solver.Value(x[(c, s, p)]):
                        assignments.append(
                            {
                                "class_group": c,
                                "subject": s,
                                "teacher": teachers[s],
                                "period": p,
                            }
                        )

    return SolveResult(status=status_name, assignments=assignments)
