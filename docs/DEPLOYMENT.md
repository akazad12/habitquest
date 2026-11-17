# Deployment and operations

**Status: prepared, not deployed.** No platform services, domains, billing, or infrastructure were changed in Phase 5. Deployment and pushing Phase 5 require owner approval. The public GitHub repository currently contains the prior approved Phase 4 revision.

## Topology and compatibility

Preferred topology: Vercel serves the static React build at `https://app.your-domain`, Render runs the long-lived Express API at `https://api.your-domain`, and a managed PostgreSQL 17 database persists users, sessions, rate limits, and ledgers. Both browser origins must be HTTPS subdomains of the same registrable domain. This preserves host-only `__Host-` Secure/HttpOnly/SameSite=Lax cookies without introducing third-party cookies. React always uses credentialed fetch; CORS allows exactly WEB_ORIGIN; mutations also require Origin and session CSRF.

The default unrelated `*.vercel.app` and `*.onrender.com` pair is **not** the supported authenticated topology. Do not weaken SameSite to work around it. If a custom domain is unavailable, use a carefully configured same-origin proxy or single-site host as a separate reviewed deployment option. That proxy topology is not implemented or live-tested here.

The frontend is static and needs SPA fallback. The backend requires persistent process/pool behavior and is not converted to serverless functions. PostgreSQL owns financial consistency independently of the API process. A restart does not discard sessions or production auth limits.

Configuration follows the official [Vercel project configuration](https://vercel.com/docs/project-configuration), [Render Blueprint reference](https://render.com/docs/blueprint-spec), [Render deployment lifecycle](https://render.com/docs/deploys), and [Express proxy guidance](https://expressjs.com/en/guide/behind-proxies/). Platform provisioning and billing still require review. The supplied Blueprint names a paid `starter` service as an explicit example; **do not import it until the owner approves that plan/cost**. It does not provision a database or custom domain automatically.

## Environment variables

| Variable               | Where                 | Purpose/default                                                                                  |
| ---------------------- | --------------------- | ------------------------------------------------------------------------------------------------ |
| NODE_ENV               | API                   | `production`; dev/test are never production deployment settings                                  |
| HOST                   | API                   | `0.0.0.0` in Render; local default 127.0.0.1                                                     |
| PORT                   | API                   | Provider-assigned port; local default 3001                                                       |
| WEB_ORIGIN             | API                   | Exact HTTPS frontend origin, no path/trailing slash; one origin                                  |
| DATABASE_URL           | API                   | Secret runtime-role PostgreSQL URL; production requires `sslmode=verify-full`                    |
| MIGRATION_DATABASE_URL | Migration job         | Secret direct connection using a separate DDL role; falls back to DATABASE_URL for local setup   |
| DB_POOL_MAX            | API                   | Integer 1–50, default 10 **per instance**; budget total instances/pools against provider limits  |
| DB_SSL_CA              | API                   | Optional PEM CA certificate for a private trust chain; literal `\n` is normalized                |
| TRUST_PROXY_HOPS       | API                   | Explicit 1 for reviewed Render edge → app topology; default 0 locally, maximum 2                 |
| RATE_LIMIT_SECRET      | API                   | At least 32 random characters; stable across instances/restarts; generate `openssl rand -hex 32` |
| VITE_API_URL           | Frontend build        | Public exact HTTPS API origin, no trailing slash; never a credential                             |
| NODE_VERSION           | Render build          | Node 24 LTS, as in render.yaml; use maintained patches                                           |
| TEST_DATABASE_URL      | Local tests/CI only   | Dedicated `*_test`, `*_verify`, or `*_perf` database, never production                           |
| ALLOW_TEST_FIXTURES    | Local scripts/CI only | Must explicitly equal `yes` for demo/load fixtures; production refuses them                      |
| A11Y_URL               | Local accessibility   | Default localhost:5175; script refuses remote hosts                                              |

Root `.env.example`, `apps/web/.env.example`, and `deploy/*.env.example` are templates. Do not commit real environment files, keys, PEM overrides, passwords, or test account credential files. A Vite variable is public at build time. Templates deliberately contain `.invalid` domains and replacement values, not usable credentials. Production startup rejects missing/unsafe configuration and logs only invalid field names.

Runtime TLS uses `rejectUnauthorized:true` with hostname verification. The code removes the URL sslmode before passing an explicit verified TLS object to node-postgres, preventing URL parsing from overriding the CA policy. Conflicting sslcert/sslkey/sslrootcert/compatibility URL overrides are refused. See [node-postgres TLS configuration](https://node-postgres.com/features/ssl). For a private CA, configure DB_SSL_CA for runtime and the provider's documented CA file/sslrootcert configuration on the separate migration URL. Never use `NODE_TLS_REJECT_UNAUTHORIZED=0` or `rejectUnauthorized:false`.

## Exact preparation and deployment steps

1. Review the local Phase 5 diff and reports. Approve the GitHub push separately from deployment/costs. Run all verification commands in README before publishing.
2. After approval, publish the reviewed source:

   ```sh
   git add .
   git diff --cached --check
   npm run check:secrets
   git commit -m "Prepare HabitQuest for production deployment"
   git push origin main
   gh run list --repo akazad12/habitquest --limit 1
   gh run watch RUN_ID --repo akazad12/habitquest --exit-status
   ```

   Confirm the run's head SHA matches the pushed commit. The new Phase 5 CI has not run on GitHub until this happens. The previous Phase 4 hosted run passed all 149 tests.

3. With explicit billing/platform approval, create a managed PostgreSQL 17 database with backups/PITR and verified TLS. Confirm `btree_gist` extension availability before deploying. Create separate migration-owner and runtime roles. The runtime role should have only needed table/sequence DML and schema usage, not schema ownership, DDL, trigger disable, superuser, or role-management rights. Custom append-only triggers must remain enabled. Test backup restoration to a separate database before accepting important data.
4. Review/import `render.yaml` or enter equivalent fields manually. Repository root is the build root. Build: `npm ci && npm run db:generate && npm run build -w @habitquest/shared && npm run build -w @habitquest/api`. Set all secret values using Render's secret environment UI. `MIGRATION_DATABASE_URL` must be a direct connection compatible with migrations, not a transaction-pooling URL. Configure same-region API/database. Keep automatic deployment off until rollout controls are chosen.
5. Pre-deploy command: `npm run db:deploy`. This uses **prisma migrate deploy**, never migrate dev, db push, reset, or a seed. It applies the five committed migrations in order. Review custom constraints/triggers and migration history. Existing volumes/data are retained. If deployment migration fails, inspect and repair the migration history explicitly; never reset as recovery. The app runtime role may differ from the migration role even though the build/job has access to the migration secret; isolate jobs/credentials further if the provider supports it.
6. API start: `npm run start -w @habitquest/api`. Local `.env` is optional. Configure the API custom HTTPS domain. Set `WEB_ORIGIN` to the final frontend domain, `TRUST_PROXY_HOPS=1` only after verifying the edge overwrites forwarded headers, and verify direct spoofed `X-Forwarded-For` cannot change the effective rightmost client IP. Never set blanket `trust proxy=true`. A different proxy chain requires a reviewed hop setting and tests.
7. Import the repository into Vercel with **repository root** as root, overriding any auto-selected nested directory. `vercel.json` supplies build/output/SPA/security headers. Set VITE_API_URL to the API custom HTTPS origin. Replace the placeholder API origin in the frontend CSP `connect-src` with that exact origin. The Vite production build rejects missing/insecure/placeholder API origins when VERCEL_ENV=production. Use a separate API/database/origin for preview/staging; previews are not automatically trusted by production CORS/CSRF.
8. Point the approved frontend custom domain at Vercel; verify both certificates and same-site domain topology. No DNS or domain changes have been made here.
9. Run the live verification checklist below. Only then label the deployment live or add a demo URL to README.

Render's pre-deploy and service capabilities depend on the chosen plan; confirm current plan support and costs in the platform before approval. No unattended CD workflow or deploy hook is included. CI validates source without deploying it.

## Live verification checklist — requires platform access

- GET API `/api/health`: 200 liveness. GET `/api/ready`: 200 only after a database query. Readiness must become 503 for database failure/draining; do not expose DB details. The pool acquisition timeout is 3 seconds and query execution is bounded; a provider can apply a shorter health-check timeout.
- Sign up with a non-sensitive account; inspect the `__Host-habitquest` cookie for Secure, HttpOnly, SameSite=Lax, Path=/, and no Domain. Confirm a refresh and API restart preserve authentication, and logout invalidates the session.
- Reject wrong Origin, missing/incorrect CSRF, non-owner IDs, and insecure API requests. Verify CORS on the final domains and browser third-party-cookie restrictions without relaxing cookie settings.
- Confirm persistence and ledger reconciliation for completion/undo, purchase/retry/cancel/refund, and terminal fulfillment. Do not run destructive or load tests against production without separate approval.
- Verify route refresh (`/analytics`, `/habits/.../edit`) serves the SPA and CSP permits only the intended backend. Confirm no browser console CSP failures and no API response caching.
- Inspect safe structured request/error logs, request IDs, readiness, memory, pool saturation, and 5xx/429 rates. Complete a graceful restart. Record a backup/restore drill.

## Operations, monitoring, rollback

JSON logs contain generated request IDs, method, route template, status, and duration. Raw URLs/query strings, IP/email, cookies, Authorization/CSRF headers, bodies, hashes, and database exceptions are not logged. Responses expose X-Request-ID for support correlation. Database connectivity failures produce a sanitized 503 where identified; unknown errors produce a sanitized 500. Liveness is independent; readiness queries the database and rejects draining state.

SIGTERM/SIGINT starts an idempotent drain, closes idle HTTP sockets, waits for active responses, disconnects Prisma, and exits. The ten-second deadline force-closes stuck sockets and exits nonzero. HTTP headers/request/keepalive and database acquire/statement/query timeouts are explicit. Production smoke tests verified degraded readiness, HTTPS enforcement, safe logs, and successful shutdown locally.

Use platform stdout/stderr aggregation and uptime checks initially. A paid error-monitoring SDK is not necessary for this portfolio baseline. If later adding one, disable body/header capture and review data retention/scrubbing before enabling it. Alert on sustained 5xx, readiness failure, auth 429 spikes, p95 regressions, storage/connection headroom, and backup failures; numerical alert thresholds must be calibrated from actual deployment data.

Run expired operational-state pruning regularly with `npm run maintenance -w @habitquest/api` using the runtime environment. It deletes only expired sessions and expired auth-limit windows. It is not automatic request-time deletion and never touches ledgers. Keep RATE_LIMIT_SECRET stable across replicas; rotation intentionally resets pseudonymous rate-limit identities. The PostgreSQL limiter is fixed-window, 20 attempts/IP and 10/normalized-account per 15 minutes, counting successes too. A distributed attacker can intentionally lock an account temporarily; edge abuse controls are still advisable for a public launch.

Rollback application code to a compatible previous release while preserving the database. Do not roll back append-only history, remove constraints, or reset data. The Phase 5 operational table is additive and harmless to older code. For future destructive changes use expand/contract migrations and backup/restore rehearsal. Document recovery point/time targets with the selected provider; neither has been measured here.
