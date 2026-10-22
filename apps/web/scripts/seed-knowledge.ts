import { loadDotEnv } from "./_env";
loadDotEnv();

const { FAQ } = await import("../src/lib/faq");
const { upsertKnowledge, reindexKnowledge } = await import("../src/server/modules/support/knowledge");
const { closeClient } = await import("../src/server/db/client");

// Public help content is reviewed in code review, so it is approved on ingestion. Seller/admin-only documents are
// created through the admin API (draft -> approve) instead.
for (const f of FAQ) await upsertKnowledge(null, { sourceId: f.id, title: f.q, body: f.a, visibility: "public" }, { autoApprove: true });
console.log(`ingested ${FAQ.length} help articles; reindexed ${await reindexKnowledge()} documents`);
await closeClient();
