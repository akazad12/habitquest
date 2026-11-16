import type { Analytics, DayDetails } from "@habitquest/shared";
import type { Prisma } from "../generated/prisma/client.js";
import { ApiError } from "../errors.js";
import { publicSelect, type AppDependencies } from "../auth.js";
import { gameRecords } from "../progression/service.js";
import { levelProgress } from "../progression/engine.js";
import {
  calendarDate,
  dateOnly,
  localDate,
  recurrenceOf,
} from "../scheduling.js";
import {
  dayPeriod,
  defaultReportStart,
  groupPeriods,
  rangeDays,
  rateOf,
  sessionsOn,
  type ReportHabit,
} from "./engine.js";
const safe = (value: bigint | number) => {
  const n = Number(value);
  if (!Number.isSafeInteger(n))
    throw new ApiError(
      409,
      "TOTAL_TOO_LARGE",
      "A ledger total exceeds the supported integer range.",
    );
  return n;
};
export function reportRange(
  today: string,
  input: { from?: string; to?: string },
) {
  const to = input.to ?? today;
  const from = input.from ?? defaultReportStart(to);
  if (
    to > today ||
    from > to ||
    (calendarDate(to).getTime() - calendarDate(from).getTime()) / 86400000 >=
      366
  )
    throw new ApiError(
      400,
      "INVALID_DATE_RANGE",
      "Choose an ordered range of at most 366 local dates ending no later than today.",
    );
  return { from, to };
}
async function reportSource(
  tx: Prisma.TransactionClient,
  userId: string,
  now: Date,
) {
  const user = await tx.user.findUniqueOrThrow({
    where: { id: userId },
    select: publicSelect,
  });
  const records = await gameRecords(tx, user, now);
  const habits: ReportHabit[] = records.evaluated.map(({ habit: h }) => ({
    id: h.id,
    title: h.title,
    schedules: h.schedules.map((s) => ({
      from: dateOnly(s.effectiveFrom),
      until: s.effectiveUntil ? dateOnly(s.effectiveUntil) : null,
      rule: recurrenceOf(s),
    })),
    pauses: h.pauses.map((p) => ({
      from: dateOnly(p.fromDate),
      until: p.untilDate ? dateOnly(p.untilDate) : null,
    })),
    completions: new Set(h.completions.map((c) => dateOnly(c.scheduledDate))),
    freezes: new Set(h.freezeUses.map((f) => dateOnly(f.scheduledDate))),
  }));
  return { user, records, habits, today: localDate(now, user.timezone) };
}
export async function analyticsReport(
  deps: AppDependencies,
  userId: string,
  input: { from?: string; to?: string },
  focusId?: string,
): Promise<
  Analytics & {
    history?: {
      date: string;
      completed: boolean;
      completedAt: string;
      undoneAt: string | null;
      timezone: string;
    }[];
  }
> {
  return deps.database().$transaction(
    async (tx) => {
      const { user, records, habits, today } = await reportSource(
        tx,
        userId,
        deps.now(),
      );
      const { from, to } = reportRange(today, input);
      if (focusId && !habits.some((h) => h.id === focusId))
        throw new ApiError(404, "NOT_FOUND", "Habit not found.");
      const selected = focusId
        ? habits.filter((h) => h.id === focusId)
        : habits;
      const xpDays = await tx.$queryRaw<
        { date: string; habitId: string | null; amount: bigint }[]
      >`
        SELECT to_char(x."createdAt" AT TIME ZONE ${user.timezone},'YYYY-MM-DD') AS date,c."habitId" AS "habitId",sum(x.amount)::bigint AS amount
        FROM "XpTransaction" x LEFT JOIN "CompletionRewardEvent" e ON e.id=x."rewardEventId"
        LEFT JOIN "CompletionReward" r ON r.id=e."rewardId" LEFT JOIN "HabitCompletion" c ON c.id=coalesce(r."completionId",x."completionId")
        WHERE x."userId"=${userId}::uuid AND x."createdAt">=(${from}::date::timestamp AT TIME ZONE ${user.timezone})
        AND x."createdAt"<((${to}::date+1)::timestamp AT TIME ZONE ${user.timezone}) GROUP BY 1,2 ORDER BY 1`;
      const xpMap = new Map<string, number>();
      const habitXp = new Map<string, number>();
      for (const row of xpDays) {
        const amount = safe(row.amount);
        xpMap.set(row.date, (xpMap.get(row.date) ?? 0) + amount);
        if (row.habitId) habitXp.set(`${row.habitId}:${row.date}`, amount);
      }
      const dates = rangeDays(from, to);
      const daily = dates.map((date) => {
        const value = dayPeriod(selected, date, today, xpMap.get(date) ?? 0);
        return {
          ...value,
          intensity:
            value.completed === 0
              ? 0
              : value.completed === 1
                ? 1
                : value.completed <= 3
                  ? 2
                  : value.completed <= 6
                    ? 3
                    : 4,
        };
      });
      const sums = daily.reduce(
        (a, d) => ({
          completed: a.completed + d.completed,
          scheduled: a.scheduled + d.scheduled,
          assessed: a.assessed + d.assessed,
          pending: a.pending + d.pending,
          frozen: a.frozen + d.frozen,
        }),
        { completed: 0, scheduled: 0, assessed: 0, pending: 0, frozen: 0 },
      );
      const money = (
        await tx.$queryRaw<
          {
            earned: bigint;
            spent: bigint;
            refunded: bigint;
            adjustments: bigint;
            balance: bigint;
          }[]
        >`SELECT coalesce(sum(amount) FILTER (WHERE "rewardEventId" IS NOT NULL OR "completionId" IS NOT NULL),0)::bigint AS earned,coalesce(-sum(amount) FILTER (WHERE "redemptionId" IS NOT NULL),0)::bigint AS spent,coalesce(sum(amount) FILTER (WHERE "refundRedemptionId" IS NOT NULL),0)::bigint AS refunded,coalesce(sum(amount) FILTER (WHERE "redemptionId" IS NULL AND "refundRedemptionId" IS NULL AND "rewardEventId" IS NULL AND "completionId" IS NULL),0)::bigint AS adjustments,coalesce(sum(amount),0)::bigint AS balance FROM "CoinTransaction" WHERE "userId"=${userId}::uuid`
      )[0]!;
      const xpTotal = (
        await tx.$queryRaw<
          { amount: bigint }[]
        >`SELECT coalesce(sum(amount),0)::bigint AS amount FROM "XpTransaction" WHERE "userId"=${userId}::uuid`
      )[0]!;
      const unlocked = await tx.userAchievement.count({ where: { userId } });
      const xp = safe(xpTotal.amount);
      const history = focusId
        ? await tx.habitCompletion.findMany({
            where: {
              habitId: focusId,
              habit: { userId },
              scheduledDate: { gte: calendarDate(from), lte: calendarDate(to) },
            },
            orderBy: { scheduledDate: "desc" },
          })
        : undefined;
      return {
        ...(history
          ? {
              history: history.map((c) => ({
                date: dateOnly(c.scheduledDate),
                completed: c.undoneAt === null,
                completedAt: c.completedAt.toISOString(),
                undoneAt: c.undoneAt?.toISOString() ?? null,
                timezone: c.timezone,
              })),
            }
          : {}),
        from,
        to,
        today,
        timezone: user.timezone,
        overview: {
          ...sums,
          rate: rateOf(sums.completed, sums.assessed),
          currentStreak: Math.max(
            0,
            ...records.evaluated.map((h) => h.stats.current),
          ),
          longestStreak: Math.max(
            0,
            ...records.evaluated.map((h) => h.stats.longest),
          ),
          lifetimeCompletions: records.evaluated.reduce(
            (n, h) => n + h.habit.completions.length,
            0,
          ),
          xp,
          level: levelProgress(xp).level,
          coinsEarned: safe(money.earned),
          coinsSpent: safe(money.spent),
          coinsRefunded: safe(money.refunded),
          coinAdjustments: safe(money.adjustments),
          coinBalance: safe(money.balance),
          achievementsUnlocked: unlocked,
        },
        daily,
        weekly: groupPeriods(daily, "week"),
        monthly: groupPeriods(daily, "month"),
        habits: selected.map((h) => {
          const original = records.evaluated.find((e) => e.habit.id === h.id)!;
          const days = dates.map((date) =>
            dayPeriod([h], date, today, habitXp.get(`${h.id}:${date}`) ?? 0),
          );
          const summary = days.reduce(
            (a, d) => ({
              completed: a.completed + d.completed,
              scheduled: a.scheduled + d.scheduled,
              assessed: a.assessed + d.assessed,
              pending: a.pending + d.pending,
              frozen: a.frozen + d.frozen,
            }),
            { completed: 0, scheduled: 0, assessed: 0, pending: 0, frozen: 0 },
          );
          return {
            id: h.id,
            title: h.title,
            category: original.habit.category,
            archived: original.habit.archivedAt !== null,
            ...summary,
            rate: rateOf(summary.completed, summary.assessed),
            currentStreak: original.stats.current,
            longestStreak: original.stats.longest,
            weekly: groupPeriods(days, "week"),
            monthly: groupPeriods(days, "month"),
          };
        }),
      };
    },
    { isolationLevel: "RepeatableRead", timeout: 20000 },
  );
}
export async function dayDetails(
  deps: AppDependencies,
  userId: string,
  date: string,
): Promise<DayDetails> {
  return deps.database().$transaction(
    async (tx) => {
      const source = await reportSource(tx, userId, deps.now());
      if (date > source.today)
        throw new ApiError(
          400,
          "FUTURE_DATE",
          "Choose a closed or current local date.",
        );
      return { date, sessions: sessionsOn(source.habits, date, source.today) };
    },
    { isolationLevel: "RepeatableRead", timeout: 20000 },
  );
}
