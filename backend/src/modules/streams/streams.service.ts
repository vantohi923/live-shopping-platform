import { Role } from "@prisma/client";
import { HttpError } from "../../lib/http";
import { prisma } from "../../lib/prisma";
import type { CreateStreamInput } from "./streams.schema";

export function listStreams() {
  return prisma.stream.findMany({
    include: { products: true, user: true },
  });
}

export async function createStream(input: CreateStreamInput) {
  const user = await prisma.user.findFirst({ where: { role: Role.STREAMER } });
  if (!user) {
    throw new HttpError(400, "Nu exista niciun streamer. Ruleaza: bun run db:seed");
  }

  return prisma.stream.create({
    data: {
      title: input.title ?? "Live Stream Demonstrativ",
      isLive: true,
      userId: user.id,
    },
  });
}
