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

async function findProductOrThrow(id: string) {
  const product = await prisma.product.findUnique({
    where: { id },
    include: { _count: { select: { orders: true } } },
  });
  if (!product) {
    throw new HttpError(404, "Produsul nu exista");
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

export async function createProduct(input: CreateProductInput) {
  await ensureStreamExists(input.streamId);
  return prisma.product.create({
    data: {
      ...input,
      imageUrl: input.imageUrl ?? DEFAULT_IMAGE_URL,
    },
  });
}

export async function updateProduct(id: string, input: UpdateProductInput) {
  await findProductOrThrow(id);
  return prisma.product.update({ where: { id }, data: input });
}

export async function removeProduct(id: string) {
  const product = await findProductOrThrow(id);
  if (product._count.orders > 0) {
    throw new HttpError(409, "Produsul are comenzi si nu poate fi sters");
  }
  await prisma.product.delete({ where: { id } });
}

export async function pinProduct(streamId: string, productId: string) {
  await ensureStreamExists(streamId);
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
