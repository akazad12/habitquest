import { z } from "zod";
export const timezoneSchema = z.string().refine((value) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}, "Use a valid IANA timezone");
export const localDateSchema = z.iso.date();
// Phase 1 weekly-version validation retained for existing consumers.
// New writes use recurrenceSchema; the server owns timezone and effective dates.
export const scheduleSchema = z
  .object({
    timezone: timezoneSchema,
    effectiveFrom: localDateSchema,
    weekdays: z
      .array(z.number().int().min(1).max(7))
      .min(1)
      .max(7)
      .refine(
        (days) => new Set(days).size === days.length,
        "Weekdays must be unique",
      ),
  })
  .strict();
export const recurrenceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("DAILY") }).strict(),
  z
    .object({
      kind: z.literal("WEEKDAYS"),
      weekdays: z
        .array(z.number().int().min(1).max(7))
        .min(1)
        .max(7)
        .refine(
          (days) => new Set(days).size === days.length,
          "Choose unique weekdays",
        ),
    })
    .strict(),
  z
    .object({
      kind: z.literal("INTERVAL"),
      intervalDays: z.number().int().min(1).max(365),
      anchorDate: localDateSchema,
    })
    .strict(),
]);
export const categorySchema = z.enum([
  "Personal",
  "Health",
  "Fitness",
  "Learning",
  "Mindfulness",
  "Work",
  "Other",
]);
export const difficultySchema = z.enum(["EASY", "MEDIUM", "HARD"]);
export const createHabitSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    description: z.string().trim().max(1000).optional(),
    category: categorySchema.default("Personal"),
    difficulty: difficultySchema.default("MEDIUM"),
    schedule: recurrenceSchema,
  })
  .strict();
export const updateHabitSchema = createHabitSchema
  .partial()
  .extend({
    category: categorySchema.optional(),
    difficulty: difficultySchema.optional(),
    archived: z.boolean().optional(),
  })
  .strict()
  .refine(
    (value) => Object.keys(value).length > 0,
    "Provide at least one change",
  );
export const emailSchema = z
  .email()
  .max(254)
  .transform((value) => value.trim().toLowerCase());
export const registerSchema = z
  .object({
    email: emailSchema,
    displayName: z.string().trim().min(1).max(80),
    password: z.string().min(12, "Use at least 12 characters").max(128),
    timezone: timezoneSchema,
  })
  .strict();
export const loginSchema = z
  .object({ email: emailSchema, password: z.string().min(1).max(128) })
  .strict();
export const profileSchema = z
  .object({
    displayName: z.string().trim().min(1).max(80),
    timezone: timezoneSchema,
  })
  .strict();
export const markCompletionSchema = z
  .object({ scheduledDate: localDateSchema })
  .strict();
export type Recurrence = z.infer<typeof recurrenceSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type UpdateHabit = z.infer<typeof updateHabitSchema>;
export const completionSchema = z
  .object({ habitId: z.uuid(), scheduledDate: localDateSchema })
  .strict();
export const createRewardSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    coinCost: z.number().int().positive().max(1000000),
  })
  .strict();
export const healthSchema = z.object({
  status: z.literal("ok"),
  service: z.literal("habitquest-api"),
});
export type HabitSchedule = z.infer<typeof scheduleSchema>;
export type CreateHabit = z.infer<typeof createHabitSchema>;
export type CompletionInput = z.infer<typeof completionSchema>;
export type HealthResponse = z.infer<typeof healthSchema>;
// Public contracts intentionally omit passwordHash and all authentication material.
export const publicUserSchema = z.object({
  id: z.uuid(),
  displayName: z.string(),
  email: z.email(),
  timezone: timezoneSchema,
});
export const habitSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  description: z.string().nullable(),
  archivedAt: z.iso.datetime().nullable(),
});
export const ledgerEntrySchema = z.object({
  id: z.uuid(),
  amount: z
    .number()
    .int()
    .refine((amount) => amount !== 0),
  reason: z.string(),
  createdAt: z.iso.datetime(),
});
export const rewardSchema = createRewardSchema.extend({ id: z.uuid() });
export const redemptionSchema = z.object({
  id: z.uuid(),
  rewardId: z.uuid(),
  rewardTitle: z.string(),
  coinCost: z.number().int().positive(),
  createdAt: z.iso.datetime(),
});
export const achievementSchema = z.object({
  id: z.uuid(),
  key: z.string(),
  title: z.string(),
  description: z.string(),
});
export const userAchievementSchema = z.object({
  achievementId: z.uuid(),
  unlockedAt: z.iso.datetime(),
});
export type PublicUser = z.infer<typeof publicUserSchema>;
export type Habit = z.infer<typeof habitSchema>;
export type LedgerEntry = z.infer<typeof ledgerEntrySchema>;
export type Reward = z.infer<typeof rewardSchema>;
export type Redemption = z.infer<typeof redemptionSchema>;
export type Achievement = z.infer<typeof achievementSchema>;
export type UserAchievement = z.infer<typeof userAchievementSchema>;
export const scheduleVersionSchema = z.object({
  id: z.uuid(),
  habitId: z.uuid(),
  timezone: timezoneSchema,
  effectiveFrom: localDateSchema,
  effectiveUntil: localDateSchema.nullable(),
  schedule: recurrenceSchema,
});
export const habitCompletionSchema = completionSchema.extend({
  id: z.uuid(),
  scheduleVersionId: z.uuid(),
  completedAt: z.iso.datetime(),
  undoneAt: z.iso.datetime().nullable(),
  timezone: timezoneSchema,
});
export type ScheduleVersion = z.infer<typeof scheduleVersionSchema>;
export type HabitCompletion = z.infer<typeof habitCompletionSchema>;
export type CreateReward = z.infer<typeof createRewardSchema>;

export const sessionResponseSchema = z.object({
  user: publicUserSchema,
  csrfToken: z.string().length(64),
});
export const habitRecordSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  description: z.string().nullable(),
  category: categorySchema,
  difficulty: difficultySchema,
  archivedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  schedule: recurrenceSchema,
  scheduleEffectiveFrom: localDateSchema,
  pendingSchedule: z
    .object({ schedule: recurrenceSchema, effectiveFrom: localDateSchema })
    .nullable(),
});
export const todayHabitSchema = habitRecordSchema.extend({
  completed: z.boolean(),
});
export const todaySchema = z.object({
  date: localDateSchema,
  timezone: timezoneSchema,
  habits: z.array(todayHabitSchema),
  completed: z.number().int(),
  total: z.number().int(),
  percentage: z.number().int(),
});
export type SessionResponse = z.infer<typeof sessionResponseSchema>;
export type HabitRecord = z.infer<typeof habitRecordSchema>;
export type Today = z.infer<typeof todaySchema>;

export const streakStatsSchema = z.object({
  habitId: z.uuid(),
  title: z.string(),
  archived: z.boolean(),
  current: z.number().int().nonnegative(),
  longest: z.number().int().nonnegative(),
  frozenDates: z.array(localDateSchema),
});
export const gameAchievementSchema = z.object({
  key: z.string(),
  title: z.string(),
  description: z.string(),
  unlockedAt: z.iso.datetime().nullable(),
});
export const progressionSchema = z.object({
  asOf: localDateSchema,
  timezone: timezoneSchema,
  xp: z.number().int().nonnegative(),
  coins: z.number().int().nonnegative(),
  level: z.number().int().positive(),
  xpIntoLevel: z.number().int().nonnegative(),
  xpForNextLevel: z.number().int().positive(),
  xpToNextLevel: z.number().int().positive(),
  levelPercent: z.number().int().min(0).max(100),
  freezes: z.object({
    available: z.number().int().min(0).max(2),
    maximum: z.literal(2),
    used: z.number().int().nonnegative(),
  }),
  freezeCandidates: z.array(
    z.object({ habitId: z.uuid(), title: z.string(), date: localDateSchema }),
  ),
  habits: z.array(streakStatsSchema),
  achievements: z.array(gameAchievementSchema),
});
export const freezeRequestSchema = z
  .object({ habitId: z.uuid(), scheduledDate: localDateSchema })
  .strict();
export const completionReceiptSchema = z.object({
  completion: z
    .object({
      id: z.uuid(),
      scheduledDate: localDateSchema,
      completedAt: z.iso.datetime(),
      undoneAt: z.iso.datetime().nullable(),
    })
    .nullable(),
  reward: z.object({
    changed: z.boolean(),
    restored: z.boolean(),
    xp: z.number().int(),
    coins: z.number().int(),
    baseXp: z.number().int().nonnegative(),
    bonusPercent: z.number().int().nonnegative(),
    streak: z.number().int().nonnegative(),
    levelBefore: z.number().int().positive(),
    levelAfter: z.number().int().positive(),
    milestone: z.number().int().nullable(),
    newAchievements: z.array(z.string()),
  }),
  progression: progressionSchema,
});
export type Progression = z.infer<typeof progressionSchema>;
export type CompletionReceipt = z.infer<typeof completionReceiptSchema>;

export const rewardCategorySchema = z.enum([
  "Personal",
  "Relaxation",
  "Food",
  "Entertainment",
  "Adventure",
  "Other",
]);
export const rewardIconSchema = z.enum([
  "gift",
  "film",
  "utensils",
  "gamepad",
  "coffee",
  "sparkles",
  "mountain",
  "book",
]);
export const rewardInputSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    description: z.string().trim().max(1000).optional(),
    coinCost: z.number().int().min(1).max(1000000),
    category: rewardCategorySchema.default("Personal"),
    icon: rewardIconSchema.nullable().optional(),
  })
  .strict();
export const rewardPatchSchema = rewardInputSchema
  .partial()
  .extend({
    category: rewardCategorySchema.optional(),
    archived: z.boolean().optional(),
  })
  .strict()
  .refine(
    (value) => Object.keys(value).length > 0,
    "Provide at least one change",
  );
export const shopRewardSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  description: z.string().nullable(),
  coinCost: z.number().int().positive(),
  category: rewardCategorySchema,
  icon: rewardIconSchema.nullable(),
  archivedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime().nullable(),
  updatedAt: z.iso.datetime().nullable(),
  affordable: z.boolean(),
});
export const redeemInputSchema = z
  .object({
    idempotencyKey: z.uuid(),
    expectedCoinCost: z.number().int().positive().max(1000000),
  })
  .strict();
export const purchaseSchema = z.object({
  id: z.uuid(),
  rewardId: z.uuid(),
  title: z.string(),
  description: z.string().nullable(),
  category: z.string().nullable(),
  icon: rewardIconSchema.nullable(),
  coinCost: z.number().int().positive(),
  status: z.enum(["PENDING", "FULFILLED", "CANCELED"]).nullable(),
  managed: z.boolean(),
  createdAt: z.iso.datetime(),
  fulfilledAt: z.iso.datetime().nullable(),
  canceledAt: z.iso.datetime().nullable(),
});
export const purchaseReceiptSchema = z.object({
  redemption: purchaseSchema,
  balance: z.number().int().nonnegative(),
  changed: z.boolean(),
  progression: progressionSchema,
});
export type ShopReward = z.infer<typeof shopRewardSchema>;
export type Purchase = z.infer<typeof purchaseSchema>;
export type PurchaseReceipt = z.infer<typeof purchaseReceiptSchema>;

export const analyticsRangeSchema = z
  .object({ from: localDateSchema.optional(), to: localDateSchema.optional() })
  .strict();
export const analyticsPeriodSchema = z.object({
  period: localDateSchema,
  completed: z.number().int().nonnegative(),
  scheduled: z.number().int().nonnegative(),
  assessed: z.number().int().nonnegative(),
  pending: z.number().int().nonnegative(),
  frozen: z.number().int().nonnegative(),
  rate: z.number().nullable(),
  xp: z.number().int(),
});
export const analyticsHabitSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  category: z.string(),
  archived: z.boolean(),
  completed: z.number().int(),
  scheduled: z.number().int(),
  assessed: z.number().int(),
  pending: z.number().int(),
  frozen: z.number().int(),
  rate: z.number().nullable(),
  currentStreak: z.number().int(),
  longestStreak: z.number().int(),
  weekly: z.array(analyticsPeriodSchema),
  monthly: z.array(analyticsPeriodSchema),
});
export const analyticsSchema = z.object({
  from: localDateSchema,
  to: localDateSchema,
  today: localDateSchema,
  timezone: timezoneSchema,
  overview: z.object({
    completed: z.number().int(),
    scheduled: z.number().int(),
    assessed: z.number().int(),
    pending: z.number().int(),
    frozen: z.number().int(),
    rate: z.number().nullable(),
    currentStreak: z.number().int(),
    longestStreak: z.number().int(),
    lifetimeCompletions: z.number().int(),
    xp: z.number().int(),
    level: z.number().int(),
    coinsEarned: z.number().int(),
    coinsSpent: z.number().int(),
    coinsRefunded: z.number().int(),
    coinAdjustments: z.number().int(),
    coinBalance: z.number().int(),
    achievementsUnlocked: z.number().int(),
  }),
  daily: z.array(
    analyticsPeriodSchema.extend({ intensity: z.number().int().min(0).max(4) }),
  ),
  weekly: z.array(analyticsPeriodSchema),
  monthly: z.array(analyticsPeriodSchema),
  habits: z.array(analyticsHabitSchema),
});
export type Analytics = z.infer<typeof analyticsSchema>;
export type AnalyticsPeriod = z.infer<typeof analyticsPeriodSchema>;
export type AnalyticsHabit = z.infer<typeof analyticsHabitSchema>;
export const dayDetailsSchema = z.object({
  date: localDateSchema,
  sessions: z.array(
    z.object({
      habitId: z.uuid(),
      title: z.string(),
      status: z.enum(["COMPLETED", "PENDING", "MISSED", "FROZEN"]),
    }),
  ),
});
export type DayDetails = z.infer<typeof dayDetailsSchema>;
