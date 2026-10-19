import { HttpError } from "../../lib/http";
import { prisma } from "../../lib/prisma";

export function listStreams() {
  return prisma.stream.findMany({
    include: { products: true, user: true },
  });
}

export async function createStream(title?: string) {
  const user = await prisma.user.findFirst();
  if (!user) {
    throw new HttpError(400, "Nu exista utilizator. Ruleaza seed mai intai!");
  }

  return prisma.stream.create({
    data: {
      title: title || "Live Stream Demonstrativ",
      isLive: true,
      userId: user.id,
    },
  });
}
