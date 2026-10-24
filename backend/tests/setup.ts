import { afterAll } from "bun:test";
import { prisma } from "../src/lib/prisma";

const dbName = new URL(process.env.DATABASE_URL ?? "").pathname.slice(1);
if (!dbName.endsWith("_test")) {
  console.error(`❌ Testele ruleaza doar pe o baza *_test. DATABASE_URL arata spre "${dbName}".`);
  process.exit(1);
}

afterAll(async () => {
  await prisma.$disconnect();
});
