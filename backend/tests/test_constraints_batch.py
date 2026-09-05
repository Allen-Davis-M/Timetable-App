"""
Tests for POST /api/constraints/batch (app/routers/constraints.py's
parse_and_create_constraints_batch) — the batch counterpart to /parse.
Covers both paths through _resolve_constraints_batch_text: the LLM batch
call (mocked here, never a real API call) and the per-line fallback that
kicks in when it's unavailable, which in this test env means "always"
(no ANTHROPIC_API_KEY is set — same as every other constraint test file).
"""
from unittest.mock import patch

from app.core.config import settings
from app.services.llm_constraint_parser import ParsedConstraint
from tests.conftest import create_school, signup


def _create_subject(client, headers, school_id, name):
    r = client.post("/api/subjects", json={"school_id": school_id, "name": name}, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


def _create_teacher(client, headers, school_id, name):
    r = client.post("/api/teachers", json={"school_id": school_id, "name": name}, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


def test_batch_without_llm_falls_back_to_one_rule_per_line(client):
    """No ANTHROPIC_API_KEY in this test env (see conftest.py), so this
    exercises the per-line regex fallback end to end — two lines, each
    independently recognizable by the regex parser, should become two
    separate Constraint rows."""
    assert settings.anthropic_api_key is None
    _, headers = signup(client)
    school = create_school(client, headers)
    _create_teacher(client, headers, school["id"], "Mrs. Sharma")
    _create_subject(client, headers, school["id"], "PE")

    r = client.post(
        "/api/constraints/batch",
        json={
            "school_id": school["id"],
            "text": "Mrs. Sharma can only teach 15 periods a week\nNo PE on Fridays",
        },
        headers=headers,
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert len(body) == 2
    types = {item["constraint"]["type"] for item in body}
    assert types == {"workload_limit", "no_subject_day"}
    assert all(item["enforced"] for item in body)


def test_batch_ignores_blank_lines(client):
    _, headers = signup(client)
    school = create_school(client, headers)
    _create_teacher(client, headers, school["id"], "Mrs. Sharma")

    r = client.post(
        "/api/constraints/batch",
        json={"school_id": school["id"], "text": "Mrs. Sharma can only teach 15 periods a week\n\n\n"},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    assert len(r.json()) == 1


def test_batch_with_unparseable_text_returns_400(client):
    _, headers = signup(client)
    school = create_school(client, headers)

    r = client.post(
        "/api/constraints/batch",
        json={"school_id": school["id"], "text": "   \n  \n"},
        headers=headers,
    )
    assert r.status_code == 400


def test_batch_uses_llm_when_configured(client):
    """Mocks parse_constraints_batch_llm directly (never a real Anthropic
    call) to prove the batch endpoint actually wires that function's
    output into created Constraint rows, rather than always silently
    falling back to per-line parsing."""
    _, headers = signup(client)
    school = create_school(client, headers)
    teacher = _create_teacher(client, headers, school["id"], "Mrs. Sharma")

    fake_parsed = [
        ParsedConstraint(
            type="workload_limit",
            description="Mrs. Sharma: 12 periods/week",
            teacher_name="Mrs. Sharma",
            max_periods_per_week=12,
        ),
        ParsedConstraint(
            type="scheduling_rule",
            description="Something unusual the LLM couldn't map to a specific type",
        ),
    ]
    with patch.object(settings, "anthropic_api_key", "fake-key"):
        with patch(
            "app.routers.constraints.parse_constraints_batch_llm", return_value=fake_parsed
        ) as mock_batch:
            r = client.post(
                "/api/constraints/batch",
                json={"school_id": school["id"], "text": "irrelevant — the mock ignores this"},
                headers=headers,
            )
    assert r.status_code == 201, r.text
    mock_batch.assert_called_once()
    body = r.json()
    assert len(body) == 2
    workload = next(item for item in body if item["constraint"]["type"] == "workload_limit")
    assert workload["constraint"]["parameters"]["teacher_id"] == teacher["id"]
    assert workload["enforced"] is True
    catchall = next(item for item in body if item["constraint"]["type"] == "scheduling_rule")
    assert catchall["enforced"] is False


def test_batch_falls_back_to_per_line_when_llm_batch_call_fails(client):
    """parse_constraints_batch_llm returning None (its documented
    never-raises failure signal) must fall back to per-line parsing, not
    silently produce zero constraints."""
    _, headers = signup(client)
    school = create_school(client, headers)
    _create_teacher(client, headers, school["id"], "Mrs. Sharma")

    with patch.object(settings, "anthropic_api_key", "fake-key"):
        with patch("app.routers.constraints.parse_constraints_batch_llm", return_value=None):
            r = client.post(
                "/api/constraints/batch",
                json={"school_id": school["id"], "text": "Mrs. Sharma can only teach 15 periods a week"},
                headers=headers,
            )
    assert r.status_code == 201, r.text
    assert len(r.json()) == 1
    assert r.json()[0]["constraint"]["type"] == "workload_limit"


def test_batch_flags_conflicts_between_two_rules_in_the_same_paste(client):
    """Two contradictory rules submitted in the SAME batch call must be
    flagged against each other, exactly like two separate /parse calls
    would be — conflict detection is DB-driven (queries every saved
    constraint), not scoped to "this batch" vs "earlier saves", so this
    should fall out for free rather than needing special-case logic."""
    _, headers = signup(client)
    school = create_school(client, headers)
    _create_subject(client, headers, school["id"], "Math")

    fake_parsed = [
        ParsedConstraint(
            type="subject_period_position", mode="require", position="first",
            subject_name="Math", description="Math must be first period",
        ),
        ParsedConstraint(
            type="subject_period_position", mode="require", position="last",
            subject_name="Math", description="Math must be last period",
        ),
    ]
    with patch.object(settings, "anthropic_api_key", "fake-key"):
        with patch("app.routers.constraints.parse_constraints_batch_llm", return_value=fake_parsed):
            r = client.post(
                "/api/constraints/batch",
                json={"school_id": school["id"], "text": "Math must be first period. Math must be last period."},
                headers=headers,
            )
    assert r.status_code == 201, r.text
    body = r.json()
    assert len(body) == 2
    assert body[0]["constraint"]["conflicts"] and body[1]["constraint"]["conflicts"]


def test_viewer_cannot_batch_create_constraints(client):
    owner, headers = signup(client, email="owner@a.com")
    school = create_school(client, headers)
    r = client.post(
        f"/api/schools/{school['id']}/invites", json={"email": "viewer@a.com", "role": "viewer"}, headers=headers
    )
    token = r.json()["token"]
    accept = client.post(f"/api/invites/{token}/accept", json={"name": "V", "password": "password123"})
    viewer_headers = {"Authorization": f"Bearer {accept.json()['access_token']}"}

    r = client.post(
        "/api/constraints/batch",
        json={"school_id": school["id"], "text": "anything"},
        headers=viewer_headers,
    )
    assert r.status_code == 403
