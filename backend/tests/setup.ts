import { afterAll, beforeEach } from "bun:test";
import { prisma } from "../src/lib/prisma";
import { resetDatabase } from "./helpers";

const dbName = new URL(process.env.DATABASE_URL ?? "").pathname.slice(1);
if (!dbName.endsWith("_test")) {
  console.error(`❌ Testele ruleaza doar pe o baza *_test. DATABASE_URL arata spre "${dbName}".`);
  process.exit(1);
}

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});
