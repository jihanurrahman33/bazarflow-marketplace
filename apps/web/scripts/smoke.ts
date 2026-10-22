/**
 * End-to-end smoke test against the PRODUCTION build (`next build` first).
 * Boots an in-memory MongoDB replica set and `next start`, seeds a store through the service layer, then drives
 * a complete purchase over real HTTP: SSR pages, CSP, cookie auth, checkout, sandbox payment webhook, fulfilment.
 *
 *   npm run build && npm run smoke
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { MongoMemoryReplSet } from "mongodb-memory-server";

const PORT = 3999;
const ORIGIN = `http://localhost:${PORT}`;
const checks: { name: string; ok: boolean; detail?: string }[] = [];
const check = (name: string, ok: boolean, detail?: string) => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "  ✓" : "  ✗"} ${name}${ok ? "" : ` — ${detail ?? ""}`}`);
};
const expect = (name: string, cond: unknown, detail?: string) => check(name, !!cond, detail);

if (!existsSync(".next/BUILD_ID")) {
  console.error("No production build found. Run `npm run build` first.");
  process.exit(2);
}

const repl = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
const env = {
  ...process.env, NODE_ENV: "production", PORT: String(PORT), APP_ORIGIN: ORIGIN, MONGODB_URI: repl.getUri(), MONGODB_DB: "smoke",
  JWT_ACCESS_SECRET: "smoke-access-secret-0123456789abcdef-0123456789", REFRESH_TOKEN_PEPPER: "smoke-pepper-secret-0123456789abcdef-0123456789",
  PAYMENT_WEBHOOK_SECRET: "smoke-webhook-secret-0123456789abcdef-0123456789", PAYMENT_PROVIDER: "mock", PAYMENT_MODE: "sandbox", MOCK_PAYMENT_UI: "true", COD_ENABLED: "true",
  LOG_LEVEL: "error",
};
Object.assign(process.env, env);

let server: ChildProcess | undefined;
async function shutdown(code: number) {
  server?.kill("SIGTERM");
  const { closeClient } = await import("../src/server/db/client");
  await closeClient().catch(() => undefined);
  await repl.stop();
  process.exit(code);
}

try {
  // ---------- seed through the service layer ----------
  const { getDb } = await import("../src/server/db/client");
  const { ensureIndexes } = await import("../src/server/db/indexes");
  await ensureIndexes(await getDb());
  const { getCollections } = await import("../src/server/db/collections");
  const { hashPassword } = await import("../src/server/modules/identity/password");
  const { PERMISSIONS } = await import("../src/server/modules/authorization/permissions");
  const { newId } = await import("../src/server/shared/ids");
  const { setMediaProvider, FakeMediaProvider } = await import("../src/server/modules/media/cloudinary");
  const media = new FakeMediaProvider();
  setMediaProvider(media);

  const c = await getCollections();
  const now = new Date();
  const mkUser = async (role: "admin" | "customer", email: string, perms: readonly string[] = []) => {
    await c.users.insertOne({ _id: newId(), email, emailNormalized: email, passwordHash: await hashPassword("smoke-password-123"), name: "Smoke " + role, role, permissions: [...perms], status: "active", emailVerifiedAt: now, failedLoginCount: 0, createdAt: now, updatedAt: now });
  };
  await mkUser("admin", "admin@smoke.test", PERMISSIONS);
  await mkUser("customer", "seller@smoke.test");

  // ---------- start the real server ----------
  const child = spawn("npx", ["next", "start", "-p", String(PORT)], { env: env as NodeJS.ProcessEnv, stdio: ["ignore", "pipe", "pipe"] });
  server = child;
  let serverLog = "";
  child.stdout?.on("data", (d) => (serverLog += d));
  child.stderr?.on("data", (d) => (serverLog += d));
  for (let i = 0; i < 80; i++) {
    const up = await fetch(`${ORIGIN}/api/health`).then((r) => r.ok).catch(() => false);
    if (up) break;
    await new Promise((r) => setTimeout(r, 500));
    if (i === 79) throw new Error("server did not start:\n" + serverLog.slice(-1500));
  }
  console.log("server up");

  // ---------- tiny cookie-jar client ----------
  class Client {
    jar = new Map<string, string>();
    async req(path: string, init: RequestInit & { json?: unknown; idem?: string } = {}) {
      const headers: Record<string, string> = { origin: ORIGIN, ...(init.headers as Record<string, string>) };
      if (this.jar.size) headers.cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
      if (init.json !== undefined) headers["content-type"] = "application/json";
      if (init.idem) headers["idempotency-key"] = init.idem;
      const res = await fetch(`${ORIGIN}${path}`, { ...init, headers, body: init.json !== undefined ? JSON.stringify(init.json) : init.body, redirect: "manual" });
      for (const sc of res.headers.getSetCookie()) {
        const [pair] = sc.split(";");
        const [k, ...v] = pair!.split("=");
        if (/Max-Age=0/i.test(sc)) this.jar.delete(k!);
        else this.jar.set(k!, v.join("="));
      }
      const text = await res.text();
      let json: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any
      try { json = JSON.parse(text); } catch { /* html */ }
      return { status: res.status, headers: res.headers, text, json };
    }
    async login(email: string) {
      const r = await this.req("/api/v1/auth/login", { method: "POST", json: { email, password: "smoke-password-123", device: { platform: "web" }, transport: "cookie" } });
      expect(`login ${email}`, r.status === 200 && this.jar.has("bf_at"), JSON.stringify(r.json));
      return r;
    }
  }
  const admin = new Client();
  const seller = new Client();
  const buyer = new Client();
  await admin.login("admin@smoke.test");
  await seller.login("seller@smoke.test");

  // ---------- seller onboarding over HTTP ----------
  const cat = await admin.req("/api/v1/admin/categories", { method: "POST", json: { name: "Gadgets", slug: "gadgets" } });
  expect("admin creates category", cat.status === 201, cat.text);
  const app = await seller.req("/api/v1/vendor/applications", { method: "POST", json: { business: { name: "Smoke Store", slug: "smoke-store", phone: "+8801711111111", address: "Gulshan, Dhaka" }, documents: [] } });
  expect("customer applies to sell", app.status === 201, app.text);
  const approve = await admin.req(`/api/v1/admin/vendor-applications/${app.json.data.id}/approve`, { method: "POST", json: {} });
  expect("admin approves seller", approve.status === 200, approve.text);
  seller.jar.clear();
  await seller.login("seller@smoke.test");
  await seller.req("/api/v1/vendor/profile", { method: "PATCH", json: { shipping: { flatFeeMinor: 6000 } } });

  const created = await seller.req("/api/v1/vendor/products", { method: "POST", json: { title: "Smoke Test Lamp", description: "A very bright lamp for smoke testing.", categoryIds: [cat.json.data.id], options: [], variants: [{ sku: "LAMP-1", optionValues: {}, priceMinor: 250000, initialStock: 5 }] } });
  expect("seller creates product", created.status === 201, created.text);
  const sig = await seller.req("/api/v1/vendor/uploads/signature", { method: "POST", json: {} });
  expect("upload signature requires Cloudinary config (501 when unset)", sig.status === 501, sig.text);
  const vendorDoc = await c.vendors.findOne({ slug: "smoke-store" });
  const publicId = `bazarflow/vendors/${vendorDoc!._id.toHexString()}/products/lamp`;
  media.assets.add(publicId);
  // The app process uses its own (unconfigured) media provider, so attach the image directly like Cloudinary's callback would.
  await c.products.updateOne({ slug: created.json.data.slug }, { $set: { media: [{ publicId, url: `https://res.cloudinary.com/demo/image/upload/${publicId}`, position: 0 }] } });
  const submit = await seller.req(`/api/v1/vendor/products/${created.json.data.id}/submit-review`, { method: "POST", json: {} });
  expect("seller submits for review", submit.status === 200, submit.text);
  const publish = await admin.req(`/api/v1/admin/products/${created.json.data.id}/approve`, { method: "POST", json: {} });
  expect("admin publishes product", publish.status === 200, publish.text);
  const slug = publish.json.data.slug as string;

  // ---------- public SSR pages ----------
  const home = await fetch(ORIGIN);
  const homeHtml = await home.text();
  expect("home renders with the product", home.status === 200 && homeHtml.includes("Smoke Test Lamp"));
  const csp = home.headers.get("content-security-policy") ?? "";
  expect("CSP header with nonce, no unsafe-eval", /script-src 'self' 'nonce-[^']+' 'strict-dynamic'/.test(csp) && !csp.includes("unsafe-eval") && csp.includes("frame-ancestors 'none'"), csp);
  expect("security headers", home.headers.get("x-content-type-options") === "nosniff" && home.headers.get("x-frame-options") === "DENY" && !home.headers.has("x-powered-by"));
  const pdp = await fetch(`${ORIGIN}/products/${slug}`);
  const pdpHtml = await pdp.text();
  expect("product page renders title, price and JSON-LD", pdp.status === 200 && pdpHtml.includes("Smoke Test Lamp") && pdpHtml.includes('"@type":"Product"') && pdpHtml.includes("2,500.00"));
  expect("product page has canonical + OG metadata", pdpHtml.includes(`rel="canonical"`) && pdpHtml.includes("og:title"));
  expect("unknown product is a real 404", (await fetch(`${ORIGIN}/products/does-not-exist`)).status === 404);
  const search = await (await fetch(`${ORIGIN}/search?q=lamp`)).text();
  expect("search finds the product", search.includes("Smoke Test Lamp"));
  expect("category page lists the product", (await (await fetch(`${ORIGIN}/category/gadgets`)).text()).includes("Smoke Test Lamp"));
  expect("vendor store page renders", (await (await fetch(`${ORIGIN}/vendors/smoke-store`)).text()).includes("Smoke Store"));
  const sitemap = await (await fetch(`${ORIGIN}/sitemap.xml`)).text();
  expect("sitemap lists the product", sitemap.includes(`/products/${slug}`));
  expect("robots blocks private areas", (await (await fetch(`${ORIGIN}/robots.txt`)).text()).includes("Disallow: /api/"));
  for (const p of ["/login", "/register", "/cart", "/checkout", "/orders", "/vendor", "/admin", "/help", "/become-a-seller"]) {
    const r = await fetch(`${ORIGIN}${p}`);
    expect(`page ${p} responds 200`, r.status === 200, String(r.status));
  }
  expect("API list is cacheable only where public", (await fetch(`${ORIGIN}/api/v1/products`)).headers.get("cache-control")?.includes("s-maxage") === true);
  expect("private API is no-store", (await admin.req("/api/v1/me")).headers.get("cache-control") === "no-store");
  expect("readiness checks the database", (await fetch(`${ORIGIN}/api/ready`)).status === 200);

  // ---------- customer journey (cookie auth) ----------
  const reg = await buyer.req("/api/v1/auth/register", { method: "POST", json: { email: "buyer@smoke.test", password: "smoke-password-123", name: "Smoke Buyer", device: { platform: "web" }, transport: "cookie" } });
  expect("customer registers (tokens hidden from body)", reg.status === 201 && !JSON.stringify(reg.json).includes("accessToken") && buyer.jar.has("bf_at") && buyer.jar.has("bf_rt"), reg.text);
  const csrf = await fetch(`${ORIGIN}/api/v1/cart/items`, { method: "POST", headers: { cookie: `bf_at=${buyer.jar.get("bf_at")}`, "content-type": "application/json", origin: "https://evil.example" }, body: "{}" });
  expect("cross-origin cookie mutation is blocked (CSRF)", csrf.status === 403);
  const addr = await buyer.req("/api/v1/addresses", { method: "POST", json: { label: "Home", recipient: "Smoke Buyer", phone: "+8801700000000", line1: "House 1", city: "Dhaka", district: "Dhaka", postalCode: "1212" } });
  const product = await (await fetch(`${ORIGIN}/api/v1/products/${slug}`)).json();
  const variantId = product.data.variants[0].variantId;
  const add = await buyer.req("/api/v1/cart/items", { method: "POST", json: { productId: product.data.id, variantId, quantity: 2 } });
  expect("add to cart", add.status === 201 && add.json.data.totals.totalMinor === 506000, add.text);
  const quote = await buyer.req("/api/v1/checkout/quote", { method: "POST", json: { addressId: addr.json.data.id } });
  expect("quote = 2 x 2500 + 60 shipping", quote.json?.data?.totals?.totalMinor === 506000, quote.text);
  const idem = "smoke-idem-key-0001";
  const order = await buyer.req("/api/v1/checkout", { method: "POST", idem, json: { addressId: addr.json.data.id, paymentMethod: "online", expectedTotalMinor: 506000 } });
  expect("checkout creates order with a payment redirect", order.status === 201 && order.json.data.status === "pending_payment" && order.json.data.payment.redirectUrl?.includes("/mock-pay/"), order.text);
  const replay = await buyer.req("/api/v1/checkout", { method: "POST", idem, json: { addressId: addr.json.data.id, paymentMethod: "online", expectedTotalMinor: 506000 } });
  expect("same Idempotency-Key replays the same order", replay.json?.data?.id === order.json.data.id && replay.headers.get("idempotent-replayed") === "true", replay.text);

  // ---------- sandbox hosted payment -> signed webhook ----------
  const ref = order.json.data.payment.redirectUrl.split("/mock-pay/")[1] as string;
  expect("sandbox payment page renders", (await fetch(`${ORIGIN}/mock-pay/${ref}`)).status === 200);
  const early = await buyer.req(`/api/v1/orders/${order.json.data.id}`);
  expect("order is NOT paid before the provider confirms", early.json.data.status === "pending_payment");
  const pay = await buyer.req(`/mock-pay/${ref}/action`, { method: "POST", json: { outcome: "success" } });
  expect("provider confirmation applied through the webhook path", pay.status === 200, pay.text);
  const paid = await buyer.req(`/api/v1/orders/${order.json.data.id}`);
  expect("order confirmed after verified webhook", paid.json.data.status === "confirmed" && paid.json.data.paymentStatus === "paid", paid.text);
  const forged = await fetch(`${ORIGIN}/api/v1/webhooks/payments/mock`, { method: "POST", headers: { "content-type": "application/json", "x-mock-signature": "00" }, body: JSON.stringify({ eventId: "x", merchantReference: ref, status: "failed", timestamp: Date.now(), amountMinor: 506000, currency: "BDT" }) });
  expect("forged webhook rejected", forged.status === 400);

  // ---------- fulfilment & money ----------
  const queue = await seller.req("/api/v1/vendor/orders");
  expect("seller sees the paid order", queue.json.data.length === 1 && queue.json.data[0].status === "new", queue.text);
  const voId = queue.json.data[0].id;
  expect("seller accepts", (await seller.req(`/api/v1/vendor/orders/${voId}/accept`, { method: "POST", json: {} })).status === 200);
  expect("seller ships", (await seller.req(`/api/v1/vendor/orders/${voId}/ship`, { method: "POST", json: { carrier: "Pathao", trackingNumber: "PT-1001" } })).status === 200);
  expect("seller delivers", (await seller.req(`/api/v1/vendor/orders/${voId}/deliver`, { method: "POST", json: {} })).status === 200);
  const final = await buyer.req(`/api/v1/orders/${order.json.data.id}`);
  expect("customer sees delivered + tracking", final.json.data.status === "delivered" && final.json.data.vendorOrders[0].shipment.trackingNumber === "PT-1001");
  const bal = await seller.req("/api/v1/vendor/balance");
  expect("ledger: net earnings held pending (506000 - 10% of 500000)", bal.json.data.pendingMinor === 456000 && bal.json.data.availableMinor === 0, bal.text);
  const review = await buyer.req(`/api/v1/products/${slug}/reviews`, { method: "POST", json: { rating: 5, body: "Bright and sturdy lamp, arrived fast." } });
  expect("verified buyer can review", review.status === 201, review.text);
  const pdp2 = await (await fetch(`${ORIGIN}/products/${slug}`)).text();
  expect("review + rating appear on the product page", pdp2.includes("Bright and sturdy lamp") && pdp2.includes('"aggregateRating"'));

  // ---------- isolation ----------
  expect("customer cannot use admin API", (await buyer.req("/api/v1/admin/users")).status === 403);
  expect("customer cannot use seller API", (await buyer.req("/api/v1/vendor/orders")).status === 403);
  expect("guest is rejected on private API", (await fetch(`${ORIGIN}/api/v1/orders`)).status === 401);
  const ops = await admin.req("/api/v1/admin/ops/health");
  expect("ops health reachable by admin", ops.status === 200 && ops.json.data.outbox.dead === 0, ops.text);
  const out = await buyer.req("/api/v1/auth/logout", { method: "POST", json: {} });
  expect("logout clears cookies", out.status === 204 && !buyer.jar.has("bf_at"));

  const failed = checks.filter((x) => !x.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  await shutdown(failed.length ? 1 : 0);
} catch (e) {
  console.error("SMOKE FAILED:", e);
  await shutdown(1);
}
