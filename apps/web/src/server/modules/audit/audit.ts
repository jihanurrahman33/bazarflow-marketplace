import type { ClientSession } from "mongodb";
import { getCollections } from "@/server/db/collections";
import type { Role } from "@/server/db/schema";
import { newId } from "@/server/shared/ids";
import { ObjectId } from "mongodb";

export interface AuditInput {
  actorId?: ObjectId;
  actorRole?: Role | "system";
  action: string;
  resourceType: string;
  resourceId?: string;
  reason?: string;
  before?: unknown;
  after?: unknown;
  requestId?: string;
  ip?: string;
}

/** Append-only. Callers pass already-redacted before/after snapshots. */
export async function writeAudit(input: AuditInput, session?: ClientSession): Promise<void> {
  const c = await getCollections();
  await c.auditLogs.insertOne({ _id: newId(), createdAt: new Date(), ...input }, { session });
}
