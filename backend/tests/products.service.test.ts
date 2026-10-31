import { describe, expect, test } from "bun:test";
import { prisma } from "../src/lib/prisma";
import {
  createProduct,
  listProductsForStream,
  pinProduct,
  removeProduct,
  updateProduct,
} from "../src/modules/products/products.service";
import { createFixture, pinnedIn } from "./helpers";

const MISSING_ID = "00000000-0000-4000-8000-000000000000";

describe("createProduct", () => {
  test("creeaza produsul si pune poza implicita", async () => {
    const { streamer, stream } = await createFixture();

    const product = await createProduct(streamer.id, { streamId: stream.id, title: "Husa", priceCents: 3990, stock: 10 });

    expect(product.priceCents).toBe(3990);
    expect(product.isPinned).toBe(false);
    expect(product.imageUrl).toStartWith("https://");
  });

  test("da 404 daca live-ul nu exista", async () => {
    const { streamer } = await createFixture();

    const promise = createProduct(streamer.id, { streamId: MISSING_ID, title: "Husa", priceCents: 3990, stock: 10 });

    await expect(promise).rejects.toMatchObject({ status: 404 });
  });

  test("da 403 daca live-ul e al altui streamer", async () => {
    const mine = await createFixture();
    const other = await createFixture();

    const promise = createProduct(mine.streamer.id, { streamId: other.stream.id, title: "Husa", priceCents: 3990, stock: 10 });

    await expect(promise).rejects.toMatchObject({ status: 403 });
  });
});

describe("listProductsForStream", () => {
  test("intoarce doar produsele live-ului cerut", async () => {
    const first = await createFixture();
    await createFixture();

    const products = await listProductsForStream(first.stream.id);

    expect(products).toHaveLength(3);
    expect(products.every((p) => p.streamId === first.stream.id)).toBe(true);
  });
});

describe("updateProduct", () => {
  test("schimba doar campurile trimise", async () => {
    const { streamer, strap } = await createFixture();

    const updated = await updateProduct(streamer.id, strap.id, { priceCents: 7990 });

    expect(updated.priceCents).toBe(7990);
    expect(updated.stock).toBe(strap.stock);
    expect(updated.title).toBe(strap.title);
  });

  test("da 404 pentru un produs inexistent", async () => {
    const { streamer } = await createFixture();

    await expect(updateProduct(streamer.id, MISSING_ID, { priceCents: 100 })).rejects.toMatchObject({ status: 404 });
  });

  test("da 403 pentru produsul altui streamer", async () => {
    const mine = await createFixture();
    const other = await createFixture();

    await expect(updateProduct(mine.streamer.id, other.strap.id, { priceCents: 100 })).rejects.toMatchObject({ status: 403 });
  });
});

describe("removeProduct", () => {
  test("sterge un produs fara comenzi", async () => {
    const { streamer, strap } = await createFixture();

    await removeProduct(streamer.id, strap.id);

    expect(await prisma.product.findUnique({ where: { id: strap.id } })).toBeNull();
  });

  test("da 409 daca produsul are comenzi si nu il sterge", async () => {
    const { streamer, strap, viewer } = await createFixture();
    await prisma.order.create({ data: { userId: viewer.id, productId: strap.id, priceCents: strap.priceCents } });

    await expect(removeProduct(streamer.id, strap.id)).rejects.toMatchObject({ status: 409 });
    expect(await prisma.product.findUnique({ where: { id: strap.id } })).not.toBeNull();
  });

  test("da 403 pentru produsul altui streamer si nu il sterge", async () => {
    const mine = await createFixture();
    const other = await createFixture();

    await expect(removeProduct(mine.streamer.id, other.strap.id)).rejects.toMatchObject({ status: 403 });
    expect(await prisma.product.findUnique({ where: { id: other.strap.id } })).not.toBeNull();
  });
});

describe("pinProduct", () => {
  test("lasa exact un produs fixat: cel ales", async () => {
    const { streamer, stream, strap } = await createFixture();

    await pinProduct(streamer.id, stream.id, strap.id);

    const pinned = await pinnedIn(stream.id);
    expect(pinned).toHaveLength(1);
    expect(pinned[0]!.id).toBe(strap.id);
  });

  test("nu atinge produsele din alte live-uri", async () => {
    const mine = await createFixture();
    const other = await createFixture();

    await pinProduct(mine.streamer.id, mine.stream.id, mine.strap.id);

    const otherPinned = await pinnedIn(other.stream.id);
    expect(otherPinned.map((p) => p.id)).toEqual([other.watch.id]);
  });

  test("da 404 pentru un produs din alt live si nu schimba nimic", async () => {
    const mine = await createFixture();
    const other = await createFixture();

    await expect(pinProduct(mine.streamer.id, mine.stream.id, other.strap.id)).rejects.toMatchObject({ status: 404 });

    const pinned = await pinnedIn(mine.stream.id);
    expect(pinned.map((p) => p.id)).toEqual([mine.watch.id]);
  });

  test("da 403 in live-ul altui streamer", async () => {
    const mine = await createFixture();
    const other = await createFixture();

    await expect(pinProduct(mine.streamer.id, other.stream.id, other.strap.id)).rejects.toMatchObject({ status: 403 });
  });

  test("doua fixari simultane lasa tot un singur produs fixat", async () => {
    const { streamer, stream, strap, charger } = await createFixture();

    await Promise.all([pinProduct(streamer.id, stream.id, strap.id), pinProduct(streamer.id, stream.id, charger.id)]);

    expect(await pinnedIn(stream.id)).toHaveLength(1);
  });
});
