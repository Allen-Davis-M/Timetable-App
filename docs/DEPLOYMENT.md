# Deployment setup: free hosted database + Google sign-in

This covers two independent pieces of manual setup — only you (the account
owner) can do these, since they involve creating accounts/credentials that
can't be scripted from here. Both are optional in the sense that the app
runs fine without them (SQLite locally, email/password only) — this is
what to do when you're ready to move off a single laptop.

## 1. Free hosted Postgres via Supabase

Supabase's free tier gives you a real Postgres database on the internet at
no cost: 500MB storage, 50,000 monthly active users, no credit card
required. Good enough for a pilot with a handful of schools; you'd
outgrow it before it becomes a real cost decision.

1. Go to [supabase.com](https://supabase.com) and sign up (Google sign-in
   works for their own dashboard, separately from this app's).
2. Create a new project. Pick any name/region; set a database password
   and **save it somewhere** — you'll need it in the connection string
   and Supabase won't show it again.
3. Once the project finishes provisioning (~2 minutes), go to
   **Project Settings → Database → Connection string → URI**. Copy it —
   it looks like:
   `postgresql://postgres:[YOUR-PASSWORD]@db.xxxxxxxxxxxx.supabase.co:5432/postgres`
4. In `backend/.env` (copy from `backend/.env.example` if you don't have
   one yet), set:
   ```
   DATABASE_URL=postgresql://postgres:your-actual-password@db.xxxxxxxxxxxx.supabase.co:5432/postgres
   ```
5. Restart the backend (`uvicorn app.main:app --reload --port 8000`).
   SQLAlchemy creates all the tables automatically on first startup
   (see `app/main.py`), so there's no separate migration step for a
   brand-new database — it'll just work against the empty Supabase
   database the same way it worked against `dev.db`.

**Two things worth knowing:**
- Supabase free projects **pause after a week with no activity** and
  wake up automatically on the next request (with a few seconds of
  delay for that first request). `app/core/database.py`'s
  `pool_pre_ping=True` handles the "connection went stale" side of
  this; the "cold start" delay itself is just something to expect on a
  quiet free-tier project, not a bug.
- If you outgrow the free tier or need it always-warm, Supabase's paid
  tier is a straightforward upgrade from the same dashboard — no data
  migration needed.

## 2. Google sign-in

This lets users click "Continue with Google" on the login page instead
of (or alongside) email/password. It needs a Google Cloud OAuth 2.0
Client ID, which only whoever controls the Google Cloud project can
create.

1. Go to the
   [Google Cloud Console credentials page](https://console.cloud.google.com/apis/credentials)
   and create a project if you don't have one already (top-left project
   selector → New Project).
2. Configure the OAuth consent screen if prompted (**APIs & Services →
   OAuth consent screen**): choose "External," fill in an app name and
   your email as support/developer contact. For a pilot with a small
   number of schools, you can leave it in "Testing" status and add
   specific test-user emails, or publish it — publishing doesn't require
   Google's review unless you request sensitive scopes, and this app
   only requests basic profile/email info.
3. Go to **Credentials → Create Credentials → OAuth client ID**.
   - Application type: **Web application**.
   - Authorized JavaScript origins: add both
     `http://localhost:5173` (for local dev) and whatever domain the
     frontend is actually hosted at once deployed (e.g.
     `https://your-app.com`).
   - You don't need a redirect URI for this flow — the app uses Google
     Identity Services' token-based sign-in, not a redirect-based OAuth
     flow.
4. Copy the resulting **Client ID** (looks like
   `123456789-abc...apps.googleusercontent.com`). You do *not* need the
   client secret — this flow only uses the client ID, verified
   server-side.
5. Set it in **two** places (they must match exactly):
   - `backend/.env`: `GOOGLE_CLIENT_ID=123456789-abc...apps.googleusercontent.com`
   - `frontend/.env` (copy from `frontend/.env.example` if needed):
     `VITE_GOOGLE_CLIENT_ID=123456789-abc...apps.googleusercontent.com`
6. Restart both the backend and the frontend dev server (Vite only
   reads `.env` at startup).

Once both are set, a "Continue with Google" button appears above the
email/password form on the login page. If either side is left blank,
that half quietly stays disabled instead of breaking — the backend
button won't render without `VITE_GOOGLE_CLIENT_ID`, and the backend
endpoint (`POST /api/auth/google`) returns a clear 503 error if someone
manages to call it without `GOOGLE_CLIENT_ID` configured.

**How it links accounts:** if someone signs in with Google using the
same email as an existing email/password account, that Google sign-in
gets linked to the existing account (not a duplicate) — see
`google_login()` in `backend/app/routers/auth.py`.
