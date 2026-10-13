import { db } from "./index";

export async function findProfileById(id: string) {
  return db.query.demoProfiles.findFirst({
    where: (p, { eq }) => eq(p.id, id),
  });
}
