import { prisma } from "../../lib/prisma";

export function seedDemoUser() {
  return prisma.user.upsert({
    where: { email: "streamer@liveshop.local" },
    update: {},
    create: {
      email: "streamer@liveshop.local",
      name: "Live Shop Demo User",
      role: "STREAMER",
    },
  });
}
