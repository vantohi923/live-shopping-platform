import type { BunRequest } from "bun";
import { json, noContent, parseBody, parseId } from "../../lib/http";
import { CreateProductSchema, PinProductSchema, UpdateProductSchema } from "./products.schema";
import {
  createProduct,
  listProductsForStream,
  pinProduct,
  removeProduct,
  updateProduct,
} from "./products.service";

export async function getStreamProducts(req: BunRequest<"/api/streams/:id/products">) {
  const products = await listProductsForStream(parseId(req.params.id));
  return json(products);
}

export async function postProduct(req: Request) {
  const body = await parseBody(req, CreateProductSchema);
  const product = await createProduct(body);
  return json(product, 201);
}

export async function patchProduct(req: BunRequest<"/api/products/:id">) {
  const id = parseId(req.params.id);
  const body = await parseBody(req, UpdateProductSchema);
  const product = await updateProduct(id, body);
  return json(product);
}

export async function deleteProduct(req: BunRequest<"/api/products/:id">) {
  await removeProduct(parseId(req.params.id));
  return noContent();
}

export async function postPinProduct(req: BunRequest<"/api/streams/:id/pin">) {
  const streamId = parseId(req.params.id);
  const { productId } = await parseBody(req, PinProductSchema);
  const product = await pinProduct(streamId, productId);
  return json(product);
}
