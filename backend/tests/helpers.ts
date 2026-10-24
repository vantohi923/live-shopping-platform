import { Role } from "@prisma/client";
import { prisma } from "../src/lib/prisma";

export async function createFixture() {
  const tag = crypto.randomUUID().slice(0, 8);

  const streamer = await prisma.user.create({
    data: { email: `streamer-${tag}@test.local`, name: "Streamer Test", role: Role.STREAMER },
  });
  const viewer = await prisma.user.create({
    data: { email: `viewer-${tag}@test.local`, name: "Viewer Test", role: Role.VIEWER },
  });

  const stream = await prisma.stream.create({
    data: {
      title: `Live test ${tag}`,
      isLive: true,
      userId: streamer.id,
      products: {
        create: [
          { title: "Ceas", priceCents: 29999, stock: 15, isPinned: true },
          { title: "Curea", priceCents: 8990, stock: 30 },
          { title: "Incarcator", priceCents: 12950, stock: 3 },
        ],
      },
    },
    include: { products: { orderBy: { priceCents: "desc" } } },
  });

  const [watch, charger, strap] = stream.products;
  return { streamer, viewer, stream, watch: watch!, strap: strap!, charger: charger! };
}

export function pinnedIn(streamId: string) {
  return prisma.product.findMany({ where: { streamId, isPinned: true } });
}
