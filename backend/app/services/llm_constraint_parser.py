"""
LLM-based constraint parser — calls Claude to turn a free-text scheduling
rule into a structured constraint, instead of the fixed regex patterns in
app/services/constraint_parser.py. This understands a much wider range of
phrasing and a richer set of constraint types (see ParsedConstraint below),
because it's real language understanding rather than keyword matching.

Design choices:
  - Uses forced tool-use (`tool_choice`), not free-text completion, so the
    response is always valid structured data — no second parsing step, no
    "the model wrapped its answer in prose" failure mode.
  - Grounds the model against the school's actual teacher/subject/class-group
    names (passed in the system prompt) and instructs it to only use exact
    names from those lists, or null. This keeps the *matching* logic here
    (in the prompt) rather than pushing fuzzy string matching into the
    router — the router just does an exact dict lookup on whatever name
    comes back, same as the regex parser did.
  - Returns None on ANY failure — no API key configured, network error,
    rate limit, malformed response, whatever. The caller
    (app/routers/constraints.py) falls back to the regex parser when this
    returns None, so a flaky LLM call never blocks constraint entry
    entirely. This is a deliberate availability-over-purity tradeoff.
"""
import logging
from dataclasses import dataclass, field

from app.core.config import settings

logger = logging.getLogger(__name__)

# Constraint types this parser (and the solver) understand:
#   workload_limit          - caps a teacher's periods/week
#   availability             - a teacher is unavailable on a given day
#   subject_period_position  - a subject must (mode=require) or must not
#                               (mode=exclude) be in the first/last period
#                               of the day, optionally scoped to one grade
#                               or section via class_group_name
#   max_consecutive_periods  - caps how many periods can run back-to-back
#                               on the same day for either a subject (any
#                               class, optionally scoped via
#                               class_group_name) or a teacher (their whole
#                               schedule, any subject/class — set
#                               teacher_name instead of subject_name)
#   min_gap_between_subjects  - first_subject_name and second_subject_name
#                               must be separated by at least min_gap
#                               periods on the same day, for the same class
#                               (e.g. "leave at least 1 period between PE
#                               and Math"), optionally scoped via
#                               class_group_name
#   subject_day_position      - a subject must (mode=require) or must not
#                               (mode=exclude) be scheduled on a given day
#                               of the week (e.g. "No PE on Fridays"),
#                               optionally scoped via class_group_name
#   subject_sequence          - second_subject_name must not be scheduled
#                               in the period immediately after
#                               first_subject_name, for the same class
#                               (e.g. "Math can't immediately follow PE"),
#                               optionally scoped via class_group_name
#   scheduling_rule           - catch-all; recorded but not enforced
_TOOL_SCHEMA = {
    "name": "record_constraint",
    "description": "Record a structured school-timetabling constraint extracted from one sentence of free text.",
    "input_schema": {
        "type": "object",
        "properties": {
            "type": {
                "type": "string",
                "enum": [
                    "workload_limit",
                    "availability",
                    "subject_period_position",
                    "subject_day_position",
                    "max_consecutive_periods",
                    "min_gap_between_subjects",
                    "subject_sequence",
                    "scheduling_rule",
                ],
            },
            "teacher_name": {
                "type": ["string", "null"],
                "description": "Must exactly match one of the provided known teacher names verbatim, or null if none is mentioned/matched. For max_consecutive_periods, set this (and leave subject_name null) when the rule caps a specific teacher's back-to-back periods rather than a subject's.",
            },
            "subject_name": {
                "type": ["string", "null"],
                "description": "Must exactly match one of the provided known subject names verbatim, or null. Used by subject_period_position, subject_day_position, and the subject variant of max_consecutive_periods.",
            },
            "first_subject_name": {
                "type": ["string", "null"],
                "description": "For subject_sequence and min_gap_between_subjects: the first-named subject. Must exactly match a known subject name, or null.",
            },
            "second_subject_name": {
                "type": ["string", "null"],
                "description": "For subject_sequence and min_gap_between_subjects: the second-named subject. Must exactly match a known subject name, or null.",
            },
            "class_group_name": {
                "type": ["string", "null"],
                "description": "Must exactly match one of the provided known class-group labels verbatim (a whole grade like 'Grade 3', or one section like 'Grade 3 - A'), or null if the rule applies school-wide / isn't about a specific class.",
            },
            "max_periods_per_week": {"type": ["integer", "null"], "description": "For workload_limit."},
            "day_of_week": {"type": ["integer", "null"], "description": "0=Monday .. 6=Sunday. For availability and subject_day_position."},
            "position": {"type": ["string", "null"], "enum": ["first", "last", None], "description": "For subject_period_position."},
            "mode": {
                "type": ["string", "null"],
                "enum": ["require", "exclude", None],
                "description": "For subject_period_position and subject_day_position: 'require' if the sentence says the subject MUST/SHOULD be there, 'exclude' if it says the subject must NOT/CAN'T/SHOULDN'T be there.",
            },
            "max_consecutive": {"type": ["integer", "null"], "description": "For max_consecutive_periods — the max number of back-to-back periods allowed."},
            "min_gap": {"type": ["integer", "null"], "description": "For min_gap_between_subjects — the minimum number of periods that must separate the two subjects on the same day."},
            "description": {
                "type": "string",
                "description": "A short, human-readable one-sentence summary of the rule, for display in a UI card.",
            },
        },
        "required": ["type", "description"],
    },
}


@dataclass
class ParsedConstraint:
    type: str
    description: str
    teacher_name: str | None = None
    subject_name: str | None = None
    first_subject_name: str | None = None
    second_subject_name: str | None = None
    class_group_name: str | None = None
    max_periods_per_week: int | None = None
    day_of_week: int | None = None
    position: str | None = None
    mode: str | None = None
    max_consecutive: int | None = None
    min_gap: int | None = None


def parse_constraint_llm(
    text: str,
    teacher_names: list[str],
    subject_names: list[str],
    class_group_labels: list[str],
) -> ParsedConstraint | None:
    """Returns None (never raises) if the LLM path can't be used right
    now — no key configured, or the call/response failed for any reason.
    Callers must handle None by falling back to the regex parser."""
    if not settings.anthropic_api_key:
        return None

    try:
        import anthropic
    except ImportError:
        logger.warning("anthropic package not installed; falling back to regex constraint parser")
        return None

    try:
        client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
        system_prompt = (
            "You extract a single structured school-timetabling constraint from one "
            "sentence written by a school admin. Use the record_constraint tool.\n\n"
            f"Known teachers: {teacher_names}\n"
            f"Known subjects: {subject_names}\n"
            f"Known class groups (grades and sections): {class_group_labels}\n\n"
            "Only reference names that appear verbatim in these lists; if a name in the "
            "sentence doesn't clearly match one of them, use null rather than guessing. "
            "If the sentence doesn't fit any of the specific constraint types, use "
            "type='scheduling_rule' and just fill in description."
        )
        response = client.messages.create(
            model=settings.llm_model,
            max_tokens=500,
            system=system_prompt,
            tools=[_TOOL_SCHEMA],
            tool_choice={"type": "tool", "name": "record_constraint"},
            messages=[{"role": "user", "content": text}],
        )
        tool_use = next(b for b in response.content if b.type == "tool_use")
        data = tool_use.input
        return ParsedConstraint(
            type=data.get("type", "scheduling_rule"),
            description=data.get("description") or text,
            teacher_name=data.get("teacher_name"),
            subject_name=data.get("subject_name"),
            first_subject_name=data.get("first_subject_name"),
            second_subject_name=data.get("second_subject_name"),
            class_group_name=data.get("class_group_name"),
            max_periods_per_week=data.get("max_periods_per_week"),
            day_of_week=data.get("day_of_week"),
            position=data.get("position"),
            mode=data.get("mode"),
            max_consecutive=data.get("max_consecutive"),
            min_gap=data.get("min_gap"),
        )
    except Exception:
        logger.exception("LLM constraint parsing failed; falling back to regex parser")
        return None
