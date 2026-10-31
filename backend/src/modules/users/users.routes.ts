import { json } from "../../lib/http";
import { requireUser } from "../../middleware/auth";

export async function getMe(req: Request) {
  const { id, email, name, role, createdAt } = await requireUser(req);
  return json({ id, email, name, role, createdAt });
}
