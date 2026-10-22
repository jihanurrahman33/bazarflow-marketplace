import type { ClientSession } from "mongodb";
import { getClient } from "./client";

/**
 * Unit-of-work boundary. Keep the callback short and NEVER perform external I/O
 * (payment providers, HTTP, email) inside it — the driver may retry the callback.
 */
export async function withTransaction<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
  const client = await getClient();
  const session = client.startSession();
  try {
    let result!: T;
    await session.withTransaction(
      async () => {
        result = await fn(session);
      },
      { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" }, readPreference: "primary" },
    );
    return result;
  } finally {
    await session.endSession();
  }
}
