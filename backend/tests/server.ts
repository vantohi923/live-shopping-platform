import { afterAll, beforeAll } from "bun:test";
import { fallback, routes } from "../src/routes";

export function useServer() {
  let server: ReturnType<typeof Bun.serve>;
  let base: string;

  beforeAll(() => {
    server = Bun.serve({ port: 0, routes, fetch: fallback });
    base = `http://localhost:${server.port}`;
  });

  afterAll(() => {
    server.stop();
  });

  return function send(method: string, path: string, body?: unknown, token?: string, scheme = "Bearer") {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (token) headers.Authorization = `${scheme} ${token}`;
    return fetch(base + path, {
      method,
      headers,
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });
  };
}
