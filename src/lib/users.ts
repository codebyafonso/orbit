import { getDb } from "./mongo";

export async function upsertUser(u: {
  vercelUserId: string;
  username: string | null;
  name: string | null;
  avatarUrl: string | null;
}): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.collection("users").updateOne(
    { vercelUserId: u.vercelUserId },
    {
      $set: { username: u.username, name: u.name, avatarUrl: u.avatarUrl, lastLoginAt: new Date() },
      $setOnInsert: { createdAt: new Date(), preferences: {} },
    },
    { upsert: true },
  );
}
