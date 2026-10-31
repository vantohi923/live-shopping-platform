import { Role } from "@prisma/client";
import { describe, expect, test } from "bun:test";
import { prisma } from "../src/lib/prisma";
import { signToken, tokenFor } from "./auth";
import { createFixture } from "./helpers";
import { useServer } from "./server";

const send = useServer();

async function errorOf(res: Response) {
  return ((await res.json()) as { error: string }).error;
}

describe("401: cine esti?", () => {
  test("fara header Authorization", async () => {
    const res = await send("GET", "/api/me");

    expect(res.status).toBe(401);
    expect(await errorOf(res)).toBe("Lipseste token-ul de autentificare");
  });

  test("alta schema decat Bearer", async () => {
    const { streamer } = await createFixture();

    const res = await send("GET", "/api/me", undefined, tokenFor(streamer), "Basic");

    expect(res.status).toBe(401);
  });

  test("token inventat", async () => {
    const res = await send("GET", "/api/me", undefined, "abc.def.ghi");

    expect(res.status).toBe(401);
    expect(await errorOf(res)).toBe("Token invalid sau expirat");
  });

  test("token expirat", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = signToken({ sub: "expirat", email: "expirat@test.local", iat: now - 7200, exp: now - 3600 });

    const res = await send("GET", "/api/me", undefined, token);

    expect(res.status).toBe(401);
  });

  test("token emis pentru alt client", async () => {
    const token = signToken({ sub: "alt-client", email: "alt@test.local", aud: "alt-client-id" });

    const res = await send("GET", "/api/me", undefined, token);

    expect(res.status).toBe(401);
  });

  test("access token in loc de ID token", async () => {
    const token = signToken({ sub: "access", email: "access@test.local", token_use: "access" });

    const res = await send("GET", "/api/me", undefined, token);

    expect(res.status).toBe(401);
  });

  test("payload modificat dupa semnare", async () => {
    const { viewer, streamer } = await createFixture();
    const [header, , signature] = tokenFor(viewer).split(".");
    const forged = Buffer.from(JSON.stringify({ sub: streamer.cognitoSub, email: streamer.email })).toString("base64url");

    const res = await send("GET", "/api/me", undefined, `${header}.${forged}.${signature}`);

    expect(res.status).toBe(401);
  });
});

describe("GET /api/me", () => {
  test("200 cu userul din token, fara cognitoSub in raspuns", async () => {
    const { streamer } = await createFixture();

    const res = await send("GET", "/api/me", undefined, tokenFor(streamer));

    expect(res.status).toBe(200);
    const me = (await res.json()) as Record<string, unknown>;
    expect(me.id).toBe(streamer.id);
    expect(me.role).toBe(Role.STREAMER);
    expect(me).not.toHaveProperty("cognitoSub");
  });

  test("accepta si 'bearer' scris cu litere mici", async () => {
    const { viewer } = await createFixture();

    const res = await send("GET", "/api/me", undefined, tokenFor(viewer), "bearer");

    expect(res.status).toBe(200);
  });

  test("primul login creeaza un VIEWER, al doilea nu face duplicat", async () => {
    const token = signToken({ sub: "nou-123", email: "nou@test.local", name: "Ion Nou" });

    const first = await send("GET", "/api/me", undefined, token);
    const second = await send("GET", "/api/me", undefined, token);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(((await first.json()) as { role: string }).role).toBe(Role.VIEWER);
    expect(await prisma.user.count({ where: { email: "nou@test.local" } })).toBe(1);
  });

  test("403 pentru un user nou cu email neverificat", async () => {
    const token = signToken({ sub: "neverificat", email: "neverificat@test.local", email_verified: false });

    const res = await send("GET", "/api/me", undefined, token);

    expect(res.status).toBe(403);
    expect(await prisma.user.count({ where: { email: "neverificat@test.local" } })).toBe(0);
  });

  test("leaga contul existent dupa email si pastreaza rolul", async () => {
    const existing = await prisma.user.create({
      data: { email: "vechi@test.local", name: "Cont Vechi", role: Role.STREAMER },
    });
    const token = signToken({ sub: "sub-nou", email: "vechi@test.local" });

    const res = await send("GET", "/api/me", undefined, token);

    expect(res.status).toBe(200);
    const linked = await prisma.user.findUniqueOrThrow({ where: { id: existing.id } });
    expect(linked.cognitoSub).toBe("sub-nou");
    expect(linked.role).toBe(Role.STREAMER);
  });
});

describe("403: rolul nu e STREAMER", () => {
  test("POST /api/streams fara token da 401", async () => {
    const res = await send("POST", "/api/streams", { title: "Live" });

    expect(res.status).toBe(401);
  });

  test("viewer-ul nu poate crea un live", async () => {
    const { viewer } = await createFixture();

    const res = await send("POST", "/api/streams", { title: "Live" }, tokenFor(viewer));

    expect(res.status).toBe(403);
    expect(await errorOf(res)).toBe("Nu ai acces la aceasta actiune");
  });

  test("viewer-ul nu poate modifica un produs", async () => {
    const { viewer, strap } = await createFixture();

    const res = await send("PATCH", `/api/products/${strap.id}`, { priceCents: 100 }, tokenFor(viewer));

    expect(res.status).toBe(403);
  });

  test("streamer-ul creeaza un live care ii apartine", async () => {
    const { streamer } = await createFixture();

    const res = await send("POST", "/api/streams", { title: "Live nou" }, tokenFor(streamer));

    expect(res.status).toBe(201);
    expect(((await res.json()) as { userId: string }).userId).toBe(streamer.id);
  });
});

describe("403: resursa e a altui streamer", () => {
  test("nu poate adauga produse in live-ul altcuiva", async () => {
    const mine = await createFixture();
    const other = await createFixture();

    const res = await send(
      "POST",
      "/api/products",
      { streamId: other.stream.id, title: "Intrus", priceCents: 100 },
      tokenFor(mine.streamer),
    );

    expect(res.status).toBe(403);
    expect(await errorOf(res)).toBe("Stream-ul nu este al tau");
    expect(await prisma.product.count({ where: { streamId: other.stream.id } })).toBe(3);
  });

  test("nu poate modifica produsul altcuiva", async () => {
    const mine = await createFixture();
    const other = await createFixture();

    const res = await send("PATCH", `/api/products/${other.strap.id}`, { priceCents: 100 }, tokenFor(mine.streamer));

    expect(res.status).toBe(403);
    expect(await errorOf(res)).toBe("Produsul nu este al tau");
    const strap = await prisma.product.findUniqueOrThrow({ where: { id: other.strap.id } });
    expect(strap.priceCents).toBe(other.strap.priceCents);
  });

  test("nu poate sterge produsul altcuiva", async () => {
    const mine = await createFixture();
    const other = await createFixture();

    const res = await send("DELETE", `/api/products/${other.strap.id}`, undefined, tokenFor(mine.streamer));

    expect(res.status).toBe(403);
    expect(await prisma.product.findUnique({ where: { id: other.strap.id } })).not.toBeNull();
  });

  test("nu poate fixa produse in live-ul altcuiva", async () => {
    const mine = await createFixture();
    const other = await createFixture();

    const res = await send(
      "POST",
      `/api/streams/${other.stream.id}/pin`,
      { productId: other.strap.id },
      tokenFor(mine.streamer),
    );

    expect(res.status).toBe(403);
    const pinned = await prisma.product.findMany({ where: { streamId: other.stream.id, isPinned: true } });
    expect(pinned.map((p) => p.id)).toEqual([other.watch.id]);
  });
});

describe("GET /api/streams", () => {
  test("e public si nu expune email-ul sau cognitoSub", async () => {
    await createFixture();

    const res = await send("GET", "/api/streams");

    expect(res.status).toBe(200);
    const [stream] = (await res.json()) as { user: Record<string, unknown> }[];
    expect(Object.keys(stream!.user).sort()).toEqual(["id", "name"]);
  });
});
