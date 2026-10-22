import { z } from "zod";

export const CreateStreamSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
});

export type CreateStreamInput = z.infer<typeof CreateStreamSchema>;
