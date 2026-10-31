import type { User } from "@prisma/client";
import { createSign, generateKeyPairSync } from "node:crypto";
import { env } from "../src/config/env";
import { tokenVerifier } from "../src/middleware/auth";

const KEY_ID = "test-key";
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const { n, e } = publicKey.export({ format: "jwk" });

tokenVerifier.cacheJwks({
  keys: [{ kty: "RSA", n: n!, e: e!, kid: KEY_ID, alg: "RS256", use: "sig" }],
});

function base64url(value: object) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

export function signToken(claims: Record<string, unknown>) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url({ alg: "RS256", kid: KEY_ID, typ: "JWT" });
  const payload = base64url({
    iss: `https://cognito-idp.${env.COGNITO_USER_POOL_ID.split("_")[0]}.amazonaws.com/${env.COGNITO_USER_POOL_ID}`,
    aud: env.COGNITO_CLIENT_ID,
    token_use: "id",
    auth_time: now,
    iat: now,
    exp: now + 3600,
    email_verified: true,
    ...claims,
  });
  const signature = createSign("RSA-SHA256").update(`${header}.${payload}`).sign(privateKey).toString("base64url");
  return `${header}.${payload}.${signature}`;
}

export function tokenFor(user: User) {
  return signToken({ sub: user.cognitoSub, email: user.email, name: user.name });
}
