import { HttpError, json, readJson } from "../../lib/http";
import { createProduct, type CreateProductInput } from "./products.service";

export async function postProduct(req: Request) {
  const body = (await readJson(req)) as CreateProductInput;
  if (!body.streamId || !body.title || !body.priceCents) {
    throw new HttpError(400, "Lipseste streamId, title sau priceCents");
  }

  const product = await createProduct(body);
  return json(product, 201);
}
