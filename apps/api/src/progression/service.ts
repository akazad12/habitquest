import type { Progression } from "@habitquest/shared";
import {
  Prisma,
  type CompletionReward,
  type Habit,
} from "../generated/prisma/client.js";
import { ApiError } from "../errors.js";
import type { AuthUser } from "../auth.js";
import {
  calendarDate,
  dateOnly,
  localDate,
  recurrenceOf,
  effectiveSchedule,
} from "../scheduling.js";
import {
  streaks,
  levelProgress,
  freezeEligible,
  eligibleAchievements,
  ACHIEVEMENT_KEYS,
} from "./engine.js";
export const gameHabitInclude = {
  schedules: true,
  completions: { where: { undoneAt: null } },
  pauses: true,
  freezeUses: true,
} as const;
export async function gameRecords(
  tx: Prisma.TransactionClient,
  user: AuthUser,
  now: Date,
) {
  const asOf = localDate(now, user.timezone);
  // Prisma's multi-relation query loader runs sibling queries concurrently on a
  // single transaction client. Read each relation sequentially in constant batches.
  const rows = await tx.habit.findMany({
    where: { userId: user.id },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const schedules = await tx.habitScheduleVersion.findMany({
    where: { habit: { userId: user.id } },
  });
  const completions = await tx.habitCompletion.findMany({
    where: { habit: { userId: user.id }, undoneAt: null },
  });
  const pauses = await tx.habitPause.findMany({
    where: { habit: { userId: user.id } },
  });
  const freezeUses = await tx.streakFreezeUse.findMany({
    where: { habit: { userId: user.id } },
  });
  function group<T extends { habitId: string }>(values: T[]) {
    const result = new Map<string, T[]>();
    for (const v of values) {
      const items = result.get(v.habitId) ?? [];
      items.push(v);
      result.set(v.habitId, items);
    }
    return result;
  }
  const s = group(schedules),
    c = group(completions),
    p = group(pauses),
    f = group(freezeUses);
  const habits = rows.map((h) => ({
    ...h,
    schedules: s.get(h.id) ?? [],
    completions: c.get(h.id) ?? [],
    pauses: p.get(h.id) ?? [],
    freezeUses: f.get(h.id) ?? [],
  }));
  const evaluated = habits.map((habit) => ({
    habit,
    stats: streaks({
      asOf,
      schedules: habit.schedules.map((s) => ({
        from: dateOnly(s.effectiveFrom),
        until: s.effectiveUntil ? dateOnly(s.effectiveUntil) : null,
        rule: recurrenceOf(s),
      })),
      completions: habit.completions.map((c) => dateOnly(c.scheduledDate)),
      freezes: habit.freezeUses.map((f) => dateOnly(f.scheduledDate)),
      pauses: habit.pauses.map((p) => ({
        from: dateOnly(p.fromDate),
        until: p.untilDate ? dateOnly(p.untilDate) : null,
      })),
    }),
  }));
  return { asOf, evaluated };
}
export async function balances(tx: Prisma.TransactionClient, userId: string) {
  const xp = await tx.xpTransaction.aggregate({
    where: { userId },
    _sum: { amount: true },
  });
  const coins = await tx.coinTransaction.aggregate({
    where: { userId },
    _sum: { amount: true },
  });
  const result = { xp: xp._sum.amount ?? 0, coins: coins._sum.amount ?? 0 };
  if (
    !Number.isSafeInteger(result.xp) ||
    !Number.isSafeInteger(result.coins) ||
    result.xp < 0 ||
    result.coins < 0
  )
    throw new ApiError(
      409,
      "BALANCE_INTEGRITY",
      "Ledger balances need an audited correction.",
    );
  return result;
}
export async function reconcileAchievements(
  tx: Prisma.TransactionClient,
  user: AuthUser,
  now: Date,
) {
  const { evaluated } = await gameRecords(tx, user, now);
  const count = evaluated.reduce(
    (total, { habit }) => total + habit.completions.length,
    0,
  );
  const longest = evaluated.reduce(
    (maximum, { stats }) => Math.max(maximum, stats.longest),
    0,
  );
  const eligible = eligibleAchievements(count, evaluated.length, longest);
  const existing = await tx.userAchievement.findMany({
    where: { userId: user.id },
    include: { achievement: true },
  });
  const known = new Set(existing.map((row) => row.achievement.key));
  const awarded: string[] = [];
  for (const key of eligible) {
    if (known.has(key)) continue;
    const achievement = await tx.achievement.findUnique({ where: { key } });
    if (!achievement)
      throw new Error("Achievement catalog migration is missing");
    await tx.userAchievement.create({
      data: { userId: user.id, achievementId: achievement.id, unlockedAt: now },
    });
    awarded.push(key);
  }
  return awarded;
}
export async function progressionSnapshot(
  tx: Prisma.TransactionClient,
  user: AuthUser,
  now: Date,
): Promise<Progression> {
  const { asOf, evaluated } = await gameRecords(tx, user, now);
  const funds = await balances(tx, user.id);
  const freezes = await tx.streakFreeze.findMany({
    where: { userId: user.id },
    include: { use: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const available = freezes.filter((f) => !f.use);
  const catalog = await tx.achievement.findMany({
    where: { key: { in: [...ACHIEVEMENT_KEYS] } },
    include: { users: { where: { userId: user.id } } },
    orderBy: { key: "asc" },
  });
  const freezeCandidates: Progression["freezeCandidates"] = [];
  if (available.length)
    for (const { habit, stats } of evaluated) {
      if (habit.archivedAt) continue;
      for (const date of stats.missed) {
        if (
          available.some((f) =>
            freezeEligible(date, asOf, dateOnly(f.grantedDate)),
          )
        )
          freezeCandidates.push({
            habitId: habit.id,
            title: habit.title,
            date,
          });
      }
    }
  freezeCandidates.sort(
    (a, b) =>
      b.date.localeCompare(a.date) || a.habitId.localeCompare(b.habitId),
  );
  return {
    asOf,
    timezone: user.timezone,
    ...funds,
    ...levelProgress(funds.xp),
    freezes: {
      available: available.length,
      maximum: 2,
      used: freezes.length - available.length,
    },
    freezeCandidates,
    habits: evaluated.map(({ habit, stats }) => ({
      habitId: habit.id,
      title: habit.title,
      archived: habit.archivedAt !== null,
      current: stats.current,
      longest: stats.longest,
      frozenDates: habit.freezeUses
        .map((f) => dateOnly(f.scheduledDate))
        .sort(),
    })),
    achievements: catalog.map((a) => ({
      key: a.key,
      title: a.title,
      description: a.description,
      unlockedAt: a.users[0]?.unlockedAt.toISOString() ?? null,
    })),
  };
}
export async function rewardEvent(
  tx: Prisma.TransactionClient,
  userId: string,
  reward: CompletionReward,
  direction: 1 | -1,
  now: Date,
) {
  if (reward.active === (direction === 1))
    throw new ApiError(
      409,
      "REWARD_STATE_CONFLICT",
      "The completion reward state changed. Refresh and try again.",
    );
  const revision = reward.revision + 1;
  const event = await tx.completionRewardEvent.create({
    data: { rewardId: reward.id, revision, direction, createdAt: now },
  });
  const source = {
    userId,
    rewardEventId: event.id,
    reason:
      direction === 1 ? "Habit completion award" : "Habit completion undo",
    createdAt: now,
  };
  // Signed, compensating entries preserve the original award and every restore/undo cycle.
  await tx.xpTransaction.create({
    data: {
      ...source,
      amount: direction * reward.xp,
      idempotencyKey: `reward:${event.id}:xp`,
    },
  });
  await tx.coinTransaction.create({
    data: {
      ...source,
      amount: direction * reward.coins,
      idempotencyKey: `reward:${event.id}:coins`,
    },
  });
  await tx.completionReward.update({
    where: { id: reward.id },
    data: { revision, active: direction === 1 },
  });
}
export async function archiveState(
  tx: Prisma.TransactionClient,
  habit: Habit,
  archived: boolean,
  today: string,
  timezone: string,
  now: Date,
) {
  if (archived === (habit.archivedAt !== null)) return;
  if (archived) {
    const previous = await tx.habitPause.findFirst({
      where: { habitId: habit.id, untilDate: { not: null } },
      orderBy: { untilDate: "desc" },
    });
    const lastEnd = previous?.untilDate ? dateOnly(previous.untilDate) : today;
    await tx.habitPause.create({
      data: {
        habitId: habit.id,
        fromDate: calendarDate(lastEnd > today ? lastEnd : today),
        timezone,
        createdAt: now,
      },
    });
  } else {
    const pause = await tx.habitPause.findFirst({
      where: { habitId: habit.id, untilDate: null },
    });
    if (!pause) throw new Error("Archived habit has no recorded pause");
    await tx.habitPause.update({
      where: { id: pause.id },
      data: {
        untilDate: calendarDate(
          today < dateOnly(pause.fromDate) ? dateOnly(pause.fromDate) : today,
        ),
      },
    });
  }
}
export async function consumeFreeze(
  tx: Prisma.TransactionClient,
  user: AuthUser,
  habitId: string,
  date: string,
  now: Date,
) {
  const habit = await tx.habit.findFirst({
    where: { id: habitId, userId: user.id },
    include: { schedules: true },
  });
  if (!habit) throw new ApiError(404, "NOT_FOUND", "Habit not found.");
  const existing = await tx.streakFreezeUse.findUnique({
    where: {
      habitId_scheduledDate: { habitId, scheduledDate: calendarDate(date) },
    },
  });
  if (existing)
    return {
      changed: false,
      newAchievements: [] as string[],
      progression: await progressionSnapshot(tx, user, now),
    };
  const today = localDate(now, user.timezone);
  const snapshot = await progressionSnapshot(tx, user, now);
  if (
    !snapshot.freezeCandidates.some(
      (c) => c.habitId === habitId && c.date === date,
    )
  )
    throw new ApiError(
      409,
      "FREEZE_INELIGIBLE",
      "Choose an uncompleted scheduled date within the last seven closed local days, on or after your freeze grant date. Archived or paused dates cannot be protected.",
    );
  const tokens = await tx.streakFreeze.findMany({
    where: { userId: user.id, use: null },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const token = tokens.find((f) =>
    freezeEligible(date, today, dateOnly(f.grantedDate)),
  );
  const version = effectiveSchedule(habit.schedules, date);
  if (!token || !version)
    throw new ApiError(
      409,
      "NO_FREEZE",
      "No eligible streak freeze is available.",
    );
  await tx.streakFreezeUse.create({
    data: {
      freezeId: token.id,
      habitId,
      scheduleVersionId: version.id,
      scheduledDate: calendarDate(date),
      timezone: user.timezone,
      usedAt: now,
    },
  });
  const newAchievements = await reconcileAchievements(tx, user, now);
  return {
    changed: true,
    newAchievements,
    progression: await progressionSnapshot(tx, user, now),
  };
}
