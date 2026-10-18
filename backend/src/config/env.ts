import { z } from "zod";

const EnvSchema = z.object({
  DATABASE_URL: z.url(),
  PORT: z.coerce.number().int().positive().default(4000),
  FRONTEND_URL: z.url().default("http://localhost:3000"),
});

const result = EnvSchema.safeParse(process.env);

if (!result.success) {
  console.error("❌ Variabile de mediu invalide în .env:\n" + z.prettifyError(result.error));
  process.exit(1);
}

export const env = result.data;
