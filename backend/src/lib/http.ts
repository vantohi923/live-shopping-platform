import { z } from "zod";
import { env } from "../config/env";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

export function noContent(): Response {
  return new Response(null, { status: 204 });
}

export function parseId(value: string): string {
  const result = z.uuid().safeParse(value);
  if (!result.success) {
    throw new HttpError(400, "ID invalid in URL");
  }
  return result.data;
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new HttpError(400, "Body-ul cererii nu este JSON valid");
  }
}

export async function parseBody<T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T>> {
  const result = schema.safeParse(await readJson(req));
  if (!result.success) {
    const details = result.error.issues.map((issue) => ({
      field: issue.path.join("."),
      message: issue.message,
    }));
    throw new HttpError(400, "Date invalide", details);
  }
  return result.data;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": env.FRONTEND_URL,
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function withCors(res: Response): Response {
  for (const [key, value] of Object.entries(corsHeaders)) {
    res.headers.set(key, value);
  }
  return res;
}

export function preflight(): Response {
  return withCors(new Response(null, { status: 204 }));
}

export function handle<R extends Request>(fn: (req: R) => Response | Promise<Response>) {
  return async (req: R): Promise<Response> => {
    try {
      return withCors(await fn(req));
    } catch (err) {
      if (err instanceof HttpError) {
        return withCors(json({ error: err.message, details: err.details }, err.status));
      }
      console.error(err);
      return withCors(json({ error: "Eroare internă de server" }, 500));
    }
  };
}
