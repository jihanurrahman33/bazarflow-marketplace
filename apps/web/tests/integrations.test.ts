import { describe, expect, it } from "vitest";
import nodemailer from "nodemailer";
import { exportPKCS8, generateKeyPair, jwtVerify, importSPKI, exportSPKI } from "jose";
import { SmtpMailer } from "@/server/modules/notifications/mailer";
import { FcmHttpV1Provider } from "@/server/modules/notifications/push";

describe("SMTP mailer", () => {
  it("sends the code in plain text to the recipient with the configured sender, and nothing else", async () => {
    const transport = nodemailer.createTransport({ jsonTransport: true });
    const mailer = new SmtpMailer(transport, "BazarFlow <no-reply@bazarflow.test>");
    const sent: string[] = [];
    const orig = transport.sendMail.bind(transport);
    transport.sendMail = (async (m: Parameters<typeof orig>[0]) => {
      const r = await orig(m);
      sent.push(String((r as { message: string }).message));
      return r;
    }) as typeof transport.sendMail;

    await mailer.send({ to: "rahim@example.com", template: "verify_email", code: "123456" });
    await mailer.send({ to: "rahim@example.com", template: "password_reset", code: "654321" });
    const [verify, reset] = sent.map((s) => JSON.parse(s));
    expect(verify.to[0].address).toBe("rahim@example.com");
    expect(verify.from.address).toBe("no-reply@bazarflow.test");
    expect(verify.subject).toMatch(/Verify/);
    expect(verify.text).toContain("123456");
    expect(reset.subject).toMatch(/Reset/);
    expect(reset.text).toContain("654321");
    expect(reset.text).toContain("expires in 15 minutes");
  });
});

describe("FCM HTTP v1 provider", () => {
  async function account() {
    const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
    return {
      json: JSON.stringify({ project_id: "bazarflow-test", client_email: "svc@bazarflow-test.iam.gserviceaccount.com", private_key: await exportPKCS8(privateKey), token_uri: "https://oauth.test/token" }),
      publicPem: await exportSPKI(publicKey),
    };
  }

  function fakeGoogle(opts: { sendStatus?: number; sendBody?: object } = {}) {
    const calls: { url: string; body: string; auth?: string }[] = [];
    let tokens = 0;
    const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      calls.push({ url: u, body: String(init?.body), auth: (init?.headers as Record<string, string> | undefined)?.authorization });
      if (u === "https://oauth.test/token") {
        tokens++;
        return Response.json({ access_token: `tok-${tokens}`, expires_in: 3600 });
      }
      return Response.json(opts.sendBody ?? { name: "projects/p/messages/1" }, { status: opts.sendStatus ?? 200 });
    }) as typeof fetch;
    return { fetchImpl, calls, tokenCount: () => tokens };
  }

  const msg = { token: "device-token-abc", title: "Order shipped", body: "Pathao PT-1", data: { deepLink: "/orders/1" } };

  it("authenticates with a signed service-account JWT, caches the access token and sends only title/body/deep link", async () => {
    const { json, publicPem } = await account();
    const g = fakeGoogle();
    const p = new FcmHttpV1Provider(json, g.fetchImpl);
    expect(await p.send(msg)).toBe("sent");
    expect(await p.send(msg)).toBe("sent");
    expect(g.tokenCount()).toBe(1); // cached
    const tokenCall = g.calls[0]!;
    const assertion = new URLSearchParams(tokenCall.body).get("assertion")!;
    const { payload } = await jwtVerify(assertion, await importSPKI(publicPem, "RS256"), { audience: "https://oauth.test/token" });
    expect(payload.iss).toBe("svc@bazarflow-test.iam.gserviceaccount.com");
    expect(payload.scope).toBe("https://www.googleapis.com/auth/firebase.messaging");
    const send = g.calls.find((c) => c.url.includes("messages:send"))!;
    expect(send.url).toBe("https://fcm.googleapis.com/v1/projects/bazarflow-test/messages:send");
    expect(send.auth).toBe("Bearer tok-1");
    expect(JSON.parse(send.body)).toEqual({ message: { token: "device-token-abc", notification: { title: "Order shipped", body: "Pathao PT-1" }, data: { deepLink: "/orders/1" } } });
  });

  it("reports dead device tokens as invalid and surfaces other failures", async () => {
    const { json } = await account();
    expect(await new FcmHttpV1Provider(json, fakeGoogle({ sendStatus: 404, sendBody: { error: { status: "NOT_FOUND", details: [{ errorCode: "UNREGISTERED" }] } } }).fetchImpl).send(msg)).toBe("invalid_token");
    expect(await new FcmHttpV1Provider(json, fakeGoogle({ sendStatus: 400, sendBody: { error: { status: "INVALID_ARGUMENT" } } }).fetchImpl).send(msg)).toBe("invalid_token");
    await expect(new FcmHttpV1Provider(json, fakeGoogle({ sendStatus: 503, sendBody: { error: { status: "UNAVAILABLE" } } }).fetchImpl).send(msg)).rejects.toThrow(/503/);
  });

  it("rejects an incomplete service account up front", () => {
    expect(() => new FcmHttpV1Provider(JSON.stringify({ project_id: "x" }))).toThrow(/missing/);
    expect(() => new FcmHttpV1Provider("not json")).toThrow();
  });
});
