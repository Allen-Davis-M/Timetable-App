# Architecture

## Overview

```
┌─────────────┐      HTTPS/JSON       ┌──────────────────┐      SQL      ┌────────────┐
│  React app   │  ───────────────────▶ │  FastAPI backend  │ ─────────────▶ │ PostgreSQL │
│ (Tailwind)   │  ◀─────────────────── │  + OR-Tools solver │ ◀───────────── │            │
└─────────────┘                        └──────────────────┘                └────────────┘
```

- **Frontend (React + Tailwind)**: handles data entry/import, constraint
  configuration, and renders the generated timetable as an interactive grid.
  Talks to the backend only through the REST API — no direct database access.
- **Backend (FastAPI)**: exposes REST endpoints for CRUD on schools,
  teachers, classes, subjects, rooms, and constraints, plus a `/generate`
  endpoint that runs the solver and returns a timetable.
- **Solver service**: a Python module that translates the school's data +
  constraints into a Google OR-Tools CP-SAT model, solves it, and translates
  the solution back into a timetable structure. Kept as its own service layer
  (not mixed into route handlers) so it can be tested and swapped
  independently of the API.
- **Database (PostgreSQL)**: stores raw input data and generated timetables.
  The solver reads from it and writes results back; it does not hold
  in-memory state between requests.

## Why FastAPI + OR-Tools (Python)

OR-Tools' Python bindings are the most mature and best documented of its
supported languages. FastAPI also generates interactive API docs
(`/docs`) automatically from the code, which matters given the project's
"documented properly" goal — the API documentation stays in sync with the
code by construction rather than needing to be hand-maintained.

## Data model philosophy

The scope was deliberately kept **generic** rather than locked to one
curriculum or school type (e.g. CBSE secondary schools specifically). That
means the core entities are modeled around universal scheduling concepts
instead of India-specific or curriculum-specific assumptions:

- **School** — top-level tenant; everything else belongs to a school.
- **Term/AcademicYear** — a scheduling period.
- **Period** — a schedulable time slot (e.g. "Monday, 9:00–9:45"). Schools
  define their own period structure rather than the app assuming a fixed one.
- **Room** — a physical space with optional capacity/type (lab, regular, etc).
- **Subject** — a teachable subject.
- **Teacher** — has qualifications (which subjects they can teach) and
  availability.
- **ClassGroup** (a.k.a. "section") — a group of students that moves through
  the timetable together (e.g. "Grade 8 - Section A").
- **Constraint** — a rule the solver must (hard) or should (soft) satisfy.
  Stored generically as `(type, target, parameters)` so new constraint types
  can be added without schema migrations for each one.
- **Timetable / TimetableEntry** — the generated result: which class group
  has which subject, with which teacher, in which room, at which period.

This generality is the tradeoff explicitly chosen over narrowing to one
school type first: slower to reach a single sellable pilot, but the schema
doesn't need reworking when the second school type is onboarded.

## Open decisions (not yet made)

- Exact constraint taxonomy (which constraint types ship in v1).
- Auth model (JWT vs. third-party auth provider) and multi-tenancy
  enforcement (row-level vs. schema-per-school).
- How infeasible-constraint errors are explained to a non-technical admin —
  flagged in project notes as one of the hardest UX problems, not yet solved.

## Request lifecycle (generate timetable)

1. Frontend calls `POST /api/timetables/generate` with a school + term ID.
2. Backend loads the school's teachers, classes, subjects, rooms, periods,
   and constraints from PostgreSQL.
3. Solver service builds a CP-SAT model: one boolean variable per
   `(class_group, subject, teacher, room, period)` combination that's valid,
   plus constraints (no teacher/room/class double-booked, teacher
   qualifications, availability, subject-hours-per-week, etc).
4. CP-SAT searches for a feasible (or optimal, if soft constraints are
   scored) assignment.
5. Backend writes the resulting `TimetableEntry` rows and returns the
   timetable (or a structured explanation if infeasible).
