import { Role } from "@prisma/client";
import { prisma } from "../src/lib/prisma";

const STREAMER_ID = "438b7fa3-0050-47b8-81d8-b42da05b1684";
const VIEWER_ID = "7c1e2f4a-9b3d-4e8f-a1c2-5d6e7f8a9b0c";
const STREAM_ID = "b3897c80-bbc2-408c-bc8e-0b588c706eb1";

async function main() {
  await prisma.$transaction([
    prisma.order.deleteMany(),
    prisma.product.deleteMany(),
    prisma.stream.deleteMany(),
    prisma.user.deleteMany(),
  ]);

  const streamer = await prisma.user.create({
    data: {
      id: STREAMER_ID,
      email: "streamer@liveshop.local",
      name: "Ana Streamer",
      role: Role.STREAMER,
    },
  });

  const viewer = await prisma.user.create({
    data: {
      id: VIEWER_ID,
      email: "viewer@liveshop.local",
      name: "Mihai Viewer",
      role: Role.VIEWER,
    },
  });

  const stream = await prisma.stream.create({
    data: {
      id: STREAM_ID,
      title: "Lansare Ceasuri Inteligente - Reduceri Live",
      isLive: true,
      userId: streamer.id,
      products: {
        create: [
          {
            title: "Smartwatch Pro V2",
            description: "Ecran AMOLED, GPS, autonomie 7 zile",
            priceCents: 29999,
            stock: 15,
            imageUrl: "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=500",
            isPinned: true,
          },
          {
            title: "Curea piele maro",
            description: "Compatibilă cu Smartwatch Pro V2",
            priceCents: 8990,
            stock: 30,
            imageUrl: "https://images.unsplash.com/photo-1524805444758-089113d48a6d?w=500",
          },
          {
            title: "Încărcător wireless",
            description: "Încărcare rapidă, suport magnetic",
            priceCents: 12950,
            stock: 3,
            imageUrl: "https://images.unsplash.com/photo-1586816879360-004f5b0c51e3?w=500",
          },
        ],
      },
    },
    include: { products: true },
  });

  console.log("✅ Seed terminat:");
  console.log(`   streamer: ${streamer.email} (${streamer.role})`);
  console.log(`   viewer:   ${viewer.email} (${viewer.role})`);
  console.log(`   stream:   ${stream.title} (id ${stream.id})`);
  for (const p of stream.products) {
    console.log(`   produs:   ${p.title} — ${(p.priceCents / 100).toFixed(2)} lei, stoc ${p.stock}${p.isPinned ? " 📌" : ""}`);
  }
}

main()
  .catch((err) => {
    console.error("❌ Seed eșuat:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
