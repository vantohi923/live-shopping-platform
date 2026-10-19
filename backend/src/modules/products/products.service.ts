import { prisma } from "../../lib/prisma";

export interface CreateProductInput {
  streamId: string;
  title: string;
  description?: string;
  price: number | string;
  stock?: number;
  imageUrl?: string;
  isPinned?: boolean;
}

export function createProduct(input: CreateProductInput) {
  return prisma.product.create({
    data: {
      title: input.title,
      description: input.description || "",
      price: Number(input.price),
      stock: input.stock ?? 10,
      imageUrl:
        input.imageUrl ||
        "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=500",
      streamId: input.streamId,
      isPinned: input.isPinned ?? false,
    },
  });
}
