import { describe, it, expect } from "vitest";
import {
  createHabitSchema,
  localDateSchema,
  scheduleSchema,
  timezoneSchema,
  createRewardSchema,
} from "../packages/shared/src/index.js";
describe("public input contracts", () => {
  it("accepts a timezone-aware weekly schedule", () =>
    expect(
      scheduleSchema.parse({
        timezone: "America/New_York",
        effectiveFrom: "2026-11-16",
        weekdays: [1, 3, 5],
      }).weekdays,
    ).toEqual([1, 3, 5]));
  it.each([{ days: [] }, { days: [0] }, { days: [8] }, { days: [1, 1] }])(
    "rejects invalid weekday sets %j",
    ({ days }) =>
      expect(
        scheduleSchema.safeParse({
          timezone: "UTC",
          effectiveFrom: "2026-11-16",
          weekdays: days,
        }).success,
      ).toBe(false),
  );
  it("rejects unknown timezones and impossible dates", () => {
    expect(timezoneSchema.safeParse("Mars/Olympus").success).toBe(false);
    expect(localDateSchema.safeParse("2026-02-30").success).toBe(false);
  });
  it("rejects blank titles, unknown fields, and nonpositive prices", () => {
    expect(
      createHabitSchema.safeParse({
        title: "   ",
        schedule: {
          timezone: "UTC",
          effectiveFrom: "2026-11-16",
          weekdays: [1],
        },
      }).success,
    ).toBe(false);
    expect(
      createRewardSchema.safeParse({ title: "Tea", coinCost: 0 }).success,
    ).toBe(false);
    expect(
      createRewardSchema.safeParse({
        title: "Tea",
        coinCost: 3,
        userId: "spoofed",
      }).success,
    ).toBe(false);
  });
});
