# HabitQuest

**Build consistency. Make progress visible. Earn something worth looking forward to.**

HabitQuest is a full-stack habit tracker with recurring daily quests, schedule-aware streaks, XP and levels, personalized rewards, and analytics based on actual completion history. It pairs a dark productivity interface with restrained gamification and a PostgreSQL transaction model designed to keep every earned, spent, reversed, and refunded coin auditable.

**Status:** Phase 5 and final publication cleanup are prepared and verified locally. No live deployment is claimed. The [prior hosted Phase 4 CI run](https://github.com/akazad12/habitquest/actions/runs/43983348136) passed 149 tests; the changed Phase 5 workflow requires an approved push before hosted verification.

![Today dashboard with real fixture-backed habits and progression](docs/screenshots/today-desktop.jpg)

The screenshots show a dedicated synthetic demo account. Metrics come from saved database records; there is no hardcoded demo dashboard or shared owner account.

## What it does

- Creates daily, selected-weekday, or anchored every-N-days habits in the user's IANA timezone.
- Preserves historical schedule versions and archive pauses; keeps one completion per habit/local date.
- Awards difficulty-based XP/coins, tracks real-session streaks, offers explicit streak freezes, and permanently unlocks verified achievements.
- Lets users create and purchase personal rewards, fulfill them, or cancel pending purchases for an exactly-once original-price refund.
- Reports real calendar activity, scheduled-session completion rates, per-habit history, weekly/monthly trends, and signed XP changes.
- Uses persistent cookie sessions, CSRF/Origin protection, owned API operations, structured request logs, and production readiness checks.

## Screenshots

| Habits                                                   | Analytics                                                                                       |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| ![Habit management](docs/screenshots/habits-desktop.jpg) | ![Analytics with schedule-aware rates and real history](docs/screenshots/analytics-desktop.jpg) |

| Rewards                                                               | Profile and achievements                                                 |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| ![Personal rewards marketplace](docs/screenshots/rewards-desktop.jpg) | ![Profile and earned achievements](docs/screenshots/profile-desktop.jpg) |

[Mobile Today](docs/screenshots/today-mobile.jpg) · [Mobile Analytics](docs/screenshots/analytics-mobile.jpg) · [60–90 second demo script](docs/DEMO.md)

## Stack and architecture

| Layer          | Technologies                                                                                               |
| -------------- | ---------------------------------------------------------------------------------------------------------- |
| Frontend       | React 19, TypeScript, Vite, React Router, Tailwind, shadcn-style components, Recharts                      |
| API            | Node 24 LTS, Express 5, Zod, Argon2id, credentialed sessions                                               |
| Database       | PostgreSQL 17, Prisma 7, custom SQL constraints/triggers                                                   |
| Tooling        | npm workspaces, Vitest, Supertest, Playwright/axe, ESLint, Prettier                                        |
| Infrastructure | Docker Compose locally; prepared Vercel frontend + Render API + managed PostgreSQL                         |
| CI             | GitHub Actions with isolated PostgreSQL, dependency/secret checks, full tests, builds, accessibility scans |

## Project Structure

HabitQuest uses an npm-workspaces monorepo that separates the React frontend, Express backend, shared TypeScript contracts, PostgreSQL database, automated tests, and deployment infrastructure.

```text
habitquest/
├── apps/
│   ├── web/                         # React frontend
│   │   ├── src/
│   │   │   ├── pages/
│   │   │   │   ├── today.tsx        # Daily habit dashboard
│   │   │   │   ├── habits.tsx       # Habit management
│   │   │   │   ├── analytics.tsx    # Charts and activity history
│   │   │   │   ├── rewards.tsx      # Rewards marketplace
│   │   │   │   ├── profile.tsx      # Profile and achievements
│   │   │   │   └── auth-page.tsx    # Authentication screens
│   │   │   ├── components/          # Reusable UI components
│   │   │   ├── lib/                 # API client and utilities
│   │   │   ├── auth.tsx             # Authentication state
│   │   │   ├── progression.tsx      # Progression state
│   │   │   └── main.tsx             # Frontend entry point
│   │   └── vite.config.ts
│   └── api/                         # Express REST API
│       └── src/
│           ├── analytics/           # Analytics engine and endpoints
│           ├── progression/         # XP, streaks, coins, achievements
│           ├── rewards/             # Purchases, refunds, fulfillment
│           ├── auth.ts              # Authentication and sessions
│           ├── habits.ts            # Habit operations
│           ├── scheduling.ts        # Recurrence and local dates
│           ├── rate-limit-store.ts  # Persistent rate limiting
│           ├── db.ts                # Database access
│           ├── config.ts            # Environment validation
│           ├── observability.ts     # Structured logging
│           ├── lifecycle.ts         # Graceful shutdown
│           ├── errors.ts            # API error types
│           ├── prune-sessions.ts    # Expired operational-state maintenance
│           ├── app.ts               # Express application
│           └── server.ts            # Server entry point
├── packages/
│   └── shared/
│       └── src/index.ts             # Shared Zod schemas and types
├── prisma/
│   ├── schema.prisma                # Relational database models
│   └── migrations/                  # Five additive SQL migrations
├── tests/                           # Unit and integration tests
├── performance/                     # Isolated load-testing runner
├── scripts/                         # Demo, security and smoke checks
├── docs/
│   ├── screenshots/                 # Desktop and mobile screenshots
│   ├── verification/                # Verification evidence
│   ├── API.md
│   ├── DEPLOYMENT.md
│   ├── SECURITY.md
│   ├── PERFORMANCE.md
│   └── PUBLICATION.md
├── deploy/                          # Hosting environment templates
├── .github/workflows/ci.yml         # GitHub Actions CI
├── .gitleaks.toml                   # Secret-scanner configuration
├── docker-compose.yml              # Local PostgreSQL
├── render.yaml                     # API deployment template
├── vercel.json                     # Frontend deployment template
├── vitest.config.ts                # Canonical test discovery
├── package.json                    # Workspace scripts
└── README.md                       # Project documentation
```

### How the Components Work Together

```mermaid
flowchart TD
    U["User / Browser"] --> W["React + TypeScript Frontend"]
    W --> A["Express REST API"]
    W -. "Shared validation contracts" .-> S["Zod + TypeScript"]
    S -. "Shared validation contracts" .-> A
    A --> AUTH["Authentication & Sessions"]
    A --> HAB["Habits & Scheduling"]
    A --> PROG["XP, Streaks & Achievements"]
    A --> REW["Rewards & Coin Ledger"]
    A --> ANA["Analytics Engine"]
    AUTH --> DB["Prisma ORM"]
    HAB --> DB
    PROG --> DB
    REW --> DB
    ANA --> DB
    DB --> PG[("PostgreSQL Database")]
    T["Vitest + Integration Tests"] -. "Verifies" .-> A
    CI["GitHub Actions CI"] -. "Builds and tests" .-> T
```

### Architecture Highlights

- **Frontend:** React 19 and TypeScript provide the user interface, dashboards, charts, and habit-management workflows.
- **Backend:** Express 5 exposes authenticated REST endpoints and implements scheduling, progression, rewards, and analytics business logic.
- **Shared contracts:** Zod schemas provide consistent validation and TypeScript types across frontend and backend.
- **Database:** PostgreSQL 17 stores users, schedules, completions, sessions, achievements, and immutable XP/coin ledger records, with Prisma 7 for database access.
- **Testing:** Vitest, HTTP integration tests, PostgreSQL integration tests, and browser accessibility checks validate the application.
- **Infrastructure:** Docker Compose supports local development. Vercel, Render, and managed PostgreSQL configurations are prepared but not yet deployed.

Prisma owns the typed model; reviewed SQL migrations retain invariants that cannot be expressed in the ORM schema alone. Services hold transaction boundaries; pure recurrence/streak/analytics engines accept explicit dates for deterministic tests. The API can be constructed without listening, enabling HTTP integration tests with a controlled clock. Analytics is lazy-loaded so charts do not inflate the initial application chunk.

## Database and integrity decisions

Users own habits, rewards, sessions, achievements, and ledger entries. Habits have date-effective schedule versions, local-date completions, and recorded archive pauses. A completion's managed reward snapshot has an append-only revision stream with matching XP/coin entries. Redemptions hold immutable original reward snapshots and append-only lifecycle events, with separate unique debit/refund sources.

Foreign keys enforce ownership relationships; a unique `(habitId, scheduledDate)` prevents duplicate check-ins. Exclusion checks protect schedule boundaries. User-row locks serialize progression and purchases. Deferred constraints verify complete event/state/ledger agreement at commit, and database guards reject negative balances and financial-history edits. The fifth migration adds only persistent operational auth-limit state; earlier migrations and existing data remain intact.

### Streaks and local dates

Streaks count **real completed scheduled sessions**, not elapsed calendar days. Rest dates and recorded archive pauses neither increase nor break a run. An unfinished current local day stays pending; an unprotected closed missed occurrence breaks the run. A freeze preserves a run without adding a completion or awarding currency. Schedule edits become effective tomorrow and never silently rewrite historical completions. Date arithmetic uses IANA timezones and local calendar dates, including DST transitions.

See [GAMIFICATION.md](GAMIFICATION.md) for XP thresholds, exact bonus/freeze rules, permanent achievements, and legacy-data policy.

### Transactional reward economy

The balance is the sum of immutable signed coin entries. Purchase locks the user, checks owner/active status/current expected price/available balance, and atomically saves one original-price snapshot, Pending event, and debit. A user-scoped idempotency UUID makes retries safe. Pending can become Fulfilled or Canceled; cancellation appends one exact refund. Fulfilled purchases cannot be canceled. Editing or archiving a reward does not rewrite its history.

Undo appends exact completion-award reversals. If coins were already spent and reversal would go negative, the whole undo fails safely. A pending cancellation may restore the required coins. No money, payments, or subscriptions are involved. See [REWARDS_ANALYTICS.md](REWARDS_ANALYTICS.md) for contracts and calculation definitions.

### Analytics policy

Rates divide completed sessions by assessed scheduled sessions. Rest days are excluded. Today's unfinished sessions are excluded until the date closes; freezes never count as completed sessions. Weekly/monthly rates sum counts before division. A zero denominator returns null. Session metrics use the selected range (maximum 366 dates); XP/level/streak/achievement/ledger overview totals are explicitly lifetime values. Signed XP is grouped by local transaction date, including undo reversals. Archived habit history remains available.

## Authentication, security, and reliability

Passwords use Argon2id (64 MiB, three iterations). Random session tokens are stored only as SHA-256 digests in PostgreSQL. Production uses Secure/HttpOnly/SameSite=Lax `__Host-` cookies; no authentication token is stored in browser storage. Each mutation requires exact Origin and authenticated CSRF, and resources are queried by owner. Production IP and account auth budgets persist across API restarts/replicas.

Production validates HTTPS origins, explicit proxy hops, verified database TLS and limiter secrets. Logs expose request IDs, route templates, status and duration, never credentials or request bodies. `/api/health` is process liveness; `/api/ready` checks PostgreSQL and draining state. Graceful shutdown drains requests and disconnects the pool with a deadline. No paid monitoring SDK is required for the stdout/uptime baseline.

[Security design and remaining risks](docs/SECURITY.md) · [Severity-ranked initial audit](docs/AUDIT.md) · [Operational/deployment runbook](docs/DEPLOYMENT.md)

## Local installation

Requirements: Node 24 LTS, npm 11 or newer, Docker Compose, and a running Docker daemon. Publication security checks also require Gitleaks 8.30.1 (for example `brew install gitleaks` on macOS; CI installs the pinned official release with checksum verification).

```sh
cp .env.example .env
cp apps/web/.env.example apps/web/.env.local
npm ci
npm run db:generate
docker compose up -d --wait db
npm run db:deploy
npm run dev
```

- Frontend: [localhost:5173](http://localhost:5173)
- API: [localhost:3001/api/health](http://localhost:3001/api/health)
- Readiness: [localhost:3001/api/ready](http://localhost:3001/api/ready)
- PostgreSQL: localhost:5432; local-only credentials are in `.env.example`.

Use `localhost` consistently. WEB_ORIGIN must exactly match the browser origin. The API reads root `.env` locally; Vite reads `apps/web/.env.local`. VITE_API_URL is public build configuration. Register an account; no demo seed runs automatically.

For an existing checkout, retain `.env` files and the database: `npm ci`, `npm run db:generate`, `npm run db:deploy`, then restart dev servers. **Do not reset or remove database volumes.** Migrations are reviewed additive SQL; do not substitute `db push`.

To start separately after `npm run build -w @habitquest/shared`, use `npm run dev -w @habitquest/shared`, `npm run dev -w @habitquest/api`, and `npm run dev -w @habitquest/web`. Build with `npm run build`; production API start is `npm run start -w @habitquest/api`, which accepts platform environment variables without requiring a local `.env` file.

## API overview

| Group                              | Behavior                                                                                      |
| ---------------------------------- | --------------------------------------------------------------------------------------------- |
| `/api/health`, `/api/ready`        | Liveness and database readiness                                                               |
| `/api/auth`                        | Register, login, logout, current session, display name/timezone                               |
| `/api/habits`                      | Owned CRUD/archive/reactivate, today's scheduled habits, current-day completion/undo, history |
| `/api/progression`                 | Verified XP/coins/levels, streaks, achievements, explicit freeze use                          |
| `/api/rewards`, `/api/redemptions` | Owned catalog, atomic idempotent purchase, history, fulfillment/cancellation                  |
| `/api/analytics`                   | Combined report, overview, heatmap, trends, date and owned-habit detail                       |

Errors use `{error:{code,message,issues?}}`. Mutations require `Origin`; authenticated mutations additionally require `X-CSRF-Token`. Shared schemas define payloads. [API details](docs/API.md) link exact request/response policies.

## Tests and measured quality

```sh
npm run typecheck
npm run lint
npm run format:check
npm run check:secrets
npm run security:audit
npm test
npm run build
npm run test:production-smoke
```

Full PostgreSQL tests require a separate disposable database:

```sh
docker compose exec db createdb -U habitquest habitquest_verify
export TEST_DATABASE_URL=postgresql://habitquest:local_dev_only@localhost:5432/habitquest_verify
DATABASE_URL="$TEST_DATABASE_URL" npm run db:deploy
npm test
```

Never run integration fixtures against important user data. They create random accounts and retain records; no destructive cleanup/reset is automatic. Without TEST_DATABASE_URL, database tests explicitly skip rather than count as passed. Vitest discovers only canonical `tests/**/*.test.ts` suites; ignored scratch projects under work/ and outputs/ cannot inflate the count.

Locally verified: **172 tests in 12 files**, including all 149 prior cases, type/lint/format/build checks, five-migration deployment, and no Prisma schema drift. Automated axe checks found **zero detected violations across 15 views** after fixes; incomplete contrast cases and manual-test limits remain documented. This is not accessibility certification. The previous Prisma adapter warning was reproduced in multi-relation transaction loading and avoided with sequential constant-count batch reads; the final regression run emitted no warning, without upgrading or suppressing it.

The bounded four-user local smoke workload measured p95: login 122 ms, Today 14 ms, undo/completion cycle 66 ms, progression 8 ms, analytics 29 ms, redemption 16 ms, with zero errors. These are development-machine measurements, not production capacity/SLA claims. Query counts remained constant between one and 24 habits. See [performance methods and full percentiles](docs/PERFORMANCE.md) and [accessibility findings](docs/ACCESSIBILITY.md).

Reproduce scans/load tests using the isolated fixture and server instructions in those documents. CI adds dependency audits, the source-file guard plus redacted Gitleaks source/full-history scans, immutable official Action references, an isolated PostgreSQL service, all tests/builds, and axe checks. Gitleaks is required and cannot silently skip; its narrowly scoped documentation exception and detection limitations are described in [SECURITY.md](docs/SECURITY.md). Phase 5 CI changes await an approved push; no new hosted success is asserted.

## Deployment

Prepared topology: Vercel frontend, Render API, managed PostgreSQL, with same-site HTTPS custom subdomains. The unrelated default Vercel/Render domain pair is unsuitable for the current SameSite cookie policy. `vercel.json`, `render.yaml`, and `deploy/*.env.example` provide reviewed templates; replace placeholder domains/CSP origin and configure secrets in platform settings.

**No live deployment was performed.** Follow [exact publishing, deployment, verification and rollback instructions](docs/DEPLOYMENT.md). Obtain approval for the GitHub push, hosting plans/costs, database, domains, and infrastructure changes first. Migration deploy is a separate pre-deploy step; no reset/seed occurs during release.

## Limitations and future improvements

- Unrecorded historical archive pauses cannot be reconstructed. Legacy unawarded completions do not receive fictional XP; old reward timestamps/lifecycle stay unknown when not recorded.
- Lifetime streak/history reads still grow with recorded history. Writes serialize per user. Smoke tests do not establish sustained/public-load capacity; history projections and admission control require measured need.
- Email verification, password recovery/change, MFA, account deletion/export, and independent penetration/assistive-technology audits are not implemented.
- Managed TLS, actual proxy-header behavior, domain cookies/CSP, backups/PITR, production monitoring, and live rollout still need operator verification. The rate limiter's account dimension can cause temporary lockouts under abuse.
- No real-money payments, social features, AI coaching, or subscriptions are included. Future work should prioritize deployment verification and operational/product security gaps before expanding features.

## License

No open-source license has been selected and no LICENSE grant is included. Ask the owner before reuse; license selection remains an owner decision.

[Final publication cleanup](docs/PUBLICATION.md) · [Phase 5 handoff and verification status](docs/PHASE5_HANDOFF.md) · [Demo walkthrough](docs/DEMO.md)
