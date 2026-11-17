# Phase 5 audit — before changes

Reviewed actual source, package scripts/lockfile, environment examples, four migrations, route ownership/transactions, CI, and the adapter warning on 2026-11-16. This is an engineering audit, not a penetration test or security certification.

| Severity | Finding                                                                                                             | Planned action                                                                                         |
| -------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| High     | Production start mandates a local `.env`; no provider deployment configuration                                      | Optional local env loading; Render/Vercel configuration and operator runbook                           |
| High     | Production proxy trust/TLS DB verification are implicit; unrelated Vercel/Render domains break SameSite=Lax cookies | Explicit validated proxy hops; verified database TLS; same-site custom domains                         |
| High     | Authentication limiter is process-local; no account dimension                                                       | Persistent PostgreSQL stores, IP and normalized-account budgets; fail closed                           |
| Medium   | Liveness has no database readiness counterpart                                                                      | Bounded readiness query and draining status                                                            |
| Medium   | Logs lack structured request IDs; startup errors can serialize configuration                                        | Allowlisted JSON events, generated IDs, sanitized startup/errors                                       |
| Medium   | Pool acquire/statement timeout and graceful shutdown behavior need explicit bounds                                  | Small configurable pool, timeout and lifecycle tests                                                   |
| Medium   | Multi-relation Prisma reads issue concurrent queries on one transaction client                                      | Reproduce warning; replace affected paths with sequential constant-count batch reads, no major upgrade |
| Medium   | No reproducible load test, automated accessibility scan, or screenshot documentation                                | Isolated fixture workload, percentiles/query counts, axe scans plus keyboard checks                    |
| Low      | Hosted CI passes Phase 4 but has no dependency/secret check or time/concurrency bounds                              | Add audit, secret guard, build/config checks and bounded jobs                                          |
| Low      | No license declaration                                                                                              | Explicit unlicensed status; do not choose legal terms on the owner's behalf                            |

Existing strengths verified: Argon2id (64 MiB/3 iterations), random persistent session tokens stored as SHA-256 digests, secure production host-only cookies, exact Origin plus session CSRF, public-field user selection, owned resource queries, restrictive foreign keys, versioned schedules, row locks and deferred append-only ledger consistency checks. All four migrations are additive. No deployment files or credentials were present. The locked npm dependency audit reported zero known vulnerabilities at audit time. Historical unrecorded archive pauses cannot be reconstructed.

Implementation outcomes and final verification are recorded in PHASE5_HANDOFF.md and the dedicated security/deployment/performance/accessibility documents.
