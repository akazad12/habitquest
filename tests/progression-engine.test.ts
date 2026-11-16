import { describe, it, expect } from "vitest";
import {
  streaks,
  completionReward,
  levelProgress,
  eligibleAchievements,
  freezeEligible,
  type CalendarSchedule,
} from "../apps/api/src/progression/engine.js";
import { addDays, localDate } from "../apps/api/src/scheduling.js";
const daily: CalendarSchedule = {
  from: "2026-11-01",
  until: null,
  rule: { kind: "DAILY" },
};
const dates = (first: string, count: number, step = 1) =>
  Array.from({ length: count }, (_, i) => addDays(first, i * step));
describe("schedule-aware streaks", () => {
  it("counts completed daily occurrences and keeps the pending day alive", () => {
    expect(
      streaks({
        schedules: [daily],
        asOf: "2026-11-04",
        completions: dates("2026-11-01", 3),
      }),
    ).toMatchObject({ current: 3, longest: 3, missed: [] });
  });
  it("breaks only after a scheduled day ends, and preserves the longest streak", () => {
    expect(
      streaks({
        schedules: [daily],
        asOf: "2026-11-06",
        completions: ["2026-11-01", "2026-11-02", "2026-11-04", "2026-11-05"],
      }),
    ).toMatchObject({ current: 2, longest: 2, missed: ["2026-11-03"] });
    expect(
      streaks({
        schedules: [daily],
        asOf: "2026-11-07",
        completions: dates("2026-11-01", 3),
      }).current,
    ).toBe(0);
  });
  it("ignores weekday rest days", () => {
    const schedule = {
      ...daily,
      rule: { kind: "WEEKDAYS" as const, weekdays: [1, 3, 5] },
    };
    expect(
      streaks({
        schedules: [schedule],
        asOf: "2026-11-09",
        completions: ["2026-11-02", "2026-11-04", "2026-11-06"],
      }),
    ).toMatchObject({ current: 3, longest: 3, missed: [] });
  });
  it("counts every-N-day occurrences relative to the anchor", () => {
    const schedule = {
      ...daily,
      rule: {
        kind: "INTERVAL" as const,
        intervalDays: 3,
        anchorDate: "2026-11-02",
      },
    };
    expect(
      streaks({
        schedules: [schedule],
        asOf: "2026-11-11",
        completions: ["2026-11-02", "2026-11-05", "2026-11-08"],
      }),
    ).toMatchObject({ current: 3, longest: 3, missed: [] });
  });
  it("does not invent occurrences before an interval anchor", () =>
    expect(
      streaks({
        schedules: [
          {
            ...daily,
            rule: {
              kind: "INTERVAL",
              intervalDays: 2,
              anchorDate: "2026-11-20",
            },
          },
        ],
        asOf: "2026-11-10",
        completions: [],
      }),
    ).toMatchObject({ current: 0, longest: 0, missed: [] }));
  it("respects exclusive version boundaries and continuity across changed rules", () => {
    const versions: CalendarSchedule[] = [
      { from: "2026-11-02", until: "2026-11-04", rule: { kind: "DAILY" } },
      {
        from: "2026-11-04",
        until: null,
        rule: { kind: "WEEKDAYS", weekdays: [3, 5] },
      },
    ];
    expect(
      streaks({
        schedules: versions,
        asOf: "2026-11-07",
        completions: ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-06"],
      }),
    ).toMatchObject({ current: 4, longest: 4, missed: [] });
  });
  it("skips schedule gaps rather than fabricating misses", () =>
    expect(
      streaks({
        schedules: [
          { ...daily, until: "2026-11-03" },
          { ...daily, from: "2026-11-07" },
        ],
        asOf: "2026-11-08",
        completions: ["2026-11-01", "2026-11-02", "2026-11-07"],
      }),
    ).toMatchObject({ current: 3, longest: 3, missed: [] }));
  it("lets a freeze bridge one miss without increasing the streak", () =>
    expect(
      streaks({
        schedules: [daily],
        asOf: "2026-11-05",
        completions: ["2026-11-01", "2026-11-02", "2026-11-04"],
        freezes: ["2026-11-03"],
      }),
    ).toMatchObject({
      current: 3,
      longest: 3,
      missed: [],
      frozen: ["2026-11-03"],
    }));
  it("does not turn freezes on rest days into streak progress", () =>
    expect(
      streaks({
        schedules: [{ ...daily, rule: { kind: "WEEKDAYS", weekdays: [1] } }],
        asOf: "2026-11-09",
        completions: ["2026-11-02"],
        freezes: ["2026-11-03"],
      }),
    ).toMatchObject({ current: 1, longest: 1, frozen: [] }));
  it("retains archive history, counts completed archive-boundary days, and skips pauses after reactivation", () => {
    expect(
      streaks({
        schedules: [daily],
        asOf: "2026-11-15",
        completions: dates("2026-11-01", 3),
        pauses: [{ from: "2026-11-03", until: null }],
      }),
    ).toMatchObject({ current: 3, longest: 3, missed: [] });
    expect(
      streaks({
        schedules: [daily],
        asOf: "2026-11-08",
        completions: ["2026-11-01", "2026-11-02", "2026-11-07"],
        pauses: [{ from: "2026-11-03", until: "2026-11-07" }],
      }),
    ).toMatchObject({ current: 3, longest: 3, missed: [] });
  });
  it("does not count future local-date records after moving timezones backward", () =>
    expect(
      streaks({
        schedules: [daily],
        asOf: "2026-11-02",
        completions: dates("2026-11-01", 3),
      }).current,
    ).toBe(2));
  it("uses local date semantics through DST and date-line boundaries", () => {
    const before = localDate(
      new Date("2026-11-01T05:30:00Z"),
      "America/New_York",
    );
    const after = localDate(
      new Date("2026-11-01T06:30:00Z"),
      "America/New_York",
    );
    expect(before).toBe(after);
    expect(
      streaks({
        schedules: [{ ...daily, from: "2026-10-30" }],
        asOf: after,
        completions: ["2026-10-30", "2026-10-31", "2026-11-01"],
      }).current,
    ).toBe(3);
    expect(
      localDate(new Date("2026-11-16T01:00:00Z"), "America/Los_Angeles"),
    ).toBe("2026-11-15");
    expect(
      streaks({
        schedules: [{ ...daily, from: "2026-03-07" }],
        asOf: "2026-03-10",
        completions: dates("2026-03-07", 3),
      }).current,
    ).toBe(3);
  });
});
describe("integer economy and levels", () => {
  it.each([
    ["EASY", 1, 15, 5, 0],
    ["MEDIUM", 1, 25, 10, 0],
    ["HARD", 1, 40, 15, 0],
    ["EASY", 7, 16, 5, 10],
    ["MEDIUM", 7, 27, 10, 10],
    ["HARD", 7, 44, 15, 10],
    ["EASY", 30, 18, 5, 25],
    ["MEDIUM", 30, 31, 10, 25],
    ["HARD", 30, 50, 15, 25],
  ] as const)(
    "awards %s at streak %d",
    (difficulty, streak, xp, coins, bonusPercent) =>
      expect(completionReward(difficulty, streak)).toMatchObject({
        xp,
        coins,
        bonusPercent,
      }),
  );
  it("uses the largest bonus only and rounds down once", () => {
    expect(completionReward("EASY", 29).xp).toBe(16);
    expect(completionReward("EASY", 300).xp).toBe(18);
    expect(completionReward("MEDIUM", 6).xp).toBe(25);
  });
  it.each([
    [0, 1, 0, 100],
    [99, 1, 99, 100],
    [100, 2, 0, 150],
    [249, 2, 149, 150],
    [250, 3, 0, 200],
    [450, 4, 0, 250],
  ])("maps XP %d to level %d", (xp, level, xpIntoLevel, xpForNextLevel) =>
    expect(levelProgress(xp)).toMatchObject({
      level,
      xpIntoLevel,
      xpForNextLevel,
    }),
  );
  it("handles very large safe-integer totals without floating threshold errors", () => {
    const progress = levelProgress(Number.MAX_SAFE_INTEGER);
    expect(progress.xpIntoLevel).toBeGreaterThanOrEqual(0);
    expect(progress.xpIntoLevel).toBeLessThan(progress.xpForNextLevel);
    expect(progress.xpToNextLevel).toBeGreaterThan(0);
  });
  it.each([-1, 1.5, Infinity])("rejects invalid XP %s", (value) =>
    expect(() => levelProgress(value)).toThrow(RangeError),
  );
  it("requires actual qualifying counts for each achievement", () => {
    expect(eligibleAchievements(0, 4, 6)).toEqual([]);
    expect(eligibleAchievements(1, 5, 7)).toEqual([
      "first-step",
      "consistency",
      "habit-builder",
    ]);
    expect(eligibleAchievements(100, 5, 30)).toHaveLength(5);
  });
  it("limits delayed freeze use to grant date and the previous seven closed days", () => {
    expect(freezeEligible("2026-11-09", "2026-11-16", "2026-11-01")).toBe(true);
    expect(freezeEligible("2026-11-08", "2026-11-16", "2026-11-01")).toBe(
      false,
    );
    expect(freezeEligible("2026-11-16", "2026-11-16", "2026-11-01")).toBe(
      false,
    );
    expect(freezeEligible("2026-11-14", "2026-11-16", "2026-11-15")).toBe(
      false,
    );
  });
});
