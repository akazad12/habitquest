# API reference map

The source of truth for strict JSON requests/responses is `packages/shared/src/index.ts`. Every protected operation derives ownership from the session. Errors are sanitized JSON with code/message and optional validation issues. Request correlation is returned as X-Request-ID.

| Method           | Route                               | Contract                                                                                                     |
| ---------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| GET              | `/api/health`                       | Public `{status:"ok",service:"habitquest-api"}`; process liveness only                                       |
| GET              | `/api/ready`                        | Public 200 `{status:"ready",service:"habitquest-api"}` or 503 `{status:"unavailable"}`; never DB diagnostics |
| POST             | `/api/auth/register`                | email, displayName, password, timezone; 201 user/CSRF and session cookie                                     |
| POST             | `/api/auth/login`                   | email/password; user/CSRF and fresh cookie; generic credential failure                                       |
| GET              | `/api/auth/me`                      | Public-field user and session CSRF token; 401 when signed out                                                |
| POST             | `/api/auth/logout`                  | Invalidate current session; 204                                                                              |
| PATCH            | `/api/auth/profile`                 | Display name and timezone; public-field user                                                                 |
| GET/POST         | `/api/habits`                       | List active/archived/all; create title/description/category/difficulty/schedule                              |
| GET/PATCH/DELETE | `/api/habits/:id`                   | Owned read/edit/archive; PATCH archived:false reactivates                                                    |
| GET              | `/api/habits/today`                 | User-local date, scheduled habits and actual completion counts                                               |
| POST             | `/api/habits/:id/completions`       | `{scheduledDate}` must equal current local today; reward/progression receipt                                 |
| DELETE           | `/api/habits/:id/completions/:date` | Today-only undo; 204 or JSON receipt with `Prefer: return=representation`                                    |
| GET              | `/api/habits/:id/completions`       | Owned descending date history, before cursor, limit 1–100                                                    |

All mutations require the configured Origin. Authenticated mutations also require session X-CSRF-Token. Browser requests use credentials:include. Production IP/account auth budgets are shared across instances and fixed-window; see [SECURITY.md](SECURITY.md).

[GAMIFICATION.md](../GAMIFICATION.md#api-contract) documents progression/freezes/completion receipts and exact rules. [REWARDS_ANALYTICS.md](../REWARDS_ANALYTICS.md#api-contracts) documents all rewards, redemption and analytics routes, pagination, idempotency requests, lifecycle receipts and metric definitions. Their Phase 3/4 historical verification sections are superseded by the current [Phase 5 handoff](PHASE5_HANDOFF.md); product rules remain unchanged.

404 hides missing/non-owned resources. 400 indicates input/HTTPS/range problems; 401 authentication; 403 Origin/CSRF; 409 financial/state conflicts; 429 auth limits. Identified database-connectivity failures return sanitized 503 with Retry-After; unknown errors remain sanitized 500. Health/readiness and all API responses use no-store.
