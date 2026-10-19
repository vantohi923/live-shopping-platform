import { json } from "../../lib/http";
import { createStream, listStreams } from "./streams.service";

export async function getStreams() {
  const streams = await listStreams();
  return json(streams);
}

export async function postStream(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { title?: string };
  const stream = await createStream(body.title);
  return json(stream, 201);
}
