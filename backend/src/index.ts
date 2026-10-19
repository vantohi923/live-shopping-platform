import { env } from "./config/env";
import { fallback, routes } from "./routes";

const server = Bun.serve({
  port: env.PORT,
  routes,
  fetch: fallback,
});

console.log(`🚀 Serverul backend Bun ruleaza pe http://localhost:${server.port}`);
