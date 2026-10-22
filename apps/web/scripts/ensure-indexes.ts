import { loadDotEnv } from "./_env";
loadDotEnv();

const { getDb, closeClient } = await import("../src/server/db/client");
const { ensureIndexes } = await import("../src/server/db/indexes");

const db = await getDb();
await ensureIndexes(db);
console.log(`indexes ensured on ${db.databaseName}`);
await closeClient();
