import { Role, type User } from "@prisma/client";
import { CognitoJwtVerifier } from "aws-jwt-verify";
import { env } from "../config/env";
import { HttpError } from "../lib/http";
import { upsertUserFromCognito } from "../modules/users/users.service";

export const tokenVerifier = CognitoJwtVerifier.create({
  userPoolId: env.COGNITO_USER_POOL_ID,
  clientId: env.COGNITO_CLIENT_ID,
  tokenUse: "id",
});

export async function requireUser(req: Request): Promise<User> {
  const token = req.headers.get("authorization")?.match(/^Bearer (.+)$/i)?.[1];
  if (!token) {
    throw new HttpError(401, "Lipseste token-ul de autentificare");
  }

  const payload = await tokenVerifier.verify(token).catch(() => {
    throw new HttpError(401, "Token invalid sau expirat");
  });

  return upsertUserFromCognito(payload);
}

export function requireRole(user: User, role: Role) {
  if (user.role !== role) {
    throw new HttpError(403, "Nu ai acces la aceasta actiune");
  }
}

export async function requireStreamer(req: Request): Promise<User> {
  const user = await requireUser(req);
  requireRole(user, Role.STREAMER);
  return user;
}
