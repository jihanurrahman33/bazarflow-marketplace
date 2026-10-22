import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, teardownTestDb } from "./helpers/db";
import { call } from "./helpers/http";
import { makeAdmin, makeCategory, makeCustomer, makeProduct, makeVendor, media, uniq, installFakeMedia } from "./helpers/factory";
import {
  approveProductHandler, categoriesHandler, optionPresetsHandler, productDetailHandler, productsHandler, rejectProductHandler, reviewQueueHandler, vendorProductsPublicHandler,
  createCategoryHandler,
} from "@/server/api/handlers/catalog";
import {
  addVariantsHandler, adjustInventoryHandler, archiveProductHandler, createProductHandler, getProductHandler, listInventoryHandler, listProductsHandler,
  movementsHandler, patchProductHandler, patchVariantHandler, submitReviewHandler, uploadSignatureHandler,
} from "@/server/api/handlers/vendor-catalog";
import { suspendVendorHandler } from "@/server/api/handlers/admin";
import { getCollections } from "@/server/db/collections";
import { withTransaction } from "@/server/db/transaction";
import { reserveLines, settleReservation } from "@/server/modules/inventory/service";
import { newId } from "@/server/shared/ids";
import { vendorMediaFolder, setMediaProvider, signParams } from "@/server/modules/media/cloudinary";
import { ObjectId } from "mongodb";

let admin: Awaited<ReturnType<typeof makeAdmin>>;
let cat: { id: string; slug: string };

beforeAll(async () => {
  await setupTestDb();
  installFakeMedia();
  admin = await makeAdmin();
  cat = await makeCategory(admin, "Fashion " + uniq());
});
afterAll(teardownTestDb);

const body = (over: Record<string, unknown> = {}) => ({
  title: "Linen Shirt", description: "Breathable linen shirt for summer.", categoryIds: [cat.id], options: [],
  variants: [{ sku: uniq("SKU"), optionValues: {}, priceMinor: 250000, initialStock: 4 }], ...over,
});

describe("categories", () => {
  it("is admin-only, enforces unique slugs and two levels, and serves a public tree", async () => {
    const v = await makeVendor();
    expect((await call(createCategoryHandler, { method: "POST", token: v.user.token, body: { name: "Hack", slug: "hack" } })).status).toBe(403);
    const parent = await makeCategory(admin, "Electronics " + uniq());
    const child = await makeCategory(admin, "Phones " + uniq(), parent.id);
    const grand = await call(createCategoryHandler, { method: "POST", token: admin.token, body: { name: "Deep", slug: uniq("deep"), parentId: child.id } });
    expect(grand.status).toBe(422);
    const dup = await call(createCategoryHandler, { method: "POST", token: admin.token, body: { name: "Again", slug: parent.slug } });
    expect(dup.error?.code).toBe("CONFLICT");
    const tree = await call(categoriesHandler);
    const node = tree.data.find((n: { id: string }) => n.id === parent.id);
    expect(node.children.map((x: { id: string }) => x.id)).toContain(child.id);
    expect(tree.headers.get("cache-control")).toContain("s-maxage");
  });
});

describe("photos tied to an option", () => {
  it("lets a seller tie a photo to a colour, refuses unknown values, and exposes the tag to shoppers", async () => {
    const v = await makeVendor();
    const made = await call(createProductHandler, { method: "POST", token: v.user.token, body: body({ options: [{ name: "Colour", values: ["Black", "White"] }], variants: [
      { sku: "PH-B-" + uniq(), optionValues: { Colour: "Black" }, priceMinor: 100000, initialStock: 3 },
      { sku: "PH-W-" + uniq(), optionValues: { Colour: "White" }, priceMinor: 100000, initialStock: 3 },
    ] }) });
    expect(made.status).toBe(201);
    const id = made.data.id as string;
    const asset = (n: string) => { const publicId = `${vendorMediaFolder(v.vendorId.toHexString())}/${uniq(n)}`; media.assets.add(publicId); return publicId; };
    const black = asset("black"), white = asset("white"), any = asset("any");
    const patch = (m: object[]) => call(patchProductHandler, { method: "PATCH", token: v.user.token, params: { id }, body: { media: m } });

    expect((await patch([{ publicId: black, forOption: { name: "Colour", value: "Red" } }])).error?.details[0]?.field).toBe("media.0.forOption"); // not a colour this product has
    expect((await patch([{ publicId: black, forOption: { name: "Size", value: "M" } }])).status).toBe(400);
    const ok = await patch([{ publicId: any }, { publicId: black, forOption: { name: "Colour", value: "Black" } }, { publicId: white, forOption: { name: "Colour", value: "White" } }]);
    expect(ok.status, JSON.stringify(ok.json)).toBe(200);
    expect(ok.data.media.map((m: { forOption?: unknown }) => m.forOption ?? null)).toEqual([null, { name: "Colour", value: "Black" }, { name: "Colour", value: "White" }]);

    await call(submitReviewHandler, { method: "POST", token: v.user.token, params: { id } });
    await call(approveProductHandler, { method: "POST", token: admin.token, params: { id } });
    const slug = (await call(getProductHandler, { token: v.user.token, params: { id } })).data.slug as string;
    const pub = await call(productDetailHandler, { params: { slug } });
    expect(pub.status).toBe(200);
    expect(pub.data.media.map((m: { forOption?: unknown }) => m.forOption ?? null)).toEqual([null, { name: "Colour", value: "Black" }, { name: "Colour", value: "White" }]);
  });
});

describe("creating products", () => {
  it("lists a tee in several colours, sizes and fits from the shared option library", async () => {
    const lib = await call(optionPresetsHandler, {});
    expect(lib.status).toBe(200);
    const names = (lib.data as { name: string }[]).map((p) => p.name);
    expect(names).toEqual(expect.arrayContaining(["Colour", "Size", "Fit", "Shoe size", "Waist", "Material"]));

    const v = await makeVendor();
    const options = [{ name: "Colour", values: ["Black", "Navy"] }, { name: "Size", values: ["M", "L", "XL"] }, { name: "Fit", values: ["Slim", "Regular"] }];
    const variants = options[0]!.values.flatMap((Colour) => options[1]!.values.flatMap((Size) => options[2]!.values.map((Fit) => ({
      sku: uniq(`T-${Colour}-${Size}-${Fit}`).slice(0, 40), optionValues: { Colour, Size, Fit }, priceMinor: 99900, initialStock: 4,
    }))));
    expect(variants).toHaveLength(12);
    const made = await call(createProductHandler, { method: "POST", token: v.user.token, body: body({ options, variants }) });
    expect(made.status, JSON.stringify(made.json)).toBe(201);
    expect(made.data.options).toEqual(options);
    expect(made.data.variants).toHaveLength(12);
    const c = await getCollections();
    expect(await c.inventoryItems.countDocuments({ productId: new ObjectId(made.data.id) })).toBe(12);

    // a fourth option, or a variant with a colour the product does not list, is refused
    const four = [...options, { name: "Material", values: ["Cotton"] }];
    expect((await call(createProductHandler, { method: "POST", token: v.user.token, body: body({ options: four, variants }) })).status).toBe(400);
    const stray = [{ ...variants[0]!, optionValues: { ...variants[0]!.optionValues, Colour: "Red" } }, ...variants.slice(1)];
    expect((await call(createProductHandler, { method: "POST", token: v.user.token, body: body({ options, variants: stray }) })).status).toBe(400);
  });


  it("creates a draft with inventory and validates variant structure", async () => {
    const v = await makeVendor();
    const ok = await call(createProductHandler, { method: "POST", token: v.user.token, body: body({ options: [{ name: "Size", values: ["S", "M"] }], variants: [
      { sku: "TS-S-" + uniq(), optionValues: { Size: "S" }, priceMinor: 100000, initialStock: 3 },
      { sku: "TS-M-" + uniq(), optionValues: { Size: "M" }, priceMinor: 120000, initialStock: 5 },
    ] }) });
    expect(ok.status).toBe(201);
    expect(ok.data.status).toBe("draft");
    expect(ok.data.minPriceMinor).toBe(100000);
    const c = await getCollections();
    expect(await c.inventoryItems.countDocuments({ productId: new ObjectId(ok.data.id) })).toBe(2);
    const bad = async (over: Record<string, unknown>, field: string) => {
      const r = await call(createProductHandler, { method: "POST", token: v.user.token, body: body(over) });
      expect(r.status, JSON.stringify(r.json)).toBe(400);
      expect(r.error?.details.some((d) => d.field.startsWith(field))).toBe(true);
    };
    const s = uniq("DUP");
    await bad({ variants: [{ sku: s, optionValues: {}, priceMinor: 1000, initialStock: 1 }, { sku: s, optionValues: {}, priceMinor: 1000, initialStock: 1 }] }, "variants");
    await bad({ options: [{ name: "Size", values: ["S"] }], variants: [{ sku: uniq("A"), optionValues: { Size: "XL" }, priceMinor: 1000, initialStock: 1 }] }, "variants");
    await bad({ options: [{ name: "Size", values: ["S"] }], variants: [{ sku: uniq("A"), optionValues: {}, priceMinor: 1000, initialStock: 1 }] }, "variants");
    await bad({ variants: [{ sku: uniq("A"), optionValues: {}, priceMinor: 1000, compareAtMinor: 900, initialStock: 1 }] }, "variants");
    await bad({ variants: [{ sku: uniq("A"), optionValues: {}, priceMinor: 10.5, initialStock: 1 }] }, "variants");
    await bad({ variants: [{ sku: uniq("A"), optionValues: {}, priceMinor: -5, initialStock: 1 }] }, "variants");
    await bad({ categoryIds: [new ObjectId().toHexString()] }, "categoryIds");
  });

  it("rejects server-controlled fields (status, vendorId, commission, vendorActive)", async () => {
    const v = await makeVendor();
    for (const extra of [{ status: "published" }, { vendorId: new ObjectId().toHexString() }, { commissionBps: 0 }, { vendorActive: true }, { publishedAt: "2020-01-01" }]) {
      expect((await call(createProductHandler, { method: "POST", token: v.user.token, body: body(extra) })).status).toBe(400);
    }
    const cust = await makeCustomer();
    expect((await call(createProductHandler, { method: "POST", token: cust.token, body: body() })).status).toBe(403);
    expect((await call(createProductHandler, { method: "POST", body: body() })).status).toBe(401);
  });

  it("keeps SKUs unique per vendor but lets different vendors reuse a SKU", async () => {
    const [a, b] = [await makeVendor(), await makeVendor()];
    const sku = uniq("SHARED");
    const mk = (t: string) => ({ token: t, method: "POST", body: body({ variants: [{ sku, optionValues: {}, priceMinor: 1000, initialStock: 1 }] }) });
    expect((await call(createProductHandler, mk(a.user.token))).status).toBe(201);
    expect((await call(createProductHandler, mk(a.user.token))).error?.code).toBe("CONFLICT");
    expect((await call(createProductHandler, mk(b.user.token))).status).toBe(201);
  });
});

describe("vendor isolation", () => {
  it("hides other vendors' products and inventory (404, not 403) and blocks edits", async () => {
    const [a, b] = [await makeVendor(), await makeVendor()];
    const p = await makeProduct(a, { categoryId: cat.id });
    const params = { id: p.id };
    expect((await call(getProductHandler, { token: b.user.token, params })).status).toBe(404);
    expect((await call(patchProductHandler, { method: "PATCH", token: b.user.token, params, body: { title: "Stolen title" } })).status).toBe(404);
    expect((await call(submitReviewHandler, { method: "POST", token: b.user.token, params })).status).toBe(404);
    expect((await call(archiveProductHandler, { method: "POST", token: b.user.token, params })).status).toBe(404);
    expect((await call(addVariantsHandler, { method: "POST", token: b.user.token, params, body: { variants: [{ sku: uniq("X"), optionValues: {}, priceMinor: 1000, initialStock: 1 }] } })).status).toBe(404);
    const detail = await call(getProductHandler, { token: a.user.token, params });
    const itemId = detail.data.variants[0].stock.inventoryItemId;
    expect((await call(adjustInventoryHandler, { method: "PATCH", token: b.user.token, params: { skuId: itemId }, body: { set: 999, reason: "hijack" } })).status).toBe(404);
    expect((await call(movementsHandler, { token: b.user.token, params: { skuId: itemId } })).status).toBe(404);
    expect((await call(listProductsHandler, { token: b.user.token })).data.map((x: { id: string }) => x.id)).not.toContain(p.id);
    expect((await call(listInventoryHandler, { token: b.user.token })).data.some((i: { productId: string }) => i.productId === p.id)).toBe(false);
  });
});

describe("media", () => {
  it("binds only the vendor's own existing assets and builds URLs server-side", async () => {
    const [a, b] = [await makeVendor(), await makeVendor()];
    const p = await makeProduct(a, { categoryId: cat.id });
    const own = `${vendorMediaFolder(a.vendorId.toHexString())}/pic1`;
    const others = `${vendorMediaFolder(b.vendorId.toHexString())}/pic2`;
    media.assets.add(own);
    media.assets.add(others);
    const patch = (publicId: string) => call(patchProductHandler, { method: "PATCH", token: a.user.token, params: { id: p.id }, body: { media: [{ publicId }] } });
    expect((await patch(others)).error?.details[0]?.code).toBe("NOT_OWNED");
    expect((await patch(`${vendorMediaFolder(a.vendorId.toHexString())}/../x`)).status).toBe(400);
    expect((await patch(`${vendorMediaFolder(a.vendorId.toHexString())}/ghost`)).error?.details[0]?.code).toBe("ASSET_NOT_FOUND");
    const ok = await patch(own);
    expect(ok.data.media[0].url).toBe(`https://fake.cdn/gallery/${own}`);
    expect((await call(patchProductHandler, { method: "PATCH", token: a.user.token, params: { id: p.id }, body: { media: [{ publicId: own, url: "http://evil" }] } })).status).toBe(400);
  });

  it("derives the upload folder from the authenticated vendor and signs deterministically", async () => {
    const v = await makeVendor();
    const r = await call(uploadSignatureHandler, { method: "POST", token: v.user.token, body: { folder: "bazarflow/vendors/someone-else" } });
    expect(r.data.folder).toBe(vendorMediaFolder(v.vendorId.toHexString()));
    expect((await call(uploadSignatureHandler, { method: "POST", token: (await makeCustomer()).token })).status).toBe(403);
    expect(signParams({ timestamp: 1315060510, folder: "f", allowed_formats: "jpg" }, "secret")).toBe(signParams({ allowed_formats: "jpg", folder: "f", timestamp: 1315060510 }, "secret"));
    setMediaProvider(undefined);
    expect((await call(uploadSignatureHandler, { method: "POST", token: v.user.token })).status).toBe(501);
    installFakeMedia();
  });
});

describe("moderation lifecycle", () => {
  it("requires media to submit, hides drafts publicly, publishes on approval and re-moderates content edits", async () => {
    const v = await makeVendor();
    const p = await makeProduct(v, { categoryId: cat.id });
    const noMedia = await call(submitReviewHandler, { method: "POST", token: v.user.token, params: { id: p.id } });
    expect(noMedia.status).toBe(422);
    expect((await call(productDetailHandler, { params: { slug: p.slug } })).status).toBe(404);

    const pub = await makeProduct(v, { categoryId: cat.id, title: "Visible Item", publish: true, admin });
    expect(pub.status).toBe("published");
    expect((await call(productDetailHandler, { params: { slug: pub.slug } })).status).toBe(200);

    // price edits do not need review; content edits do
    const variantId = pub.variants[0].variantId;
    const priceEdit = await call(patchVariantHandler, { method: "PATCH", token: v.user.token, params: { id: pub.id, variantId }, body: { priceMinor: 99900 } });
    expect(priceEdit.data.status).toBe("published");
    expect(priceEdit.data.minPriceMinor).toBe(99900);
    const titleEdit = await call(patchProductHandler, { method: "PATCH", token: v.user.token, params: { id: pub.id }, body: { title: "Renamed Item" } });
    expect(titleEdit.data.status).toBe("pending_review");
    expect((await call(productDetailHandler, { params: { slug: pub.slug } })).status).toBe(404);
    expect((await call(patchProductHandler, { method: "PATCH", token: v.user.token, params: { id: pub.id }, body: { title: "While reviewing" } })).error?.code).toBe("INVALID_STATE_TRANSITION");
  });

  it("reject needs a reason, vendor can fix and resubmit, and moderation needs the permission", async () => {
    const v = await makeVendor();
    const p = await makeProduct(v, { categoryId: cat.id });
    const publicId = `${vendorMediaFolder(v.vendorId.toHexString())}/m1`;
    media.assets.add(publicId);
    await call(patchProductHandler, { method: "PATCH", token: v.user.token, params: { id: p.id }, body: { media: [{ publicId }] } });
    await call(submitReviewHandler, { method: "POST", token: v.user.token, params: { id: p.id } });
    const queue = await call(reviewQueueHandler, { token: admin.token, query: { limit: 50 } });
    expect(queue.data.map((x: { id: string }) => x.id)).toContain(p.id);
    const support = await makeAdmin(["order.read_all"]);
    for (const h of [reviewQueueHandler]) expect((await call(h, { token: support.token })).status).toBe(403);
    expect((await call(approveProductHandler, { method: "POST", token: support.token, params: { id: p.id } })).status).toBe(403);
    expect((await call(approveProductHandler, { method: "POST", token: v.user.token, params: { id: p.id } })).status).toBe(403);
    expect((await call(rejectProductHandler, { method: "POST", token: admin.token, params: { id: p.id }, body: {} })).status).toBe(400);
    const rej = await call(rejectProductHandler, { method: "POST", token: admin.token, params: { id: p.id }, body: { reason: "Blurry photos" } });
    expect(rej.data.status).toBe("rejected");
    expect(rej.data.moderation.reason).toBe("Blurry photos");
    expect((await call(approveProductHandler, { method: "POST", token: admin.token, params: { id: p.id } })).error?.code).toBe("INVALID_STATE_TRANSITION");
    expect((await call(submitReviewHandler, { method: "POST", token: v.user.token, params: { id: p.id } })).data.status).toBe("pending_review");
    expect((await call(approveProductHandler, { method: "POST", token: admin.token, params: { id: p.id } })).data.status).toBe("published");
  });

  it("hides a suspended vendor's catalogue immediately and blocks new products", async () => {
    const v = await makeVendor();
    const pub = await makeProduct(v, { categoryId: cat.id, publish: true, admin });
    expect((await call(productDetailHandler, { params: { slug: pub.slug } })).status).toBe(200);
    await call(suspendVendorHandler, { method: "POST", token: admin.token, params: { id: v.vendorId.toHexString() }, body: { reason: "Counterfeits" } });
    expect((await call(productDetailHandler, { params: { slug: pub.slug } })).status).toBe(404);
    expect((await call(productsHandler, { query: { vendor: v.slug } })).data).toEqual([]);
    expect((await call(createProductHandler, { method: "POST", token: v.user.token, body: body() })).error?.code).toBe("VENDOR_NOT_ACTIVE");
    expect((await call(submitReviewHandler, { method: "POST", token: v.user.token, params: { id: pub.id } })).error?.code).toBe("VENDOR_NOT_ACTIVE");
  });
});

describe("variants", () => {
  it("adds variants with new option values, never deletes, and refuses to deactivate the last one on a published product", async () => {
    const v = await makeVendor();
    const sku1 = uniq("V");
    const p = await makeProduct(v, { categoryId: cat.id, options: [{ name: "Size", values: ["S"] }], variants: [{ sku: sku1, optionValues: { Size: "S" }, priceMinor: 1000, initialStock: 2 }], publish: true, admin });
    const added = await call(addVariantsHandler, { method: "POST", token: v.user.token, params: { id: p.id }, body: { newOptionValues: { Size: ["L"] }, variants: [{ sku: uniq("V"), optionValues: { Size: "L" }, priceMinor: 1500, initialStock: 7 }] } });
    expect(added.status).toBe(201);
    expect(added.data.variants).toHaveLength(2);
    expect(added.data.options[0].values).toEqual(["S", "L"]);
    const dupCombo = await call(addVariantsHandler, { method: "POST", token: v.user.token, params: { id: p.id }, body: { variants: [{ sku: uniq("V"), optionValues: { Size: "L" }, priceMinor: 1500, initialStock: 1 }] } });
    expect(dupCombo.status).toBe(400);
    const [v1, v2] = added.data.variants;
    await call(patchVariantHandler, { method: "PATCH", token: v.user.token, params: { id: p.id, variantId: v1.variantId }, body: { active: false } });
    const last = await call(patchVariantHandler, { method: "PATCH", token: v.user.token, params: { id: p.id, variantId: v2.variantId }, body: { active: false } });
    expect(last.status).toBe(422);
    const pubView = await call(productDetailHandler, { params: { slug: p.slug } });
    expect(pubView.data.variants).toHaveLength(1);
    expect((await call(patchVariantHandler, { method: "PATCH", token: v.user.token, params: { id: p.id, variantId: "nope" }, body: { active: true } })).status).toBe(404);
    expect((await call(patchVariantHandler, { method: "PATCH", token: v.user.token, params: { id: p.id, variantId: v2.variantId }, body: { sku: "CHANGED" } })).status).toBe(400);
  });
});

describe("public catalogue", () => {
  it("filters, sorts, paginates by cursor and never leaks internal fields", async () => {
    const v = await makeVendor({ slug: uniq("listing") });
    const c2 = await makeCategory(admin, "Gadgets " + uniq());
    const prices = [30000, 10000, 20000, 40000, 50000];
    const made: { slug: string; price: number }[] = [];
    for (const price of prices) {
      const p = await makeProduct(v, { categoryId: c2.id, priceMinor: price, publish: true, admin, title: `Gadget ${price}` });
      made.push({ slug: p.slug, price });
    }
    const asc = await call(productsHandler, { query: { category: c2.slug, sort: "price_asc", limit: 2 } });
    expect(asc.data.map((x: { minPriceMinor: number }) => x.minPriceMinor)).toEqual([10000, 20000]);
    expect(asc.json.meta?.hasMore).toBe(true);
    const asc2 = await call(productsHandler, { query: { category: c2.slug, sort: "price_asc", limit: 2, cursor: asc.json.meta!.nextCursor } });
    expect(asc2.data.map((x: { minPriceMinor: number }) => x.minPriceMinor)).toEqual([30000, 40000]);
    const asc3 = await call(productsHandler, { query: { category: c2.slug, sort: "price_asc", limit: 2, cursor: asc2.json.meta!.nextCursor } });
    expect(asc3.data.map((x: { minPriceMinor: number }) => x.minPriceMinor)).toEqual([50000]);
    expect(asc3.json.meta?.hasMore).toBe(false);
    const desc = await call(productsHandler, { query: { category: c2.slug, sort: "price_desc", limit: 50 } });
    expect(desc.data.map((x: { minPriceMinor: number }) => x.minPriceMinor)).toEqual([50000, 40000, 30000, 20000, 10000]);
    const ranged = await call(productsHandler, { query: { category: c2.slug, minPrice: 15000, maxPrice: 35000, sort: "price_asc" } });
    expect(ranged.data.map((x: { minPriceMinor: number }) => x.minPriceMinor)).toEqual([20000, 30000]);
    const newest = await call(productsHandler, { query: { vendor: v.slug, limit: 3 } });
    expect(newest.data).toHaveLength(3);
    const byVendor = await call(vendorProductsPublicHandler, { params: { slug: v.slug }, query: { limit: 50 } });
    expect(byVendor.data).toHaveLength(5);
    const item = asc.data[0];
    expect(Object.keys(item).sort()).toEqual(["id", "image", "inStock", "currency", "minPriceMinor", "slug", "title", "vendor"].sort());
    const detail = await call(productDetailHandler, { params: { slug: made[0]!.slug } });
    const json = JSON.stringify(detail.data);
    for (const leak of ["vendorId", "onHand", "reserved", "moderation", "commission", "version"]) expect(json).not.toContain(leak);
    expect((await call(productsHandler, { query: { limit: 0 } })).status).toBe(400);
    expect((await call(productsHandler, { query: { sort: "random" } })).status).toBe(400);
    expect((await call(productsHandler, { query: { cursor: "garbage" } })).status).toBe(400);
  });

  it("supports text search and reports stock status accurately", async () => {
    const v = await makeVendor();
    const unique = "zephyrite" + uniq("q").toLowerCase();
    const p = await makeProduct(v, { categoryId: cat.id, title: `${unique} lamp`, stock: 2, publish: true, admin });
    const found = await call(productsHandler, { query: { q: unique } });
    expect(found.data.map((x: { id: string }) => x.id)).toEqual([p.id]);
    expect(found.data[0].inStock).toBe(true);
    const detail = await call(productDetailHandler, { params: { slug: p.slug } });
    expect(detail.data.variants[0].lowStock).toBe(2);
    const itemId = (await call(getProductHandler, { token: v.user.token, params: { id: p.id } })).data.variants[0].stock.inventoryItemId;
    await call(adjustInventoryHandler, { method: "PATCH", token: v.user.token, params: { skuId: itemId }, body: { set: 0, reason: "sold out offline" } });
    const after = await call(productsHandler, { query: { q: unique } });
    expect(after.data[0].inStock).toBe(false);
    expect((await call(productDetailHandler, { params: { slug: p.slug } })).data.variants[0].inStock).toBe(false);
    expect((await call(productsHandler, { query: { q: "x" } })).status).toBe(400);
  });
});

describe("inventory", () => {
  it("adjusts by set or delta, logs movements, and never drops below reserved stock", async () => {
    const v = await makeVendor();
    const p = await makeProduct(v, { categoryId: cat.id, stock: 10 });
    const detail = await call(getProductHandler, { token: v.user.token, params: { id: p.id } });
    const itemId = detail.data.variants[0].stock.inventoryItemId as string;
    const adj = (b: object) => call(adjustInventoryHandler, { method: "PATCH", token: v.user.token, params: { skuId: itemId }, body: b });
    expect((await adj({ delta: 5, reason: "restock" })).data.onHand).toBe(15);
    expect((await adj({ set: 8, reason: "recount" })).data.onHand).toBe(8);
    expect((await adj({ set: 1, delta: 1, reason: "both" })).status).toBe(400);
    expect((await adj({ reason: "none" })).status).toBe(400);
    expect((await adj({ set: -1, reason: "negative" })).status).toBe(400);
    expect((await adj({ delta: -100, reason: "too much" })).status).toBe(400);
    // reserve 6, then try to set onHand to 5 (< reserved)
    const c = await getCollections();
    await withTransaction((s) => reserveLines(s, newId(), [{ inventoryItemId: new ObjectId(itemId), quantity: 6 }]));
    const below = await adj({ set: 5, reason: "oops" });
    expect(below.error?.code).toBe("CONFLICT");
    expect((await adj({ set: 6, reason: "exactly reserved" })).data.available).toBe(0);
    const mv = await call(movementsHandler, { token: v.user.token, params: { skuId: itemId } });
    expect(mv.data.map((m: { kind: string }) => m.kind)).toEqual(expect.arrayContaining(["adjust", "reserve"]));
    expect((await c.inventoryItems.findOne({ _id: new ObjectId(itemId) }))!.reserved).toBe(6);
  });

  it("never oversells under concurrent reservations", async () => {
    const v = await makeVendor();
    const p = await makeProduct(v, { categoryId: cat.id, stock: 5 });
    const itemId = new ObjectId((await call(getProductHandler, { token: v.user.token, params: { id: p.id } })).data.variants[0].stock.inventoryItemId);
    const attempts = await Promise.allSettled(
      Array.from({ length: 12 }, () => withTransaction((s) => reserveLines(s, newId(), [{ inventoryItemId: itemId, quantity: 1 }]))),
    );
    expect(attempts.filter((a) => a.status === "fulfilled")).toHaveLength(5);
    for (const a of attempts.filter((x) => x.status === "rejected")) expect(String((a as PromiseRejectedResult).reason?.code ?? (a as PromiseRejectedResult).reason)).toMatch(/INVENTORY_UNAVAILABLE|WriteConflict|Transient/i);
    const c = await getCollections();
    const item = await c.inventoryItems.findOne({ _id: itemId });
    expect(item!.reserved).toBe(5);
    expect(item!.onHand - item!.reserved).toBe(0);
  });

  it("rolls back a multi-line reservation when one line lacks stock", async () => {
    const v = await makeVendor();
    const [p1, p2] = [await makeProduct(v, { categoryId: cat.id, stock: 5 }), await makeProduct(v, { categoryId: cat.id, stock: 1 })];
    const id = async (p: { id: string }) => new ObjectId((await call(getProductHandler, { token: v.user.token, params: { id: p.id } })).data.variants[0].stock.inventoryItemId);
    const [i1, i2] = [await id(p1), await id(p2)];
    await expect(withTransaction((s) => reserveLines(s, newId(), [{ inventoryItemId: i1, quantity: 3 }, { inventoryItemId: i2, quantity: 2 }]))).rejects.toMatchObject({ code: "INVENTORY_UNAVAILABLE" });
    const c = await getCollections();
    expect((await c.inventoryItems.findOne({ _id: i1 }))!.reserved).toBe(0);
  });

  it("settles a reservation exactly once (commit vs release race)", async () => {
    const v = await makeVendor();
    const p = await makeProduct(v, { categoryId: cat.id, stock: 5 });
    const itemId = new ObjectId((await call(getProductHandler, { token: v.user.token, params: { id: p.id } })).data.variants[0].stock.inventoryItemId);
    const orderId = newId();
    const c = await getCollections();
    await withTransaction(async (s) => {
      await reserveLines(s, orderId, [{ inventoryItemId: itemId, quantity: 2 }]);
      await c.stockReservations.insertOne({ _id: newId(), orderId, lines: [{ inventoryItemId: itemId, quantity: 2 }], status: "active", expiresAt: new Date(Date.now() + 60000), createdAt: new Date() }, { session: s });
    });
    const results = await Promise.allSettled([
      withTransaction((s) => settleReservation(s, orderId, "commit")),
      withTransaction((s) => settleReservation(s, orderId, "release")),
      withTransaction((s) => settleReservation(s, orderId, "commit")),
    ]);
    expect(results.filter((r) => r.status === "fulfilled" && r.value === true)).toHaveLength(1);
    const item = await c.inventoryItems.findOne({ _id: itemId });
    expect(item!.reserved).toBe(0);
    expect([3, 5]).toContain(item!.onHand); // committed (3) or released (5) — never both, never negative
    expect(item!.onHand + item!.reserved).toBeGreaterThanOrEqual(3);
  });
});
