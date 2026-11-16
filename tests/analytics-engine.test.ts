import { describe, it, expect } from "vitest";
import {
  dayPeriod,
  defaultReportStart,
  groupPeriods,
  rangeDays,
  rateOf,
  sessionsOn,
  type ReportHabit,
} from "../apps/api/src/analytics/engine.js";
import { reportRange } from "../apps/api/src/analytics/service.js";
const habit = (patch: Partial<ReportHabit> = {}): ReportHabit => ({
  id: "h",
  title: "Read",
  schedules: [{ from: "2026-11-01", until: null, rule: { kind: "DAILY" } }],
  pauses: [],
  completions: new Set(),
  freezes: new Set(),
  ...patch,
});
describe("analytics calendar definitions", () => {
  it("uses eligible occurrences rather than rest days as the denominator", () => {
    const h = habit({
      schedules: [
        {
          from: "2026-11-01",
          until: null,
          rule: { kind: "WEEKDAYS", weekdays: [1, 3, 5] },
        },
      ],
      completions: new Set(["2026-11-02", "2026-11-04"]),
    });
    const rows = rangeDays("2026-11-02", "2026-11-08").map((d) =>
      dayPeriod([h], d, "2026-11-09"),
    );
    const week = groupPeriods(rows, "week")[0]!;
    expect(week).toMatchObject({
      completed: 2,
      scheduled: 3,
      assessed: 3,
      rate: 66.67,
    });
  });
  it("excludes unfinished today from assessed rates while counting actual completed sessions", () => {
    const a = habit({ completions: new Set(["2026-11-16"]) });
    const b = habit({ id: "b" });
    expect(dayPeriod([a, b], "2026-11-16", "2026-11-16")).toMatchObject({
      completed: 1,
      scheduled: 2,
      pending: 1,
      assessed: 1,
      rate: 100,
    });
    expect(dayPeriod([b], "2026-11-16", "2026-11-16").rate).toBeNull();
  });
  it("keeps freezes distinct from completions and includes closed frozen occurrences in rates", () => {
    const h = habit({ freezes: new Set(["2026-11-15"]) });
    expect(dayPeriod([h], "2026-11-15", "2026-11-16")).toMatchObject({
      completed: 0,
      scheduled: 1,
      assessed: 1,
      frozen: 1,
      rate: 0,
    });
    expect(sessionsOn([h], "2026-11-15", "2026-11-16")[0]!.status).toBe(
      "FROZEN",
    );
  });
  it("respects custom interval anchors", () => {
    const h = habit({
      schedules: [
        {
          from: "2026-11-01",
          until: null,
          rule: { kind: "INTERVAL", anchorDate: "2026-11-02", intervalDays: 3 },
        },
      ],
    });
    expect(
      rangeDays("2026-11-01", "2026-11-10")
        .map((d) => dayPeriod([h], d, "2026-11-11").scheduled)
        .reduce((a, b) => a + b, 0),
    ).toBe(3);
  });
  it("respects schedule version boundaries", () => {
    const h = habit({
      schedules: [
        { from: "2026-11-01", until: "2026-11-04", rule: { kind: "DAILY" } },
        {
          from: "2026-11-04",
          until: null,
          rule: { kind: "WEEKDAYS", weekdays: [5] },
        },
      ],
    });
    expect(
      rangeDays("2026-11-01", "2026-11-08")
        .map((d) => dayPeriod([h], d, "2026-11-09").scheduled)
        .reduce((a, b) => a + b, 0),
    ).toBe(4);
  });
  it("skips archived pauses but preserves verified archive-boundary completions", () => {
    const h = habit({
      pauses: [{ from: "2026-11-03", until: "2026-11-07" }],
      completions: new Set(["2026-11-03"]),
    });
    expect(dayPeriod([h], "2026-11-03", "2026-11-09").completed).toBe(1);
    expect(dayPeriod([h], "2026-11-04", "2026-11-09").scheduled).toBe(0);
    expect(dayPeriod([h], "2026-11-07", "2026-11-09").scheduled).toBe(1);
  });
  it("weights weekly and monthly rates by session counts instead of averaging percentages", () => {
    const rows = [
      {
        period: "2026-11-02",
        completed: 1,
        scheduled: 1,
        assessed: 1,
        pending: 0,
        frozen: 0,
        rate: 100,
        xp: 25,
      },
      {
        period: "2026-11-03",
        completed: 0,
        scheduled: 9,
        assessed: 9,
        pending: 0,
        frozen: 0,
        rate: 0,
        xp: -25,
      },
    ];
    expect(groupPeriods(rows, "week")[0]).toMatchObject({
      completed: 1,
      assessed: 10,
      rate: 10,
      xp: 0,
    });
    expect(groupPeriods(rows, "month")[0]!.rate).toBe(10);
  });
  it("returns null rates rather than fabricated percentages for empty periods", () =>
    expect(rateOf(0, 0)).toBeNull());
  it("generates a leap-safe rolling year bounded to 366 dates", () => {
    const from = defaultReportStart("2028-02-29");
    expect(from).toBe("2027-03-01");
    expect(rangeDays(from, "2028-02-29")).toHaveLength(366);
  });
  it.each([
    { from: "2026-11-17", to: "2026-11-16" },
    { from: "2020-01-01", to: "2026-11-16" },
    { to: "2026-11-17" },
  ])("rejects invalid or future report range %j", (input) =>
    expect(() => reportRange("2026-11-16", input)).toThrow(),
  );
});
