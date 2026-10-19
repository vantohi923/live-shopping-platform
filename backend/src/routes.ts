import { handle, json, preflight } from "./lib/http";
import { postProduct } from "./modules/products/products.routes";
import { getStreams, postStream } from "./modules/streams/streams.routes";
import { postSeedUser } from "./modules/users/users.routes";

export const routes = {
  "/health": { GET: handle(() => json({ status: "ok" })) },
  "/api/users/seed": { POST: handle(postSeedUser) },
  "/api/streams": { GET: handle(getStreams), POST: handle(postStream) },
  "/api/products": { POST: handle(postProduct) },
};

export const fallback = handle((req: Request) => {
  if (req.method === "OPTIONS") {
    return preflight();
  }
  return json({ error: "Not Found" }, 404);
});
