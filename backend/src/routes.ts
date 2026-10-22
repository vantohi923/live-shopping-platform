import { handle, json, preflight } from "./lib/http";
import {
  deleteProduct,
  getStreamProducts,
  patchProduct,
  postPinProduct,
  postProduct,
} from "./modules/products/products.routes";
import { getStreams, postStream } from "./modules/streams/streams.routes";

export const routes = {
  "/health": { GET: handle(() => json({ status: "ok" })) },
  "/api/streams": { GET: handle(getStreams), POST: handle(postStream) },
  "/api/streams/:id/products": { GET: handle(getStreamProducts) },
  "/api/streams/:id/pin": { POST: handle(postPinProduct) },
  "/api/products": { POST: handle(postProduct) },
  "/api/products/:id": { PATCH: handle(patchProduct), DELETE: handle(deleteProduct) },
};

export const fallback = handle((req: Request) => {
  if (req.method === "OPTIONS") {
    return preflight();
  }
  return json({ error: "Not Found" }, 404);
});
