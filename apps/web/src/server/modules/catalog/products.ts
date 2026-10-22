import { MongoServerError, ObjectId, type Filter } from "mongodb";
import { queueWishlistAlert } from "@/server/modules/wishlist/service";
import { getCollections } from "@/server/db/collections";
import { withTransaction } from "@/server/db/transaction";
import type { MediaRef, ProductDoc, ProductStatus, VariantDef } from "@/server/db/schema";
import { AppError } from "@/server/shared/errors";
import { newId, randomToken } from "@/server/shared/ids";
import { DEFAULT_CURRENCY } from "@/server/shared/money";
import { decodeCursor, encodeCursor, slicePage } from "@/server/shared/pagination";
import { slugify } from "@/server/shared/slug";
import { defineStateMachine } from "@/server/shared/state-machine";
import { writeAudit } from "@/server/modules/audit/audit";
import { enqueue } from "@/server/modules/outbox/outbox";
import type { Actor } from "@/server/modules/authorization/actor";
import { getMediaProvider, vendorMediaFolder } from "@/server/modules/media/cloudinary";
import { requireActiveVendor } from "@/server/modules/vendors/service";
import { invalidateCatalog } from "./cache";

export const productMachine = defineStateMachine({
  draft: ["pending_review", "archived"],
  pending_review: ["published", "rejected", "draft"],
  rejected: ["pending_review", "archived"],
  published: ["pending_review", "archived"],
  archived: ["draft"],
} as const);

const MAX_VARIANTS = 100;
const MAX_MEDIA = 10;

export interface VariantInput {
  sku: string;
  optionValues: Record<string, string>;
  priceMinor: number;
  compareAtMinor?: number;
  initialStock: number;
}

export interface CreateProductInput {
  title: string;
  description: string;
  categoryIds: ObjectId[];
  options: { name: string; values: string[] }[];
  variants: VariantInput[];
}

// ---------- validation helpers ----------

function validateVariantShape(options: { name: string; values: string[] }[], variants: { sku: string; optionValues: Record<string, string>; priceMinor: number; compareAtMinor?: number }[]) {
  if (variants.length === 0 || variants.length > MAX_VARIANTS) {
    throw new AppError("VALIDATION_FAILED", { details: [{ field: "variants", code: "OUT_OF_RANGE" }] });
  }
  const names = new Set(options.map((o) => o.name));
  if (names.size !== options.length) throw new AppError("VALIDATION_FAILED", { details: [{ field: "options", code: "DUPLICATE_OPTION" }] });
  const skus = new Set<string>();
  const combos = new Set<string>();
  for (const v of variants) {
    if (skus.has(v.sku)) throw new AppError("VALIDATION_FAILED", { details: [{ field: "variants.sku", code: "DUPLICATE_SKU" }] });
    skus.add(v.sku);
    const keys = Object.keys(v.optionValues);
    if (keys.length !== options.length || !keys.every((k) => names.has(k))) {
      throw new AppError("VALIDATION_FAILED", { details: [{ field: "variants.optionValues", code: "OPTION_MISMATCH" }] });
    }
    for (const o of options) {
      if (!o.values.includes(v.optionValues[o.name]!)) throw new AppError("VALIDATION_FAILED", { details: [{ field: "variants.optionValues", code: "UNKNOWN_OPTION_VALUE" }] });
    }
    const combo = options.map((o) => v.optionValues[o.name]).join("\u0000");
    if (combos.has(combo)) throw new AppError("VALIDATION_FAILED", { details: [{ field: "variants.optionValues", code: "DUPLICATE_COMBINATION" }] });
    combos.add(combo);
    if (v.compareAtMinor != null && v.compareAtMinor <= v.priceMinor) {
      throw new AppError("VALIDATION_FAILED", { details: [{ field: "variants.compareAtMinor", code: "MUST_EXCEED_PRICE" }] });
    }
  }
}

const minPrice = (variants: VariantDef[]): number => {
  const active = variants.filter((v) => v.active);
  return Math.min(...(active.length ? active : variants).map((v) => v.priceMinor));
};

async function assertCategories(ids: ObjectId[]) {
  const c = await getCollections();
  if (ids.length === 0) throw new AppError("VALIDATION_FAILED", { details: [{ field: "categoryIds", code: "REQUIRED" }] });
  const found = await c.categories.countDocuments({ _id: { $in: ids }, visible: true });
  if (found !== new Set(ids.map(String)).size) throw new AppError("VALIDATION_FAILED", { details: [{ field: "categoryIds", code: "NOT_FOUND" }] });
}

export function variantLabel(v: Pick<VariantDef, "optionValues">): string {
  return Object.values(v.optionValues).join(" / ") || "Default";
}

// ---------- DTOs ----------

export const toVendorProductDto = (p: ProductDoc, stock?: Map<string, { onHand: number; reserved: number; inventoryItemId: string }>) => ({
  id: p._id.toHexString(), slug: p.slug, title: p.title, description: p.description, status: p.status,
  categoryIds: p.categoryIds.map((x) => x.toHexString()), options: p.options, currency: p.currency,
  variants: p.variants.map((v) => ({ ...v, ...(stock?.get(v.variantId) ? { stock: stock.get(v.variantId) } : {}) })),
  media: p.media, minPriceMinor: p.minPriceMinor,
  moderation: p.moderation ? { reason: p.moderation.reason, at: p.moderation.at.toISOString() } : undefined,
  publishedAt: p.publishedAt?.toISOString(), createdAt: p.createdAt.toISOString(), updatedAt: p.updatedAt.toISOString(),
});

// ---------- vendor operations ----------

export async function createProduct(actor: Actor & { vendorId: ObjectId }, input: CreateProductInput) {
  await requireActiveVendor(actor.vendorId);
  validateVariantShape(input.options, input.variants);
  await assertCategories(input.categoryIds);

  const c = await getCollections();
  const now = new Date();
  const variants: VariantDef[] = input.variants.map((v) => ({
    variantId: randomToken(6), sku: v.sku, optionValues: v.optionValues, priceMinor: v.priceMinor, compareAtMinor: v.compareAtMinor, active: true,
  }));
  const productId = newId();

  for (let attempt = 0; attempt < 5; attempt++) {
    const doc: ProductDoc = {
      _id: productId, vendorId: actor.vendorId, categoryIds: input.categoryIds,
      slug: `${slugify(input.title) || "product"}-${randomToken(4).toLowerCase().replace(/[^a-z0-9]/g, "x")}`,
      title: input.title.trim(), description: input.description.trim(), status: "draft", currency: DEFAULT_CURRENCY,
      options: input.options, variants, media: [], minPriceMinor: minPrice(variants), vendorActive: true, version: 1, createdAt: now, updatedAt: now,
    };
    try {
      const items = variants.map((v, i) => ({
        _id: newId(), vendorId: actor.vendorId, productId, variantId: v.variantId, sku: v.sku,
        onHand: input.variants[i]!.initialStock, reserved: 0, version: 1, updatedAt: now,
      }));
      await withTransaction(async (session) => {
        await c.products.insertOne(doc, { session });
        await c.inventoryItems.insertMany(items, { session });
        const initial = items.filter((i) => i.onHand > 0);
        if (initial.length) {
          await c.inventoryMovements.insertMany(
            initial.map((i) => ({
              _id: newId(), inventoryItemId: i._id, vendorId: actor.vendorId, sku: i.sku, kind: "adjust" as const,
              deltaOnHand: i.onHand, deltaReserved: 0, reason: "initial stock", actorId: actor.userId, createdAt: now,
            })),
            { session },
          );
        }
      });
      return toVendorProductDto(doc);
    } catch (e) {
      if (e instanceof MongoServerError && e.code === 11000) {
        const msg = String(e.message);
        if (msg.includes("uq_products_vendor_sku") || msg.includes("uq_inventory_vendor_sku")) {
          throw new AppError("CONFLICT", { message: "One of the SKUs is already used by your store.", details: [{ field: "variants.sku", code: "TAKEN" }] });
        }
        continue; // slug collision: retry with a new suffix
      }
      throw e;
    }
  }
  throw new AppError("INTERNAL", { message: "Could not allocate a product slug." });
}

async function loadOwned(vendorId: ObjectId, id: ObjectId): Promise<ProductDoc> {
  const c = await getCollections();
  // Ownership is in the filter: another vendor's product is simply "not found".
  const p = await c.products.findOne({ _id: id, vendorId });
  if (!p) throw new AppError("NOT_FOUND");
  return p;
}

export async function getVendorProduct(vendorId: ObjectId, id: ObjectId) {
  const p = await loadOwned(vendorId, id);
  const c = await getCollections();
  const items = await c.inventoryItems.find({ productId: p._id }).toArray();
  const stock = new Map(items.map((i) => [i.variantId, { onHand: i.onHand, reserved: i.reserved, inventoryItemId: i._id.toHexString() }]));
  return toVendorProductDto(p, stock);
}

export async function listVendorProducts(vendorId: ObjectId, q: { status?: ProductStatus; limit: number; cursor?: string }) {
  const c = await getCollections();
  const cur = decodeCursor<{ id: string }>(q.cursor);
  const filter: Filter<ProductDoc> = { vendorId };
  if (q.status) filter.status = q.status;
  if (cur) filter._id = { $lt: new ObjectId(cur.id) };
  const rows = await c.products.find(filter).sort({ _id: -1 }).limit(q.limit + 1).toArray();
  const { items, hasMore } = slicePage(rows, q.limit);
  const last = items[items.length - 1];
  const inv = items.length ? await c.inventoryItems.find({ productId: { $in: items.map((p) => p._id) } }).toArray() : [];
  const stockOf = (productId: ObjectId) => new Map(inv.filter((i) => i.productId.equals(productId)).map((i) => [i.variantId, { onHand: i.onHand, reserved: i.reserved, inventoryItemId: i._id.toHexString() }]));
  return { items: items.map((p) => toVendorProductDto(p, stockOf(p._id))), nextCursor: hasMore && last ? encodeCursor({ id: last._id.toHexString() }) : null };
}

export interface UpdateProductInput {
  title?: string;
  description?: string;
  categoryIds?: ObjectId[];
  media?: { publicId: string }[];
}

/** Fields that change what shoppers see; editing them on a published product sends it back through moderation. */
const CONTENT_FIELDS = ["title", "description", "categoryIds", "media"] as const;

export async function updateProduct(actor: { userId: ObjectId; vendorId: ObjectId }, id: ObjectId, input: UpdateProductInput) {
  const vendor = await requireActiveVendor(actor.vendorId);
  const current = await loadOwned(actor.vendorId, id);
  if (current.status === "pending_review" || current.status === "archived") {
    throw new AppError("INVALID_STATE_TRANSITION", { message: `A ${current.status.replace("_", " ")} product cannot be edited.` });
  }
  const $set: Partial<ProductDoc> = { updatedAt: new Date() };
  if (input.title !== undefined) $set.title = input.title.trim();
  if (input.description !== undefined) $set.description = input.description.trim();
  if (input.categoryIds !== undefined) {
    await assertCategories(input.categoryIds);
    $set.categoryIds = input.categoryIds;
  }
  if (input.media !== undefined) $set.media = await bindMedia(vendor._id, input.media);

  const touchesContent = CONTENT_FIELDS.some((f) => input[f] !== undefined);
  let nextStatus: ProductStatus = current.status;
  if (current.status === "published" && touchesContent) nextStatus = "pending_review";
  if (nextStatus !== current.status) {
    productMachine.assert(current.status, nextStatus);
    $set.status = nextStatus;
    $set.vendorActive = vendor.status === "active";
  }
  const updated = await (await getCollections()).products.findOneAndUpdate(
    { _id: id, vendorId: actor.vendorId, version: current.version },
    { $set, $inc: { version: 1 } },
    { returnDocument: "after" },
  );
  if (!updated) throw new AppError("CONFLICT", { message: "The product was changed elsewhere. Reload and retry." });
  if (current.status === "published") await invalidateCatalog(updated.slug);
  return toVendorProductDto(updated);
}

/**
 * Bind uploaded assets to the product: the public id must sit under this vendor's folder (so one vendor can
 * never attach another's assets), exist at the provider, and delivery URLs are built centrally.
 */
async function bindMedia(vendorId: ObjectId, refs: { publicId: string }[]): Promise<MediaRef[]> {
  if (refs.length > MAX_MEDIA) throw new AppError("VALIDATION_FAILED", { details: [{ field: "media", code: "TOO_MANY" }] });
  const prefix = `${vendorMediaFolder(vendorId.toHexString())}/`;
  const provider = getMediaProvider();
  const out: MediaRef[] = [];
  const seen = new Set<string>();
  for (const [position, ref] of refs.entries()) {
    if (!ref.publicId.startsWith(prefix) || ref.publicId.includes("..") || seen.has(ref.publicId)) {
      throw new AppError("VALIDATION_FAILED", { details: [{ field: `media.${position}.publicId`, code: "NOT_OWNED" }] });
    }
    seen.add(ref.publicId);
    const asset = await provider.verifyAsset(ref.publicId);
    if (!asset) throw new AppError("VALIDATION_FAILED", { details: [{ field: `media.${position}.publicId`, code: "ASSET_NOT_FOUND" }] });
    out.push({ publicId: ref.publicId, url: provider.deliveryUrl(ref.publicId, "gallery"), width: asset.width, height: asset.height, position });
  }
  return out;
}

export async function addVariants(actor: { userId: ObjectId; vendorId: ObjectId }, id: ObjectId, input: { newOptionValues?: Record<string, string[]>; variants: VariantInput[] }) {
  await requireActiveVendor(actor.vendorId);
  const current = await loadOwned(actor.vendorId, id);
  if (current.status === "pending_review" || current.status === "archived") throw new AppError("INVALID_STATE_TRANSITION");
  const options = current.options.map((o) => ({ name: o.name, values: [...new Set([...o.values, ...(input.newOptionValues?.[o.name] ?? [])])] }));
  const newVariants: VariantDef[] = input.variants.map((v) => ({
    variantId: randomToken(6), sku: v.sku, optionValues: v.optionValues, priceMinor: v.priceMinor, compareAtMinor: v.compareAtMinor, active: true,
  }));
  validateVariantShape(options, [...current.variants, ...newVariants]);
  const c = await getCollections();
  const now = new Date();
  try {
    await withTransaction(async (session) => {
      const res = await c.products.updateOne(
        { _id: id, vendorId: actor.vendorId, version: current.version },
        { $set: { options, variants: [...current.variants, ...newVariants], minPriceMinor: minPrice([...current.variants, ...newVariants]), updatedAt: now }, $inc: { version: 1 } },
        { session },
      );
      if (res.modifiedCount !== 1) throw new AppError("CONFLICT");
      await c.inventoryItems.insertMany(
        newVariants.map((v, i) => ({ _id: newId(), vendorId: actor.vendorId, productId: id, variantId: v.variantId, sku: v.sku, onHand: input.variants[i]!.initialStock, reserved: 0, version: 1, updatedAt: now })),
        { session },
      );
    });
  } catch (e) {
    if (e instanceof MongoServerError && e.code === 11000) throw new AppError("CONFLICT", { message: "One of the SKUs is already used by your store.", details: [{ field: "variants.sku", code: "TAKEN" }] });
    throw e;
  }
  if (current.status === "published") await invalidateCatalog(current.slug);
  return getVendorProduct(actor.vendorId, id);
}

export async function updateVariant(
  actor: { userId: ObjectId; vendorId: ObjectId },
  id: ObjectId,
  variantId: string,
  patch: { priceMinor?: number; compareAtMinor?: number | null; active?: boolean },
) {
  await requireActiveVendor(actor.vendorId);
  const current = await loadOwned(actor.vendorId, id);
  const idx = current.variants.findIndex((v) => v.variantId === variantId);
  if (idx < 0) throw new AppError("NOT_FOUND");
  const next = current.variants.map((v) => ({ ...v }));
  const v = next[idx]!;
  if (patch.priceMinor !== undefined) v.priceMinor = patch.priceMinor;
  if (patch.compareAtMinor === null) delete v.compareAtMinor;
  else if (patch.compareAtMinor !== undefined) v.compareAtMinor = patch.compareAtMinor;
  if (patch.active !== undefined) v.active = patch.active;
  if (v.compareAtMinor != null && v.compareAtMinor <= v.priceMinor) {
    throw new AppError("VALIDATION_FAILED", { details: [{ field: "compareAtMinor", code: "MUST_EXCEED_PRICE" }] });
  }
  if (!next.some((x) => x.active) && current.status === "published") {
    throw new AppError("BUSINESS_RULE_VIOLATION", { message: "A published product needs at least one active variant." });
  }
  const c = await getCollections();
  const res = await c.products.findOneAndUpdate(
    { _id: id, vendorId: actor.vendorId, version: current.version },
    { $set: { variants: next, minPriceMinor: minPrice(next), updatedAt: new Date() }, $inc: { version: 1 } },
    { returnDocument: "after" },
  );
  if (!res) throw new AppError("CONFLICT");
  if (current.status === "published") await invalidateCatalog(current.slug);
  const before = current.variants[idx]!.priceMinor;
  if (current.status === "published" && patch.priceMinor !== undefined && patch.priceMinor < before && res.minPriceMinor < current.minPriceMinor) {
    await queueWishlistAlert("price_drop", id, { priceMinor: res.minPriceMinor, previousMinor: current.minPriceMinor, token: String(res.version) });
  }
  return getVendorProduct(actor.vendorId, id);
}

export async function submitForReview(actor: { userId: ObjectId; vendorId: ObjectId }, id: ObjectId) {
  await requireActiveVendor(actor.vendorId);
  const p = await loadOwned(actor.vendorId, id);
  productMachine.assert(p.status, "pending_review");
  if (p.media.length === 0) throw new AppError("BUSINESS_RULE_VIOLATION", { message: "Add at least one image before submitting.", details: [{ field: "media", code: "REQUIRED" }] });
  if (!p.variants.some((v) => v.active)) throw new AppError("BUSINESS_RULE_VIOLATION", { message: "Activate at least one variant." });
  const c = await getCollections();
  const res = await c.products.findOneAndUpdate(
    { _id: id, vendorId: actor.vendorId, status: p.status, version: p.version },
    { $set: { status: "pending_review", updatedAt: new Date() }, $unset: { moderation: "" }, $inc: { version: 1 } },
    { returnDocument: "after" },
  );
  if (!res) throw new AppError("INVALID_STATE_TRANSITION");
  return toVendorProductDto(res);
}

export async function archiveProduct(actor: { userId: ObjectId; vendorId: ObjectId }, id: ObjectId) {
  const p = await loadOwned(actor.vendorId, id);
  productMachine.assert(p.status, "archived");
  const c = await getCollections();
  const res = await c.products.findOneAndUpdate(
    { _id: id, vendorId: actor.vendorId, status: p.status, version: p.version },
    { $set: { status: "archived", updatedAt: new Date() }, $inc: { version: 1 } },
    { returnDocument: "after" },
  );
  if (!res) throw new AppError("INVALID_STATE_TRANSITION");
  if (p.status === "published") await invalidateCatalog(p.slug);
  return toVendorProductDto(res);
}

// ---------- admin moderation ----------

export async function reviewQueue(q: { limit: number; cursor?: string }) {
  const c = await getCollections();
  const cur = decodeCursor<{ id: string }>(q.cursor);
  const filter: Filter<ProductDoc> = { status: "pending_review" };
  if (cur) filter._id = { $gt: new ObjectId(cur.id) };
  const rows = await c.products.find(filter).sort({ _id: 1 }).limit(q.limit + 1).toArray();
  const { items, hasMore } = slicePage(rows, q.limit);
  const last = items[items.length - 1];
  return { items: items.map((p) => ({ ...toVendorProductDto(p), vendorId: p.vendorId.toHexString() })), nextCursor: hasMore && last ? encodeCursor({ id: last._id.toHexString() }) : null };
}

export async function moderateProduct(admin: Actor, id: ObjectId, decision: "published" | "rejected", reason: string | undefined, requestId?: string) {
  const c = await getCollections();
  const p = await c.products.findOne({ _id: id });
  if (!p) throw new AppError("NOT_FOUND");
  productMachine.assert(p.status, decision);
  const vendor = await c.vendors.findOne({ _id: p.vendorId });
  if (!vendor) throw new AppError("NOT_FOUND");
  if (decision === "published" && vendor.status !== "active") throw new AppError("VENDOR_NOT_ACTIVE");
  const now = new Date();
  const res = await withTransaction(async (session) => {
    const updated = await c.products.findOneAndUpdate(
      { _id: id, status: "pending_review", version: p.version },
      {
        $set: {
          status: decision, moderation: { reviewerId: admin.userId, reason, at: now }, updatedAt: now, vendorActive: vendor.status === "active",
          ...(decision === "published" ? { publishedAt: p.publishedAt ?? now } : {}),
        },
        $inc: { version: 1 },
      },
      { returnDocument: "after", session },
    );
    if (!updated) throw new AppError("INVALID_STATE_TRANSITION");
    await writeAudit(
      { actorId: admin.userId, actorRole: admin.role, action: decision === "published" ? "product.approve" : "product.reject", resourceType: "product", resourceId: id.toHexString(), reason, requestId },
      session,
    );
    await enqueue(
      {
        type: "notify.user", aggregateType: "product", aggregateId: id.toHexString(), dedupeKey: `product-${decision}:${id.toHexString()}:${updated.version}`,
        payload: { userId: vendor.ownerUserId.toHexString(), eventType: `product.${decision}`, title: decision === "published" ? "Product approved" : "Product rejected", body: `${p.title}${reason ? ` — ${reason}` : ""}`, deepLink: `/vendor/products/${id.toHexString()}` },
      },
      session,
    );
    return updated;
  });
  await invalidateCatalog(res.slug);
  return toVendorProductDto(res);
}

