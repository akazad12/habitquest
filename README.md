# HabitQuest

A gamified habit tracker built with React, Express, TypeScript, PostgreSQL, and Prisma. **Phase 4** adds a personalized rewards marketplace, atomic coin purchases and refunds, and analytics derived from saved schedules, completions, and ledgers. The existing authentication, streaks, XP, levels, freezes, and achievements are preserved.

See [Rewards and analytics](REWARDS_ANALYTICS.md) for API contracts, purchase integrity, calculation definitions, legacy-data limits, and manual verification. [Gamification rules](GAMIFICATION.md) documents the unchanged progression engine.

## Start locally

Requirements: Node.js 24 LTS, npm 11, Docker Compose, and a running Docker daemon. Use `localhost` consistently for both servers; switching one server to `127.0.0.1` changes cookie/origin behavior.

For a fresh checkout:

```sh
cp .env.example .env
cp apps/web/.env.example apps/web/.env.local
npm ci
npm run db:generate
docker compose up -d --wait db
npm run db:deploy
npm run dev
```

For an existing Phase 1–3 checkout, keep your `.env` and database, run `npm ci`, `npm run db:generate`, and `npm run db:deploy`, then restart `npm run dev`. **Do not reset the database.** The Phase 2–4 migrations are additive and preserve the earlier migrations.

- Web: [localhost:5173](http://localhost:5173)
- API liveness: [localhost:3001/api/health](http://localhost:3001/api/health)
- PostgreSQL: `localhost:5432`, credentials from the root `.env`

`npm run dev` builds shared contracts and watches all three workspaces. To start separately after `npm run build -w @habitquest/shared`, run these in three terminals:

```sh
npm run dev -w @habitquest/shared
npm run dev -w @habitquest/api
npm run dev -w @habitquest/web
```

The API reads the repository root `.env`; Vite reads `apps/web/.env.local`. `WEB_ORIGIN` must exactly match the frontend origin, without a path or trailing slash. Free port 5173 if Vite chooses an alternate port, or explicitly update `WEB_ORIGIN`. `VITE_API_URL` is the API origin and is public browser configuration. Never place secrets in `VITE_*` variables. Local environment files, generated code, builds, and dependencies are ignored by Git. Environment examples contain development-only credentials.

Register your own account in the app. There is no built-in demo account or automatic seed data. A disposable account was created manually during browser verification; its data belongs only to that account, and its session was signed out. It is not a source of dashboard data for other users.

## Architecture

```text
apps/
  api/src/
    app.ts                 Express middleware and centralized errors
    auth.ts                Argon2id, PostgreSQL sessions, CSRF, auth routes
    habits.ts              Owned habit operations and completion transactions
    scheduling.ts          Local calendar dates and recurrence eligibility
    progression/           Pure streak/economy engine, transaction services, routes
    rewards/               Owned catalog, atomic purchase/lifecycle services and routes
    analytics/             Calendar aggregation engine and consistent report services
    db.ts                  Prisma/PostgreSQL driver factory
    server.ts              Validated startup and graceful shutdown
    prune-sessions.ts      Explicit expired-session maintenance command
  web/src/
    auth.tsx               Session bootstrap and in-memory auth context
    progression.tsx        Backend progression state, badges, freezes, celebrations
    lib/api.ts             Credentialed fetch, in-memory CSRF token, errors
    pages/                 Authentication, Today, habits, profile, rewards, analytics
    components/            Accessible fields and shadcn-style Button
    main.tsx               Existing shell, routing, and route protection
packages/shared/src/       Zod input/response contracts and inferred types
prisma/schema.prisma       Relational models and generated-client config
prisma/migrations/         Four additive migrations through rewards/analytics
tests/                     HTTP, validation, scheduling, and PostgreSQL tests
.github/workflows/ci.yml   PostgreSQL-backed GitHub Actions checks
```

The current directory is the repository root; the project has not been recreated or nested in another `habitquest/` directory. npm workspace links and built ESM exports connect the apps to shared contracts. Prisma 7's client is generated under `apps/api/src/generated/prisma`, which remains ignored. React Router and the original dark-mode-first styling, Tailwind 4/Vite integration, and shadcn/ui component configuration are retained. Dedicated authentication and habit pages extend the original shell.

The API exports `createApp()` independently of the listening server. Dependencies and the clock can be injected for real HTTP integration tests. Health is liveness only; it does not claim database readiness. Only business routes require PostgreSQL. Public user responses explicitly select `id`, `email`, `displayName`, and `timezone`; hashes and session internals are never serialized as user data.

## Authentication and security

- Registration requires email, display name, an IANA timezone, and a 12–128 character password. Email is normalized to lowercase and uniquely constrained. Existing Phase 1 users receive a fallback display name; users with a null password hash cannot use password sign-in.
- Passwords use Argon2id with 64 MiB memory, three iterations, and one lane. A dummy hash verification is used for missing accounts. Login failures use a generic credential error. Passwords are not logged or stored in plaintext.
- Each session uses a cryptographically random 256-bit token. Only its SHA-256 digest is stored in PostgreSQL. A separate random CSRF token is bound to the session. No JWT, signing secret, or localStorage token is used.
- The session cookie is HttpOnly, SameSite=Lax, Path=/, and has no Domain attribute. Production enables Secure and the `__Host-` cookie prefix; server startup requires an HTTPS frontend origin in production. Sessions expire absolutely after seven days with no sliding renewal.
- Successful registration/login establishes a fresh session and revokes the previous session presented by that browser. Other browsers' independent sessions remain valid. Logout deletes the current database session and expires its cookie. Expired sessions are rejected and removed when presented.
- Every state-changing `/api` request requires the exact configured `Origin`, including registration and login. Authenticated mutations additionally require the session's `X-CSRF-Token` header. `GET /api/auth/me` returns that token over credentialed CORS; React keeps it only in memory. SameSite is defense in depth, not the sole CSRF control.
- Register/login share an IP rate limit of 20 attempts per 15 minutes. The limiter is in-process; use a shared limiter store or trusted edge limit before deploying multiple API instances. Express does not trust forwarded IP headers by default. Configure a narrowly trusted proxy topology deliberately before changing that.
- All user-scoped API operations check ownership. Non-owned habit IDs return 404 for reads and writes. JSON inputs use strict shared Zod schemas; Prisma/raw tagged templates parameterize database values. Helmet, a 32 KiB JSON limit, no-store API responses, explicit credentialed CORS, and sanitized errors remain enabled. Internal error logging omits request bodies, credentials, and raw Prisma error arguments.

Expired session records can also be pruned explicitly:

```sh
npm run sessions:prune
```

Production must use HTTPS for the frontend and API, preferably same-origin `/api` hosting or same-site subdomains, because SameSite=Lax intentionally excludes unrelated cross-site API deployments. A reverse proxy should terminate TLS and preserve the configured browser origin. The Vite static host needs SPA fallback to `index.html`. After `npm run build`, start the API with `npm run start -w @habitquest/api`; supply the root environment file as described above. Deployment, email verification, password recovery/change, account deletion, MFA, backups, and distributed rate limiting are not implemented in this phase.

## Recurrence and calendar policy

The **user's configured IANA timezone** defines the current local date. The server computes it from a trusted clock on each operation; the browser does not decide eligibility. Dates are stored as PostgreSQL `date` values. Timestamps use timezone-aware absolute instants.

Supported recurrence:

```json
{ "kind": "DAILY" }
{ "kind": "WEEKDAYS", "weekdays": [1, 3, 5] }
{ "kind": "INTERVAL", "intervalDays": 2, "anchorDate": "2026-11-16" }
```

Weekdays use ISO numbering: Monday=1, Sunday=7. Weekday sets must be nonempty and unique. Intervals accept 1–365 days; the anchor is eligible and earlier dates are not. Calculations count calendar dates, never elapsed 24-hour periods, so daylight-saving transitions do not shift an every-N-days schedule.

A new habit starts on the account's current local date. Its actual first eligible day still depends on recurrence. Schedule edits take effect **tomorrow in the user's configured timezone**, close the current version at an exclusive end date, and create a new version. Today and recorded completion history stay unchanged. Repeated edits may replace an unstarted future version only if it has no completion history. Old effective versions are preserved. The form shows pending rules and their start dates.

Timezone changes take effect immediately for deciding what today means. They do not rewrite stored local-date keys, recurrence anchors, or version boundaries. Schedule timezone fields preserve the timezone at version creation; completion timezone fields preserve the timezone used at the original check-in. They are provenance, while the user's current timezone is the authority for today's date. Moving backward across a date boundary can make a newly created habit not yet eligible. An edit that would replace a version with recorded dates ahead of the new local today is rejected with 409 instead of changing history.

Habit details can be edited immediately. Archive hides a habit from active lists and Today without deleting its schedules or history. Reactivation restores its existing schedule. Undoing an existing check-in remains possible on the current local date even if the habit has since been archived; creating a new check-in requires an active habit.

## Completion and concurrency policy

Mark and undo remain restricted to the server-computed current date in the user's IANA timezone. Ownership, active status for mark, effective schedule, and recurrence eligibility are checked in the transaction. The unique `(habitId, scheduledDate)` and database schedule checks remain authoritative. No historical backfill API is exposed.

A managed completion atomically creates/reuses its unique row, calculates its streak, snapshots rewards, appends XP and coin entries, reconciles achievements, and commits. Undo appends exact compensating entries before marking the row undone. Re-completing restores the immutable original award, so changing difficulty or toggling repeatedly cannot farm XP/coins. Idempotent retries return no additional award. User locks serialize all progression-changing operations; deferred database constraints verify reward-event sequence, both ledgers, and completion state at commit. Balance triggers independently prevent negative XP and coins.

Undo retains the original completion identity, date, timestamp, and timezone. Achievements are permanently unlocked once eligibility is verified; undo can lower XP/level and streaks but does not revoke badges. Reward spending now uses the same user lock and nonnegative ledger guards. Undo can return 409 if spent coins cannot be reversed; cancel a pending purchase to recover its coins before retrying. Full policies and migration treatment of legacy completions are in [GAMIFICATION.md](GAMIFICATION.md).

The UI waits for authoritative server results and refreshes daily data. Progression counters, level thresholds, streak values, badges, available freezes, and eligible freeze dates all come from the backend. GET progression is read-only; explicit reconciliation awards eligible badges, and explicit freeze use consumes inventory. Rest days and freezes never create a completion or award currency.

## REST API

All request bodies are JSON. Mutations require `Origin`; authenticated mutations also require `X-CSRF-Token`. Browser requests use `credentials: include`.

| Method | Path                                | Behavior                                                      |
| ------ | ----------------------------------- | ------------------------------------------------------------- |
| GET    | `/api/health`                       | Public liveness                                               |
| POST   | `/api/auth/register`                | Register and establish a session (201)                        |
| POST   | `/api/auth/login`                   | Verify credentials and rotate the browser session             |
| GET    | `/api/auth/me`                      | Public user fields and session CSRF token (401 if signed out) |
| POST   | `/api/auth/logout`                  | Invalidate the current session (204)                          |
| PATCH  | `/api/auth/profile`                 | Update display name and timezone                              |
| GET    | `/api/habits?status=active`         | Owned habits; status may be active, archived, or all          |
| POST   | `/api/habits`                       | Create habit and initial schedule (201)                       |
| GET    | `/api/habits/today`                 | Local date, timezone, due habits, statuses, count, percentage |
| GET    | `/api/habits/:id`                   | Owned habit and current/pending schedule                      |
| PATCH  | `/api/habits/:id`                   | Partial detail/recurrence edit; `archived:false` reactivates  |
| DELETE | `/api/habits/:id`                   | Archive only (204)                                            |
| POST   | `/api/habits/:id/completions`       | Idempotent completion for `{scheduledDate}`                   |
| DELETE | `/api/habits/:id/completions/:date` | Idempotent local-today undo (204)                             |
| GET    | `/api/habits/:id/completions`       | Descending local-date history, including undone records       |

Phase 3 endpoints:

| Method | Path                         | Behavior                                                                                                                           |
| ------ | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/progression`           | Consistent snapshot of net XP, level/progress, coins, per-habit streaks, inventory, freeze candidates, achievement catalog/unlocks |
| POST   | `/api/progression/reconcile` | Idempotently reconcile eligible achievements and return progression; does not award XP/coins or consume freezes                    |
| POST   | `/api/progression/freezes`   | Apply one eligible freeze using `{habitId, scheduledDate}`; return `{changed,newAchievements,progression}`                         |

Completion POST additionally returns `{completion,reward,progression}` with actual deltas, original base/bonus, current streak, level before/after, milestone, and newly earned achievement keys. Duplicate attempts return zero deltas. Completion DELETE retains its Phase 2 204 default; send `Prefer: return=representation` for a 200 JSON receipt (the React app uses this). All new mutations require the existing authentication, Origin, and CSRF checks.

Example habit body (the UI calls this field “Habit name”; the existing API/database field stays `title`):

```json
{
  "title": "Read ten pages",
  "description": "A quiet moment with a book.",
  "category": "Learning",
  "difficulty": "EASY",
  "schedule": { "kind": "DAILY" }
}
```

Categories: Personal, Health, Fitness, Learning, Mindfulness, Work, Other. Difficulty: EASY, MEDIUM, HARD. Both default for creation; partial edits do not inject defaults. Description may be omitted on creation or cleared with an empty string in a patch. Creation dates and ownership are server controlled.

History supports `limit=1..100` (default 30) and an exclusive local-date `before=YYYY-MM-DD` cursor. Responses contain `completions` and `nextCursor` (null when exhausted). A record exposes only its ID, scheduled date, original completion time, undone time, and timezone snapshot.

Errors use `{error:{code,message,issues?}}`. Typical statuses are 400 for validation, 401 for missing/invalid/expired sessions or invalid credentials, 403 for CSRF, 404 for non-owned/missing habits, 409 for duplicates or date/schedule conflicts, and 429 for auth rate limiting.

Phase 4 reward, redemption, and analytics routes and JSON contracts are documented in [REWARDS_ANALYTICS.md](REWARDS_ANALYTICS.md#api-contracts).

## Database and migrations

The original relational models remain. Phase 3 adds `CompletionReward`, `CompletionRewardEvent`, `StreakFreeze`, `StreakFreezeUse`, and `HabitPause`, plus unique managed-event sources on both ledgers. The original completion uniqueness, legacy award uniqueness, foreign keys, schedule exclusions, and ledger immutability are preserved. Five achievement definitions are inserted by migration. Existing users receive one initial freeze; new-user grants are created transactionally by a database trigger. Existing data and environment files are retained.

Phase 4 adds reward metadata, immutable redemption snapshots, managed lifecycle state, append-only lifecycle events, and a unique refund source on the existing coin ledger. Legacy redemptions retain unknown lifecycle status and cannot be transitioned automatically. See the new design document for migration details.

Custom PostgreSQL checks, deferred consistency triggers, append-only guards, balance locks, inventory caps, and calendar exclusions live in migrations. Preserve them in future changes; do not use `prisma db push` instead of migrations. The migration refuses preexisting negative XP/coin balances rather than silently rewriting history; such data needs an explicit audited correction.

```sh
npm run db:generate
npx prisma validate
npm run db:deploy
```

For a future schema change, configure a separate development/shadow database as required by Prisma, run `npm run db:migrate -- --name descriptive_change`, and review generated SQL. The migration role needs permission to install `btree_gist`; production app and migration roles should be separate. `docker compose down` stops the database while retaining its volume. Removing the volume deletes local data.

## Tests and validation

```sh
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
```

Without `TEST_DATABASE_URL`, pure validation/scheduling and public API tests run, while database suites are explicitly skipped. To run **all** tests, create a dedicated disposable database and apply all migrations:

```sh
docker compose exec db createdb -U habitquest habitquest_test
export TEST_DATABASE_URL=postgresql://habitquest:local_dev_only@localhost:5432/habitquest_test
DATABASE_URL="$TEST_DATABASE_URL" npm run db:deploy
npm test
```

Do not run integration tests against production or a database holding important user data. Database constraint tests roll back their fixtures. HTTP authentication/habit tests use random `@example.test` accounts and commit their fixtures so persistence and concurrency can be tested across independent requests; those fixtures remain in the disposable test database. No destructive automatic cleanup is performed.

CI provisions isolated PostgreSQL 17, installs the lockfile, generates Prisma, deploys all migrations, and runs type checks, lint, formatting, all tests, and the build. Hosted GitHub Actions execution must be confirmed after pushing; local checks do not establish that the hosted workflow ran.

Browser verification used the actual React application and API to register a disposable account, create and edit a habit, complete it, refresh and observe its saved status, undo and refresh, archive/reactivate, save profile, sign out, and test invalid/valid login. Desktop and 390px mobile views were inspected. This is a manual browser check; the automated regression suites target HTTP, shared contracts, scheduling, and PostgreSQL invariants.

## Verification result

The original 109 Phase 3 tests remain. The expanded suite contains **149 tests across ten files**, including real PostgreSQL purchase/refund concurrency, rollback, ledger integrity, ownership, schedule history, timezone/DST boundaries, and analytics fixtures.

Locally verified on Node 24.11.1 and PostgreSQL 17: all 149 tests, TypeScript, ESLint, formatting, production builds, Prisma validation, the four-migration chain on a fresh verification database, additive deployment to the existing development database, and zero Prisma schema drift. Older migration files were preserved. `npm run test:rewards` and `npm run test:analytics` run focused suites; integration cases require `TEST_DATABASE_URL`.

Manual browser checks used isolated test servers and a labeled fixture account. Purchase, refresh persistence, original-price refunds after reward edits, archive/reactivation, fulfillment, safe recovery after an API outage, and real calendar/trend data were exercised. Desktop and 390px mobile layouts were checked; the test session was signed out. The fixture was prepared through the real completion transaction service, not embedded in the UI.

Known warning: the installed Prisma PostgreSQL adapter emits node-postgres's concurrent-query deprecation warning during relation-loading paths. It is not suppressed; the PostgreSQL correctness tests pass. Hosted GitHub Actions, production HTTPS deployment, large-history load testing, and a formal accessibility audit remain unverified.

## Phase boundary

Phase 4 is implemented. Social leaderboards, AI coaching, real-money purchases, subscriptions, and multiplayer are outside scope. Existing authentication deployment limitations still apply. Historical pauses that were never recorded and legacy unawarded XP cannot be reconstructed. Analytics ranges are bounded to 366 local dates; lifetime streak calculations still evaluate saved history on demand.

Stop here before Phase 5; approval is required to continue.
