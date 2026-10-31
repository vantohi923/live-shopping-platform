import { json, parseBody } from "../../lib/http";
import { requireStreamer } from "../../middleware/auth";
import { CreateStreamSchema } from "./streams.schema";
import { createStream, listStreams } from "./streams.service";

export async function getStreams() {
  const streams = await listStreams();
  return json(streams);
}

export async function postStream(req: Request) {
  const user = await requireStreamer(req);
  const body = await parseBody(req, CreateStreamSchema);
  const stream = await createStream(user.id, body);
  return json(stream, 201);
}
