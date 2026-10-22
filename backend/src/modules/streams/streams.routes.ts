import { json, parseBody } from "../../lib/http";
import { CreateStreamSchema } from "./streams.schema";
import { createStream, listStreams } from "./streams.service";

export async function getStreams() {
  const streams = await listStreams();
  return json(streams);
}

export async function postStream(req: Request) {
  const body = await parseBody(req, CreateStreamSchema);
  const stream = await createStream(body);
  return json(stream, 201);
}
