import { createDatabase } from "./db.js";
const db = createDatabase();
try {
  const { count } = await db.session.deleteMany({
    where: { expiresAt: { lte: new Date() } },
  });
  const limits = await db.authRateLimit.deleteMany({
    where: { expiresAt: { lte: new Date() } },
  });
  console.log(
    JSON.stringify({
      event: "maintenance",
      expiredSessions: count,
      expiredRateLimits: limits.count,
    }),
  );
} finally {
  await db.$disconnect();
}
