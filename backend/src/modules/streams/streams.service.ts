import { prisma } from "../../lib/prisma";
import type { CreateStreamInput } from "./streams.schema";

export function listStreams() {
  return prisma.stream.findMany({
    include: { products: true, user: { select: { id: true, name: true } } },
  });
}

export function createStream(userId: string, input: CreateStreamInput) {
  return prisma.stream.create({
    data: {
      title: input.title ?? "Live Stream Demonstrativ",
      isLive: true,
      userId,
    },
  });
}
