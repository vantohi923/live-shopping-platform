import { Role } from "@prisma/client";
import { z } from "zod";
import { HttpError } from "../../lib/http";
import { prisma } from "../../lib/prisma";

const CognitoClaimsSchema = z.object({
  sub: z.string().min(1),
  email: z.email(),
  email_verified: z.boolean().optional(),
  name: z.string().trim().min(1).optional(),
});

export async function upsertUserFromCognito(payload: unknown) {
  const result = CognitoClaimsSchema.safeParse(payload);
  if (!result.success) {
    throw new HttpError(401, "Token-ul nu contine datele necesare");
  }
  const claims = result.data;

  const existing = await prisma.user.findUnique({ where: { cognitoSub: claims.sub } });
  if (existing) return existing;

  if (!claims.email_verified) {
    throw new HttpError(403, "Adresa de email nu este verificata");
  }

  return prisma.user.upsert({
    where: { email: claims.email },
    update: { cognitoSub: claims.sub },
    create: {
      cognitoSub: claims.sub,
      email: claims.email,
      name: claims.name ?? claims.email.split("@")[0]!,
      role: Role.VIEWER,
    },
  });
}
