# Timetable Generator

A web application that generates conflict-free school timetables automatically.
School administrators enter their data (teachers, classes, subjects, rooms,
constraints) and the app produces an optimized, conflict-free schedule using a
real constraint solver — instead of building timetables by hand in a
spreadsheet.

## Who this is for

Non-technical school administrators (initial target market: schools in India).
The product philosophy is "simple surface, powerful engine": the UI stays
minimal, and advanced scheduling rules are opt-in rather than required.

## How it works

1. **Land on the marketing page** — an unauthenticated visitor sees a proper
   SaaS-style landing page (hero, features, pricing, testimonials) before the
   login screen, not a bare login form.
2. **Sign up** — email/password, or "Continue with Google" if Google sign-in
   is configured (see `docs/DEPLOYMENT.md`).
3. **Set up the school** — enter teachers, subjects, rooms, and periods by
   hand, or bulk-import from a CSV/Excel spreadsheet.
4. **Describe scheduling rules in plain English** — e.g. "Math can't follow
   PE," "Mr. Rao should not teach more than 3 periods in a row," "No PE on
   Fridays." An LLM (Claude, with a regex fallback when no API key is set)
   turns these into real constraints the solver enforces.
5. **Generate** — one click runs the solver for the *whole school* at once
   (every section and every shared teacher together, so there are no
   cross-section conflicts) and produces a complete timetable, including room
   assignment.
6. **Resolve conflicts** — if no fully valid schedule exists, the app
   diagnoses the specific cause (an overloaded teacher, an over-subscribed
   section) instead of just saying "infeasible."
7. **Fine-tune** — drag a period to move it, lock a slot so it survives the
   next regeneration, or swap two classes in one move.
8. **Export** — download the timetable as Excel or PDF.
9. **Bring your team in** — invite an office admin or vice principal (full
   access) or a read-only viewer to the same school.

## Tech stack

| Layer | Technology | Why |
|---|---|---|
| Solver | Google OR-Tools (CP-SAT) | Purpose-built constraint solver; handles hard + soft scheduling constraints well |
| Backend | Python + FastAPI | Best-supported language for OR-Tools; FastAPI gives free auto-generated API docs |
| Frontend | React + Tailwind CSS + Framer Motion | Component-based UI, fast to style, widely supported |
| Constraint parsing | Anthropic Claude (regex fallback) | Understands free-text scheduling rules without a rigid input form |
| Database | PostgreSQL (SQLite for local dev) | Relational data with strong consistency guarantees; Supabase's free tier works well for a hosted Postgres instance — see `docs/DEPLOYMENT.md` |
| Auth | JWT (email/password) + optional Google sign-in | Standard token auth; Google sign-in is additive, not required |
| Import/Export | openpyxl, reportlab | Reads/writes Excel and PDF files server-side |

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for how the pieces fit
together, [`docs/GETTING_STARTED.md`](docs/GETTING_STARTED.md) to run the
project locally, and [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for setting
up a free hosted database and Google sign-in.

## Project structure

```
timetable-app/
├── backend/          FastAPI application + OR-Tools solver
│   ├── app/
│   │   ├── core/          config, database connection, auth, access control
│   │   ├── models/        SQLAlchemy database models
│   │   ├── schemas/       Pydantic request/response schemas
│   │   ├── routers/       API endpoints
│   │   └── services/      business logic: solver, constraint parsing, bulk import, export
│   └── tests/
├── frontend/          React + Tailwind admin UI + marketing landing page
└── docs/              Architecture, setup, and deployment documentation
```

## Key features

- **Plain-English constraints** — day-specific placement rules, teacher and
  subject consecutive-period limits, minimum gaps between subjects,
  subject-sequence rules ("Math can't follow PE"), availability, and
  workload limits — all describable as a sentence, parsed by an LLM with a
  regex fallback.
- **Real optimization, not a heuristic** — Google OR-Tools' CP-SAT solver,
  the same class of technology used for airline crew scheduling.
- **Room assignment** — the solver assigns rooms (respecting required room
  types like "Lab" or "Gym"), not just teacher/period slots.
- **Bulk import** — upload teachers, subjects, rooms, and class groups from
  CSV/Excel instead of typing them in one at a time.
- **Manual editing that survives regeneration** — drag-and-drop, lock
  individual slots, atomic swaps between two filled slots.
- **Infeasibility diagnostics** — when generation fails, the app identifies
  the specific overloaded teacher or over-subscribed section, not just
  "no solution found."
- **Multi-admin schools with roles** — invite colleagues by email as full
  admins or read-only viewers; every school-scoped endpoint checks
  membership before allowing access.
- **Export** — Excel and PDF, ready for the staff room wall.
- **Marketing landing page** — hero, feature grid, pricing, testimonials,
  and Aceternity/Magic UI-style visual flourishes (spotlight glow, grid
  background, marquee, cursor-tracking glow cards), all hand-built with
  Tailwind + Framer Motion.

## Not yet built

Billing/payments (pricing on the landing page is illustrative), automated
tests/CI, error monitoring, and a formal security review ahead of handling
real customer data at scale. See the "production ready" conversation this
was built alongside for the fuller list.

## Status

The full flow works end-to-end against a real backend: landing page → auth
(email/password or Google) → school setup (manual or bulk-imported) →
plain-English constraints → generation via CP-SAT → manual editing → export.
Multiple admins per school and read-only viewers are supported with real
access-control checks on every endpoint, not just UI-level hiding. The app
runs on SQLite locally by default and can point at a free hosted Supabase
Postgres instance via `DATABASE_URL` with no code changes. Scope is
intentionally generic (not locked to one curriculum or school type) — see
`docs/ARCHITECTURE.md` for the data model reasoning and the full history of
what's been built and why.
