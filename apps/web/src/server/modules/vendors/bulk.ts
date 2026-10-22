import type { ObjectId } from "mongodb";
import { getCollections } from "@/server/db/collections";
import { adjustStock } from "@/server/modules/inventory/service";
import { updateVariant } from "@/server/modules/catalog/products";
import { isAppError } from "@/server/shared/errors";

const messageOfError = (e: unknown) => (isAppError(e) ? e.message : "Could not update this row.");

export const MAX_BULK_ROWS = 500;
export interface BulkRow { sku: string; priceMinor?: number; stock?: number }
export interface BulkResult { sku: string; status: "updated" | "unchanged" | "error"; message?: string; price?: [number, number]; stock?: [number, number] }

/**
 * Change many variants' price and stock at once, matched by SKU. Only this seller's SKUs can match. Each row stands alone: a bad
 * row is reported and the rest still go through. With `dryRun` nothing is changed and the result shows what would happen.
 */
export async function bulkUpdate(actor: { userId: ObjectId; vendorId: ObjectId }, rows: BulkRow[], opts: { dryRun: boolean }): Promise<BulkResult[]> {
  const c = await getCollections();
  const skus = [...new Set(rows.map((r) => r.sku))];
  const [products, items] = await Promise.all([
    c.products.find({ vendorId: actor.vendorId, "variants.sku": { $in: skus } }).toArray(),
    c.inventoryItems.find({ vendorId: actor.vendorId, sku: { $in: skus } }).toArray(),
  ]);
  const variantOf = new Map<string, { productId: ObjectId; variantId: string; priceMinor: number; compareAtMinor?: number; status: string }>();
  for (const p of products) for (const v of p.variants) if (skus.includes(v.sku)) variantOf.set(v.sku, { productId: p._id, variantId: v.variantId, priceMinor: v.priceMinor, compareAtMinor: v.compareAtMinor, status: p.status });
  const stockOf = new Map(items.map((i) => [i.sku, i]));

  const results: BulkResult[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const out: BulkResult = { sku: row.sku, status: "unchanged" };
    results.push(out);
    const v = variantOf.get(row.sku);
    if (seen.has(row.sku)) { out.status = "error"; out.message = "This SKU appears more than once."; continue; }
    seen.add(row.sku);
    if (!v) { out.status = "error"; out.message = "No variant with this SKU in your store."; continue; }
    if (v.status === "archived" || v.status === "pending_review") { out.status = "error"; out.message = `This product is ${v.status.replace("_", " ")} and cannot be edited.`; continue; }
    // Checked here as well as in updateVariant so a dry run shows exactly what the real run will do.
    if (row.priceMinor !== undefined && v.compareAtMinor != null && row.priceMinor >= v.compareAtMinor) {
      out.status = "error";
      out.message = "The old (“was”) price must stay above the new price. Lower or remove the old price first.";
      continue;
    }
    try {
      if (row.priceMinor !== undefined && row.priceMinor !== v.priceMinor) {
        out.price = [v.priceMinor, row.priceMinor];
        if (!opts.dryRun) await updateVariant(actor, v.productId, v.variantId, { priceMinor: row.priceMinor });
      }
      const item = stockOf.get(row.sku);
      if (row.stock !== undefined && item && row.stock !== item.onHand) {
        out.stock = [item.onHand, row.stock];
        if (!opts.dryRun) await adjustStock(actor, item._id, { set: row.stock }, "bulk update");
      }
      out.status = out.price || out.stock ? "updated" : "unchanged";
    } catch (e) {
      out.status = "error";
      out.message = messageOfError(e);
    }
  }
  return results;
}

/** Everything a seller can edit in bulk, one row per variant: SKU, product, option label, price, and stock on hand. */
export async function catalogExport(vendorId: ObjectId) {
  const c = await getCollections();
  const [products, items] = await Promise.all([
    c.products.find({ vendorId, status: { $in: ["draft", "published", "rejected"] } }, { projection: { title: 1, variants: 1, status: 1 } }).limit(2000).toArray(),
    c.inventoryItems.find({ vendorId }, { projection: { sku: 1, onHand: 1 } }).toArray(),
  ]);
  const onHand = new Map(items.map((i) => [i.sku, i.onHand]));
  return products.flatMap((p) => p.variants.map((v) => ({ sku: v.sku, product: p.title, variant: Object.values(v.optionValues).join(" / "), status: p.status, priceMinor: v.priceMinor, stock: onHand.get(v.sku) ?? 0 })));
}
