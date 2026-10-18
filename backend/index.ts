import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const PORT = 4000;

interface CreateStreamBody {
  title?: string;
}

interface CreateProductBody {
  streamId: string;
  title: string;
  description?: string;
  price: number | string;
  stock?: number;
  imageUrl?: string;
  isPinned?: boolean;
}

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    // Setări CORS pentru comunicarea cu frontend-ul
    const headers = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Content-Type": "application/json",
    };

    if (req.method === "OPTIONS") {
      return new Response(null, { headers });
    }

    // Health check
    if (url.pathname === "/health" && req.method === "GET") {
      return new Response(JSON.stringify({ status: "ok" }), { headers });
    }

    // Seed utilizator de test
    if (url.pathname === "/api/users/seed" && req.method === "POST") {
      const user = await prisma.user.upsert({
        where: { email: "streamer@liveshop.local" },
        update: {},
        create: {
          email: "streamer@liveshop.local",
          name: "Live Shop Demo User",
          role: "STREAMER",
        },
      });
      return new Response(JSON.stringify(user), { status: 201, headers });
    }

    // Listare toate stream-urile cu produse și detalii utilizator
    if (url.pathname === "/api/streams" && req.method === "GET") {
      const streams = await prisma.stream.findMany({
        include: { products: true, user: true },
      });
      return new Response(JSON.stringify(streams), { headers });
    }

    // Creare stream nou
    if (url.pathname === "/api/streams" && req.method === "POST") {
      let body: CreateStreamBody = {};
      try {
        body = (await req.json()) as CreateStreamBody;
      } catch {}

      const user = await prisma.user.findFirst();
      if (!user) {
        return new Response(
          JSON.stringify({ error: "Nu exista utilizator. Ruleaza seed mai intai!" }),
          { status: 400, headers }
        );
      }

      const stream = await prisma.stream.create({
        data: {
          title: body.title || "Live Stream Demonstrativ",
          isLive: true,
          userId: user.id,
        },
      });
      return new Response(JSON.stringify(stream), { status: 201, headers });
    }

    // Adaugare produs la un stream
    if (url.pathname === "/api/products" && req.method === "POST") {
      const body = (await req.json()) as CreateProductBody;
      if (!body.streamId || !body.title || !body.price) {
        return new Response(
          JSON.stringify({ error: "Lipseste streamId, title sau price" }),
          { status: 400, headers }
        );
      }

      const product = await prisma.product.create({
        data: {
          title: body.title,
          description: body.description || "",
          price: Number(body.price),
          stock: body.stock ?? 10,
          imageUrl:
            body.imageUrl ||
            "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=500",
          streamId: body.streamId,
          isPinned: body.isPinned ?? false,
        },
      });
      return new Response(JSON.stringify(product), { status: 201, headers });
    }

    return new Response(JSON.stringify({ error: "Not Found" }), { status: 404, headers });
  },
});

console.log(`🚀 Serverul backend Bun ruleaza pe http://localhost:${server.port}`);