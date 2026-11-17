# Rewards and analytics — Phase 4

> Phase 5 operational verification supersedes the historical results below: see [the current handoff](docs/PHASE5_HANDOFF.md). Progression and analytics product rules are unchanged. The adapter warning was avoided through sequential batch relation reads; no major dependency upgrade or warning suppression was used.

Phase 4 extends the existing npm workspaces, session authentication, CSRF validation, Prisma models, and progression ledger. It does not change difficulty awards, XP thresholds, streak counting, freezes, permanent achievements, or today-only completion/undo rules. No real-money transaction is supported.

## Rewards economy

Rewards belong to one account. Creation and editing accept a title, optional description, positive integer coin cost (maximum 1,000,000), category, and optional icon. Categories are Personal, Relaxation, Food, Entertainment, Adventure, and Other. Icons are gift, film, utensils, gamepad, coffee, sparkles, mountain, and book. An enumerated icon avoids external image hosting and uploads. DELETE archives; PATCH with `archived:false` reactivates. There is no hard-delete API.

The spendable balance is always the sum of signed immutable coin transactions. No stored balance is overwritten. A purchase locks the owner user row, checks reward ownership, active status, expected current price, and available coins, then creates the redemption snapshot, PENDING audit event, and negative ledger entry in one transaction. The existing database balance guard independently rejects negative balances. Purchases, cancellations, completion awards, and completion undo serialize on the same user row.

The client supplies a UUID idempotency key and expected coin price. The server scopes the stored key to the authenticated user. Reusing it for the same reward and original expected price returns the original receipt without a second debit, including after later reward edits, archive, or cancellation. Reusing it for a different intent returns 409. A new purchase at an outdated price returns `PRICE_CHANGED` (409); the user must review the changed reward and create a new intent. An insufficient balance returns 409. The browser's affordability display is advisory; the database transaction decides correctness.

The confirmation dialog preserves an uncertain confirmed purchase intent in user-scoped sessionStorage. This is a UUID, reward reference, and reviewed price, never an authentication token. Network/5xx or uncertain authentication errors retain the key and offer safe retry, including after refresh. Certain business rejections let the user close and review again. If sessionStorage is unavailable, the UI refuses to send a purchase without recoverable intent storage. A successful purchase immediately updates backend-provided progression and balance; a subsequent catalog-refresh failure is reported separately.

### Lifecycle and audit

| Current state | Action        | Result                                                     |
| ------------- | ------------- | ---------------------------------------------------------- |
| Pending       | Fulfill       | Fulfilled; no currency mutation                            |
| Pending       | Cancel        | Canceled; append one refund of the original snapshot price |
| Fulfilled     | Fulfill again | Idempotent no-op                                           |
| Canceled      | Cancel again  | Idempotent no-op                                           |
| Fulfilled     | Cancel        | 409; no reversal operation exists                          |
| Canceled      | Fulfill       | 409                                                        |

The original reward title, price, description, category, and icon are saved on purchase. Edits and archives never rewrite receipts. Concurrent lifecycle operations have one terminal winner; repeated cancellations cannot refund twice. Every managed redemption has exactly one debit and PENDING event. A terminal transition adds one matching timestamped audit event. Cancellation additionally has exactly one positive refund linked by a unique redemption source. Deferred database constraints reject incomplete state/event/ledger transactions at commit, even if a database client bypasses API services. Financial snapshots, ledger rows, and events are append-only; managed transitions are one-way.

Spending can make a same-day completion undo impossible until enough coins are available: the existing nonnegative-balance policy returns 409 and rolls back the entire undo. Canceling a pending reward restores its original coins; a fulfilled reward has no cancellation path. Purchases and refunds never award XP, coins as a bonus, achievements, or freezes.

## Analytics definitions

All data is owned by the authenticated user. The default range is the rolling previous twelve months through the user's current local date (365 or 366 dates, leap-safe). Custom ordered ranges contain at most 366 dates and cannot end in the future. Dates are inclusive. The server's trusted clock and configured IANA timezone define today.

For each date, the engine selects that habit's saved effective schedule version. Daily, ISO weekdays, and anchored every-N-calendar-days recurrence are evaluated using local date arithmetic. Rest days, schedule gaps, and recorded archive pauses do not create missed sessions. A completion already saved on an archive-boundary date is retained. Archived habits remain in historical reporting. Current schedule edits never retroactively replace old recurrence versions.

- **Scheduled:** eligible occurrences in the selected range, including unfinished today.
- **Completed:** active completion rows for eligible occurrences; undone rows do not count.
- **Pending:** eligible unfinished occurrences on the server's current local date.
- **Assessed:** scheduled minus pending. Today's completed sessions enter both numerator and denominator immediately; unfinished today is excluded until that local date closes.
- **Completion percentage:** `completed / assessed * 100`, rounded to two decimal places. Zero assessed sessions yields null (displayed as an em dash), rather than an invented percentage.
- **Frozen:** protected unfinished sessions. On a closed date they remain in the denominator and never become a completion. A freeze only protects the streak. If a timezone return makes a frozen date today, its unfinished session is pending until the date closes.
- **Weekly/monthly rates:** sums of completed and assessed counts, then the same ratio; never an average of daily percentages. Weeks start Monday. Partial boundary weeks/months include only the selected dates.
- **Current/longest streak:** unchanged Phase 3 schedule-aware real-session counts, evaluated through today using recorded history. Overview uses the maximum per-habit value, not a fictional aggregate streak. These values are lifetime, independent of the selected reporting range.
- **Overview counts/rate:** selected range. Lifetime completion count is separately provided. XP, level, financial metrics, and permanent unlocked-achievement count are explicitly lifetime values in the UI.
- **XP:** net recognized signed ledger XP, including undo reversals. The time chart groups transaction timestamps by the user's current timezone, using PostgreSQL timezone-aware local-midnight boundaries (including DST). A reversal appears on its transaction date, rather than silently rewriting an earlier day's XP. Per-habit XP uses actual completion-linked ledger entries. Source-less adjustments contribute to overall XP but cannot be assigned to a habit.
- **Coins earned:** net completion-linked coin awards, including reversals. **Spent:** gross purchase debits. **Refunded:** separate original-price refunds. **Adjustments:** source-less audited entries. `balance = earned + adjustments - spent + refunded`. Refunds are not new earned coins.
- **Heatmap intensity:** 0 completions → 0; 1 → 1; 2–3 → 2; 4–6 → 3; 7+ → 4. Each cell exposes date/count/schedule information and visible numeric non-color cues. Day details are fetched only after selection.

Reports use repeatable-read transactions, batched owned schedule/completion/pause/freeze reads, and SQL aggregates for XP and money. No database query is issued for every day or habit. The frontend loads one combined report, with explicit selected-day and selected-habit detail requests. Range tables accompany Recharts charts; animation is disabled. Analytics is a separate lazy-loaded bundle. Heatmap dates support arrow-key navigation and native focus.

### Historical limits and scale

Unrecorded pre-Phase-3 archive intervals cannot be reconstructed. Pre-gamification completions do not acquire fictional XP or coins. Timezone changes preserve stored local completion dates, schedule boundaries, and provenance; charts re-bucket absolute XP instants in the currently configured timezone. Dates ahead of today's local date after a timezone return are excluded from sessions until the calendar catches up; recorded ledger entries and permanent badges remain.

The output/calendar and XP query are bounded, but the existing Phase 3 lifetime streak evaluation reads saved history on demand. It is batched rather than N+1; a materialized statistics projection and production-scale load benchmark remain future work. Reports fail rather than returning unsafe integer totals.

## Additive migration

`20261116000400_rewards_analytics` extends Reward metadata, adds the redemption enum/projection/timestamps and append-only RedemptionEvent table, and adds the unique refund source and owner foreign key on CoinTransaction. It adds a completion-date index and database lifecycle/refund/audit consistency checks. Existing progression models, constraints, ledger rows, environment files, and the first three migration files are preserved.

Legacy reward creation/update timestamps are nullable because the previous schema did not record them. New rewards supply real timestamps. Legacy redemptions have `lifecycleManaged:false`: their old debit and snapshots remain intact, the API exposes a null/unknown lifecycle, and fulfillment/cancellation is refused rather than fabricating a status or refund. An explicit audited migration would be required to reconcile such records.

Deploy using `npm run db:generate` and `npm run db:deploy`. Do not reset, use `db push`, or remove database volumes. Prisma model drift checks do not validate custom triggers; the committed migration and PostgreSQL integrity tests are authoritative for those constraints.

## API contracts

All routes below require the existing session cookie. Every mutation requires the configured Origin and session `X-CSRF-Token`. Ownership is derived from the session, never accepted from the body. Errors retain `{error:{code,message,issues?}}`; 400 validation, 401 auth, 403 CSRF, 404 missing/non-owned resource, and 409 financial/state conflict.

| Method | Path                           | Request/result                                                                                                     |
| ------ | ------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| GET    | `/api/rewards`                 | `status=active\|archived\|all`, optional category/cursor, limit 1–100 (default 24); `{rewards,balance,nextCursor}` |
| POST   | `/api/rewards`                 | Reward input; 201 `{reward}`                                                                                       |
| GET    | `/api/rewards/:id`             | `{reward}`                                                                                                         |
| PATCH  | `/api/rewards/:id`             | Nonempty partial input, optional archived; `{reward}`                                                              |
| DELETE | `/api/rewards/:id`             | Archive, 204                                                                                                       |
| POST   | `/api/rewards/:id/redemptions` | Purchase intent below; 201 new or 200 replay receipt                                                               |
| GET    | `/api/redemptions`             | Optional `status=PENDING\|FULFILLED\|CANCELED`, cursor, limit 1–100 (default 20); `{redemptions,nextCursor}`       |
| POST   | `/api/redemptions/:id/cancel`  | Empty JSON object; receipt with exact refund or idempotent no-op                                                   |
| POST   | `/api/redemptions/:id/fulfill` | Empty JSON object; receipt with terminal state or idempotent no-op                                                 |
| GET    | `/api/analytics`               | Optional from/to; combined overview, daily, weekly, monthly, per-habit summaries                                   |
| GET    | `/api/analytics/overview`      | Range/timezone plus overview                                                                                       |
| GET    | `/api/analytics/heatmap`       | Range/timezone plus daily records                                                                                  |
| GET    | `/api/analytics/trends`        | Range/timezone plus weekly/monthly records                                                                         |
| GET    | `/api/analytics/days/:date`    | `{date,sessions}` with COMPLETED/PENDING/MISSED/FROZEN statuses                                                    |
| GET    | `/api/analytics/habits/:id`    | Optional range; `{from,to,timezone,habit,history}` including undone history rows                                   |

```json
{
  "title": "Movie night",
  "description": "An evening with a favorite film.",
  "coinCost": 200,
  "category": "Entertainment",
  "icon": "film"
}
```

```json
{
  "idempotencyKey": "e4cf5066-a37e-447d-b8dc-8949b7bbd266",
  "expectedCoinCost": 200
}
```

A purchase/lifecycle receipt is `{redemption,balance,changed,progression}`. Redemption includes ID, reward ID, immutable title/cost/metadata, nullable status, managed flag, created/fulfilled/canceled timestamps. Progression is the unchanged backend game snapshot. Reward responses include archived status, nullable timestamps, and server-derived affordability. Pagination cursors are owned resource IDs and return null when exhausted.

Analytics includes from/to/today/timezone; overview counts and lifetime metrics; daily periods with intensity; weighted weekly/monthly periods; and per-habit title/category/archive status, counts, rates, streaks, and trends. Periods expose period, completed, scheduled, assessed, pending, frozen, rate, and signed XP. Shared Zod schemas in `packages/shared/src/index.ts` define exact types and validation.

## Verification and manual instructions

Run README setup, all migrations, then all checks with a dedicated `TEST_DATABASE_URL`. The Phase 4 suites exercise reward CRUD, auth/CSRF/ownership, price/balance rejection, concurrent purchases and overspending, scoped idempotency, original snapshots, repeat/concurrent refunds, terminal races, archive behavior, ledger constraints, and fault-injected debit/refund rollback. Analytics cases cover empty data, weekdays/intervals/rest dates, versions, pauses, pending dates, freezes, undo, weighted rates, leap ranges, timezone boundaries, both DST transitions, financial reconciliation, and isolation. All original tests remain.

Manual workflow with your own account:

1. Complete eligible habits to earn coins; note XP and balance. Create a reward you can afford and one you cannot. Check categories, edit fields, archive, and reactivate.
2. Confirm one affordable purchase. Refresh and verify one pending receipt, the exact debit, and unchanged XP. Repeated requests using the same UUID must return the same receipt.
3. Change the reward's title/price; history must retain the original values. Cancel the pending receipt and verify the original amount is returned once. Refresh and try cancellation again through the API.
4. Purchase another reward, fulfill it, and verify there is no cancellation path. Check that unaffordable new purchases are rejected server-side.
5. In a disposable local environment, interrupt API connectivity after confirming a purchase. Restore the API, reload, and retry the preserved intent. Verify only one debit exists.
6. Compare Analytics with saved scheduled dates: rest days excluded, today's pending sessions excluded from assessed counts, missed closed sessions included, and freezes not treated as completions. Inspect day detail, archived habit history, weekly/monthly views, and partial date ranges.
7. Undo an eligible current-day completion and verify actual completion and net XP/coin changes. If purchased coins prevent reversal, expect 409 with no partial writes.
8. Check keyboard navigation, dialog Escape before submission, labeled errors, chart data tables, and mobile layouts. Sign out.

Historical Phase 4 result: **149 tests in ten files passed**, with TypeScript, ESLint, formatting, production builds, Prisma validation, fresh four-migration deployment, existing-database deployment, and schema drift checks. Browser fixture reconciliation is recorded separately in the Phase 4 handoff. Phase 4 emitted the Prisma/node-postgres concurrent-query warning. Phase 5 avoids the affected loader path, adds local performance/accessibility/reliability verification, and prepares deployment configuration; see [the current handoff](docs/PHASE5_HANDOFF.md) for passed and unverified checks. Live deployment and independent certification remain unverified.
