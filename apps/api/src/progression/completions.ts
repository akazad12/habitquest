import type { CompletionReceipt } from "@habitquest/shared";
import type { HabitCompletion } from "../generated/prisma/client.js";
import { ApiError } from "../errors.js";
import { lockUser, type AppDependencies } from "../auth.js";
import {
  calendarDate,
  dateOnly,
  localDate,
  effectiveSchedule,
  recurrenceOf,
  isDue,
} from "../scheduling.js";
import { completionReward } from "./engine.js";
import {
  progressionSnapshot,
  gameRecords,
  rewardEvent,
  reconcileAchievements,
} from "./service.js";
const completionDto = (row: HabitCompletion | null) =>
  row
    ? {
        id: row.id,
        scheduledDate: dateOnly(row.scheduledDate),
        completedAt: row.completedAt.toISOString(),
        undoneAt: row.undoneAt?.toISOString() ?? null,
      }
    : null;
export async function mutateCompletion(
  deps: AppDependencies,
  userId: string,
  habitId: string,
  date: string,
  complete: boolean,
): Promise<CompletionReceipt> {
  return deps.database().$transaction(
    async (tx) => {
      const user = await lockUser(tx, userId);
      const now = deps.now();
      const today = localDate(now, user.timezone);
      const habit = await tx.habit.findFirst({
        where: { id: habitId, userId },
        include: { schedules: true },
      });
      if (!habit) throw new ApiError(404, "NOT_FOUND", "Habit not found.");
      if (date !== today)
        throw new ApiError(
          409,
          "TODAY_ONLY",
          "Only the current local date can be completed or undone. Refresh Today and try again.",
        );
      const before = await progressionSnapshot(tx, user, now);
      const priorStreak = before.habits.find(
        (h) => h.habitId === habitId,
      )!.current;
      const where = {
        habitId_scheduledDate: { habitId, scheduledDate: calendarDate(date) },
      };
      let row = await tx.habitCompletion.findUnique({ where });
      let reward = row
        ? await tx.completionReward.findUnique({
            where: { completionId: row.id },
          })
        : null;
      let changed = false;
      let restored = false;
      let deltaXp = 0;
      let deltaCoins = 0;
      if (complete) {
        if (habit.archivedAt)
          throw new ApiError(
            409,
            "HABIT_ARCHIVED",
            "Reactivate this habit before completing it.",
          );
        const schedule = effectiveSchedule(habit.schedules, date);
        if (!schedule || !isDue(recurrenceOf(schedule), date))
          throw new ApiError(
            409,
            "NOT_SCHEDULED",
            "This habit is not scheduled for today.",
          );
        const frozen = await tx.streakFreezeUse.findUnique({
          where: {
            habitId_scheduledDate: {
              habitId,
              scheduledDate: calendarDate(date),
            },
          },
        });
        if (frozen)
          throw new ApiError(
            409,
            "FROZEN_DATE",
            "A protected occurrence cannot also be completed, even after a timezone change.",
          );
        if (!row || row.undoneAt) {
          row = row
            ? await tx.habitCompletion.update({
                where,
                data: { undoneAt: null },
              })
            : await tx.habitCompletion.create({
                data: {
                  habitId,
                  scheduleVersionId: schedule.id,
                  scheduledDate: calendarDate(date),
                  completedAt: now,
                  timezone: user.timezone,
                },
              });
          if (!reward) {
            const records = await gameRecords(tx, user, now);
            const streak = records.evaluated.find(
              (h) => h.habit.id === habitId,
            )!.stats.current;
            reward = await tx.completionReward.create({
              data: {
                completionId: row.id,
                ...completionReward(habit.difficulty, streak),
                createdAt: now,
              },
            });
          } else restored = true;
          await rewardEvent(tx, user.id, reward, 1, now);
          changed = true;
          deltaXp = reward.xp;
          deltaCoins = reward.coins;
        }
        // Active pre-Phase-3 completions remain historical records; retries do not retroactively award them.
      } else if (row && !row.undoneAt) {
        if (reward) {
          if (before.coins < reward.coins || before.xp < reward.xp)
            throw new ApiError(
              409,
              "INSUFFICIENT_REVERSAL_BALANCE",
              "This award cannot be reversed without making a balance negative.",
            );
          await rewardEvent(tx, user.id, reward, -1, now);
          deltaXp = -reward.xp;
          deltaCoins = -reward.coins;
        } else if (
          (await tx.xpTransaction.count({ where: { completionId: row.id } })) ||
          (await tx.coinTransaction.count({ where: { completionId: row.id } }))
        ) {
          throw new ApiError(
            409,
            "LEGACY_REWARDED_COMPLETION",
            "This legacy award requires an audited adjustment and cannot be undone automatically.",
          );
        }
        row = await tx.habitCompletion.update({
          where,
          data: { undoneAt: now },
        });
        changed = true;
      }
      const newAchievements = await reconcileAchievements(tx, user, now);
      const progression = await progressionSnapshot(tx, user, now);
      const current = progression.habits.find(
        (h) => h.habitId === habitId,
      )!.current;
      const milestone =
        complete && changed
          ? priorStreak < 30 && current >= 30
            ? 30
            : priorStreak < 7 && current >= 7
              ? 7
              : null
          : null;
      return {
        completion: completionDto(row),
        reward: {
          changed,
          restored,
          xp: deltaXp,
          coins: deltaCoins,
          baseXp: reward?.baseXp ?? 0,
          bonusPercent: reward?.bonusPercent ?? 0,
          streak: current,
          levelBefore: before.level,
          levelAfter: progression.level,
          milestone,
          newAchievements,
        },
        progression,
      };
    },
    { maxWait: 10000, timeout: 20000 },
  );
}
