import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../apps/api/src/generated/prisma/client.js";
import { hashPassword } from "../apps/api/src/auth.js";
import { mutateCompletion } from "../apps/api/src/progression/completions.js";
import {
  addDays,
  calendarDate,
  localDate,
  scheduleData,
  isDue,
} from "../apps/api/src/scheduling.js";
import { archiveState } from "../apps/api/src/progression/service.js";
export function isolatedDatabaseUrl() {
  const value = process.env.TEST_DATABASE_URL;
  if (
    process.env.NODE_ENV === "production" ||
    process.env.ALLOW_TEST_FIXTURES !== "yes" ||
    !value ||
    !/_(test|verify|perf)$/.test(new URL(value).pathname)
  )
    throw new Error(
      "Explicit ALLOW_TEST_FIXTURES=yes and an isolated *_test, *_verify or *_perf TEST_DATABASE_URL are required; production is prohibited.",
    );
  return value;
}
export async function seedDemo(
  db: PrismaClient,
  index = 0,
  habitCount = 8,
  days = 35,
) {
  const timezone = "America/New_York",
    now = new Date(),
    today = localDate(now, timezone);
  const email = `demo-${randomUUID()}@example.test`,
    password = randomBytes(24).toString("base64url");
  const user = await db.user.create({
    data: {
      email,
      passwordHash: await hashPassword(password),
      displayName: index
        ? `Load participant ${index}`
        : "Morgan · Demo workspace",
      timezone,
    },
  });
  const habits = [];
  const names = [
    "Read ten pages",
    "Move for twenty minutes",
    "Make space to breathe",
    "Practice a new skill",
    "Plan tomorrow",
    "Drink water",
    "Earlier morning routine",
    "Write a few lines",
  ];
  for (let i = 0; i < habitCount; i++) {
    const rule =
      i % 3 === 1
        ? { kind: "WEEKDAYS" as const, weekdays: [1, 3, 5] }
        : i % 3 === 2
          ? {
              kind: "INTERVAL" as const,
              intervalDays: 3,
              anchorDate: addDays(today, -days),
            }
          : { kind: "DAILY" as const };
    habits.push({
      row: await db.habit.create({
        data: {
          userId: user.id,
          title: names[i % names.length]! + (i >= 8 ? ` ${i + 1}` : ""),
          category: i % 3 === 1 ? "Fitness" : "Learning",
          difficulty: i % 3 === 1 ? "HARD" : "MEDIUM",
          schedules: {
            create: {
              effectiveFrom: calendarDate(addDays(today, -days)),
              timezone,
              ...scheduleData(rule),
            },
          },
        },
      }),
      rule,
    });
  }
  const deps = {
    database: () => db,
    now: () => now,
    production: false,
    origin: "http://127.0.0.1:5175",
    sessionDays: 7,
    authLimit: 20,
  };
  for (let offset = days; offset >= 1; offset--) {
    const date = addDays(today, -offset);
    for (let i = 0; i < habits.length; i++) {
      const h = habits[i]!;
      if (isDue(h.rule, date) && (i === 0 || (offset + i) % 7 !== 0))
        await mutateCompletion(
          { ...deps, now: () => new Date(date + "T17:00:00Z") },
          user.id,
          h.row.id,
          date,
          true,
        );
    }
  }
  if (!index && habits.length > 6) {
    const h = habits[6]!.row;
    await db.$transaction(async (tx) => {
      await archiveState(tx, h, true, today, timezone, now);
      await tx.habit.update({ where: { id: h.id }, data: { archivedAt: now } });
    });
  }
  if (!index)
    await mutateCompletion(deps, user.id, habits[0]!.row.id, today, true);
  const rewards = [];
  for (const [title, coinCost, category, icon] of [
    ["Movie night", 200, "Entertainment", "film"],
    ["A quiet coffee break", 50, "Relaxation", "coffee"],
    ["Favorite meal", 500, "Food", "utensils"],
    ["Weekend outdoors", 250, "Adventure", "mountain"],
    ["A new video game", 1500, "Entertainment", "gamepad"],
  ] as const)
    rewards.push(
      await db.reward.create({
        data: {
          userId: user.id,
          title,
          coinCost,
          category,
          icon,
          description: "A little time for something you enjoy.",
          createdAt: now,
          updatedAt: now,
        },
      }),
    );
  const cheap = await db.reward.create({
    data: {
      userId: user.id,
      title: "Load test reservation",
      coinCost: 1,
      category: "Other",
      icon: "gift",
      archivedAt: index ? null : now,
      createdAt: now,
      updatedAt: now,
    },
  });
  return {
    email,
    password,
    userId: user.id,
    today,
    habitId: habits[0]!.row.id,
    rewardId: cheap.id,
  };
}
if (process.argv[1]?.endsWith("demo-seed.ts")) {
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: isolatedDatabaseUrl() }),
  });
  try {
    const fixture = await seedDemo(db);
    await mkdir("work", { recursive: true });
    await writeFile(
      "work/demo-account.json",
      JSON.stringify(fixture, null, 2),
      { mode: 0o600 },
    );
    console.log(
      "Dedicated non-sensitive demo workspace created. Credentials saved only in ignored work/demo-account.json.",
    );
  } finally {
    await db.$disconnect();
  }
}
