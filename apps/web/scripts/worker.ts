import { loadDotEnv } from "./_env";
loadDotEnv();

const { processOutbox } = await import("../src/server/modules/outbox/outbox");
const { outboxHandlers } = await import("../src/server/modules/outbox/handlers");
const { expireUnpaidOrders } = await import("../src/server/modules/orders/service");
const { closeClient } = await import("../src/server/db/client");

const once = process.argv.includes("--once");
const MAINTENANCE_EVERY_MS = 30_000;
let stopping = false;
process.on("SIGINT", () => (stopping = true));
process.on("SIGTERM", () => (stopping = true));

/** Time-based jobs. Every one is idempotent, so running two workers is safe. */
async function maintenance() {
  const cancelled = await expireUnpaidOrders();
  if (cancelled) console.log(JSON.stringify({ job: "expireUnpaidOrders", cancelled }));
}

let lastMaintenance = 0;
do {
  if (Date.now() - lastMaintenance >= MAINTENANCE_EVERY_MS || once) {
    await maintenance().catch((e) => console.error("maintenance failed", e instanceof Error ? e.name : e));
    lastMaintenance = Date.now();
  }
  const n = await processOutbox(outboxHandlers);
  if (once) break;
  if (n === 0) await new Promise((r) => setTimeout(r, 2000));
} while (!stopping);

await closeClient();
