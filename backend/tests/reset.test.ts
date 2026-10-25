import { describe, expect, test } from "bun:test";
import { prisma } from "../src/lib/prisma";
import { createFixture } from "./helpers";

async function countRows() {
  const [users, streams, products, orders] = await Promise.all([
    prisma.user.count(),
    prisma.stream.count(),
    prisma.product.count(),
    prisma.order.count(),
  ]);
  return { users, streams, products, orders };
}

describe("baza de test se goleste inainte de fiecare test", () => {
  test("primul test lasa date in urma", async () => {
    const { viewer, strap } = await createFixture();
    await prisma.order.create({ data: { userId: viewer.id, productId: strap.id, priceCents: strap.priceCents } });

    expect(await countRows()).toEqual({ users: 2, streams: 1, products: 3, orders: 1 });
  });

  test("al doilea test porneste de la zero", async () => {
    expect(await countRows()).toEqual({ users: 0, streams: 0, products: 0, orders: 0 });
  });
});
