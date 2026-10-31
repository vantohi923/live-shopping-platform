import { describe, expect, test } from "bun:test";
import { tokenFor } from "./auth";
import { createFixture } from "./helpers";
import { useServer } from "./server";

const send = useServer();

describe("server", () => {
  test("GET /health raspunde ok", async () => {
    const res = await send("GET", "/health");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  test("raspunsurile au header-ul CORS al frontend-ului", async () => {
    const res = await send("GET", "/health");

    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
  });

  test("OPTIONS (preflight) da 204", async () => {
    const res = await send("OPTIONS", "/api/products");

    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-methods")).toContain("PATCH");
  });

  test("un URL necunoscut da 404 in JSON", async () => {
    const res = await send("GET", "/nu-exista");

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not Found" });
  });
});

describe("POST /api/products", () => {
  test("201 pentru date valide, cu titlul curatat de spatii", async () => {
    const { streamer, stream } = await createFixture();

    const res = await send("POST", "/api/products", { streamId: stream.id, title: "  Husa  ", priceCents: 3990 }, tokenFor(streamer));

    expect(res.status).toBe(201);
    const product = (await res.json()) as { title: string; stock: number };
    expect(product.title).toBe("Husa");
    expect(product.stock).toBe(10);
  });

  test("400 cu lista tuturor campurilor gresite", async () => {
    const { streamer } = await createFixture();

    const res = await send("POST", "/api/products", { streamId: "abc", title: "", priceCents: "abc" }, tokenFor(streamer));

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; details: { field: string }[] };
    expect(body.error).toBe("Date invalide");
    expect(body.details.map((d) => d.field).sort()).toEqual(["priceCents", "streamId", "title"]);
  });

  test("400 pentru pret in lei in loc de centi", async () => {
    const { streamer, stream } = await createFixture();

    const res = await send("POST", "/api/products", { streamId: stream.id, title: "Husa", priceCents: 39.9 }, tokenFor(streamer));

    expect(res.status).toBe(400);
  });

  test("400 pentru JSON stricat", async () => {
    const { streamer } = await createFixture();

    const res = await send("POST", "/api/products", "{ stricat", tokenFor(streamer));

    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("Body-ul cererii nu este JSON valid");
  });
});

describe("GET /api/streams/:id/products", () => {
  test("200 cu produsele live-ului", async () => {
    const { stream } = await createFixture();

    const res = await send("GET", `/api/streams/${stream.id}/products`);

    expect(res.status).toBe(200);
    expect(await res.json()).toHaveLength(3);
  });

  test("400 pentru un ID care nu e UUID", async () => {
    const res = await send("GET", "/api/streams/abc/products");

    expect(res.status).toBe(400);
  });
});

describe("POST /api/streams/:id/pin", () => {
  test("200 si produsul intors e fixat", async () => {
    const { streamer, stream, strap } = await createFixture();

    const res = await send("POST", `/api/streams/${stream.id}/pin`, { productId: strap.id }, tokenFor(streamer));

    expect(res.status).toBe(200);
    expect(((await res.json()) as { isPinned: boolean }).isPinned).toBe(true);
  });
});

describe("PATCH si DELETE /api/products/:id", () => {
  test("PATCH cu body gol da 400", async () => {
    const { streamer, strap } = await createFixture();

    const res = await send("PATCH", `/api/products/${strap.id}`, {}, tokenFor(streamer));

    expect(res.status).toBe(400);
  });

  test("DELETE da 204, iar al doilea DELETE da 404", async () => {
    const { streamer, strap } = await createFixture();

    const first = await send("DELETE", `/api/products/${strap.id}`, undefined, tokenFor(streamer));
    const second = await send("DELETE", `/api/products/${strap.id}`, undefined, tokenFor(streamer));

    expect(first.status).toBe(204);
    expect(second.status).toBe(404);
  });
});
