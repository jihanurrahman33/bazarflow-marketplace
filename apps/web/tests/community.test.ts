import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { setupTestDb, teardownTestDb } from "./helpers/db";
import { call } from "./helpers/http";
import { installFakeMedia, makeAdmin, makeCategory, makeCustomer, makeProduct, makeVendor } from "./helpers/factory";
import { answerQuestionHandler, askQuestionHandler, hideQuestionHandler, listQuestionsHandler, replyReviewHandler, vendorQuestionsHandler, vendorReviewsHandler } from "@/server/api/handlers/community";
import { listReviewsHandler } from "@/server/api/handlers/commerce-ops";
import { listNotificationsHandler } from "@/server/api/handlers/notifications";
import { runWorkerTick } from "@/server/modules/outbox/tick";
import { getCollections } from "@/server/db/collections";
import type { ReviewDoc } from "@/server/db/schema";

let admin: Awaited<ReturnType<typeof makeAdmin>>;
let vendor: Awaited<ReturnType<typeof makeVendor>>;
let rival: Awaited<ReturnType<typeof makeVendor>>;
let product: Awaited<ReturnType<typeof makeProduct>>;
const ask = (token: string | undefined, body: unknown, slug = product.slug) => call(askQuestionHandler, { method: "POST", token, params: { slug }, body });
const inbox = async (token: string) => (await call(listNotificationsHandler, { token })).data as { eventType: string; body: string }[];

beforeAll(async () => {
  await setupTestDb();
  installFakeMedia();
  admin = await makeAdmin();
  const cat = await makeCategory(admin);
  vendor = await makeVendor();
  rival = await makeVendor();
  product = await makeProduct(vendor, { categoryId: cat.id, publish: true, admin });
});
afterAll(teardownTestDb);

describe("product questions", () => {
  it("lets a shopper ask, the owning store answer, and everyone read both", async () => {
    const shopper = await makeCustomer();
    expect((await ask(shopper.token, { body: "short" })).status).toBe(400);
    expect((await ask(undefined, { body: "Does it come with a warranty?" })).status).toBe(401);
    expect((await ask(vendor.user.token, { body: "Does it come with a warranty?" })).status).toBe(403);
    expect((await ask(shopper.token, { body: "Does it come with a warranty?" }, "no-such-product")).status).toBe(404);
    const q = await ask(shopper.token, { body: "Does it come with a warranty?" });
    expect(q.status).toBe(201);
    expect(q.data.answer).toBeUndefined();

    // the store hears about it
    await runWorkerTick();
    expect((await inbox(vendor.user.token)).some((n) => n.eventType === "question.asked")).toBe(true);
    const open = await call(vendorQuestionsHandler, { token: vendor.user.token, query: { answered: "false" } });
    expect(open.data.map((x: { id: string }) => x.id)).toContain(q.data.id);
    expect(open.data[0].product.slug).toBe(product.slug);

    // another store cannot answer it; the owning store can
    const reply = (token: string, body: string) => call(answerQuestionHandler, { method: "PUT", token, params: { id: q.data.id }, body: { body } });
    expect((await reply(rival.user.token, "Yes, 12 months.")).status).toBe(404);
    expect((await reply(shopper.token, "I answer myself")).status).toBe(403);
    const answered = await reply(vendor.user.token, "Yes, it has a 12-month seller warranty.");
    expect(answered.status).toBe(200);
    expect(answered.data.answer.body).toContain("12-month");

    const pub = await call(listQuestionsHandler, { params: { slug: product.slug } });
    expect(pub.status).toBe(200);
    expect(pub.data[0]).toMatchObject({ body: "Does it come with a warranty?", answer: { body: "Yes, it has a 12-month seller warranty." } });
    expect(JSON.stringify(pub.data)).not.toMatch(/@/); // no email addresses
    await runWorkerTick();
    expect((await inbox(shopper.token)).some((n) => n.eventType === "question.answered")).toBe(true);
    expect((await call(vendorQuestionsHandler, { token: vendor.user.token, query: { answered: "false" } })).data.map((x: { id: string }) => x.id)).not.toContain(q.data.id);
  });

  it("lets staff hide a question, and not shoppers or sellers", async () => {
    const shopper = await makeCustomer();
    const q = await ask(shopper.token, { body: "Is this product any good at all?" });
    const hide = (token: string) => call(hideQuestionHandler, { method: "POST", token, params: { id: q.data.id }, body: { reason: "off topic" } });
    expect((await hide(shopper.token)).status).toBe(403);
    expect((await hide(vendor.user.token)).status).toBe(403);
    expect((await hide(admin.token)).status).toBe(200);
    const pub = await call(listQuestionsHandler, { params: { slug: product.slug } });
    expect(pub.data.map((x: { id: string }) => x.id)).not.toContain(q.data.id);
  });

  it("pages through many questions without repeats", async () => {
    const shopper = await makeCustomer();
    const c = await getCollections();
    await c.questions.insertMany(Array.from({ length: 25 }, (_, i) => ({ _id: new ObjectId(), productId: new ObjectId(product.id), vendorId: vendor.vendorId, userId: shopper.id, body: `Question number ${i} here`, status: "published" as const, answered: false, createdAt: new Date() })));
    const seen = new Set<string>();
    let cursor: string | undefined;
    for (let guard = 0; guard < 10; guard++) {
      const r = await call(listQuestionsHandler, { params: { slug: product.slug }, query: { limit: 10, ...(cursor ? { cursor } : {}) } });
      for (const x of r.data) { expect(seen.has(x.id)).toBe(false); seen.add(x.id); }
      cursor = r.json.meta?.nextCursor ?? undefined;
      if (!cursor) break;
    }
    expect(seen.size).toBeGreaterThanOrEqual(25);
  });
});

describe("seller replies to reviews", () => {
  it("shows the store's reply on the review, notifies the reviewer, and only the owning store may reply", async () => {
    const reviewer = await makeCustomer();
    const c = await getCollections();
    const doc: ReviewDoc = { _id: new ObjectId(), productId: new ObjectId(product.id), vendorId: vendor.vendorId, userId: reviewer.id, vendorOrderId: new ObjectId(), rating: 2, body: "Arrived late and the box was damaged.", status: "published", createdAt: new Date() };
    await c.reviews.insertOne(doc);
    const reply = (token: string, body: string) => call(replyReviewHandler, { method: "PUT", token, params: { id: doc._id.toHexString() }, body: { body } });
    expect((await reply(rival.user.token, "We are sorry")).status).toBe(404);
    expect((await reply(reviewer.token, "I reply to myself")).status).toBe(403);
    expect((await reply(vendor.user.token, "x")).status).toBe(400);
    const ok = await reply(vendor.user.token, "Sorry about the delay. We have changed courier and will refund the damaged box.");
    expect(ok.status).toBe(200);

    const pub = await call(listReviewsHandler, { params: { slug: product.slug } });
    expect(pub.data.find((r: { id: string }) => r.id === doc._id.toHexString()).reply.body).toContain("changed courier");
    const mine = await call(vendorReviewsHandler, { token: vendor.user.token, query: { unanswered: "true" } });
    expect(mine.data.map((r: { id: string }) => r.id)).not.toContain(doc._id.toHexString());
    await runWorkerTick();
    expect((await inbox(reviewer.token)).some((n) => n.eventType === "review.reply")).toBe(true);
    expect((await call(vendorReviewsHandler, { token: reviewer.token })).status).toBe(403);
  });
});
