import { applyTestEnv } from "./env";
import { closeClient, getDb } from "@/server/db/client";
import { ensureIndexes } from "@/server/db/indexes";

/** Fresh database per test file: unique db name, env wired, indexes ensured. */
export async function setupTestDb(overrides: Record<string, string> = {}) {
  const dbName = `bf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  applyTestEnv({ MONGODB_DB: dbName, ...overrides });
  const db = await getDb();
  await ensureIndexes(db);
  return db;
}

export async function teardownTestDb() {
  const db = await getDb();
  await db.dropDatabase();
  await closeClient();
}
