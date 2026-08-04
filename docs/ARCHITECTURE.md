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
  in-memory state between requests. Local development runs against SQLite
  instead (`sqlite:///./dev.db`, see `app/core/config.py`) purely so
  contributors don't need Postgres installed just to get the app running —
  the ORM layer (SQLAlchemy) is the only thing that talks to the database,
  so swapping the connection string is the entire migration when a
  deployment actually needs Postgres.

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

## Auth and multi-tenancy

Auth is email/password with JWTs (`app/core/auth.py`), not a third-party
provider — the simplest thing that works for a single-admin-per-school
product, with a `User.google_sub` column already reserved so Google
sign-in can be added later as a new router plus a few lines, not a schema
change. `POST /api/auth/signup` and `/login` both return a bearer token;
every other endpoint depends on `get_current_user`, which decodes the
token and loads the `User` row, rejecting the request with 401 if the
token is missing, expired, or invalid.

Multi-tenancy is enforced at exactly one point: `School.owner_id`.
Creating a school attaches the logged-in user as owner, and
`GET /api/schools` / `GET /api/schools/{id}` only return schools that
user owns (`app/routers/schools.py`). Every other resource — teachers,
subjects, rooms, constraints, timetables — is scoped by `school_id` in
its queries but doesn't re-check ownership itself; it relies on the
frontend only ever passing a `school_id` the current user is actually
looking at. This is a known simplification, fine while there's one admin
per school, but worth tightening (checking the requesting user owns the
`school_id` on every resource endpoint, not just the school endpoints
themselves) before this supports multiple admins per school or any
untrusted client calling the API directly.

## Open decisions (not yet made)

- Per-resource ownership checks (see multi-tenancy note above) — deferred
  until multiple admins per school is an actual requirement.
- Diagnosing infeasibility caused by an interaction *between* several
  constraints (as opposed to one constraint alone) — see the "Infeasibility
  diagnostics" section below for what's covered and what still isn't.

## Request lifecycle (generate timetable)

Generation runs as an async background job, not a single request/response,
because CP-SAT can legitimately take up to a minute on a large school
(many sections, symmetric teacher pools) — long enough that holding an
HTTP request open risks browser/proxy timeouts and gives the admin no
feedback while it runs.

1. Frontend calls `POST /api/timetables/generate?school_id=...`.
2. Backend creates a `Timetable` row with `status="generating"`, commits
   it, spawns a background thread to do the actual solve, and returns the
   row immediately (`app/routers/timetables.py`).
3. In the background thread: solver service loads the school's teachers,
   classes, subjects, and periods, builds a CP-SAT model (one boolean
   variable per valid `(class_group, subject, teacher, period)`
   combination, plus constraints: no teacher/class double-booked, teacher
   qualifications, per-teacher weekly caps, subject-hours-per-week), and
   solves it within `solver_time_limit_seconds` (default 60s,
   `app/core/config.py`).
4. On completion the thread updates the same `Timetable` row: `status`
   becomes `"draft"` with `TimetableEntry` rows written (success), or
   `"failed"` with `error_message` explaining why (infeasible, timed out
   without a conclusive answer, or missing data like no periods defined).
5. Frontend polls `GET /api/timetables/{id}` every 1.5s
   (`TimetableTab.jsx`) until `status` is no longer `"generating"`, then
   renders the grid or the error.

This uses a plain Python thread rather than a task queue (Celery/RQ +
Redis) — the right tradeoff at current scale: zero extra infrastructure,
at the cost of jobs not surviving a server restart and not scaling across
multiple backend worker processes. If the app needs multiple backend
processes or job durability, swap the thread for a real task queue; the
job-row-plus-polling API shape wouldn't need to change.

Room assignment runs as a second, best-effort phase after the main
teacher/period schedule is fixed (`_assign_rooms` in
`app/services/solver.py`). It's deliberately not folded into the main
CP-SAT model: rooms don't affect whether a valid timetable exists, only
where each already-scheduled class happens to sit, so solving them
together would slow down the harder search for no benefit and could turn
an otherwise-feasible schedule infeasible over a room shortage. Instead,
once `assignments` is finalized, `_assign_rooms` builds a small per-period
bipartite matching problem (entries at that period that need a room vs.
available rooms, respecting `Subject.required_room_type` against
`Room.room_type` when set, and `Room.capacity` when a class group's
`student_count` is known) and assigns as many rooms as it can. Any entry
that can't get a room (e.g. more simultaneous classes than the school has
generic rooms) is simply left with `room_id = null` — the timetable is
still shown and exported, just without a room noted for that class.

## Infeasibility diagnostics

Historically, a failed generation just surfaced CP-SAT's raw
`INFEASIBLE`/`UNKNOWN` status as "No feasible timetable found" — true, but
useless to a non-technical admin trying to figure out what to actually
change. `_diagnose_infeasibility` in `app/services/solver.py` closes part
of that gap by checking for a handful of causes that are both common in
practice and cheap to detect directly from the data, without needing to
interrogate the solver itself:

1. **Total demand exceeds total supply.** A class group's periods/week
   summed across all its subjects is more than the school has periods
   defined at all — impossible regardless of teachers or constraints.
2. **A placement constraint over-restricts a subject.** "Math must be the
   first period" only creates one eligible period per day; if a subject
   needs more periods/week than that restriction leaves eligible, it's
   impossible no matter what else is going on.
3. **A sole qualified/preferred teacher is overloaded.** If a teacher is
   the *only* one qualified (or explicitly preferred) for one or more
   requirements, and those requirements' periods/week add up to more than
   that teacher's cap (or their actual available periods), that's the
   bottleneck — nothing else needs to be wrong for the whole solve to fail.

Each hit becomes one specific, actionable sentence (e.g. naming the exact
class group, subject, or teacher and the exact numbers involved) rather
than a generic failure. `app/routers/timetables.py` joins multiple hits
with newlines, and `TimetableTab.jsx` renders them as a bullet list rather
than one run-on sentence when there's more than one.

**What this deliberately doesn't do**: find the true minimal cause of an
infeasibility that comes from several constraints interacting — e.g. two
different subjects both restricted to the same single period for the same
class group, where neither restriction is a problem on its own. That's a
genuinely hard problem (formally, finding a minimal unsatisfiable subset
of constraints), and doing it properly would mean something like CP-SAT's
assumption-based conflict analysis (`AddAssumption` /
`SufficientAssumptionsForInfeasibility`) rather than closed-form checks
like these. When none of the three checks above find anything,
`_diagnose_infeasibility` returns an empty list on purpose — the router
falls back to an honest "the specific cause couldn't be automatically
identified, it's likely an interaction between several constraints" message
plus a concrete next step (try removing the most recently added constraint
and regenerating), rather than pretending to have diagnosed something it
didn't. Extending this to the multi-constraint case is exactly the "open
decision" noted above, and would be worth doing once there's enough real
usage to see which multi-constraint conflicts actually come up in practice.

## Constraint parsing: LLM first, regex fallback

`POST /api/constraints/parse` (`app/routers/constraints.py`) tries Claude
first (`app/services/llm_constraint_parser.py`) and falls back to a regex
parser (`app/services/constraint_parser.py`) if no `ANTHROPIC_API_KEY` is
configured, or the API call fails for any reason (network, rate limit,
auth, malformed response — anything). The fallback is unconditional: a
flaky LLM call must never block constraint entry. `_adapt_legacy` in the
router translates the regex parser's older output shape into the same
unified shape the LLM path produces, so everything downstream (matching,
storage, solver wiring) only has to handle one shape.

The LLM path uses forced tool-use (`tool_choice`), not free-text
completion — Claude's response is always the structured JSON our schema
asks for, no secondary parsing step. It's grounded against the school's
actual teacher/subject/class-group names (passed in the system prompt,
see `_TOOL_SCHEMA` in `llm_constraint_parser.py`) and told to only
reference exact names from those lists or return `null`; the router then
does a plain dict lookup on whatever name comes back, so fuzzy matching
lives entirely in the prompt, not scattered through router code.

## Constraint types and what's actually enforced

- **workload_limit** ("Mrs. Sharma can only teach 10 periods a week") ->
  `Teacher.max_periods_per_week`.
- **availability** ("Priya Sharma is not available on Wednesdays") -> adds
  that day's `Period` ids to `Teacher.unavailable_period_ids`. Only
  day-level granularity is supported — "not available Wednesday mornings"
  currently matches the whole day, not just the morning half.
- **subject_period_position** (stored as `no_subject_period` or
  `require_subject_period` depending on `mode`) — a subject must
  (`mode="require"`) or must not (`mode="exclude"`) be in the first/last
  period of the day. Optionally scoped to specific sections/grades via
  `class_group_ids` (e.g. "Grade 3 shouldn't have Math last period" only
  restricts Grade 3's sections, not the whole school) — omit it for a
  school-wide rule. If a ban and a requirement both apply to the same
  requirement, the ban wins. Read directly from the `Constraint` table by
  the solver (`generate_school_timetable` in `app/services/solver.py`).
- **max_consecutive_periods** ("no more than 2 consecutive PE periods for
  Grade 5") — caps how many periods of a subject can run back-to-back on
  the same day, same `class_group_ids` scoping rules as above. Implemented
  as a sliding-window sum constraint over each day's periods in the
  solver — no new CP-SAT variables needed, since a requirement's presence
  at a given period is just the sum of its own candidate variables there.
- **subject_sequence** ("Math can't immediately follow PE") — forbids
  `second_subject_id` from being scheduled in the period right after
  `first_subject_id`, for the same class, on any day. Optionally scoped
  via `class_group_ids`, same convention as the other scoped types above.
  Implemented in the solver as a boolean implication per matching
  (day, order) pair: if the first subject's variable is true at period N,
  the second subject's variable at period N+1 (same class, same day) must
  be false. Only applies within a single day — the last period of one day
  followed by the first period of the next is never considered adjacent.
- **scheduling_rule** — the catch-all for anything that doesn't match the
  above (from either parser). Recorded and shown in the UI, but not
  applied to the solve. What's left here now: rules that genuinely don't
  map to any of the above — e.g. rules with attendance/exam scheduling
  semantics, or anything the LLM can't confidently map to the known
  constraint vocabulary.

Every constraint's `ConstraintOut.enforced` field reflects whether that
specific row actually affects generation (e.g. an availability constraint
where no day was recognized is saved but `enforced: false`), computed in
`app/routers/constraints.py::_is_enforced` rather than stored, so the UI
can't drift out of sync with what the solver does — regardless of which
parser (LLM or regex) produced the row.

## Manual editing (lock + drag-to-move)

Regeneration used to be all-or-nothing — the only way to change one class's
slot was to re-solve the whole school and hope it landed somewhere better.
`PATCH /api/timetables/entries/{id}` (`app/routers/timetables.py`) adds two
ways to hand-edit an already-generated timetable without a full re-solve:

- **Lock/unlock** a slot (`{"locked": true}`) — purely a flag, doesn't move
  anything by itself.
- **Move** a slot (`{"period_id": ...}`, optionally `teacher_id`/`room_id`
  too) — checked against every other entry in the same timetable at the
  target period before being applied, so a manual move can't silently
  double-book the class group, the teacher, or the room; a conflicting
  move gets rejected with a 400 and a specific reason instead of silently
  corrupting the schedule.
- **Swap** two slots — `POST /entries/{id}/swap-with/{other_id}`, a
  separate endpoint rather than two PATCH calls. Moving slot A onto slot
  B's period via PATCH would always get rejected: B is still sitting
  there until it also moves, so it looks like a double-booking even
  though the end state (A and B trading places) is perfectly valid. The
  swap endpoint moves both in one transaction, with a single conflict
  check that excludes both entries from each other's checks — so it still
  catches a real conflict (e.g. A's teacher is already booked elsewhere
  at B's old period) without falsely rejecting the two entries seeing
  each other. Refuses to swap if either entry is locked.

Locking only matters at the *next* regeneration. `generate_school_timetable`
(`app/services/solver.py`) looks up the most recent `draft` Timetable for
the school, reads its locked entries, and for each one forces that exact
`(requirement, teacher, period)` boolean variable to `1` in the new CP-SAT
model before solving — so the rest of the schedule is re-solved *around*
that fixed point rather than from scratch. If a locked entry's original
teacher/period combination would normally have been filtered out (e.g. the
teacher's availability changed since it was locked), the variable is
created and forced anyway rather than silently dropped — a lock is a
deliberate admin override and should win. Locked rooms are threaded through
`_assign_rooms` the same way: fixed in place, and reserved so no unlocked
entry gets matched into the same (period, room) pair. After a successful
regenerate, any new entry whose (class group, subject, teacher, period)
exactly matches a lock from before is marked `locked=True` again — so a
lock "sticks" across repeated regenerations instead of needing to be
reapplied by hand every time.

**UI**: in `TimetableTab.jsx`'s "By Section" view, each scheduled slot has
a lock icon and, if unlocked, can be dragged to a different cell (native
HTML5 drag-and-drop) — dropping on an empty cell calls the PATCH move
endpoint, dropping on another filled (and unlocked) cell calls the swap
endpoint instead. Both refetch the timetable on success; a rejected
move/swap surfaces the backend's specific conflict message. Editing is
section-view-only — "By Teacher" mixes entries from multiple different
classes, where "move this" doesn't have one obvious meaning.

## Bulk import (CSV / Excel)

Subjects, rooms, teachers, and class groups can each be uploaded as a CSV
or `.xlsx` file (`POST /api/{resource}/bulk-import`,
`app/services/bulk_import.py`) instead of being typed in one at a time —
the first real friction point for any school with more than a handful of
teachers.

Two design choices carry the whole feature:

- **Best-effort, not all-or-nothing.** A bad row (missing a required
  column, an unresolvable subject name for a teacher) is recorded as an
  error string and skipped; every other row in the file still imports.
  `BulkImportResult` reports `created`, `updated`, and `errors` back to
  the caller so the UI can show "38 created, 2 skipped" plus exactly what
  was wrong with those two, rather than the whole upload failing over one
  typo. This mirrors the same philosophy used elsewhere in this codebase:
  room assignment doesn't fail generation over a room shortage
  (`_assign_rooms` in `app/services/solver.py`), and constraint parsing
  falls back rather than blocking entry when the LLM call fails
  (`app/routers/constraints.py`).
- **Upsert by name, not blind insert.** Subjects and rooms match on
  `name`, teachers on `name`, class groups on `(grade, name)` — all
  case-insensitive. Re-uploading the same file after fixing one row
  updates the rows that already existed instead of creating duplicates,
  which matters because the realistic workflow is "export the current
  roster, edit it, re-upload," not "upload once and never touch it
  again."

`parse_rows` in the same module normalizes both file types to the same
shape (a list of dicts keyed by lowercased header names) before any
resource-specific logic runs, so `import_subjects`/`import_rooms`/
`import_teachers`/`import_class_groups` don't need to know or care
whether the upload was CSV or Excel.

Teachers' `qualified_subjects` column (subject names separated by `;` or
`,`) is resolved against subjects already in the school at import time —
subjects should generally be imported first. An unresolvable name doesn't
block the teacher from being created; it's just left off their qualified
list and reported as a row-level warning, since a teacher missing one
subject qualification is still useful data, unlike a row missing a name.

Each resource's router also exposes `GET /{resource}/bulk-import/template`
— a downloadable CSV with a header row and one example row, so an admin
isn't guessing at column names.

**UI**: `BulkImportPanel.jsx`, added to the bottom of the Data Entry tab,
has a resource-type dropdown, a file picker, an "Import" button, and a
"Download template" link, with the created/updated/error summary shown
inline after upload. Importing class groups needs to also refresh the
sidebar's own class-group list (owned by `App.jsx`, not `DataEntryTab.jsx`)
so a newly bulk-imported section shows up without a manual reload — wired
via an `onClassGroupsChanged` callback passed down from `App.jsx`.

## Export (PDF / Excel)

`GET /api/timetables/{id}/export?format=xlsx|pdf` (`app/routers/timetables.py`)
downloads a printable version of a generated timetable — one sheet
(Excel) or page (PDF) per section, followed by one per teacher, so the
same file can be handed to a class or a teacher.

Both formats are built from the exact same data, on purpose. `_load_grid_data`
in `app/services/export.py` is the only place that reads the `Timetable`'s
entries from the database and organizes them into grids (day x period,
one grid per class group plus one per teacher); `build_excel` and
`build_pdf` each just render that same grid data with a different
library — openpyxl for Excel, reportlab for PDF — with no independent
data-gathering logic of their own. This is deliberate: if Excel and PDF
each recomputed "who's scheduled where" separately, a bug fix or a future
change (like adding room names to the cell text) could land in one format
and not the other, so what an admin sees on screen, prints as PDF, and
opens in Excel could quietly disagree. Routing both through one shared
function makes that class of bug structurally impossible instead of
something that has to be remembered and kept in sync by hand.

Sections/teachers with nothing scheduled are skipped rather than
producing an empty sheet/page, and a timetable with zero entries at all
still produces a valid (near-empty) file rather than erroring, so the
export endpoint never 500s just because generation hasn't been run yet
for part of the school.

## Known data-integrity fix: orphaned subject requirements

`DELETE /api/subjects/{id}` used to just delete the `Subject` row, leaving
any `SubjectRequirement` rows that referenced it behind — `SubjectRequirement`
has no ORM-level relationship/cascade back to `Subject` (only to
`ClassGroup`, see the model). Those orphaned rows were invisible in Data
Entry (`DataEntryTab.jsx` only lists requirements for subjects that still
exist) but the solver still summed every requirement row for a class
group as real demand — so deleting and re-adding a subject could silently
double a section's real periods/week total, surfacing later as an
infeasibility diagnostic ("needs 80 periods/week but the school only has
40") with no obvious cause visible in the UI. `app/routers/subjects.py`
now deletes matching `SubjectRequirement` rows in the same transaction as
the subject. `backend/dedupe_orphaned_requirements.py` and
`backend/diagnose_timetable.py` (both read-only except the former, which
only deletes orphans) are one-off scripts for cleaning up / spotting this
in a database that predates the fix — see their docstrings for usage
(stop the backend server first when running the cleanup script; writing
to a SQLite file while something else has it open, especially inside a
OneDrive-synced folder, isn't reliable and can silently lose the write).

## Scale testing (50-200 sections)

Stress-tested with `backend/stress_test_50sections.py` (not part of the
app — a one-off diagnostic script) against a *realistic* staffing
structure: each grade has its own dedicated teacher pool per subject (not
shared school-wide), 8 subjects, 40 periods/week/section, on this
project's 2-core sandbox.

The single biggest factor by far was **symmetry** — whether the solver has
to choose between multiple interchangeable teachers for the same
subject/grade, or whether that choice is already made:

| Sections | Teachers/subject/grade | Preferred teacher pinned? | Result |
|---|---|---|---|
| 50  | 1 (no symmetry) | n/a | optimal in ~26s |
| 50  | 2 | no  | inconclusive ("unknown") at 15s; still inconclusive at 30s+ |
| 50  | 2 | **yes** | optimal in **2.8s** |
| 100 | 2 | **yes** | optimal in **5.8s** |
| 200 | 2 | **yes** | optimal in **10.6s** |

Practical takeaway: for large schools, **use `SubjectRequirement.preferred_teacher_id`**
(already a field in the schema) to tell the solver which teacher covers
which section, instead of leaving multiple qualified teachers
interchangeable. This isn't a workaround so much as how larger schools
actually staff — the admin usually already knows "Ms. Iyer covers Grade
8-A and 8-B Math, Mr. Rao covers 8-C through 8-E" — and giving the solver
that information turns an open combinatorial search into a much smaller
one, which is what accounts for the 200-section run finishing 10x faster
than the unpinned 50-section run.

**UI**: `DataEntryTab.jsx` shows a "Preferred teacher" dropdown under a
subject's teacher chips whenever more than one teacher is qualified for
it — picking one sets `preferred_teacher_id` on that section's
requirement, and the picked teacher's chip gets a star/highlight so it's
visible at a glance. Selecting "any (let solver choose)" clears the pin.
If a teacher's qualification for a subject is removed while they're
pinned as preferred for that subject on the currently viewed section, the
pin is cleared automatically — otherwise the solver would keep assigning
them anyway, since a pin overrides the qualified-teachers list by design
(see `generate_school_timetable` in `app/services/solver.py`). Note this
auto-clear only checks the section currently being viewed; if the same
teacher is pinned for the same subject on other sections, those aren't
checked and would need clearing separately.

## Constraints: editing in place, scope visibility, and conflict detection

Three gaps in the original plain-English constraints flow: a wrong or
outdated rule could only be deleted and re-typed (losing its position in
the list and its id), there was no way to see or change which sections a
rule applied to without re-typing it, and two constraints that flatly
contradicted each other could both be saved with no warning — the admin
would only find out when the solver went infeasible with no obvious
cause.

**Edit in place.** `PUT /api/constraints/{id}/reparse` (`reparse_constraint`
in `app/routers/constraints.py`) takes new text and re-runs the same
resolution pipeline as creating a constraint, but mutates the *existing*
row's `type`/`parameters`/`description` instead of inserting a new one —
the id, position in the list, and any relationship to it stay stable.
Both this endpoint and the original `/parse` endpoint now share one
`_resolve_constraint_text(db, school_id, text)` helper (name/scope
resolution, per-type parameter building) so editing and creating always
produce identical results for the same text. `ConstraintsTab.jsx`'s edit
(✎) button swaps the card into a textarea; Save calls `reparseConstraint`.

**Scope visibility and editing.** Constraint types that can be scoped to
specific sections (`SCOPABLE_TYPES` in `ConstraintsTab.jsx`:
`no_subject_period`, `require_subject_period`, `max_consecutive_periods`,
`subject_sequence` — the others, like `workload_limit`, are always about
one teacher, not a set of sections) now show an explicit "Applies to:
Whole school" or comma-joined section list on the card, previously only
visible by inspecting `parameters.class_group_ids` directly. Clicking it
opens a checkbox list of every class group; Save calls `PUT
/api/constraints/{id}` with an updated `parameters` object (no
`class_group_ids` key = whole school). This is a direct field edit, not a
re-parse — it doesn't touch `type` or `description`.

**Conflict detection.** `_find_placement_conflicts(db, school_id,
constraint_id, constraint_type, parameters)` in `app/routers/constraints.py`
runs on every constraint returned by the API (`_to_out`, used by create,
list, get, update, parse, and reparse) and checks one specific,
cheaply-provable contradiction: two `require_subject_period` constraints
for the same subject with overlapping scope (`_scopes_overlap` — `None`
scope means whole-school and overlaps everything) but different required
positions (e.g. one says Math must be first period, another says Math
must be last period for an overlapping set of sections) — these can never
both hold, since a period can't be both first and last. `ConstraintOut`
carries the result as `conflicts: list[str]`, and it's computed
bidirectionally — both constraints in a contradicting pair show it,
referencing each other's id and description. `ConstraintsTab.jsx` renders
non-empty `conflicts` as a red bullet list under the card, distinct from
the existing amber "Not yet enforced by the solver" note.

This deliberately doesn't attempt general multi-constraint satisfiability
analysis (that's what the CP-SAT solver itself does, exhaustively, at
generation time) — it's a narrow, fast, always-on check for the one
contradiction pattern that's both common and unambiguous to detect
without running the solver. Constraints scoped to disjoint sections
(e.g. one required-first-period rule for Grade 8-A and another for Grade
8-B) correctly show no conflict, since they can both hold simultaneously.

## Three new constraint rule types

Three previously-deferred constraint types, filling out the most common
gaps left after the placement/consecutive/sequencing rules above: rules
tied to a specific day, rules that cap a *teacher's* back-to-back periods
rather than a subject's, and rules that keep two subjects apart by more
than one period. All three go through the same pipeline as every other
constraint type — `_resolve_constraint_text` in
`app/routers/constraints.py` (LLM parser first, regex fallback via
`app/services/constraint_parser.py`), read directly by the solver in
`app/services/solver.py` — so editing, scoping, and conflict detection
(where applicable) all work on them the same way described above.

**`no_subject_day` / `require_subject_day`** — a subject banned from, or
pinned to, a whole day of the week ("No PE on Fridays", "Math should be
on Mondays"), parameters `{subject_id, day_of_week, class_group_ids?}`.
Same require/exclude-by-negation shape as `no_subject_period` /
`require_subject_period`, just matching every period on a day instead of
one position — the solver resolves both into the same
`req_restricted_periods` / `req_required_periods` sets it already
computes for the position-based types (`generate_school_timetable` in
`app/services/solver.py`), so there's no separate code path for
applying them. Conflict detection is likewise a parallel
`_find_day_conflicts` function next to `_find_placement_conflicts`: two
`require_subject_day` rows for the same subject naming different days,
or a `require_subject_day` and `no_subject_day` for the same subject and
day, are flagged the same way a contradictory first/last pair is.

**`max_consecutive_periods` — teacher variant.** This constraint type
already existed for subjects ("no more than 2 PE periods in a row" for a
class); it now also accepts a teacher instead of a subject
(`parameters={teacher_id, max_consecutive}`, no `class_group_ids` —
it caps that teacher's whole day, not one class's schedule). The solver
applies the same sliding-window logic as the subject variant, just
summing `teacher_period_vars` for that teacher across each day's periods
instead of one requirement's per-period vars. `ConstraintsTab.jsx`'s
scope picker is hidden for a teacher-variant row (see the `SCOPABLE_TYPES`
comment and the `scopable` check in `ConstraintCard`, which excludes
`max_consecutive_periods` rows that carry a `teacher_id`), since setting
a class-group scope on it wouldn't actually do anything.

**`min_gap_between_subjects`** — two subjects that must be separated by
at least N periods on the same day, for the same class ("leave at least 1
period between PE and Math"), parameters `{first_subject_id,
second_subject_id, min_gap, class_group_ids?}`. Unlike `subject_sequence`
(which is directional — B must not *immediately follow* A) this is
symmetric and covers the whole gap window, not just the adjacent period:
for every same-day pair of periods whose order distance is less than
`min_gap`, the solver forbids both subjects' requirements from occupying
that pair at once. Implemented as its own block in
`generate_school_timetable`, right after `subject_sequence`, reusing the
same `req_by_class_subject` lookup and `req_period_vars` structures.

**Regex fallback, and a latent bug it surfaced.** All three types got
regex patterns in `constraint_parser.py` (`_CONSECUTIVE_RE`, `_GAP_RE`,
plus the day-detection branch reusing `_find_day`), including — as a
side effect — the first regex-based support for the *subject* variant of
`max_consecutive_periods`, which previously only worked through the LLM
parser. Building the teacher-variant test case ("Mr. Rao should not teach
more than 3 periods in a row") surfaced a real bug in the existing
`_find_by_name` helper: it matched subject "PE" as a substring of the
unrelated word "periods", so a sentence naming a teacher but no subject
was still misparsed as being about the PE subject. Fixed by requiring a
word-boundary match for names of 3 characters or fewer (short subject
codes are the only names short enough to collide with common English
words this way) — this was a pre-existing latent bug, not something the
new features introduced, just one they happened to exercise.

## Onboarding checklist

A new admin previously had no guidance on setup order beyond a static
3-card Overview (Data entry / Constraints / Generate) that didn't even
mention periods, and a school with zero grades/sections rendered nothing
but a small "Add a grade/section to get started" hint in the header —
easy to miss, with no explanation of *why* a section has to exist first
(periods/subjects/teachers are school-wide, but every tab is scoped to a
selected class group, so there's nothing to render without one).

**`FirstRunWelcome.jsx`** — shown by `App.jsx` in place of the tab area
when `selectedSchool && !selectedClassGroup`. Explains the 4-stage flow
up front (add a section → periods/subjects/teachers → this section's
requirements → generate) and puts the same "add grade/section" form
`Sidebar.jsx` already has, front and center, instead of behind a small
"+ Add" toggle. Submitting it calls the same `onAddClassGroup` handler
Sidebar uses; `App.jsx`'s existing `loadSchoolData` auto-selects the new
class group afterward, so the admin lands straight on the Overview
checklist next — no separate "step 2" screen needed.

**`OverviewTab.jsx`** — rewritten from the old static 3-card summary into
a real 5-step checklist: periods, subjects & teachers, this section's
requirements, constraints (optional), generate. Each step's done/not-done
state comes from real counts (`api.listPeriods`, `listSubjects`,
`listTeachers`, `listRequirements`, `listConstraints`, `listTimetables`),
not a guess. The first *required* incomplete step (constraints is the
only optional one — see the `optional` flag on each step) gets a
"Do this next" badge and a filled button; completed steps show a green
checkmark instead of their step number. This is deliberately a single
current-step highlight rather than five equal-weight cards, so there's
always one obvious next action.

**Known limitation.** This doesn't cover a second/third section within
the same school — after the first one, the checklist repeats per
section (periods/subjects/teachers are school-wide and will already show
done, but requirements are per-section and won't be). That's correct
behavior, not a bug, but it does mean the checklist can't be permanently
dismissed — it's designed to always reflect the currently-selected
section's real state rather than being a one-time tutorial.

## Multiple admins per school, invites, and closing a real access-control gap

Before this, a school had exactly one login (`School.owner_id`) with no
way to add a second admin, and — more importantly — almost no router
actually checked that the logged-in user had anything to do with the
`school_id` they were operating on. Only `schools.py`'s own endpoints
checked ownership; every other router (subjects, teachers, rooms,
periods, class groups, constraints, timetables) took a bare `school_id`
and trusted it completely. Any authenticated user could read or write
*any* school's data just by changing a number in the request. This was a
known, documented simplification ("worth revisiting before this supports
multiple admins per school" — the old docstring in `schools.py`) that
this feature both fixes and was the reason to add.

**Data model** (`app/models/school.py`): `SchoolMembership` (school_id,
user_id, role) and `SchoolInvite` (school_id, email, role, token,
status). The school's owner is always an implicit `"admin"` member with
no `SchoolMembership` row required — `get_membership_role` in
`app/core/access.py` checks `School.owner_id == user.id` first, falling
back to a membership row lookup. This means every existing school with a
single owner keeps working exactly as before with **zero data
migration** — the membership table only matters for *additional* users
beyond the owner.

**The access-control fix** (`app/core/access.py`): `require_school_access(db,
user, school_id, min_role="viewer")` — a plain function, not a single
FastAPI `Depends()`, because `school_id` shows up in three different
shapes across the existing routers (query param on list endpoints, body
field on create endpoints, or not present at all on get/update/delete
endpoints that only take a resource id and need `school_id` looked up
from the fetched row first). Every router that touches school-scoped
data now calls it explicitly: `teachers.py`, `subjects.py`, `rooms.py`,
`periods.py`, `class_groups.py` (including the nested requirements
endpoints, which resolve `school_id` via the parent class group),
`constraints.py`, and `timetables.py` (including entry-level endpoints,
resolved via `entry.timetable_id -> timetable.school_id`). Raises 404 for
no access at all (a school you can't see shouldn't confirm it exists via
a different status code) and 403 for read-only access hitting a write
endpoint.

**Roles**: two tiers, `"admin"` and `"viewer"`. Deliberately not more
granular than that for this first pass — seeing real demand for e.g.
"can edit constraints but not billing" before building it seemed better
than guessing at permission boundaries nobody's asked for yet.

**Invites** (`app/routers/invites.py`, plus admin-only member/invite
management endpoints added to `schools.py`): an admin creates an invite
(`POST /api/schools/{id}/invites`) with an email and role; the response
includes the invite's token (safe here specifically because every
endpoint that returns it is already admin-only — see `InviteOut`'s
docstring in `schemas/membership.py`) so `TeamTab.jsx` can build a
shareable link (`?invite=<token>`) right away. There's no email service
wired up, so nothing is sent automatically — the admin copies the link
and sends it themselves, same "documented, not silently wrong" pattern
as other gaps in this project. `GET /api/invites/{token}` (preview) and
`POST /api/invites/{token}/accept` are public — no auth required, since
whoever clicked the link likely isn't logged in yet. Accepting always
requires a password: either to set one for a brand-new account (the
invited email has never signed up — `name` + `password` create it), or
to confirm an existing account's password (so the invite link alone,
which could leak via a forwarded email or screenshot, is never enough by
itself to access someone else's existing account).

**Frontend**: `SchoolOut` now carries the current user's `role` for that
specific school (computed server-side, not a stored column — see
`schemas/school.py`), so `App.jsx` can gate the UI without an extra
round-trip: a `viewer` doesn't see the "Team" tab at all, sees a
"View only" badge in the header, and every tab's primary write surfaces
(add/edit/delete buttons, the constraint input box, drag-and-drop and
lock toggles on the timetable grid, "Generate Timetable") are hidden
rather than shown-then-rejected. This is a UX nicety layered on top of
the real enforcement in `access.py` — the backend blocks a viewer's
write attempt regardless of what the frontend shows, verified directly
(not just inferred from hidden buttons) in the TestClient script noted
below. **Known gap**: the Periods and Rooms sub-panels (collapsed
toggles inside Data Entry) aren't yet role-gated at the UI level — a
viewer opening them would see the normal add/edit controls and get a
403 from the backend on submit rather than not seeing the controls at
all. Correct outcome, rougher UX; left for a follow-up pass rather than
blocking this feature on it.

**A second fix that came out of closing the auth gap**: the timetable
export links (`GET /api/timetables/{id}/export`) used to be plain
`<a href>` downloads specifically *because* that endpoint didn't require
auth. Once it did, a bare link could no longer attach the
`Authorization` header. Fixed by replacing the links with a button that
fetches the file with auth and triggers the download via a temporary
blob URL (`downloadFile` in `api.js`) — same end-user experience, just
routed through `fetch` instead of the browser's native link-download
path.

Verified end-to-end via a TestClient script covering: a user with no
relationship to a school gets 404 from every resource endpoint (the
original gap, now closed); an invited viewer can read but gets 403 on
every write endpoint including generation; an invited second admin can
write normally; the members list shows the owner (synthesized, no
membership row) plus real members with correct roles; a viewer can't
view the members list; promoting a viewer to admin actually grants
write access; removing a member actually revokes access; and the owner
can't be removed or demoted.

## Marketing landing page

Unauthenticated visitors used to land straight on AuthPage.jsx's login
form — functional, but it's a login screen, not a page that explains
what the product does or why to sign up. `LandingPage.jsx` is a proper
marketing page (nav, hero, feature grid, "how it works", pricing,
testimonials, closing CTA, footer) shown first instead; `App.jsx` only
reveals AuthPage once a "Get started" / "Sign in" click sets a local
`showAuth` flag (reset on logout, so signing out returns to the
marketing page rather than a bare login form). The existing invite-link
flow (`?invite=<token>` → `AcceptInvitePage.jsx`) and session-restore
check both still run before this, unaffected.

**Animation**: `framer-motion` (MIT-licensed, the same library Motion.dev
publishes and documents) — chosen because it's the natural fit for a
React app that already exists, rather than reaching for a separate
animation framework or hand-rolled CSS keyframes. Used for a staggered
hero entrance, scroll-triggered section reveals (`whileInView`, so
content animates in as you scroll rather than all at once on load), and
hover lift on feature cards. Kept restrained — entrance/reveal
animations only, no parallax or scroll-jacking — so it reads as polish
rather than a distraction.

**Content that's explicitly placeholder, not final**: the hero's
timetable visual is a hand-built CSS/SVG mockup (`TimetableMockup`
inside `LandingPage.jsx`), not a real product screenshot — there's
nowhere hosted yet to screenshot (see the deployment conversation this
was built alongside). Swap it for a real screenshot once the app is
deployed somewhere presentable. Pricing tiers show placeholder amounts
(`₹—`) with a visible "final numbers to be confirmed" note — actual
pricing hasn't been decided (see the business-readiness conversation).
Testimonials are attributed to a role ("School Administrator") rather
than an invented name or school, specifically so they can't be mistaken
for real quotes — replace with real ones once there are real customers
to quote, but don't replace the placeholder attribution style with
fabricated specific names in the meantime.

### Aceternity/Magic UI-style flourishes

The landing page's animation is deliberately restrained (see above), but
a few spots use the small set of "SaaS site feels alive" visual patterns
popularized by component galleries like Aceternity UI and Magic UI —
spotlight glows, a faded dot-grid background, an infinite-scroll
marquee, and a cursor-tracking card glow. These galleries are copy-paste
Tailwind + Framer Motion code, not installable npm packages or a
service to call, so each pattern is hand-implemented directly in this
codebase rather than pulled in as a dependency:

- **`Spotlight` / `GridBackground`** (`components/Spotlight.jsx`): a
  blurred radial SVG ellipse (`feGaussianBlur`) and a CSS
  `linear-gradient` dot grid faded via a radial `mask-image`. Both sit
  behind `Hero()` in `LandingPage.jsx`, `pointer-events-none` and
  `-z-10`/`z-0` so they never intercept clicks. Purely decorative.
- **`Marquee`** (`components/Marquee.jsx`): renders a list of items
  twice, side by side, and slides the wrapper left by exactly one
  copy's width forever (`.animate-marquee` keyframe in `index.css`),
  pausing on hover. `LogoStrip()` uses it for a scrolling strip of real
  feature highlights ("Zero teacher clashes," "CP-SAT solver," etc.) —
  deliberately *not* customer logos, since there are no real customers
  to show yet and invented company names would be misleading in a way a
  feature-highlight marquee isn't (same reasoning as the testimonials
  placeholder above).
- **`GlowCard`** (`components/Spotlight.jsx`): wraps each card in
  `Features()`'s grid; tracks the cursor via `onMouseMove` and writes
  the pointer position into a CSS custom property that a
  `radial-gradient` background reads, so a soft glow follows the cursor
  on hover. Uses local component state rather than a global listener,
  and does no work at all until a visitor's cursor actually enters a
  card, so it doesn't add any cost to page load or scrolling.

All four are additive/decorative — removing any of them degrades the
page to its previous plain-but-functional appearance rather than
breaking anything. `docs/ARCHITECTURE.md`'s existing "known limitation"
pattern applies here too: none of this is tested with automated visual
regression, so a future redesign should eyeball it after any Tailwind
or `framer-motion` version bump.

## Hosted Postgres + Google sign-in

Two pieces of "make this reachable and usable beyond one laptop"
infrastructure, both requiring manual setup only the account owner can
do (creating a database project / OAuth credentials isn't something to
script) — see `docs/DEPLOYMENT.md` for the actual click-by-click steps.
This section is the "what changed in the code" companion to that.

**Hosted Postgres (Supabase)**: no code changes were actually needed —
`app/core/config.py`'s `database_url` setting and
`app/core/database.py`'s engine setup were already database-agnostic
(SQLite locally via a default, anything SQLAlchemy supports via
`DATABASE_URL`), and `psycopg2-binary` was already a dependency. The one
real addition is `pool_pre_ping=True` on the engine: free-tier hosted
Postgres (Supabase specifically pauses free projects after a week of
inactivity) can hand back a stale/dropped connection, and without this
flag the first query after a quiet period would fail outright instead
of SQLAlchemy transparently checking and reconnecting first. Cheap
no-op for SQLite, so no downside to leaving it on unconditionally.

**Google sign-in**: the groundwork was already in place from the
original auth build — `User.google_sub` existed as a nullable column,
and both `models/user.py` and `routers/auth.py` had docstring notes
pointing at what to add later. This session filled that in:

- `POST /api/auth/google` (`routers/auth.py`) accepts a Google ID token
  (the `credential` Google's Sign-In button hands back), verifies it
  server-side against Google's public keys and the configured
  `GOOGLE_CLIENT_ID` (`google-auth`'s `id_token.verify_oauth2_token` —
  never trusts the token as-is), then finds-or-creates a `User`. Matches
  first by `google_sub` (a returning Google user), falling back to
  email (so an existing email/password account gets *linked* on first
  Google sign-in rather than silently creating a duplicate account with
  the same email).
- Returns 503 with a clear message if `GOOGLE_CLIENT_ID` isn't
  configured, rather than attempting verification against nothing.
- `AuthPage.jsx` loads Google Identity Services' script at runtime
  (not bundled — it's meant to be loaded live from
  `accounts.google.com`) and renders Google's own button via
  `google.accounts.id.renderButton`. This is Google's requirement for
  the ID-token flow, not a styling choice — you can't hand-build a
  compliant button for this flow. The button — and the "or" divider
  above the email form — simply don't render at all if
  `VITE_GOOGLE_CLIENT_ID` is unset, rather than showing something that
  would fail on click.
- `api.loginWithGoogle(credential)` in `api.js` posts to the new
  endpoint and returns the same `TokenResponse` shape as
  `login`/`signup`, so `AuthPage.jsx` handles the result identically
  regardless of which method the user chose.

Both env vars (`GOOGLE_CLIENT_ID` backend-side, `VITE_GOOGLE_CLIENT_ID`
frontend-side) must be set to the *same* value — Google's verification
checks the token's audience against the client ID, so a mismatch fails
closed rather than open.

## Core-flow UX polish pass

A pass through the existing admin flow (data entry, constraints,
timetable, onboarding, sidebar, auth) looking for rough edges rather than
new features — the kind of thing a first-time school admin actually hits.
No new screens or endpoints; all fixes below are to code already
described elsewhere in this doc.

- **Error banners that never cleared.** `App.jsx`, `DataEntryTab.jsx`, and
  `ConstraintsTab.jsx` set an error message on a failed request but never
  cleared it on the next successful one, so a single flaky request left a
  red banner pinned on screen indefinitely. All three now clear `error`
  at the start of a successful load/action.
- **`window.prompt()` for "add a school"** (`App.jsx`) replaced with an
  inline modal matching the rest of the app's form styling — a native
  browser dialog looked out of place next to everything else, and
  couldn't show a "Creating…" state or a real inline error.
- **Blank screen during session check.** `App.jsx` rendered nothing at
  all while validating a stored token on load; now shows a small centered
  spinner so a slow connection doesn't read as a frozen app.
- **Double-submit risks.** `DataEntryTab.jsx`'s "Quick setup: Mon-Fri, 8
  periods/day" button fires 40 `createPeriod` calls with no in-flight
  guard — a double-click could fire 80, silently duplicating the period
  grid. `TimetableTab.jsx`'s Excel/PDF export buttons had the same gap.
  Both now track an in-flight state, disable themselves, and show
  "Setting up…"/"Preparing…" while running. `Sidebar.jsx`'s "Add section"
  form got the same treatment (`FirstRunWelcome.jsx`'s near-identical form
  already had it — this was an inconsistency, not a missing feature).
  `BulkImportPanel.jsx`'s resource-type `<select>` and file `<input>` now
  disable while an upload is in flight, rather than letting someone swap
  the target resource or pick a new file mid-upload.
- **No confirmation on destructive actions.** Removing a subject
  (`DataEntryTab.jsx`) or a constraint (`ConstraintsTab.jsx`) deleted
  instantly with no undo. Both now show a `window.confirm()` naming the
  specific thing being removed — not a custom modal, since the action is
  reversible by re-adding and the stakes don't justify more UI for it.
- **Stale `selectedTeacherId` (real bug, not just polish).**
  `TimetableTab.jsx`'s "By Teacher" view only re-picked a default teacher
  when nothing was selected, not when the teacher list itself changed —
  switching schools could leave it pointing at a teacher id that doesn't
  exist in the new school at all, silently rendering an empty grid with
  no explanation. Now re-validates the current selection against the
  live teacher list on every change.
- **`OverviewTab.jsx`'s onboarding checklist silently swallowed load
  errors**, rendering every step as "0 configured / not done" —
  indistinguishable from a genuinely empty new school, and capable of
  telling an admin to "set up periods" they already have. Now surfaces a
  real error banner instead of guessing.
- **Google sign-in's script-load failure was silent** (`AuthPage.jsx`):
  if `accounts.google.com/gsi/client` failed to load (offline, blocked),
  the "or" divider rendered with no button ever appearing beneath it and
  no explanation. Now shows a small inline message and falls back
  gracefully to email/password, which was always unaffected.
- **Accessibility basics**: labels (visually hidden via `sr-only` where a
  visible label would be redundant, e.g. subject-name and room-type
  inputs) on previously placeholder-only form fields; `aria-label` on
  icon-only buttons (constraint edit/delete, teacher-chip remove, subject
  remove); `Sidebar.jsx`'s grade-expand and section-select rows — plain
  `<div onClick>`s with no keyboard path at all — now have
  `role="button"`, `tabIndex={0}`, and `onKeyDown` handling for Enter/Space.

Deliberately left alone: this was a polish pass, not a redesign — no new
components, no architectural changes, no new dependencies.

## Colleges, part 1: fixed-batch extension

First step of expanding beyond schools to colleges — specifically the
large majority of Indian colleges affiliated to a state university, which
assign students to a fixed year/division that follows one shared
timetable, structurally the same problem as a school section. (The
harder version — autonomous/credit-based colleges where students
individually register for electives — is a different, much larger
project deliberately not started here; see the business-planning
conversation this was scoped alongside.)

**Terminology, not schema.** `ClassGroup.grade`/`.name` were already
freeform text fields, not fixed dropdowns — a college admin could already
type "Semester 3" / "Div B" before this change. What actually excluded
colleges was the UI copy assuming "Grade 8" / "A" everywhere (placeholders,
onboarding steps, landing page). Updated `FirstRunWelcome.jsx`,
`Sidebar.jsx`, and `LandingPage.jsx` to use neutral "Grade / Year" and
"Section / Division" labels with dual-example placeholders, and to say
"schools & colleges" instead of just "schools" in the marketing copy. No
data model change — existing schools are unaffected.

**`Subject.credits`**: optional integer, informational only, not read by
the solver. Colleges track credits per course; schools generally don't
set it. Surfaced as a small optional input in `DataEntryTab.jsx` next to
the room-type field.

**`Subject.lab_batch_count`**: the one real solver feature in this batch.
When set to 2 or more, every period the solver schedules for that subject
is split into that many simultaneous batches instead of one class
session — e.g. a 60-student "Programming Lab" splitting into 3 batches of
~20, each in its own lab room, each with its own teacher, all at the same
period. Modeling approach (see `generate_school_timetable`'s
`lab_batch_count` branch in `app/services/solver.py`):

- One `occ` boolean var per eligible period represents "does a lab
  session happen here at all" — this is what reserves the class group's
  slot (feeds into `class_group_period_vars`, same as a normal
  requirement) and counts toward `periods_per_week`.
- Per batch, a teacher-choice var per qualified candidate, constrained to
  sum to exactly `occ` — "if a session happens here, this batch has
  exactly one teacher; if not, zero." This ties every batch to the same
  period as its siblings without needing an explicit equality constraint
  between them.
- Those teacher-choice vars feed into the *same* `teacher_period_vars`/
  `teacher_total_vars` structures the non-batched path already uses, so
  teacher double-booking (which, within one period, is exactly what
  keeps different batches from picking the same teacher) and workload
  caps are enforced for free — no new constraint code needed for either.
- Room assignment (`_assign_rooms`, a separate post-pass — see its own
  docstring) needed no changes at all: each batch is just another
  (class_group, subject, teacher, period) tuple needing a room, and
  since batches share a period but have distinct teachers, the existing
  room-double-booking-per-period constraint already forces them into
  distinct rooms.
- Upfront validation: if a subject has fewer qualified teachers than its
  batch count, generation fails immediately with a specific message
  ("splits into 3 batches, but only 2 qualified teachers are available")
  rather than a generic CP-SAT infeasibility with no clear cause.

**Known limitation, documented in the code**: locked entries aren't
honored for batched subjects — a lock uses a single (requirement,
teacher, period) key, which can't cleanly express "batch 2 specifically"
without a bigger change to the lock format. Batched sessions are
re-solved fresh on every regeneration instead of silently mis-locking one
batch. `TimetableEntry.lab_batch` (nullable int, 1-indexed) tags which
batch a row belongs to, null for every normal entry.

**Frontend**: `TimetableTab.jsx`'s `entryFor` (singular) became
`entriesFor` (plural, `.filter` instead of `.find`) since a batched slot
now has several simultaneous entries at the same class group + period —
rendered stacked with a "Batch N" label. Batched slots are view-only
(no drag, no lock toggle) in this version, matching the backend's
locked-entries limitation above — designing what "drag one batch" or
"drag the whole session" should mean is future work, not done here.
Verified end-to-end with `backend/verify_lab_batches.py` (a 3-batch lab
subject alongside a normal subject): confirms exactly N simultaneous
entries per session, all at the same period, all with distinct teachers,
and — with enough lab-type rooms available — distinct rooms too.

## Bulk-creating grades/sections

Adding class groups one at a time (the existing form in
`FirstRunWelcome.jsx` and `Sidebar.jsx`) doesn't scale for a school or
college that wants "Grade 1 through 12, sections A through C" or
"Semester 1 through 8, one division each" set up in one go — that's 36
(or 8) separate form submissions otherwise.

`BulkAddClassGroups.jsx` is a new shared component (used by both places
rather than duplicated) taking a prefix ("Grade", "Semester", or blank),
a numeric from/to range, and a section list — either a single-letter
range like "A-D" or a comma-separated list like "A, B, C" / "North,
South" for names that don't fit a range. It shows a live count preview
before submitting ("This creates 36 sections") and computes the full
cross-product client-side; the parsing (`expandSections`, `buildPairs`)
is pure and has no server round-trip until submit.

In `Sidebar.jsx`, it's also handed the school's existing `classGroups`
and skips any (grade, name) pair that already exists rather than
creating a duplicate or surfacing a unique-constraint error the admin
didn't ask for — the preview text says how many will be skipped.
`FirstRunWelcome.jsx` doesn't pass `existing` since a school with zero
class groups (its only render condition) has nothing to collide with.

Both places gained a small "Add one" / "Add a range" toggle rather than
replacing the single-add form outright — some admins genuinely just want
one section, and the toggle keeps that path exactly as simple as before.

`App.jsx` gained `handleAddClassGroups` (plural) alongside the existing
`handleAddClassGroup`: fires every create in `Promise.all` and reloads
school data once at the end, rather than looping the singular handler
(which reloads after every single create — fine for one, wasteful and
re-render-heavy for dozens).

## Deleting sections, and a real orphaned-data bug it surfaced

`DELETE /api/class-groups/{id}` already existed, but nothing in the UI
called it — added a delete ("✕") button per section row in
`Sidebar.jsx` (admin-only, appears on hover, confirms before deleting)
wired through a new `App.jsx` handler, `handleDeleteClassGroup`.

Building this surfaced a real backend bug, the same class as the
`delete_subject` orphaned-data fix from earlier: `TimetableEntry.
class_group_id` has no ORM-level relationship or cascade back to
`ClassGroup` (only `SubjectRequirement` does, via `ClassGroup.
requirements`'s `cascade="all, delete-orphan"`). So deleting a class
group that already had a generated timetable would either raise a
foreign-key constraint error (Postgres — the common case now that
Supabase is in the picture) or silently leave orphaned `TimetableEntry`
rows behind (SQLite, which doesn't enforce foreign keys by default —
explaining why this hadn't been caught in local dev). Those orphaned
rows would then crash `_to_timetable_out`'s plain dict lookups
(`class_groups[e.class_group_id].name`) the next time anyone viewed that
timetable. Fixed in `delete_class_group`
(`app/routers/class_groups.py`) by explicitly deleting the class group's
`TimetableEntry` rows first, mirroring `delete_subject`'s existing fix.
Verified directly with `backend/verify_delete_class_group.py`: creates a
class group with a real timetable entry attached, deletes it, and
asserts zero orphaned rows remain.

Deleting a section removes its subject requirements and any of its
timetable entries; other sections' entries in the same timetable are
untouched. The confirm dialog says so explicitly, since this can't be
undone.
