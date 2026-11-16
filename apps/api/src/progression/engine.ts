import type { Difficulty } from "../generated/prisma/client.js";
import type { Recurrence } from "@habitquest/shared";
import { addDays, isDue } from "../scheduling.js";
export type CalendarSchedule = {
  from: string;
  until: string | null;
  rule: Recurrence;
};
export type CalendarPause = { from: string; until: string | null };
export type StreakInput = {
  asOf: string;
  schedules: CalendarSchedule[];
  completions: readonly string[];
  freezes?: readonly string[];
  pauses?: CalendarPause[];
};
/** A streak counts real completions; freezes bridge a miss without incrementing it. */
export function streaks(input: StreakInput) {
  const completions = new Set(input.completions);
  const freezes = new Set(input.freezes ?? []);
  let current = 0;
  let longest = 0;
  const missed: string[] = [];
  const frozen: string[] = [];
  const schedules = [...input.schedules].sort((a, b) =>
    a.from.localeCompare(b.from),
  );
  for (const schedule of schedules) {
    const end =
      schedule.until && schedule.until <= input.asOf
        ? addDays(schedule.until, -1)
        : input.asOf;
    for (let date = schedule.from; date <= end; date = addDays(date, 1)) {
      if (!isDue(schedule.rule, date)) continue;
      // Confirmed boundary-day completions still count when archiving cancels the pending day.
      const completed = completions.has(date);
      const paused = (input.pauses ?? []).some(
        (p) => p.from <= date && (!p.until || date < p.until),
      );
      if (paused && !completed) continue;
      if (completed) {
        current++;
        longest = Math.max(longest, current);
      } else if (freezes.has(date)) {
        frozen.push(date);
      } else if (date < input.asOf) {
        missed.push(date);
        current = 0;
      }
      // The current local day remains pending until it closes.
    }
  }
  return { current, longest, missed, frozen };
}
export function completionReward(difficulty: Difficulty, streak: number) {
  const baseXp = { EASY: 15, MEDIUM: 25, HARD: 40 }[difficulty];
  const coins = { EASY: 5, MEDIUM: 10, HARD: 15 }[difficulty];
  const bonusPercent = streak >= 30 ? 25 : streak >= 7 ? 10 : 0;
  return {
    difficulty,
    baseXp,
    bonusPercent,
    xp: Math.floor((baseXp * (100 + bonusPercent)) / 100),
    coins,
    streakAtAward: streak,
  };
}
/** Level 1 starts at zero; crossing level L costs 100 + 50*(L-1) XP. */
export function levelProgress(xp: number) {
  if (!Number.isSafeInteger(xp) || xp < 0)
    throw new RangeError("XP must be a nonnegative safe integer");
  const value = BigInt(xp);
  const threshold = (level: bigint) => 25n * (level - 1n) * (level + 2n);
  let low = 1n;
  let high = 2n;
  while (threshold(high) <= value) high *= 2n;
  while (low + 1n < high) {
    const middle = (low + high) / 2n;
    if (threshold(middle) <= value) low = middle;
    else high = middle;
  }
  const into = value - threshold(low);
  const required = 100n + 50n * (low - 1n);
  return {
    level: Number(low),
    xpIntoLevel: Number(into),
    xpForNextLevel: Number(required),
    xpToNextLevel: Number(required - into),
    levelPercent: Number((into * 100n) / required),
  };
}
export function freezeEligible(date: string, today: string, grantDate: string) {
  return date >= grantDate && date >= addDays(today, -7) && date < today;
}
export const ACHIEVEMENT_KEYS = [
  "first-step",
  "consistency",
  "dedicated",
  "century-club",
  "habit-builder",
] as const;
export function eligibleAchievements(
  completions: number,
  habits: number,
  longest: number,
) {
  return ACHIEVEMENT_KEYS.filter(
    (key) =>
      ({
        "first-step": completions >= 1,
        consistency: longest >= 7,
        dedicated: longest >= 30,
        "century-club": completions >= 100,
        "habit-builder": habits >= 5,
      })[key],
  );
}
