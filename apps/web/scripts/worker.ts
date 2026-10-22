import { loadDotEnv } from "./_env";
loadDotEnv();

const { processOutbox } = await import("../src/server/modules/outbox/outbox");
const { outboxHandlers } = await import("../src/server/modules/outbox/handlers");
const { closeClient } = await import("../src/server/db/client");

const once = process.argv.includes("--once");
let stopping = false;
process.on("SIGINT", () => (stopping = true));
process.on("SIGTERM", () => (stopping = true));

do {
  const n = await processOutbox(outboxHandlers);
  if (once) break;
  if (n === 0) await new Promise((r) => setTimeout(r, 2000));
} while (!stopping);

await closeClient();
