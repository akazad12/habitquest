# Performance verification

The committed [raw report](verification/performance.json) is measured output, not a target or production capacity claim. It was run against an ephemeral local HTTP API and local Docker PostgreSQL on Node 24.11.1/macOS arm64. No production host was stressed.

## Reproduce

Migrate a dedicated `*_test`, `*_verify`, or `*_perf` database first, then:

```sh
ALLOW_TEST_FIXTURES=yes TEST_DATABASE_URL=postgresql://USER:PASSWORD@localhost:5432/habitquest_perf npm run test:performance
```

The runner refuses production mode and other database names. It binds its own API to an ephemeral 127.0.0.1 port; there is no arbitrary remote target option. It creates four independent synthetic users with eight habits and fourteen days of completions through the real award service. It retains fixtures and never resets/deletes another account. Authentication uses real Argon2id, persistent production rate stores, forwarded HTTPS test headers, and sessions; no auth middleware bypass is used.

The dependency-free Node fetch runner is a bounded closed-loop smoke tool: four concurrent workers, 16 measured login requests, 32 samples per other scenario. An undo/completion cycle measures both HTTP requests together. Reported throughput is operations/second for that scenario (cycles/second for completion), not all-endpoint RPS. Fixture setup, login setup, and query-scaling probes are excluded from latency samples. Percentiles use the sorted nearest-rank method. Small samples make p99 descriptive rather than a statistically robust tail estimate.

## Measured results

| Scenario                | Samples | p50 ms | p95 ms | p99 ms | Operations/s | Errors |
| ----------------------- | ------: | -----: | -----: | -----: | -----------: | -----: |
| Authentication          |      16 |  86.64 | 122.32 | 122.32 |        42.21 |      0 |
| Today dashboard         |      32 |   3.54 |  14.05 |  14.11 |       809.48 |      0 |
| Undo + completion cycle |      32 |  58.77 |  66.16 |  67.63 |        66.47 |      0 |
| Progression retrieval   |      32 |   6.78 |   7.96 |   8.00 |       572.22 |      0 |
| Analytics               |      32 |  22.03 |  29.26 |  29.41 |       176.35 |      0 |
| Reward redemption       |      32 |  10.74 |  15.98 |  16.23 |       353.28 |      0 |

Error rate was zero in all scenarios. Budgets are **targets**: auth p95 <1500 ms; reads <500 ms; write cycle <1000 ms; error rate 0 for this smoke workload. All measured scenarios were within those local targets. The runner fails for request errors but does not enforce latency budgets across heterogeneous developer/CI hardware.

## Query behavior and confirmed optimization

Query-event instrumentation counts statements without saving SQL parameters, cookies or user information. With one versus 24 habits, counts were unchanged: Today 6/6, progression 15/15, analytics 13/13 (including authentication and transaction statements). This is evidence against a per-habit N+1 query pattern for those probes, not proof of bounded memory or historical query cost.

The confirmed Prisma adapter warning arose from sibling relation queries submitted concurrently on a single transaction connection. Existing application code awaited the outer query, but that did not serialize the ORM's internal relation loader. An upstream reproduction is recorded in [Prisma issue 29407](https://github.com/prisma/orm/issues/29407). The affected game-history and Today paths now load relations sequentially in constant batches and group them in memory. All 149 prior regression tests plus the new tests pass without the warning. No dependency upgrade, vendored patch or warning suppression was used.

The completion cycle is the most SQL-intensive scenario: 2780 observed statements across 32 cycles, including undo and mark, integrity checks, achievement reconciliation and authoritative receipts. The measured p95 was 66 ms, so no speculative balance cache or ledger bypass was introduced. Existing useful indexes cover owner/archive habit lists, habit/date uniqueness, user/time ledger aggregation, schedule boundaries, redemption history and session lookup/expiry. The new limiter uses a primary-key upsert and expiry index. Small fixtures do not justify further indexes; production EXPLAIN/row-volume and pool-wait profiling remain necessary before changes.

Lifetime streaks still read history on demand. Larger histories, long-duration arrival-rate tests, distributed contention, network/TLS/cold starts, exhausted pools, host memory/CPU saturation and production-sized query plans are not measured by this run. Argon2 uses 64 MiB per active hash; rate limits are not a substitute for public-traffic memory/capacity planning. A k6 arrival-rate/sustained test can follow on a dedicated staging deployment after approval. There is no production SLA or claim of unlimited scalability.
