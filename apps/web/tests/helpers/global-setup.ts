import { MongoMemoryReplSet } from "mongodb-memory-server";

let replSet: MongoMemoryReplSet | undefined;

/** One in-memory replica set (transactions need it) shared by the whole test run. */
export async function setup() {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  process.env.TEST_MONGODB_URI = replSet.getUri();
}

export async function teardown() {
  await replSet?.stop();
}
