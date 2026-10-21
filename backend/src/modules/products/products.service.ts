import { prisma } from "../../lib/prisma";

export interface CreateProductInput {
  streamId: string;
  title: string;
  description?: string;
  priceCents: number;
  stock?: number;
  imageUrl?: string;
  isPinned?: boolean;
}

export function createProduct(input: CreateProductInput) {
  return prisma.product.create({
    data: {
      title: input.title,
      description: input.description || "",
      priceCents: input.priceCents,
      stock: input.stock ?? 10,
      imageUrl:
        input.imageUrl ||
        "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=500",
      streamId: input.streamId,
      isPinned: input.isPinned ?? false,
    },
  });
}
