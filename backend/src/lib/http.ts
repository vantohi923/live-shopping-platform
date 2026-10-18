import { env } from "../config/env";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new HttpError(400, "Body-ul cererii nu este JSON valid");
  }
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
        return withCors(json({ error: err.message }, err.status));
      }
      console.error(err);
      return withCors(json({ error: "Eroare internă de server" }, 500));
    }
  };
}
