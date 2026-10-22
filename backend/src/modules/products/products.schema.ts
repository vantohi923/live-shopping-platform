import { z } from "zod";

export const CreateProductSchema = z.object({
  streamId: z.uuid(),
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).optional(),
  priceCents: z.number().int().positive(),
  stock: z.number().int().min(0).default(10),
  imageUrl: z.url().optional(),
});

export const UpdateProductSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    description: z.string().trim().max(2000),
    priceCents: z.number().int().positive(),
    stock: z.number().int().min(0),
    imageUrl: z.url(),
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: "Trimite cel putin un camp de modificat",
  });

export const PinProductSchema = z.object({
  productId: z.uuid(),
});

export type CreateProductInput = z.infer<typeof CreateProductSchema>;
export type UpdateProductInput = z.infer<typeof UpdateProductSchema>;
