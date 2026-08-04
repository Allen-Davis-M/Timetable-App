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
import os
from dataclasses import dataclass, field

from ortools.sat.python import cp_model
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.school import (
    ClassGroup,
    Constraint,
    Period,
    Room,
    Subject,
    SubjectRequirement,
    Teacher,
    Timetable,
)


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
    # (class_group_id, subject_id, teacher_id, period_id) tuples that were
    # locked on the previous timetable and successfully honored in this
    # solve — the router uses this to mark the corresponding new
    # TimetableEntry rows locked=True again, so a lock "sticks" across
    # regenerations instead of needing to be re-applied by hand each time.
    locked_keys: set[tuple[int, int, int, int]] = field(default_factory=set)


def _class_group_label(cg: ClassGroup) -> str:
    return f"{cg.grade} - {cg.name}" if cg.grade else cg.name


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
      - "no_subject_period" Constraint rows (parameters={subject_id,
        position: "first"|"last", class_group_ids?}) ban that subject from
        the first/last period of every day. Scoped to specific class
        groups if class_group_ids is set, otherwise school-wide.
      - "require_subject_period" Constraint rows restrict that subject to
        ONLY the first/last period of every day (same scoping rules). If
        both types apply to the same requirement (contradictory input),
        the ban wins.
      - "no_subject_day" / "require_subject_day" Constraint rows
        (parameters={subject_id, day_of_week, class_group_ids?}) are the
        same idea as the two above but for a whole day of the week instead
        of a single first/last period — resolved into the same
        req_restricted_periods / req_required_periods sets, just matching
        every period on that day rather than one position.
      - "max_consecutive_periods" Constraint rows cap how many periods can
        run back-to-back on the same day, either for one subject
        (parameters={subject_id, max_consecutive, class_group_ids?},
        scoped like the placement types) or for one teacher's whole
        schedule regardless of subject/class (parameters={teacher_id,
        max_consecutive} — never scoped to class groups, since it's about
        that teacher's day, not one class's).
      - "min_gap_between_subjects" Constraint rows (parameters={
        first_subject_id, second_subject_id, min_gap, class_group_ids?})
        forbid the two named subjects from landing within min_gap periods
        of each other on the same day, for the scoped class groups (or
        school-wide). Symmetric — order doesn't matter, unlike
        subject_sequence below.
      - "subject_sequence" Constraint rows (parameters={first_subject_id,
        second_subject_id, class_group_ids?}) forbid second_subject from
        being scheduled in the period immediately after first_subject, for
        the same class group (e.g. "Math can't immediately follow PE").
        Cross-subject, so this (and min_gap_between_subjects) are the two
        constraint types that link two different SubjectRequirement rows'
        period-occupancy together.
      - Subject.lab_batch_count (2+) splits a requirement's sessions into
        that many simultaneous batches — e.g. a 60-student "Programming
        Lab" splitting into 3 batches of ~20 at the same period, each with
        its own teacher and (best-effort) room. See the lab_batch_count
        branch inside the main requirement-building loop below for the
        modeling approach. Known limitation: locked entries aren't honored
        for batched subjects (they're re-solved fresh every regeneration)
        — see the comment where locks are read, further down.
      - Room assignment is a second, separate CP-SAT solve
        (`_assign_rooms`) run after the main schedule is fixed — see its
        docstring for why it's kept separate rather than folded into the
        main model. Best-effort: entries that can't get a matching room
        (by Subject.required_room_type and Room.capacity vs. ClassGroup.
        student_count) just keep room_id=None rather than blocking
        generation.

    Constraint plumbing: teacher availability (unavailable_period_ids) and
    workload caps (max_periods_per_week) are read directly off the Teacher
    row rather than the generic Constraint table, because
    app/routers/constraints.py already writes them there when it parses a
    matching constraint — the Constraint row itself is kept too, purely as
    a human-readable record for the UI. Everything else (placement,
    consecutive-period limits, subject sequencing) has no single row to
    live on, so those are read directly from the Constraint table here.

    Deliberately not yet handled (documented limitation, not a bug):
      - The catch-all "scheduling_rule" constraint type — recorded and
        shown in the UI, but not applied. Free-text rules that don't match
        any of the specific types above land here.
    """
    periods = db.query(Period).filter(Period.school_id == school_id).all()
    if not periods:
        return TimetableSolveResult(
            status="no_periods",
            errors=["This school has no periods defined yet. Add periods before generating a timetable."],
        )

    # Group periods by day so "first period" / "last period" constraints
    # can be resolved to concrete period ids regardless of how many
    # periods a day has or what their labels are.
    periods_by_day: dict[int, list[Period]] = {}
    for p in periods:
        periods_by_day.setdefault(p.day_of_week, []).append(p)
    first_period_ids = {min(day_periods, key=lambda p: p.order).id for day_periods in periods_by_day.values()}
    last_period_ids = {max(day_periods, key=lambda p: p.order).id for day_periods in periods_by_day.values()}
    sorted_periods_by_day = {day: sorted(day_periods, key=lambda p: p.order) for day, day_periods in periods_by_day.items()}

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

    def _applies_to(constraint_params: dict, req: SubjectRequirement) -> bool:
        if constraint_params.get("subject_id") != req.subject_id:
            return False
        class_group_ids = constraint_params.get("class_group_ids")
        return not class_group_ids or req.class_group_id in class_group_ids

    # Every period id that falls on a given day, for resolving
    # "no_subject_day" / "require_subject_day" the same way first/last
    # period ids are resolved above.
    period_ids_by_day: dict[int, set[int]] = {
        day: {p.id for p in day_periods} for day, day_periods in periods_by_day.items()
    }

    # Per-requirement period restrictions from "no_subject_period" /
    # "require_subject_period" (position-based) and "no_subject_day" /
    # "require_subject_day" (whole-day) Constraint rows, resolved once up
    # front rather than re-querying per requirement.
    placement_constraints = (
        db.query(Constraint)
        .filter(
            Constraint.school_id == school_id,
            Constraint.type.in_(
                ["no_subject_period", "require_subject_period", "no_subject_day", "require_subject_day"]
            ),
            Constraint.is_hard.is_(True),
        )
        .all()
    )
    req_restricted_periods: dict[int, set[int]] = {}
    req_required_periods: dict[int, set[int] | None] = {}
    for req in requirements:
        restricted: set[int] = set()
        required: set[int] | None = None
        for c in placement_constraints:
            p = c.parameters or {}
            if not _applies_to(p, req):
                continue
            if c.type in ("no_subject_period", "require_subject_period"):
                position = p.get("position")
                if position not in ("first", "last"):
                    continue
                matched = first_period_ids if position == "first" else last_period_ids
            else:  # no_subject_day / require_subject_day
                day_of_week = p.get("day_of_week")
                if not isinstance(day_of_week, int):
                    continue
                matched = period_ids_by_day.get(day_of_week, set())
            if c.type in ("no_subject_period", "no_subject_day"):
                restricted |= matched
            else:
                required = matched if required is None else (required & matched)
        if required is not None:
            required -= restricted  # a ban always wins over a same-subject requirement
        req_restricted_periods[req.id] = restricted
        req_required_periods[req.id] = required

    errors = []
    model = cp_model.CpModel()

    # x[(requirement_id, teacher_id, period_id)] = this requirement's
    # subject is taught by this teacher in this period, for this class group.
    x: dict[tuple[int, int, int], cp_model.IntVar] = {}
    requirement_vars: dict[int, list] = {r.id: [] for r in requirements}
    class_group_period_vars: dict[tuple[int, int], list] = {}
    teacher_period_vars: dict[tuple[int, int], list] = {}
    teacher_total_vars: dict[int, list] = {t.id: [] for t in teachers}
    # req_period_vars[req.id][period.id] = list of candidate vars for that
    # requirement at that period (0 or 1 will end up true, thanks to
    # class_group_period_vars' AddAtMostOne below) — used by the
    # max_consecutive_periods constraint further down to know whether a
    # requirement "occupies" a given period without needing a separate
    # aggregate variable.
    req_period_vars: dict[int, dict[int, list]] = {r.id: {} for r in requirements}
    # Which teacher(s) could even be assigned to each requirement, before
    # any period-level filtering — kept around for _diagnose_infeasibility
    # below (specifically: spotting a sole qualified/preferred teacher
    # who's overloaded across their requirements).
    candidate_ids_by_req: dict[int, list[int]] = {}

    subjects_by_id = {s.id: s for s in db.query(Subject).filter(Subject.school_id == school_id).all()}
    class_groups_by_id = {c.id: c for c in class_groups}

    # batch_x[(req_id, period_id, batch_index)] = list of (teacher_id, var)
    # — the lab-batch-splitting counterpart to `x` above. See the
    # lab_batch_count branch below for why this needs its own structure
    # instead of reusing `x` directly (each batch needs its own teacher
    # choice, all tied to the same "does a session happen here" variable).
    batch_x: dict[tuple[int, int, int], list[tuple[int, cp_model.IntVar]]] = {}

    def _batch_count(req: SubjectRequirement) -> int:
        subject = subjects_by_id.get(req.subject_id)
        n = subject.lab_batch_count if subject else None
        return n if isinstance(n, int) and n >= 2 else 1

    for req in requirements:
        if req.preferred_teacher_id:
            candidate_ids = [req.preferred_teacher_id] if req.preferred_teacher_id in teachers_by_id else []
        else:
            candidate_ids = [
                t.id for t in teachers
                if req.subject_id in (t.qualified_subject_ids or [])
            ]
        candidate_ids_by_req[req.id] = candidate_ids

        if not candidate_ids:
            subject = subjects_by_id.get(req.subject_id)
            cg = class_groups_by_id.get(req.class_group_id)
            subject_name = subject.name if subject else f"subject_id={req.subject_id}"
            cg_label = _class_group_label(cg) if cg else f"class_group_id={req.class_group_id}"
            errors.append(
                f"No qualified teacher found for {subject_name} in {cg_label}. Assign a "
                f"teacher qualified for this subject, or set a preferred teacher on the requirement."
            )
            continue

        restricted_periods_for_req = req_restricted_periods.get(req.id, set())
        required_periods_for_req = req_required_periods.get(req.id)  # None = no restriction
        batch_count = _batch_count(req)

        if batch_count == 1:
            for teacher_id in candidate_ids:
                teacher = teachers_by_id[teacher_id]
                unavailable = set(teacher.unavailable_period_ids or [])
                for period in periods:
                    if period.id in unavailable:
                        continue
                    if period.id in restricted_periods_for_req:
                        continue
                    if required_periods_for_req is not None and period.id not in required_periods_for_req:
                        continue
                    var = model.NewBoolVar(f"x_r{req.id}_t{teacher_id}_p{period.id}")
                    x[(req.id, teacher_id, period.id)] = var
                    requirement_vars[req.id].append(var)
                    class_group_period_vars.setdefault((req.class_group_id, period.id), []).append(var)
                    teacher_period_vars.setdefault((teacher_id, period.id), []).append(var)
                    teacher_total_vars[teacher_id].append(var)
                    req_period_vars[req.id].setdefault(period.id, []).append(var)
            continue

        # Lab-batch splitting (Subject.lab_batch_count >= 2): this
        # requirement's periods are sessions where the whole class group
        # splits into `batch_count` simultaneous batches, each with its
        # own teacher (and, in the room-assignment pass below, its own
        # room). Modeled with one "occ" var per eligible period (does a
        # session happen here at all — this is what reserves the class
        # group's slot and counts toward periods_per_week, exactly like a
        # normal requirement's per-period vars would) plus, per batch, a
        # teacher-choice var per candidate that's forced to sum to
        # exactly `occ` — i.e. "if a session happens here, batch b has
        # exactly one teacher; if not, zero". Feeding those teacher-choice
        # vars into the same teacher_period_vars/teacher_total_vars
        # structures the non-batched path uses means teacher
        # double-booking (and therefore batch-to-batch distinctness within
        # one period) and workload caps are enforced for free, with no
        # extra constraints needed here.
        if len(candidate_ids) < batch_count:
            subject = subjects_by_id.get(req.subject_id)
            cg = class_groups_by_id.get(req.class_group_id)
            errors.append(
                f"{subject.name if subject else 'This subject'} for "
                f"{_class_group_label(cg) if cg else 'a section'} splits into {batch_count} lab "
                f"batches, but only {len(candidate_ids)} qualified teacher(s) are available — add "
                f"more qualified teachers (need at least {batch_count}) to staff every batch at once."
            )
            continue

        for period in periods:
            if period.id in restricted_periods_for_req:
                continue
            if required_periods_for_req is not None and period.id not in required_periods_for_req:
                continue
            free_teacher_ids = [
                t_id for t_id in candidate_ids
                if period.id not in set(teachers_by_id[t_id].unavailable_period_ids or [])
            ]
            if len(free_teacher_ids) < batch_count:
                continue  # not enough free teachers to staff every batch at this period

            occ = model.NewBoolVar(f"occ_r{req.id}_p{period.id}")
            requirement_vars[req.id].append(occ)
            class_group_period_vars.setdefault((req.class_group_id, period.id), []).append(occ)
            req_period_vars[req.id].setdefault(period.id, []).append(occ)

            for batch in range(batch_count):
                batch_vars = []
                for teacher_id in free_teacher_ids:
                    var = model.NewBoolVar(f"x_r{req.id}_b{batch}_t{teacher_id}_p{period.id}")
                    batch_vars.append((teacher_id, var))
                    teacher_period_vars.setdefault((teacher_id, period.id), []).append(var)
                    teacher_total_vars[teacher_id].append(var)
                batch_x[(req.id, period.id, batch)] = batch_vars
                # Exactly one teacher for this batch iff a session occurs
                # here — ties every batch's period choice to `occ`, so all
                # batches always land on the same period as each other.
                model.Add(sum(v for _, v in batch_vars) == occ)

    if errors:
        return TimetableSolveResult(status="infeasible", errors=errors)

    # Honor locked entries from the previous generation: an admin can lock
    # a slot in TimetableTab.jsx (PATCH /api/timetables/entries/{id}) to
    # pin it in place, then regenerate to re-solve everything else around
    # it. Only the most recent "draft" timetable's locks are read — older
    # ones are history, not the current schedule.
    previous_timetable = (
        db.query(Timetable)
        .filter(Timetable.school_id == school_id, Timetable.status == "draft")
        .order_by(Timetable.id.desc())
        .first()
    )
    req_by_class_subject = {(r.class_group_id, r.subject_id): r for r in requirements}
    locked_keys: set[tuple[int, int, int, int]] = set()
    locked_rooms: dict[tuple[int, int, int, int], int | None] = {}
    if previous_timetable:
        for le in previous_timetable.entries:
            if not le.locked:
                continue
            req = req_by_class_subject.get((le.class_group_id, le.subject_id))
            if not req:
                continue  # the requirement this was locked against no longer exists
            if _batch_count(req) > 1:
                # Known limitation: locking isn't supported for lab-batch
                # subjects yet — honoring a lock here would need to pin
                # one specific batch's teacher without disturbing the
                # others' occ-tied structure above, which the current
                # single-key (req, teacher, period) lock format can't
                # express. Batched sessions just get freshly re-solved
                # every regeneration instead of silently mis-locking.
                continue
            key = (req.id, le.teacher_id, le.period_id)
            if key not in x:
                # Filtered out of the normal candidate list (e.g. the
                # teacher's availability or a placement constraint changed
                # since this was locked). An explicit lock is a deliberate
                # admin override, so honor it anyway rather than silently
                # dropping it — it participates in every other constraint
                # below exactly like a normal candidate variable would.
                var = model.NewBoolVar(f"locked_r{req.id}_t{le.teacher_id}_p{le.period_id}")
                x[key] = var
                requirement_vars[req.id].append(var)
                class_group_period_vars.setdefault((req.class_group_id, le.period_id), []).append(var)
                teacher_period_vars.setdefault((le.teacher_id, le.period_id), []).append(var)
                teacher_total_vars.setdefault(le.teacher_id, []).append(var)
                req_period_vars[req.id].setdefault(le.period_id, []).append(var)
            model.Add(x[key] == 1)
            result_key = (le.class_group_id, le.subject_id, le.teacher_id, le.period_id)
            locked_keys.add(result_key)
            locked_rooms[result_key] = le.room_id

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

    # "max_consecutive_periods" Constraint rows: cap how many periods in a
    # row (same day, adjacent order) a subject can run for the scoped
    # requirements. Implemented as a sliding window over each day's
    # periods — no new variables needed, since a requirement's presence at
    # a period is just the sum of its candidate vars there (0 or 1,
    # guaranteed by the AddAtMostOne on class_group_period_vars above).
    consecutive_constraints = (
        db.query(Constraint)
        .filter(
            Constraint.school_id == school_id,
            Constraint.type == "max_consecutive_periods",
            Constraint.is_hard.is_(True),
        )
        .all()
    )
    for c in consecutive_constraints:
        p = c.parameters or {}
        max_consecutive = p.get("max_consecutive")
        if not isinstance(max_consecutive, int) or max_consecutive < 1:
            continue

        teacher_id = p.get("teacher_id")
        if teacher_id is not None:
            # Teacher variant: caps how many periods in a row that teacher
            # is scheduled at all, any subject/class — uses
            # teacher_period_vars (already AddAtMostOne'd to 0-or-1 per
            # period) instead of one requirement's per-period vars.
            for day_periods in sorted_periods_by_day.values():
                if len(day_periods) <= max_consecutive:
                    continue
                for start in range(len(day_periods) - max_consecutive):
                    window = day_periods[start:start + max_consecutive + 1]
                    window_vars = [
                        v for wp in window for v in teacher_period_vars.get((teacher_id, wp.id), [])
                    ]
                    if window_vars:
                        model.Add(sum(window_vars) <= max_consecutive)
            continue

        for req in requirements:
            if not _applies_to(p, req):
                continue
            per_period_vars = req_period_vars.get(req.id, {})
            for day_periods in sorted_periods_by_day.values():
                if len(day_periods) <= max_consecutive:
                    continue  # can't possibly exceed the cap on this day
                for start in range(len(day_periods) - max_consecutive):
                    window = day_periods[start:start + max_consecutive + 1]
                    window_vars = [v for wp in window for v in per_period_vars.get(wp.id, [])]
                    if window_vars:
                        model.Add(sum(window_vars) <= max_consecutive)

    # "subject_sequence" Constraint rows: forbid second_subject_id from
    # being scheduled in the period immediately after first_subject_id, on
    # the same day, for the same class group. Requirements are unique per
    # (class_group, subject) (see SubjectRequirement's unique constraint),
    # so each side of the rule maps to at most one requirement per class
    # group — no aggregation needed beyond the per-period var lists already
    # built above.
    sequence_constraints = (
        db.query(Constraint)
        .filter(
            Constraint.school_id == school_id,
            Constraint.type == "subject_sequence",
            Constraint.is_hard.is_(True),
        )
        .all()
    )
    if sequence_constraints:
        # req_by_class_subject was already built above, when honoring
        # locked entries — reused here rather than recomputed.
        for c in sequence_constraints:
            p = c.parameters or {}
            first_subject_id = p.get("first_subject_id")
            second_subject_id = p.get("second_subject_id")
            if not first_subject_id or not second_subject_id:
                continue
            class_group_ids = p.get("class_group_ids") or [cg.id for cg in class_groups]
            for cg_id in class_group_ids:
                req1 = req_by_class_subject.get((cg_id, first_subject_id))
                req2 = req_by_class_subject.get((cg_id, second_subject_id))
                if not req1 or not req2:
                    continue  # this class group doesn't have both subjects; nothing to constrain
                for day_periods in sorted_periods_by_day.values():
                    for i in range(len(day_periods) - 1):
                        period, next_period = day_periods[i], day_periods[i + 1]
                        first_vars = req_period_vars.get(req1.id, {}).get(period.id, [])
                        second_vars = req_period_vars.get(req2.id, {}).get(next_period.id, [])
                        if first_vars and second_vars:
                            model.Add(sum(first_vars) + sum(second_vars) <= 1)

    # "min_gap_between_subjects" Constraint rows: forbid first_subject_id
    # and second_subject_id from landing within min_gap periods of each
    # other on the same day, for the scoped class groups. Unlike
    # subject_sequence, this is symmetric (order doesn't matter) and
    # covers every period pair within the gap, not just the immediately
    # adjacent one — implemented as a direct "at most one of these two
    # periods" constraint for every same-day period pair whose order
    # distance is less than min_gap (this naturally also covers the
    # same-period case, distance 0, though that's already impossible via
    # the class-group double-booking constraint above).
    gap_constraints = (
        db.query(Constraint)
        .filter(
            Constraint.school_id == school_id,
            Constraint.type == "min_gap_between_subjects",
            Constraint.is_hard.is_(True),
        )
        .all()
    )
    for c in gap_constraints:
        p = c.parameters or {}
        first_subject_id = p.get("first_subject_id")
        second_subject_id = p.get("second_subject_id")
        min_gap = p.get("min_gap")
        if not first_subject_id or not second_subject_id or not isinstance(min_gap, int) or min_gap < 1:
            continue
        class_group_ids = p.get("class_group_ids") or [cg.id for cg in class_groups]
        for cg_id in class_group_ids:
            req1 = req_by_class_subject.get((cg_id, first_subject_id))
            req2 = req_by_class_subject.get((cg_id, second_subject_id))
            if not req1 or not req2:
                continue  # this class group doesn't have both subjects; nothing to constrain
            for day_periods in sorted_periods_by_day.values():
                for p1 in day_periods:
                    p1_vars = req_period_vars.get(req1.id, {}).get(p1.id, [])
                    if not p1_vars:
                        continue
                    for p2 in day_periods:
                        if abs(p1.order - p2.order) >= min_gap:
                            continue
                        p2_vars = req_period_vars.get(req2.id, {}).get(p2.id, [])
                        if p2_vars:
                            model.Add(sum(p1_vars) + sum(p2_vars) <= 1)

    solver = cp_model.CpSolver()
    # Use every core the machine has, up to a reasonable cap — CP-SAT's
    # parallel search scales well and this is the single biggest lever for
    # solving larger schools (many sections/teachers) within the time
    # budget. Stress-tested: with fully symmetric teacher pools (a
    # deliberately worst-case setup — real schools have more natural
    # variation, which helps the solver), this handles ~40 sections'
    # worth of a school optimally in well under a minute on 2 cores;
    # more cores scale further.
    solver.parameters.num_search_workers = min(8, max(1, os.cpu_count() or 1))
    solver.parameters.max_time_in_seconds = settings.solver_time_limit_seconds
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
        # Lab-batch assignments live in batch_x, not x (see the
        # lab_batch_count branch above) — pulled in separately here, each
        # tagged with its 1-indexed batch number so the frontend can show
        # "Batch 1 - Room 3" / "Batch 2 - Room 5" for the same class,
        # subject, and period instead of two indistinguishable rows.
        for (req_id, period_id, batch), teacher_options in batch_x.items():
            for teacher_id, var in teacher_options:
                if solver.Value(var):
                    req = req_by_id[req_id]
                    assignments.append(
                        {
                            "class_group_id": req.class_group_id,
                            "subject_id": req.subject_id,
                            "teacher_id": teacher_id,
                            "period_id": period_id,
                            "batch": batch + 1,
                        }
                    )
                    break
        _assign_rooms(db, school_id, assignments, locked_rooms=locked_rooms)

    if status_name in ("infeasible", "unknown"):
        errors = errors + _diagnose_infeasibility(
            requirements, teachers_by_id, periods,
            req_restricted_periods, req_required_periods, candidate_ids_by_req,
            subjects_by_id, class_groups_by_id,
        )

    return TimetableSolveResult(status=status_name, assignments=assignments, locked_keys=locked_keys, errors=errors)


def _diagnose_infeasibility(
    requirements: list[SubjectRequirement],
    teachers_by_id: dict[int, Teacher],
    periods: list[Period],
    req_restricted_periods: dict[int, set[int]],
    req_required_periods: dict[int, set[int] | None],
    candidate_ids_by_req: dict[int, list[int]],
    subjects_by_id: dict[int, Subject],
    class_groups_by_id: dict[int, ClassGroup],
) -> list[str]:
    """
    Best-effort explanation for why the solve came back infeasible (or
    timed out inconclusively) instead of just surfacing CP-SAT's raw
    status. This is deliberately NOT a general infeasibility explainer —
    that's a genuinely hard problem (formally, finding a minimal
    unsatisfiable subset of constraints) that would need something like
    CP-SAT's assumption-based conflict analysis to do properly for
    arbitrary constraint interactions. Instead, this checks for the
    handful of causes that are both common in practice and cheap to
    detect directly from the data, without needing to interrogate the
    solver at all:

      1. A class group's total periods/week demand (summed across all its
         subjects) exceeds how many periods the school even has defined.
      2. A "subject must be in the first/last period" placement constraint
         leaves fewer eligible periods than the subject's periods/week —
         e.g. "6 periods/week, but restricted to only the first period of
         a 5-day week" is impossible regardless of anything else.
      3. A teacher who is the *only* qualified (or explicitly preferred)
         teacher for one or more requirements is asked for more total
         periods/week than their max_periods_per_week cap or their actual
         available periods allow.

    Each hit becomes one specific, actionable sentence. Returns an empty
    list if none of these apply — a genuinely opaque infeasibility (e.g.
    an interaction between several constraints, none of which alone is
    the problem) isn't diagnosed, and the caller falls back to a generic
    message rather than pretending to know the cause.
    """
    messages: list[str] = []

    # 1. Total demand vs. total periods available, per class group.
    total_periods = len(periods)
    demand_by_cg: dict[int, int] = {}
    for req in requirements:
        demand_by_cg[req.class_group_id] = demand_by_cg.get(req.class_group_id, 0) + req.periods_per_week
    for cg_id, demand in demand_by_cg.items():
        if demand > total_periods:
            cg = class_groups_by_id.get(cg_id)
            label = _class_group_label(cg) if cg else f"class_group_id={cg_id}"
            messages.append(
                f"{label} needs {demand} periods/week in total across all its subjects, but "
                f"the school only has {total_periods} periods defined — add more periods, or "
                f"reduce periods/week for one or more subjects in this section."
            )

    # 2. A placement restriction leaves too few eligible periods for a
    # requirement's periods/week, regardless of teacher availability.
    for req in requirements:
        required = req_required_periods.get(req.id)
        if required is not None and len(required) < req.periods_per_week:
            subject = subjects_by_id.get(req.subject_id)
            cg = class_groups_by_id.get(req.class_group_id)
            subject_name = subject.name if subject else f"subject_id={req.subject_id}"
            cg_label = _class_group_label(cg) if cg else f"class_group_id={req.class_group_id}"
            messages.append(
                f"{subject_name} for {cg_label} needs {req.periods_per_week} periods/week, but "
                f"a subject-placement constraint restricts it to only {len(required)} eligible "
                f"period(s) — loosen that constraint or reduce periods/week."
            )

    # 3. A sole qualified/preferred teacher is asked for more than they
    # can give, either by their own cap or by how many periods they're
    # actually available for.
    load_by_teacher: dict[int, int] = {}
    for req in requirements:
        candidates = candidate_ids_by_req.get(req.id, [])
        if len(candidates) == 1:
            load_by_teacher[candidates[0]] = load_by_teacher.get(candidates[0], 0) + req.periods_per_week
    for teacher_id, load in load_by_teacher.items():
        teacher = teachers_by_id.get(teacher_id)
        if not teacher:
            continue
        available = len(periods) - len(set(teacher.unavailable_period_ids or []))
        cap = teacher.max_periods_per_week
        effective_cap = min(cap, available) if cap is not None else available
        if load > effective_cap:
            if cap is not None and cap <= available:
                reason = f"capped at {cap} periods/week"
            else:
                reason = f"only available for {available} period(s)/week (given their marked-unavailable periods)"
            messages.append(
                f"{teacher.name} is the only qualified or preferred teacher for requirements "
                f"totaling {load} periods/week, but is {reason} — raise their cap, free up more "
                f"of their availability, or add another teacher qualified for the same subject(s)."
            )

    return messages


def _assign_rooms(
    db: Session,
    school_id: int,
    assignments: list[dict],
    locked_rooms: dict[tuple[int, int, int, int], int | None] | None = None,
) -> None:
    """
    Best-effort second pass: assigns a Room to as many scheduled entries as
    possible, without touching the (subject, teacher, period) choices the
    main solve already made. Mutates each dict in `assignments` in place,
    adding a "room_id" key (int or None).

    Kept as its own separate, much smaller CP-SAT model rather than folded
    into the main model above, for two reasons:
      1. Once the period/teacher for every entry is fixed, room-matching
         reduces to a much simpler problem (which room, if any, for an
         already-fixed class/period) — solving it separately keeps rooms
         from making the expensive part of the search (the main model)
         any slower as more rooms are added to a school.
      2. It's genuinely optional/best-effort: a school might have fewer
         rooms than simultaneous classes, and that should mean some
         entries just don't get a room, not that generation fails
         entirely. So this maximizes the number of entries assigned a
         room rather than requiring all of them to get one.
    """
    locked_rooms = locked_rooms or {}
    rooms = db.query(Room).filter(Room.school_id == school_id).all()

    # Locked entries keep whatever room they already had (or stay
    # room-less if they didn't have one) — they're not up for
    # re-matching. Their (period, room) pair is still reserved so an
    # unlocked entry can't get matched into it below.
    locked_period_rooms: set[tuple[int, int]] = set()
    for a in assignments:
        key = (a["class_group_id"], a["subject_id"], a["teacher_id"], a["period_id"])
        if key in locked_rooms:
            a["room_id"] = locked_rooms[key]
            if locked_rooms[key] is not None:
                locked_period_rooms.add((a["period_id"], locked_rooms[key]))
        else:
            a["room_id"] = None
    if not rooms:
        return  # nothing to assign against; every unlocked entry stays room_id=None

    subjects_by_id = {s.id: s for s in db.query(Subject).filter(Subject.school_id == school_id).all()}
    class_groups_by_id = {c.id: c for c in db.query(ClassGroup).filter(ClassGroup.school_id == school_id).all()}

    room_model = cp_model.CpModel()
    room_vars: dict[tuple[int, int], cp_model.IntVar] = {}  # (assignment_index, room_id) -> var

    for idx, a in enumerate(assignments):
        key = (a["class_group_id"], a["subject_id"], a["teacher_id"], a["period_id"])
        if key in locked_rooms:
            continue  # already fixed above; not part of this solve

        subject = subjects_by_id.get(a["subject_id"])
        class_group = class_groups_by_id.get(a["class_group_id"])
        required_type = subject.required_room_type if subject else None
        student_count = class_group.student_count if class_group else None

        eligible = [
            r for r in rooms
            if (not required_type or r.room_type == required_type)
            and (not student_count or not r.capacity or r.capacity >= student_count)
            and (a["period_id"], r.id) not in locked_period_rooms
        ]
        vars_for_assignment = []
        for room in eligible:
            var = room_model.NewBoolVar(f"room_{idx}_{room.id}")
            room_vars[(idx, room.id)] = var
            vars_for_assignment.append(var)
        if vars_for_assignment:
            room_model.Add(sum(vars_for_assignment) <= 1)  # at most one room; 0 = unassigned

    if not room_vars:
        return  # no (entry, room) combination is even eligible

    # No room double-booked in the same period.
    period_room_vars: dict[tuple[int, int], list] = {}
    for (idx, room_id), var in room_vars.items():
        period_room_vars.setdefault((assignments[idx]["period_id"], room_id), []).append(var)
    for group in period_room_vars.values():
        room_model.AddAtMostOne(group)

    room_model.Maximize(sum(room_vars.values()))

    room_solver = cp_model.CpSolver()
    room_solver.parameters.num_search_workers = min(8, max(1, os.cpu_count() or 1))
    # This is a much simpler problem than the main solve (fixed periods,
    # just matching rooms against them), so it doesn't need anywhere near
    # the same time budget.
    room_solver.parameters.max_time_in_seconds = min(15, settings.solver_time_limit_seconds)
    room_status = room_solver.Solve(room_model)

    if room_status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        for (idx, room_id), var in room_vars.items():
            if room_solver.Value(var):
                assignments[idx]["room_id"] = room_id


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
