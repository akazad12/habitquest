# HabitQuest gamification rules — Phase 3

This document is the contract for implemented progression. All progression comes from authenticated, owned database records. The React client formats backend results; it does not calculate XP, level thresholds, streaks, coins, achievement eligibility, or freeze eligibility.

## Calendar and streak definitions

A **scheduled occurrence** is a habit-local-date pair admitted by the habit's effective recurrence version. Dates use the existing semantics: the user's configured IANA timezone defines today's date; previously saved completion dates and their timezone provenance never move when the user changes timezone. Schedule-version ranges are inclusive at `effectiveFrom`, exclusive at `effectiveUntil`. Daily means every calendar date, weekdays use ISO Monday=1 through Sunday=7, and intervals count every N calendar dates from an inclusive anchor. Dates before an interval anchor are not scheduled.

A **current streak** is the count of real, active (not undone) completions in the most recent uninterrupted run of scheduled occurrences up to the current local date. A **longest streak** is the largest such completed-session count in the evaluated history, including today's completed occurrence. Neither value is a count of elapsed days.

For each effective scheduled occurrence, in date order:

1. A real active completion increases the run by one.
2. A recorded freeze preserves the run, increasing it by zero.
3. An uncompleted occurrence on today's date remains pending and preserves the run until that local date ends.
4. An unprotected, uncompleted occurrence before today resets the run to zero.
5. Rest dates, schedule gaps, and recorded archive-pause dates are skipped. They neither increase nor reset a run.

A habit scheduled Monday/Wednesday/Friday and completed Friday retains its run over Saturday and Sunday and while Monday is still pending. It breaks if Monday ends without completion or protection. An every-three-days habit advances once for each eligible anchor-based occurrence, not once per intervening day. No rewards are earned merely because time passes.

A freeze may bridge one missed occurrence between real completions, so six real completions + one protected miss + one new completion yield a seven-session streak. A freeze does not itself satisfy a seven-session achievement or bonus. Applying a freeze to a run of zero leaves it at zero. Two adjacent missed dates would each need separate protection; protecting only one does not repair the other.

The pure engine is `apps/api/src/progression/engine.ts`. It receives date-only schedules, active completion dates, freeze dates, archive pauses, and an explicit `asOf` date. Its inputs come from versioned records, not the current recurrence applied retroactively. Unit tests cover daily/weekly/interval patterns, rest dates, pending dates, misses, gaps, version boundaries, pauses, freezes, DST, and date-line behavior.

## Archives, recurrence edits, and timezone changes

Archive keeps schedules and completions. A `HabitPause` begins on the archive's local date and remains open until reactivation. The unfinished archive-boundary day is canceled; a completion already recorded on that boundary still counts. Reactivation closes the pause exclusively at its local date, making that date eligible again. Streaks pause across the archive interval rather than manufacturing misses. Archived habits appear in the progression snapshot and archived habit list with historical current/longest values.

Repeated archive is idempotent. Same-date archive/reactivation produces a harmless empty pause interval. Pause history is immutable apart from closing an open interval once. If a timezone return would overlap a prior closed pause, the next pause begins at the later of today or that prior end; the earlier dates are already protected by the recorded pause. No old pause is shortened or rewritten.

Recurrence edits retain Phase 2's tomorrow-effective policy. Old effective versions remain; only an unstarted future version with no completion/freeze history can be replaced. Schedule edits that would truncate a recorded completion or freeze ahead of the current local date return 409, which can occur after moving timezones backward.

Changing timezone immediately changes which date is today. Streak evaluation ignores completion dates still ahead of that date until the local calendar catches up; their earned ledger entries and permanent achievements remain recorded. It does not change an award's immutable snapshot. If a previously frozen date becomes today after a timezone return, it remains protected and cannot also be completed or receive rewards.

The old schema did not record every archive/reactivate interval. Migration backfills an open pause for currently archived habits using their stored archive timestamp and the account's configured timezone. Earlier unrecorded pauses cannot be reconstructed; legacy streaks therefore reflect the schedules, completions, and pauses actually available. New pauses are fully recorded from Phase 3 onward.

## Completion awards

| Difficulty | Base XP | Coins | XP at 7–29 sessions | XP at 30+ sessions |
| ---------- | ------: | ----: | ------------------: | -----------------: |
| Easy       |      15 |     5 |                  16 |                 18 |
| Medium     |      25 |    10 |                  27 |                 31 |
| Hard       |      40 |    15 |                  44 |                 50 |

The bonus uses the streak **after** the verified completion: 0% below seven real completions, 10% from seven, and 25% from thirty. Bonuses do not stack. XP is integer arithmetic, `floor(baseXp * (100 + bonusPercent) / 100)`, rounded down once. Coins have no streak multiplier. Achievements and freezes do not award extra currency.

The first managed award for a completion snapshots difficulty, base XP, bonus percentage, total XP, coins, and streak at award. Later difficulty edits or freeze repairs do not recalculate that award. A re-complete after undo restores the exact original amounts, preventing a user from cycling difficulty or state to farm a larger award. Future dates' first awards use the difficulty and verified streak applicable when they are first awarded.

There is no client-supplied reward amount or user ID in a completion request. The body contains only the scheduled date, which must match server-computed today. Past/future completion and undo remain prohibited.

## XP and levels

Lifetime XP is the **net recognized XP** in the append-only ledger: all signed XP entries, including exact undo reversals. It is not a gross count that retains invalidated awards. Undo can therefore reduce XP and level. A second total that ignores reversals is deliberately not presented as earned progression.

- Level 1 begins at 0 XP.
- Advancing from level L costs `100 + 50 * (L - 1)` XP.
- The total XP threshold for level L is `25 * (L - 1) * (L + 2)`.
- Levels 2, 3, 4, and 5 begin at 100, 250, 450, and 700 total XP.

The server calculates level, XP into the level, requirement for the next level, XP remaining, and integer progress percentage. Threshold comparisons use integer `BigInt` arithmetic and validate safe nonnegative XP totals, avoiding floating-point threshold errors. The client uses those supplied values in the native progress element.

## Coins and nonnegative balances

Coin balance is the sum of signed coin ledger entries. Phase 4 adds personal reward purchases and exact original-price cancellation refunds using this ledger; see [REWARDS_ANALYTICS.md](REWARDS_ANALYTICS.md). There is no freeze store or payment route. There is no spendable balance stored in localStorage or calculated from client completion counts.

Ledger inserts lock the owner row and check the resulting balance. A debit cannot make XP or coins negative. An undo that cannot reverse its original award because a reward purchase or audited external adjustment has already removed the required balance returns 409 and rolls back the whole mutation. Phase 4 spending paths use the same user lock and ledger guards.

Migration refuses existing negative balances rather than inventing an offset or rewriting ledger history. Such data needs a separate explicit audited correction. The development and verification databases passed this preflight without data changes.

## Atomic completion, undo, and retry behavior

Every progression-changing API operation holds the existing user-row lock. Completion also verifies ownership, active habit state, effective version, recurrence, and today's local date. Inside one Prisma transaction:

1. Create the unique completion row or reactivate its existing undone row.
2. Calculate the post-completion streak from database records.
3. Create the immutable `CompletionReward` snapshot if this is its first managed award.
4. Append one `CompletionRewardEvent` and its signed XP and coin entries.
5. Update the reward-state projection.
6. Reconcile achievement eligibility from real records.
7. Build the authoritative receipt and commit.

Undo uses the same transaction boundary, appends negative entries equal to the original snapshot, changes the reward projection, and soft-undoes the completion. Its original ID, date, timestamp, and timezone remain intact. No ledger rows are edited or deleted.

A reward has one increasing revision stream: revision 1 awards, 2 reverses, 3 restores, 4 reverses, and so on. Each event has exactly one XP entry and one coin entry. Duplicate event revisions and ledger sources are uniquely constrained. The active projection must match revision parity and the final completion state.

**Deferred PostgreSQL constraint triggers** check at commit that the event sequence has no gaps, both ledger entries exist with exact snapshot amounts, and the reward/completion states agree. Even a database client that omits one ledger write or changes only completion state cannot commit a partial managed reward. Additional checks prevent mixing the original legacy award source with the managed source. Append-only guards protect events, grants/uses, ledgers, and permanent achievements.

Repeated mark on an active completion returns zero deltas. Repeated undo on an already-undone or absent completion changes nothing. Concurrent requests serialize on the user row, while unique and deferred constraints provide independent guards. Tests exercise concurrent mark, undo, restore, freeze use, and database-level debits.

### Existing Phase 1/2 data

No historical XP or coins are automatically minted by migration, GET, reconciliation, or retrying an already-active old completion. Historical verified completions still contribute to streaks and achievement eligibility. A today-only undo/re-complete of an unawarded old completion can create its first managed award under the new rules.

Legacy entries explicitly linked through the original ledger `completionId` remain intact. A legacy-rewarded completion without a managed snapshot is not automatically reversible; it returns 409 and requires an audited adjustment. Phase 2 did not expose reward-awarding endpoints, so this protects manually inserted/imported historical ledgers rather than silently interpreting their amounts as new economy awards.

## Streak freezes

The initial system gives each existing and newly registered user one token. Grants are persistent, append-only records. The new-user grant is in the user-creation transaction through a database trigger; it rolls back if registration fails. There is no public grant or purchase endpoint.

Inventory can contain at most **two unused tokens**, enforced under the user lock in PostgreSQL. Used tokens stay in history and do not occupy an inventory slot. A unique user/source key prevents a second INITIAL grant. Each token records its immutable grant local date and timezone, so changing timezone cannot backdate its eligibility.

Freeze consumption is explicit through the app or `POST /api/progression/freezes`. There is no surprise automatic spending on GET or login. An eligible target must:

- Belong to the authenticated user and be an active habit.
- Be a scheduled occurrence according to its historical version.
- Have no active completion or existing freeze.
- Be outside an archive pause.
- Be one of the previous seven **closed** local dates: `today - 7 <= date < today`.
- Be on or after an available token's immutable grant date.

The oldest eligible available token (grant timestamp, then ID) is consumed. A unique freeze ID prevents reuse; a unique habit/date prevents double protection. Version/habit foreign keys and a trigger validate ownership, recurrence, pause status, and absence of a real completion. The service validates the date window against its trusted clock. Missing several occurrences while offline may break a streak even after one is protected; a single token repairs only one miss.

Consumption is permanent and auditable, with habit, schedule version, saved date, timezone, and timestamp. It cannot be refunded or reassigned. Repeating an already-successful request for the same owned target is idempotent, even when it is no longer in the current eligibility window. A freeze creates no completion and awards no XP or coins. It can make an achievement eligible by bridging a run that already contains enough real completions; it does not manufacture those completions or retroactively increase their XP bonuses.

## Achievements

| Achievement   | Verified condition                                                                 |
| ------------- | ---------------------------------------------------------------------------------- |
| First Step    | At least one active completed habit session                                        |
| Consistency   | A current or historical run of at least seven real scheduled completions           |
| Dedicated     | A current or historical run of at least thirty real scheduled completions          |
| Century Club  | At least 100 active completion rows across owned habits, including archived habits |
| Habit Builder | At least five owned habit records, including archived habits                       |

The database's unique user/achievement key prevents duplicate unlocks. Repeated toggles of one completion cannot count as multiple sessions. Definitions come from the migrated achievement catalog; locked badges are catalog entries with no earned timestamp, not fabricated awards.

Achievements are **permanent once validly unlocked**. Undo may make their current conditions false, but the earned historical badge remains and is not granted again. This policy is enforced with an append-only trigger. No XP/coins are awarded for achievement unlocks.

Eligibility is reconciled inside completion/undo/freeze transactions and after habit creation, or explicitly through `POST /api/progression/reconcile`. Navigation uses reconciliation so legacy verified records can unlock earned badges without minting XP. GET progression is a read-only snapshot and does not consume tokens or grant achievements.

## API contract

All endpoints retain the authentication, exact Origin check, CSRF token, credentialed cookies, strict validation, and ownership rules established in Phase 2.

| Method | Endpoint                            | Result                                                                                  |
| ------ | ----------------------------------- | --------------------------------------------------------------------------------------- |
| GET    | `/api/progression`                  | Consistent, repeatable-read progression snapshot                                        |
| POST   | `/api/progression/reconcile`        | Idempotent badge reconciliation and updated snapshot                                    |
| POST   | `/api/progression/freezes`          | `{changed, newAchievements, progression}` for an owned `{habitId,scheduledDate}` target |
| POST   | `/api/habits/:id/completions`       | `{completion, reward, progression}` after the atomic operation                          |
| DELETE | `/api/habits/:id/completions/:date` | Existing 204 default; `Prefer: return=representation` returns a 200 receipt             |

The snapshot includes `asOf`, timezone, XP, coins, level fields, freeze availability/maximum/used count, eligible freeze candidates, current/longest streak and frozen dates for each owned habit (including archived), and catalog entries with nullable unlock times.

A completion receipt contains `changed`, `restored`, signed XP/coin deltas, base XP, bonus percentage, current streak, level before/after, optional 7/30 milestone, and new achievement keys. A no-op retry has zero deltas. The snapshot can therefore be rendered immediately without optimistic accounting or client-side progression calculations.

## Frontend behavior

The existing shell shows backend-sourced XP, level progress, coins, and freezes. Today and habit cards show flame/current/best streak indicators. Profile shows earned and locked achievement badges. Today/Profile offer only server-approved freeze candidates; selecting one and pressing “Use one freeze” performs the permanent action.

Completion feedback announces actual signed amounts, the streak bonus, restored original awards, newly unlocked badges, level-ups, and 7/30-session milestones. Feedback is a dismissible polite live region with an eight-second display. Fade/translation and progress transitions are disabled for `prefers-reduced-motion: reduce`; there is no confetti dependency, audio, or essential motion. Existing keyboard-visible focus, native controls, labeled forms, and error/live states remain.

## Verification and manual checks

Run the complete suite with a dedicated PostgreSQL database; see README. `npm run test:gamification` targets the pure engine and critical PostgreSQL integration suite. Without `TEST_DATABASE_URL`, database cases are explicitly skipped rather than represented as passed.

Manual check with your own account:

1. Sign in, note your backend-provided XP, level, coins, and freeze inventory.
2. Create an Easy daily habit. Its first eligible completion should add exactly 15 XP and 5 coins (unless a qualifying historical streak is present).
3. Refresh: completion, ledger totals, and streak should persist.
4. Undo today: XP/coins should return to their prior values; First Step stays unlocked if this was your first verified completion.
5. Re-complete: the original award is restored once. Edit difficulty, undo/re-complete again, and confirm the same saved award is used for that date.
6. Archive/reactivate: history and streak values remain; archived dates are paused from this phase onward.
7. On a later local day with an eligible missed occurrence, choose it in the freeze panel. Inventory decreases once; no completion or currency is added. Refresh to confirm persistence. No freeze is consumed merely by visiting the page.
8. Verify the badges and all five definitions in Profile. Reward purchases and pending cancellations can now be checked using the Phase 4 manual instructions.

Automated tests include 7-/30-session bonus/achievement thresholds, 100 sessions, five habits, concurrency, rollback, source consistency, nonnegative balances, freeze inventory/reuse/window rules, timezone history conflicts, and unauthorized/cross-user operations.

Browser verification additionally used clearly labeled isolated fixtures whose historical awards were generated through the actual transaction service. A seventh Medium completion moved the account from 225 XP / 85 coins / level 2 to 252 XP / 95 coins / level 3. Repeated undo/re-complete produced an alternating event stream with the same final net award. Freeze consumption added one audit row and zero completions; totals stayed unchanged. Desktop and 390px mobile layouts were inspected without horizontal overflow. The test session was signed out.

### Known limits and unverified checks

- Historical pauses that Phase 2 never recorded cannot be recovered; future pauses are audited.
- Prior unawarded completions do not receive a bulk XP/coin backfill. Legacy explicit award rows need audited reconciliation before automatic undo.
- Streaks are evaluated from history on demand; there is no background statistics projection or production-scale load-test result. Writes deliberately serialize per user.
- The installed Prisma/node-postgres adapter emits a concurrent-query deprecation warning from its relation-loading runtime. It was traced, not suppressed; all application transaction calls are awaited and PostgreSQL correctness tests pass. An upstream compatibility update remains future dependency maintenance.
- Hosted GitHub Actions, production HTTPS deployment, assistive-technology audit, and OS-level reduced-motion emulation are unverified. The implemented reduced-motion CSS is present in the production build.
- Phase 4 adds the rewards marketplace and analytics; leaderboards, AI coaching, premium plans, and a paid freeze store remain outside scope. Progression rules above are unchanged.
