# Portfolio walkthrough — 60–90 seconds

Use a dedicated synthetic account and a local isolated database. Screenshots in `docs/screenshots` show this seeded non-sensitive account, not the owner's workspace. Historical records are generated through the real transaction service with an explicit fixture clock. The application itself has no demo-data fallback.

## Prepare

After local installation, use a separate database ending in `_test`, `_verify`, or `_perf`, deploy all migrations to it, and run:

```sh
ALLOW_TEST_FIXTURES=yes TEST_DATABASE_URL=postgresql://USER:PASSWORD@localhost:5432/habitquest_demo_test npm run demo:seed
```

The randomly generated account/password is saved only in ignored `work/demo-account.json` with mode 0600. Start a separate API pointing DATABASE_URL at that same database and a frontend origin matching WEB_ORIGIN. Use the local credentials only to sign in. Never commit the credential file or run fixture scripts on production. Scripts refuse production mode and do not reset, delete, or backfill another user's data. Repeated runs create additional independent accounts.

## Script

- **0–15s — Today:** “HabitQuest makes consistency visible. This workspace shows only habits scheduled for my local day, with saved recurrence and timezone rules.” Complete one eligible habit; show the actual XP, coins and streak feedback. Refresh to demonstrate persistence.
- **15–30s — Habits:** Open a habit's edit form and show daily, weekdays and anchored every-N-days scheduling. Explain that recurrence edits start tomorrow and preserve historical versions. Avoid saving unnecessary changes during recording.
- **30–45s — Analytics:** Show the rolling calendar, choose a day, switch weekly/monthly rates, and open a chart's data table. “Rest days aren't misses. Today's unfinished sessions don't lower the assessed percentage until the day closes.”
- **45–65s — Rewards:** Show a personally chosen reward and confirmation. Purchase once, then cancel a pending reward to demonstrate the exact original-price refund. “A transaction and idempotency key prevent duplicate charges and concurrent overspending.”
- **65–80s — Profile:** Show timezone, permanent achievement dates, and secure logout. Briefly show the responsive mobile view.
- **80–90s — Engineering:** “React and Express share Zod contracts. PostgreSQL enforces schedule and ledger integrity. CI runs real database tests, production builds, security checks and accessibility scans.” State current verified counts from the handoff; do not claim a live deployment until verified.

## Captures

Today, Habits, Analytics, Rewards, Profile/achievements desktop screenshots and Today/Analytics mobile screenshots are actual rendered application captures. No private owner data, session token, password, or provider secret is included. Only account display name, synthetic `example.test` email, and earned fixture metrics are visible. Sign out after recording.
