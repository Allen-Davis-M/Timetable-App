"""
Turns a plain-English scheduling constraint into a structured constraint.

This is a pattern-matching parser, not an LLM call — it recognizes a fixed
set of common phrasings (workload limits, availability, generic rules) well
enough to be useful without needing an API key or external service. It is
NOT a general NLP system: unusual phrasing falls through to a generic
"scheduling rule" bucket that's recorded but not enforced by the solver.

Swapping this for a real LLM-based parser (e.g. calling Claude) later is a
drop-in replacement: same input (text, list of known teacher names), same
output shape (ParsedConstraint), so nothing else has to change.

What's actually enforced by the solver today:
  - "workload_limit" constraints, when a teacher is identified, are applied
    for real by setting Teacher.max_periods_per_week (which the solver
    already respects — see app/services/solver.py).
  - "availability" and "scheduling_rule" constraints are recorded (visible
    in the UI, stored in the Constraint table) but not yet enforced by the
    solver. That's a known, documented gap — see docs/ARCHITECTURE.md.
"""
import re
from dataclasses import dataclass


@dataclass
class ParsedConstraint:
    type: str  # "workload_limit" | "availability" | "scheduling_rule"
    teacher_name: str | None
    max_periods_per_week: int | None
    description: str


_PERIODS_RE = re.compile(r"(\d+)\s*period", re.IGNORECASE)
_AVAILABILITY_WORDS = [
    "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
    "morning", "afternoon", "not available", "unavailable", "can't teach", "cannot teach",
]


def _find_teacher(text: str, teacher_names: list[str]) -> str | None:
    """Match a teacher by last name appearing in the text (case-insensitive).
    Simple substring matching — good enough for "Mrs. Sharma can only..."
    style input where the full name may not be typed out."""
    lower = text.lower()
    for name in teacher_names:
        last_name = name.strip().split(" ")[-1].lower()
        if last_name and last_name in lower:
            return name
    return None


def parse_constraint(text: str, teacher_names: list[str]) -> ParsedConstraint:
    lower = text.lower()
    teacher = _find_teacher(text, teacher_names)

    periods_match = _PERIODS_RE.search(lower)
    if periods_match:
        max_periods = int(periods_match.group(1))
        description = (
            f"Max {max_periods} periods per week for {teacher}"
            if teacher
            else text
        )
        return ParsedConstraint(
            type="workload_limit",
            teacher_name=teacher,
            max_periods_per_week=max_periods,
            description=description,
        )

    if any(word in lower for word in _AVAILABILITY_WORDS):
        return ParsedConstraint(
            type="availability",
            teacher_name=teacher,
            max_periods_per_week=None,
            description=text,
        )

    return ParsedConstraint(
        type="scheduling_rule",
        teacher_name=teacher,
        max_periods_per_week=None,
        description=text,
    )
