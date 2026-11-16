import type { Recurrence } from "@habitquest/shared";
import type { HabitScheduleVersion } from "./generated/prisma/client.js";
/** Calendar arithmetic uses date-only UTC values, never elapsed hours in a timezone. */
export function localDate(now: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (name: string) => parts.find((p) => p.type === name)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export const dateOnly = (date: Date) => date.toISOString().slice(0, 10);
export const calendarDate = (date: string) => new Date(`${date}T00:00:00.000Z`);
export function addDays(date: string, days: number) {
  const next = calendarDate(date);
  next.setUTCDate(next.getUTCDate() + days);
  return dateOnly(next);
}
export function recurrenceOf(schedule: HabitScheduleVersion): Recurrence {
  if (schedule.kind === "DAILY") return { kind: "DAILY" };
  if (schedule.kind === "INTERVAL")
    return {
      kind: "INTERVAL",
      intervalDays: schedule.intervalDays!,
      anchorDate: dateOnly(schedule.anchorDate!),
    };
  return { kind: "WEEKDAYS", weekdays: schedule.weekdays };
}
export function isDue(rule: Recurrence, date: string): boolean {
  if (rule.kind === "DAILY") return true;
  if (rule.kind === "WEEKDAYS")
    return rule.weekdays.includes(calendarDate(date).getUTCDay() || 7);
  const difference =
    (calendarDate(date).getTime() - calendarDate(rule.anchorDate).getTime()) /
    86400000;
  return difference >= 0 && difference % rule.intervalDays === 0;
}
export function scheduleData(rule: Recurrence) {
  return {
    kind: rule.kind,
    weekdays:
      rule.kind === "DAILY"
        ? [1, 2, 3, 4, 5, 6, 7]
        : rule.kind === "WEEKDAYS"
          ? [...rule.weekdays].sort()
          : [],
    intervalDays: rule.kind === "INTERVAL" ? rule.intervalDays : null,
    anchorDate: rule.kind === "INTERVAL" ? calendarDate(rule.anchorDate) : null,
  };
}
export function effectiveSchedule(
  schedules: HabitScheduleVersion[],
  date: string,
) {
  return schedules.find(
    (s) =>
      dateOnly(s.effectiveFrom) <= date &&
      (!s.effectiveUntil || date < dateOnly(s.effectiveUntil)),
  );
}
