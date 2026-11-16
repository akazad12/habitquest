import { describe, it, expect } from "vitest";
import { localDate, addDays, isDue } from "../apps/api/src/scheduling.js";
import {
  recurrenceSchema,
  updateHabitSchema,
  registerSchema,
} from "../packages/shared/src/index.js";
describe("timezone-aware calendar scheduling", () => {
  it("uses different local dates at the same instant", () => {
    const now = new Date("2026-11-16T01:00:00Z");
    expect(localDate(now, "America/Los_Angeles")).toBe("2026-11-15");
    expect(localDate(now, "Asia/Tokyo")).toBe("2026-11-16");
  });
  it("handles spring-forward and fall-back boundaries without elapsed-day arithmetic", () => {
    expect(
      localDate(new Date("2026-03-08T06:59:00Z"), "America/New_York"),
    ).toBe("2026-03-08");
    expect(
      localDate(new Date("2026-03-08T07:01:00Z"), "America/New_York"),
    ).toBe("2026-03-08");
    expect(
      localDate(new Date("2026-11-01T05:30:00Z"), "America/New_York"),
    ).toBe(localDate(new Date("2026-11-01T06:30:00Z"), "America/New_York"));
    expect(addDays("2026-03-08", 1)).toBe("2026-03-09");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
  it("matches daily and ISO weekday recurrence", () => {
    expect(isDue({ kind: "DAILY" }, "2026-11-16")).toBe(true);
    expect(isDue({ kind: "WEEKDAYS", weekdays: [1, 3, 5] }, "2026-11-16")).toBe(
      true,
    );
    expect(isDue({ kind: "WEEKDAYS", weekdays: [1, 3, 5] }, "2026-11-17")).toBe(
      false,
    );
    expect(isDue({ kind: "WEEKDAYS", weekdays: [7] }, "2026-11-15")).toBe(true);
  });
  it("anchors intervals to calendar dates across DST and leap days", () => {
    const rule = {
      kind: "INTERVAL" as const,
      intervalDays: 2,
      anchorDate: "2026-03-07",
    };
    expect(isDue(rule, "2026-03-05")).toBe(false);
    expect(isDue(rule, "2026-03-07")).toBe(true);
    expect(isDue(rule, "2026-03-08")).toBe(false);
    expect(isDue(rule, "2026-03-09")).toBe(true);
    expect(
      isDue(
        { kind: "INTERVAL", intervalDays: 2, anchorDate: "2028-02-28" },
        "2028-03-01",
      ),
    ).toBe(true);
  });
  it.each([
    { kind: "WEEKDAYS", weekdays: [] },
    { kind: "WEEKDAYS", weekdays: [1, 1] },
    { kind: "INTERVAL", intervalDays: 0, anchorDate: "2026-11-16" },
    { kind: "INTERVAL", intervalDays: 2, anchorDate: "2026-02-30" },
    { kind: "DAILY", userId: "spoofed" },
  ])("rejects invalid recurrence %j", (rule) =>
    expect(recurrenceSchema.safeParse(rule).success).toBe(false),
  );
  it("does not inject defaults into partial edits", () =>
    expect(updateHabitSchema.parse({ title: "Read more" })).toEqual({
      title: "Read more",
    }));
  it("rejects weak registration passwords", () =>
    expect(
      registerSchema.safeParse({
        email: "test@example.test",
        displayName: "Reader",
        password: "short",
        timezone: "UTC",
      }).success,
    ).toBe(false));
});
