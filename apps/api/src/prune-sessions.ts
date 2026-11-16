import { createDatabase } from "./db.js";
const db = createDatabase();
try {
  const { count } = await db.session.deleteMany({
    where: { expiresAt: { lte: new Date() } },
  });
  console.log(`Removed ${count} expired sessions.`);
} finally {
  await db.$disconnect();
}
