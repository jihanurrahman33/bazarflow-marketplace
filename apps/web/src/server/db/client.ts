import { MongoClient, type Db } from "mongodb";
import { getEnv } from "../config/env";

interface Holder {
  client?: MongoClient;
  promise?: Promise<MongoClient>;
}
// Survives Next.js dev hot reloads.
const holder: Holder = ((globalThis as { __bfMongo?: Holder }).__bfMongo ??= {});

export async function getClient(): Promise<MongoClient> {
  if (holder.client) return holder.client;
  holder.promise ??= new MongoClient(getEnv().MONGODB_URI, {
    maxPoolSize: 20,
    retryWrites: true,
    serverSelectionTimeoutMS: 10_000,
  })
    .connect()
    .then((c) => (holder.client = c))
    .catch((e) => {
      holder.promise = undefined;
      throw e;
    });
  return holder.promise;
}

export async function getDb(): Promise<Db> {
  return (await getClient()).db(getEnv().MONGODB_DB);
}

export async function closeClient(): Promise<void> {
  const c = holder.client ?? (await holder.promise?.catch(() => undefined));
  holder.client = undefined;
  holder.promise = undefined;
  await c?.close();
}
