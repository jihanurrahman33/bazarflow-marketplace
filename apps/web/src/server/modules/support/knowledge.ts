import { getCollections } from "@/server/db/collections";
import type { KnowledgeDocumentDoc } from "@/server/db/schema";
import { AppError } from "@/server/shared/errors";
import { newId, sha256Hex } from "@/server/shared/ids";
import { writeAudit } from "@/server/modules/audit/audit";
import type { Actor } from "@/server/modules/authorization/actor";
import { uniqueTokens } from "./text";

export interface KnowledgeInput {
  sourceId: string;
  title: string;
  body: string;
  visibility: KnowledgeDocumentDoc["visibility"];
  locale?: string;
}

const toDto = (d: KnowledgeDocumentDoc) => ({
  id: d._id.toHexString(), sourceId: d.sourceId, title: d.title, visibility: d.visibility, locale: d.locale, version: d.version, status: d.status, updatedAt: d.updatedAt.toISOString(),
});

/**
 * Create or update a source. Changed content gets a new version and goes back to `draft`, so edited text is never
 * served until someone approves it. Unchanged content is a no-op (idempotent ingestion).
 */
export async function upsertKnowledge(actor: Actor | null, input: KnowledgeInput, opts: { autoApprove?: boolean } = {}) {
  const c = await getCollections();
  const hash = sha256Hex(`${input.title}\n${input.body}\n${input.visibility}`);
  const existing = await c.knowledgeDocuments.findOne({ sourceId: input.sourceId });
  const now = new Date();
  const tokens = uniqueTokens(`${input.title} ${input.body}`);
  if (existing && existing.contentHash === hash) return toDto(existing);
  const status: KnowledgeDocumentDoc["status"] = opts.autoApprove ? "approved" : "draft";
  const doc = await c.knowledgeDocuments.findOneAndUpdate(
    { sourceId: input.sourceId },
    {
      $set: { title: input.title, body: input.body, visibility: input.visibility, locale: input.locale ?? "en", contentHash: hash, status, tokens, effectiveAt: now, updatedAt: now },
      $inc: { version: 1 },
      $setOnInsert: { _id: newId() },
    },
    { upsert: true, returnDocument: "after" },
  );
  if (!doc) throw new AppError("INTERNAL");
  await writeAudit({ actorId: actor?.userId, actorRole: actor ? "admin" : "system", action: "knowledge.upsert", resourceType: "knowledge", resourceId: input.sourceId, after: { version: doc.version, status } });
  return toDto(doc);
}

export async function setKnowledgeStatus(actor: Actor, sourceId: string, status: "approved" | "retired") {
  const c = await getCollections();
  const doc = await c.knowledgeDocuments.findOneAndUpdate({ sourceId }, { $set: { status, updatedAt: new Date() } }, { returnDocument: "after" });
  if (!doc) throw new AppError("NOT_FOUND");
  await writeAudit({ actorId: actor.userId, actorRole: "admin", action: `knowledge.${status}`, resourceType: "knowledge", resourceId: sourceId });
  return toDto(doc);
}

export async function listKnowledge(limit = 100) {
  const c = await getCollections();
  return (await c.knowledgeDocuments.find({}).sort({ sourceId: 1 }).limit(limit).toArray()).map(toDto);
}

/** Recompute search tokens for every document (run after changing the tokenizer/stemmer). */
export async function reindexKnowledge(): Promise<number> {
  const c = await getCollections();
  let n = 0;
  for await (const d of c.knowledgeDocuments.find({})) {
    await c.knowledgeDocuments.updateOne({ _id: d._id }, { $set: { tokens: uniqueTokens(`${d.title} ${d.body}`) } });
    n++;
  }
  return n;
}
