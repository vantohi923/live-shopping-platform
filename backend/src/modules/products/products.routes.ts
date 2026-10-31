import type { BunRequest } from "bun";
import { json, noContent, parseBody, parseId } from "../../lib/http";
import { requireStreamer } from "../../middleware/auth";
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
  const user = await requireStreamer(req);
  const body = await parseBody(req, CreateProductSchema);
  const product = await createProduct(user.id, body);
  return json(product, 201);
}

export async function patchProduct(req: BunRequest<"/api/products/:id">) {
  const user = await requireStreamer(req);
  const id = parseId(req.params.id);
  const body = await parseBody(req, UpdateProductSchema);
  const product = await updateProduct(user.id, id, body);
  return json(product);
}

export async function deleteProduct(req: BunRequest<"/api/products/:id">) {
  const user = await requireStreamer(req);
  await removeProduct(user.id, parseId(req.params.id));
  return noContent();
}

export async function postPinProduct(req: BunRequest<"/api/streams/:id/pin">) {
  const user = await requireStreamer(req);
  const streamId = parseId(req.params.id);
  const { productId } = await parseBody(req, PinProductSchema);
  const product = await pinProduct(user.id, streamId, productId);
  return json(product);
}
