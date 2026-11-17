import { mutateCompletion } from "./progression/completions.js";
import { archiveState, reconcileAchievements } from "./progression/service.js";
import { Router } from "express";
import { z } from "zod";
import {
  createHabitSchema,
  updateHabitSchema,
  localDateSchema,
  markCompletionSchema,
  type HabitRecord,
  type Recurrence,
} from "@habitquest/shared";
import {
  Prisma,
  type Habit,
  type HabitScheduleVersion,
} from "./generated/prisma/client.js";
import { requireAuth, lockUser, type AppDependencies } from "./auth.js";
import { ApiError } from "./errors.js";
import {
  addDays,
  localDate,
  dateOnly,
  calendarDate,
  effectiveSchedule,
  recurrenceOf,
  isDue,
  scheduleData,
} from "./scheduling.js";
type HabitWithSchedules = Habit & { schedules: HabitScheduleVersion[] };
const withSchedules = {
  schedules: { orderBy: { effectiveFrom: "asc" as const } },
};
export function habitRecord(
  habit: HabitWithSchedules,
  today: string,
): HabitRecord {
  const current =
    effectiveSchedule(habit.schedules, today) ?? habit.schedules[0];
  if (!current) throw new Error("Habit without a schedule");
  const pending = habit.schedules.find(
    (s) => dateOnly(s.effectiveFrom) > today,
  );
  return {
    id: habit.id,
    title: habit.title,
    description: habit.description,
    category: habit.category as HabitRecord["category"],
    difficulty: habit.difficulty,
    createdAt: habit.createdAt.toISOString(),
    archivedAt: habit.archivedAt?.toISOString() ?? null,
    schedule: recurrenceOf(current),
    scheduleEffectiveFrom: dateOnly(current.effectiveFrom),
    pendingSchedule: pending
      ? {
          schedule: recurrenceOf(pending),
          effectiveFrom: dateOnly(pending.effectiveFrom),
        }
      : null,
  };
}
async function owned(tx: Prisma.TransactionClient, userId: string, id: string) {
  const habit = await tx.habit.findFirst({
    where: { id, userId },
    include: withSchedules,
  });
  if (!habit) throw new ApiError(404, "NOT_FOUND", "Habit not found.");
  return habit;
}
async function changeSchedule(
  tx: Prisma.TransactionClient,
  habit: HabitWithSchedules,
  rule: Recurrence,
  today: string,
  timezone: string,
) {
  const start = addDays(today, 1);
  const future = habit.schedules.filter(
    (s) => dateOnly(s.effectiveFrom) >= start,
  );
  const recorded = await tx.habitCompletion.count({
    where: { scheduleVersionId: { in: future.map((s) => s.id) } },
  });
  const laterCompletions = await tx.habitCompletion.count({
    where: { habitId: habit.id, scheduledDate: { gte: calendarDate(start) } },
  });
  const laterFreezes = await tx.streakFreezeUse.count({
    where: { habitId: habit.id, scheduledDate: { gte: calendarDate(start) } },
  });
  const protectedDates = await tx.streakFreezeUse.count({
    where: { scheduleVersionId: { in: future.map((s) => s.id) } },
  });
  if (recorded || protectedDates || laterCompletions || laterFreezes)
    throw new ApiError(
      409,
      "SCHEDULE_HISTORY_CONFLICT",
      "A timezone change has placed recorded history ahead of today. Try editing on a later local date.",
    );
  // Only unstarted versions with no completion history may be replaced.
  await tx.habitScheduleVersion.deleteMany({
    where: { habitId: habit.id, effectiveFrom: { gte: calendarDate(start) } },
  });
  const current = effectiveSchedule(habit.schedules, today);
  if (current)
    await tx.habitScheduleVersion.update({
      where: { id: current.id },
      data: { effectiveUntil: calendarDate(start) },
    });
  await tx.habitScheduleVersion.create({
    data: {
      habitId: habit.id,
      timezone,
      effectiveFrom: calendarDate(start),
      ...scheduleData(rule),
    },
  });
}
export function habitsRouter(deps: AppDependencies) {
  const router = Router();
  router.use(requireAuth(deps));
  const idOf = (value: unknown) => z.uuid().parse(value);
  router.get("/today", async (req, res) => {
    const user = req.auth!.user;
    const date = localDate(deps.now(), user.timezone);
    const rows = await deps.database().$transaction(
      async (tx) => {
        const habits = await tx.habit.findMany({
          where: { userId: user.id, archivedAt: null },
          include: withSchedules,
          orderBy: { createdAt: "asc" },
        });
        const completions = await tx.habitCompletion.findMany({
          where: {
            habit: { userId: user.id, archivedAt: null },
            scheduledDate: calendarDate(date),
            undoneAt: null,
          },
          select: { habitId: true },
        });
        const completed = new Set(completions.map((c) => c.habitId));
        return habits.map((h) => ({
          ...h,
          completions: completed.has(h.id) ? [true] : [],
        }));
      },
      { isolationLevel: "RepeatableRead" },
    );
    const habits = rows
      .filter((h) => {
        const schedule = effectiveSchedule(h.schedules, date);
        return schedule && isDue(recurrenceOf(schedule), date);
      })
      .map((h) => ({
        ...habitRecord(h, date),
        completed: h.completions.length > 0,
      }));
    const completed = habits.filter((h) => h.completed).length;
    const total = habits.length;
    res.json({
      date,
      timezone: user.timezone,
      habits,
      completed,
      total,
      percentage: total ? Math.round((completed / total) * 100) : 0,
    });
  });
  router.get("/", async (req, res) => {
    const filter = z
      .enum(["active", "archived", "all"])
      .default("active")
      .parse(req.query.status);
    const user = req.auth!.user;
    const date = localDate(deps.now(), user.timezone);
    const habits = await deps.database().habit.findMany({
      where: {
        userId: user.id,
        ...(filter === "all"
          ? {}
          : { archivedAt: filter === "active" ? null : { not: null } }),
      },
      include: withSchedules,
      orderBy: { createdAt: "desc" },
    });
    res.json({ habits: habits.map((h) => habitRecord(h, date)) });
  });
  router.post("/", async (req, res) => {
    const input = createHabitSchema.parse(req.body);
    const habit = await deps.database().$transaction(async (tx) => {
      const user = await lockUser(tx, req.auth!.user.id);
      const today = localDate(deps.now(), user.timezone);
      const habit = await tx.habit.create({
        data: {
          userId: user.id,
          title: input.title,
          description: input.description || null,
          category: input.category,
          difficulty: input.difficulty,
          schedules: {
            create: {
              timezone: user.timezone,
              effectiveFrom: calendarDate(today),
              ...scheduleData(input.schedule),
            },
          },
        },
        include: withSchedules,
      });
      await reconcileAchievements(tx, user, deps.now());
      return habitRecord(habit, today);
    });
    res.status(201).json({ habit });
  });
  router.get("/:id", async (req, res) => {
    const id = idOf(req.params.id);
    const user = req.auth!.user;
    const habit = await owned(deps.database(), user.id, id);
    res.json({
      habit: habitRecord(habit, localDate(deps.now(), user.timezone)),
    });
  });
  router.patch("/:id", async (req, res) => {
    const id = idOf(req.params.id);
    const input = updateHabitSchema.parse(req.body);
    const habit = await deps.database().$transaction(async (tx) => {
      const user = await lockUser(tx, req.auth!.user.id);
      const today = localDate(deps.now(), user.timezone);
      const habit = await owned(tx, user.id, id);
      if (input.archived !== undefined)
        await archiveState(
          tx,
          habit,
          input.archived,
          today,
          user.timezone,
          deps.now(),
        );
      if (input.schedule)
        await changeSchedule(tx, habit, input.schedule, today, user.timezone);
      const updated = await tx.habit.update({
        where: { id },
        data: {
          title: input.title,
          description:
            input.description === undefined
              ? undefined
              : input.description || null,
          category: input.category,
          difficulty: input.difficulty,
          archivedAt:
            input.archived === undefined
              ? undefined
              : input.archived
                ? deps.now()
                : null,
        },
        include: withSchedules,
      });
      return habitRecord(updated, today);
    });
    res.json({ habit });
  });
  router.delete("/:id", async (req, res) => {
    const id = idOf(req.params.id);
    await deps.database().$transaction(async (tx) => {
      const user = await lockUser(tx, req.auth!.user.id);
      const habit = await owned(tx, user.id, id);
      const now = deps.now();
      await archiveState(
        tx,
        habit,
        true,
        localDate(now, user.timezone),
        user.timezone,
        now,
      );
      if (!habit.archivedAt)
        await tx.habit.update({ where: { id }, data: { archivedAt: now } });
    });
    res.status(204).end();
  });
  router.post("/:id/completions", async (req, res) => {
    const id = idOf(req.params.id);
    const input = markCompletionSchema.parse(req.body);
    res.json(
      await mutateCompletion(
        deps,
        req.auth!.user.id,
        id,
        input.scheduledDate,
        true,
      ),
    );
  });
  router.delete("/:id/completions/:date", async (req, res) => {
    const id = idOf(req.params.id);
    const date = localDateSchema.parse(req.params.date);
    const result = await mutateCompletion(
      deps,
      req.auth!.user.id,
      id,
      date,
      false,
    );
    if (req.get("Prefer") === "return=representation") {
      res.set("Preference-Applied", "return=representation").json(result);
    } else res.status(204).end();
  });
  router.get("/:id/completions", async (req, res) => {
    const id = idOf(req.params.id);
    await owned(deps.database(), req.auth!.user.id, id);
    const query = z
      .object({
        before: localDateSchema.optional(),
        limit: z.coerce.number().int().min(1).max(100).default(30),
      })
      .strict()
      .parse(req.query);
    const rows = await deps.database().habitCompletion.findMany({
      where: {
        habitId: id,
        ...(query.before
          ? { scheduledDate: { lt: calendarDate(query.before) } }
          : {}),
      },
      orderBy: { scheduledDate: "desc" },
      take: query.limit + 1,
    });
    const more = rows.length > query.limit;
    const page = rows.slice(0, query.limit);
    res.json({
      completions: page.map((c) => ({
        id: c.id,
        scheduledDate: dateOnly(c.scheduledDate),
        completedAt: c.completedAt.toISOString(),
        undoneAt: c.undoneAt?.toISOString() ?? null,
        timezone: c.timezone,
      })),
      nextCursor: more ? dateOnly(page.at(-1)!.scheduledDate) : null,
    });
  });
  return router;
}
