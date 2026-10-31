import { HttpError } from "../../lib/http";
import { prisma } from "../../lib/prisma";
import type { CreateProductInput, UpdateProductInput } from "./products.schema";

const DEFAULT_IMAGE_URL = "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=500";

async function ensureStreamExists(streamId: string) {
  const stream = await prisma.stream.findUnique({ where: { id: streamId } });
  if (!stream) {
    throw new HttpError(404, "Stream-ul nu exista");
  }
}

async function ensureStreamOwnedBy(streamId: string, userId: string) {
  const stream = await prisma.stream.findUnique({ where: { id: streamId } });
  if (!stream) {
    throw new HttpError(404, "Stream-ul nu exista");
  }
  if (stream.userId !== userId) {
    throw new HttpError(403, "Stream-ul nu este al tau");
  }
}

async function findOwnedProduct(id: string, userId: string) {
  const product = await prisma.product.findUnique({
    where: { id },
    include: { stream: { select: { userId: true } }, _count: { select: { orders: true } } },
  });
  if (!product) {
    throw new HttpError(404, "Produsul nu exista");
  }
  if (product.stream.userId !== userId) {
    throw new HttpError(403, "Produsul nu este al tau");
  }
  return product;
}

export async function listProductsForStream(streamId: string) {
  await ensureStreamExists(streamId);
  return prisma.product.findMany({
    where: { streamId },
    orderBy: { createdAt: "asc" },
  });
}

export async function createProduct(userId: string, input: CreateProductInput) {
  await ensureStreamOwnedBy(input.streamId, userId);
  return prisma.product.create({
    data: {
      ...input,
      imageUrl: input.imageUrl ?? DEFAULT_IMAGE_URL,
    },
  });
}

export async function updateProduct(userId: string, id: string, input: UpdateProductInput) {
  await findOwnedProduct(id, userId);
  return prisma.product.update({ where: { id }, data: input });
}

export async function removeProduct(userId: string, id: string) {
  const product = await findOwnedProduct(id, userId);
  if (product._count.orders > 0) {
    throw new HttpError(409, "Produsul are comenzi si nu poate fi sters");
  }
  await prisma.product.delete({ where: { id } });
}

export async function pinProduct(userId: string, streamId: string, productId: string) {
  await ensureStreamOwnedBy(streamId, userId);
  const product = await prisma.product.findFirst({ where: { id: productId, streamId } });
  if (!product) {
    throw new HttpError(404, "Produsul nu exista in acest stream");
  }

  const [, pinned] = await prisma.$transaction([
    prisma.product.updateMany({ where: { streamId }, data: { isPinned: false } }),
    prisma.product.update({ where: { id: productId }, data: { isPinned: true } }),
  ]);
  return pinned;
}
