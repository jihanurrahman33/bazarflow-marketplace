import { MongoServerError, ObjectId } from "mongodb";
import { getCollections } from "@/server/db/collections";
import type { CategoryDoc } from "@/server/db/schema";
import { AppError } from "@/server/shared/errors";
import { newId } from "@/server/shared/ids";
import { writeAudit } from "@/server/modules/audit/audit";
import type { Actor } from "@/server/modules/authorization/actor";

export const toCategoryDto = (c: CategoryDoc) => ({
  id: c._id.toHexString(), name: c.name, slug: c.slug, parentId: c.parentId?.toHexString() ?? null, sortOrder: c.sortOrder, visible: c.visible,
});

export async function createCategory(admin: Actor, input: { name: string; slug: string; parentId?: ObjectId; sortOrder: number }, requestId?: string) {
  const c = await getCollections();
  if (input.parentId) {
    const parent = await c.categories.findOne({ _id: input.parentId });
    if (!parent) throw new AppError("VALIDATION_FAILED", { details: [{ field: "parentId", code: "NOT_FOUND" }] });
    if (parent.parentId) throw new AppError("BUSINESS_RULE_VIOLATION", { message: "Categories support two levels only." });
  }
  const now = new Date();
  const doc: CategoryDoc = { _id: newId(), name: input.name, slug: input.slug, parentId: input.parentId, visible: true, sortOrder: input.sortOrder, createdAt: now, updatedAt: now };
  try {
    await c.categories.insertOne(doc);
  } catch (e) {
    if (e instanceof MongoServerError && e.code === 11000) throw new AppError("CONFLICT", { message: "Category slug already exists.", details: [{ field: "slug", code: "TAKEN" }] });
    throw e;
  }
  await writeAudit({ actorId: admin.userId, actorRole: admin.role, action: "category.create", resourceType: "category", resourceId: doc._id.toHexString(), requestId });
  return toCategoryDto(doc);
}

export async function updateCategory(admin: Actor, id: ObjectId, patch: { name?: string; sortOrder?: number; visible?: boolean }, requestId?: string) {
  const c = await getCollections();
  const res = await c.categories.findOneAndUpdate({ _id: id }, { $set: { ...patch, updatedAt: new Date() } }, { returnDocument: "after" });
  if (!res) throw new AppError("NOT_FOUND");
  await writeAudit({ actorId: admin.userId, actorRole: admin.role, action: "category.update", resourceType: "category", resourceId: id.toHexString(), after: patch, requestId });
  return toCategoryDto(res);
}

export interface CategoryNode extends ReturnType<typeof toCategoryDto> {
  children: ReturnType<typeof toCategoryDto>[];
}

export async function listCategoryTree(opts: { includeHidden?: boolean } = {}): Promise<CategoryNode[]> {
  const c = await getCollections();
  const rows = await c.categories.find(opts.includeHidden ? {} : { visible: true }).sort({ sortOrder: 1, name: 1 }).limit(500).toArray();
  const roots = rows.filter((r) => !r.parentId);
  return roots.map((r) => ({ ...toCategoryDto(r), children: rows.filter((x) => x.parentId?.equals(r._id)).map(toCategoryDto) }));
}
