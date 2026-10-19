import { json } from "../../lib/http";
import { seedDemoUser } from "./users.service";

export async function postSeedUser() {
  const user = await seedDemoUser();
  return json(user, 201);
}
