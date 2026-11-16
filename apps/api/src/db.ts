import { PrismaClient } from "./generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { z } from "zod";
export function createDatabase() {
  const connectionString = z
    .string()
    .startsWith("postgresql://")
    .parse(process.env.DATABASE_URL);
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}
