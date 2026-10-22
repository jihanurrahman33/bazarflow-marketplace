import { loadDotEnv } from "./_env";
loadDotEnv();

const { runWorkerTick } = await import("../src/server/modules/outbox/tick");
const { closeClient } = await import("../src/server/db/client");

const once = process.argv.includes("--once");
let stopping = false;
process.on("SIGINT", () => (stopping = true));
process.on("SIGTERM", () => (stopping = true));

do {
  const r = await runWorkerTick(25_000).catch((e) => { console.error("tick failed", e instanceof Error ? e.name : e); return null; });
  if (r && (r.expiredOrders || r.reconciledPayments || r.refundRetries || r.outboxProcessed)) console.log(JSON.stringify({ job: "tick", ...r }));
  if (once) break;
  if (!r || r.outboxProcessed === 0) await new Promise((res) => setTimeout(res, 2000));
} while (!stopping);

await closeClient();
