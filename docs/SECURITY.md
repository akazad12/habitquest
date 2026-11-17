# Security design and residual risks

This document records reviewed controls and tested behavior; it does not claim complete security or independent penetration testing.

## Controls

- Argon2id: 64 MiB, three iterations, one lane; 12–128-character registration passwords. Generic login failure and dummy hash verification; email normalization and unique DB constraint.
- Persistent seven-day absolute sessions: random 256-bit cookie token, SHA-256 digest in PostgreSQL, separate CSRF token. Rotation on login/register for the presented browser session; deletion on logout. No auth token in localStorage/sessionStorage. Reward retry state in sessionStorage contains only non-auth intent data.
- Production cookies: `__Host-` prefix, Secure/HttpOnly/SameSite=Lax, Path=/, no Domain. Exact configured Origin on every mutation, session-bound constant-time CSRF comparison, credentialed single-origin CORS. Proxy/TLS settings are validated at server startup.
- Production auth budgets persist in PostgreSQL via atomic upserts: IP limit and normalized-account limit, shared across instances. Keys are HMAC digests using an environment secret; raw identity values are not persisted in the limiter table. Expiry/reset and concurrency are tested. Store failure denies the request rather than bypassing limits.
- Owned queries protect habits, history, rewards, lifecycle mutations, and analytics. Shared strict Zod schemas validate bodies/ranges. Prisma/tagged raw SQL parameterizes values. Non-owned IDs return 404. Public user selection excludes password hashes and session records.
- User-row locks serialize progression and spending. Unique keys, ownership foreign keys, immutable snapshots/events/ledgers, nonnegative balance guards, and deferred SQL consistency triggers protect concurrent transactions. Phase 5 preserves all prior migrations and economy rules.
- Helmet for API headers, 32 KiB JSON body cap, no-store responses, HTTPS enforcement behind explicit proxy hops, and safe centralized errors. Frontend Vercel headers add CSP, framing, MIME, permissions, referrer and HSTS policies; CSP requires the actual API origin before deployment. Inline styles remain allowed because React/Recharts use them; scripts are self-only.
- Generated request IDs and allowlisted structured logs exclude tokens, bodies, raw URLs, database messages, and user identities. Startup errors disclose only field names. No production demo endpoints; seed/load scripts refuse NODE_ENV=production and require explicitly named test databases.
- Verified database TLS in production, bounded pool/timeouts, separate migration-role support, and graceful shutdown. No automatic destructive database recovery.

## Automated verification

The new production/reliability and persistent-limit suites retain the original 149 tests. They cover unsafe configuration, trusted/untrusted forwarded HTTPS, readiness failure/drain, safe logs, request correlation, orderly/deadline shutdown, cross-instance auth budgets, account normalization, concurrent store increments, expiry reset, and fail-closed errors. Existing ownership/CSRF/session/ledger tests are rerun.

`npm run security:audit` checks locked packages against the npm advisory service. The final audit had zero known advisories; this does not prove vulnerability absence. `npm run check:secrets` first checks accidental env files and recognizable token/private-key patterns, then runs the required Gitleaks CLI over the complete tracked/nonignored publication candidate and all reachable Git history. The source scan uses a temporary copy so ignored databases, credentials and generated directories are not swept into source scans. Temporary source/report copies are removed afterward. Scanner output is suppressed and only file/line/rule diagnostics are forwarded; values, matches and author identities are never printed. Missing scanners, findings and scanner errors fail the command.

CI fetches full history and installs Gitleaks 8.30.1 from the official GitHub release with a pinned SHA-256 archive checksum. Locally install the corresponding Gitleaks CLI before the publication check (for example Homebrew on macOS). [Gitleaks documentation](https://github.com/gitleaks/gitleaks) describes its detector and maintenance policy; the project is feature-complete and maintained for security patches. Keep the reviewed version/checksum current as maintenance work rather than downloading an unpinned latest executable.

`.gitleaks.toml` retains default rules with one exact, line-and-path-constrained exception: the documented non-auth purchase idempotency UUID in REWARDS_ANALYTICS.md. The same value in another file still triggers detection, and a different credential-shaped value in that documentation is not exempt. Inline `gitleaks:allow` comments are not honored by the runner. Synthetic detector probes verified all three cases without exposing values.

Detection is not exhaustive. Scanners can miss novel credentials, short/plain passwords, binary dumps, encoded/encrypted material and private information without recognizable patterns; they do not verify whether credentials are active. False positives require review, not broad exclusions. Image privacy and author identity require separate inspection. The ordinary history scan covers reachable Git refs, not every unreachable/reflog object; unreachable local blobs were separately scanned during the publication audit and do not accompany a normal branch push. No scanner result is a complete security certification.

Git ignores local environments/npm auth, envrc, credential/key files, dumps/backups, SQLite/local databases, logs, generated output and task artifacts. SQL exports are ignored while `prisma/migrations/**/migration.sql` is explicitly retained. Ignore rules do not untrack already committed files; the current publication manifest is independently reviewed.

CI Action references are pinned to official action commit SHAs, permissions are read-only, jobs have time limits and concurrency cancellation, and all databases are isolated service containers. The changed workflow has not been pushed/run in hosted CI during Phase 5; the prior Phase 4 hosted workflow passed.

## Remaining launch decisions

No email ownership verification, password reset/change, MFA, account deletion/export, breach-password checking, or independent abuse/penetration audit is implemented. These are production product/security considerations, not silently claimed as complete. Registration reveals an existing email with 409; login stays generic. Account-based fixed-window limits can be used for temporary denial of service. No global concurrency admission control for Argon2 is added; measure public traffic and constrain platform memory/edge abuse accordingly (64 MiB per active hash).

The managed database, TLS trust chain, least-privilege roles, actual edge header behavior, backups/PITR, alerting, retention, and live cookie/CSP behavior need operator verification with approved platform access. The default unrelated Vercel/Render domains are deliberately unsupported for authenticated cookies; use the documented same-site topology.

Historical unrecorded archive pauses remain unavailable, legacy reward lifecycle is not invented, and old unawarded completions are not retroactively paid. Lifetime history evaluation and per-user write serialization remain scale limits. No independent certification, real-money payment, or production capacity claim is made.
