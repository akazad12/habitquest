import type {
  AnalyticsPeriod,
  DayDetails,
  Recurrence,
} from "@habitquest/shared";
import { addDays, calendarDate, dateOnly, isDue } from "../scheduling.js";
export type ReportHabit = {
  id: string;
  title: string;
  schedules: { from: string; until: string | null; rule: Recurrence }[];
  pauses: { from: string; until: string | null }[];
  completions: Set<string>;
  freezes: Set<string>;
};
export function sessionsOn(
  habits: ReportHabit[],
  date: string,
  today: string,
): DayDetails["sessions"] {
  const sessions: DayDetails["sessions"] = [];
  for (const h of habits) {
    const version = h.schedules.find(
      (v) => v.from <= date && (!v.until || date < v.until),
    );
    if (!version || !isDue(version.rule, date)) continue;
    const completed = h.completions.has(date);
    if (
      !completed &&
      h.pauses.some((p) => p.from <= date && (!p.until || date < p.until))
    )
      continue;
    sessions.push({
      habitId: h.id,
      title: h.title,
      status: completed
        ? "COMPLETED"
        : h.freezes.has(date)
          ? "FROZEN"
          : date === today
            ? "PENDING"
            : "MISSED",
    });
  }
  return sessions;
}
export const rateOf = (completed: number, assessed: number) =>
  assessed ? Math.round((completed * 10000) / assessed) / 100 : null;
export function dayPeriod(
  habits: ReportHabit[],
  date: string,
  today: string,
  xp = 0,
): AnalyticsPeriod {
  const sessions = sessionsOn(habits, date, today);
  const completed = sessions.filter((s) => s.status === "COMPLETED").length;
  const pending = date === today ? sessions.length - completed : 0;
  const assessed = sessions.length - pending;
  return {
    period: date,
    completed,
    scheduled: sessions.length,
    assessed,
    pending,
    frozen: sessions.filter((s) => s.status === "FROZEN").length,
    rate: rateOf(completed, assessed),
    xp,
  };
}
export function rangeDays(from: string, to: string) {
  const days: string[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) days.push(day);
  return days;
}
export function groupPeriods(
  daily: AnalyticsPeriod[],
  unit: "week" | "month",
): AnalyticsPeriod[] {
  const groups = new Map<string, AnalyticsPeriod>();
  for (const day of daily) {
    const weekday = calendarDate(day.period).getUTCDay() || 7;
    const key =
      unit === "week"
        ? addDays(day.period, 1 - weekday)
        : day.period.slice(0, 7) + "-01";
    const row = groups.get(key) ?? {
      period: key,
      completed: 0,
      scheduled: 0,
      assessed: 0,
      pending: 0,
      frozen: 0,
      rate: null,
      xp: 0,
    };
    for (const field of [
      "completed",
      "scheduled",
      "assessed",
      "pending",
      "frozen",
      "xp",
    ] as const)
      row[field] += day[field];
    row.rate = rateOf(row.completed, row.assessed);
    groups.set(key, row);
  }
  return [...groups.values()];
}
export function defaultReportStart(today: string) {
  const date = calendarDate(today);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCFullYear(date.getUTCFullYear() - 1);
  const max = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
  ).getUTCDate();
  date.setUTCDate(Math.min(day, max));
  return addDays(dateOnly(date), 1);
}
