import { SignJWT, importPKCS8 } from "jose";
import { getEnv } from "@/server/config/env";

/** Push provider boundary (FCM adapter plugs in here). Tokens are never logged. */
export interface PushMessage {
  token: string;
  title: string;
  body: string;
  /** Small, non-sensitive payload: resource ids / deep link only. */
  data: Record<string, string>;
}
export type PushResult = "sent" | "invalid_token";

export interface PushProvider {
  send(message: PushMessage): Promise<PushResult>;
}

export class MemoryPushProvider implements PushProvider {
  readonly sent: PushMessage[] = [];
  invalidTokens = new Set<string>();
  async send(message: PushMessage): Promise<PushResult> {
    if (this.invalidTokens.has(message.token)) return "invalid_token";
    this.sent.push(message);
    return "sent";
  }
}

/** Default until Firebase service credentials are provisioned: deliveries are recorded as skipped, never faked. */
export class DisabledPushProvider implements PushProvider {
  async send(): Promise<PushResult> {
    throw new Error("push provider not configured");
  }
}

interface ServiceAccount {
  client_email: string;
  private_key: string;
  project_id: string;
  token_uri?: string;
}

/**
 * Firebase Cloud Messaging HTTP v1. Authenticates as a service account (short-lived OAuth token minted from a signed
 * JWT, cached until shortly before expiry). Payloads carry only a title, body and a deep link: no personal data.
 */
export class FcmHttpV1Provider implements PushProvider {
  private cached?: { token: string; expiresAt: number };
  private readonly account: ServiceAccount;

  constructor(serviceAccountJson: string, private readonly fetchImpl: typeof fetch = fetch) {
    const a = JSON.parse(serviceAccountJson) as ServiceAccount;
    if (!a.client_email || !a.private_key || !a.project_id) throw new Error("FCM service account JSON is missing client_email, private_key or project_id");
    this.account = a;
  }

  private async accessToken(): Promise<string> {
    const now = Date.now();
    if (this.cached && this.cached.expiresAt - 60_000 > now) return this.cached.token;
    const tokenUri = this.account.token_uri ?? "https://oauth2.googleapis.com/token";
    const key = await importPKCS8(this.account.private_key, "RS256");
    const assertion = await new SignJWT({ scope: "https://www.googleapis.com/auth/firebase.messaging" })
      .setProtectedHeader({ alg: "RS256", typ: "JWT" })
      .setIssuer(this.account.client_email)
      .setAudience(tokenUri)
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(key);
    const res = await this.fetchImpl(tokenUri, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`fcm auth failed (${res.status})`);
    const body = (await res.json()) as { access_token: string; expires_in: number };
    this.cached = { token: body.access_token, expiresAt: now + body.expires_in * 1000 };
    return body.access_token;
  }

  async send(m: PushMessage): Promise<PushResult> {
    const res = await this.fetchImpl(`https://fcm.googleapis.com/v1/projects/${this.account.project_id}/messages:send`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${await this.accessToken()}` },
      body: JSON.stringify({ message: { token: m.token, notification: { title: m.title, body: m.body }, data: m.data } }),
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) return "sent";
    const err = (await res.json().catch(() => ({}))) as { error?: { status?: string; details?: { errorCode?: string }[] } };
    const code = err.error?.details?.find((d) => d.errorCode)?.errorCode ?? err.error?.status;
    // The device uninstalled the app or rotated its token: stop sending to it.
    if (res.status === 404 || code === "UNREGISTERED" || code === "INVALID_ARGUMENT") return "invalid_token";
    throw new Error(`fcm send failed (${res.status})`);
  }
}

let override: PushProvider | undefined;
let cachedFcm: { key: string; provider: PushProvider } | undefined;
export const setPushProvider = (p: PushProvider | undefined): void => {
  override = p;
};

export function getPushProvider(): PushProvider {
  if (override) return override;
  const json = getEnv().FCM_SERVICE_ACCOUNT_JSON;
  if (!json) return (cachedFcm = cachedFcm?.key === "none" ? cachedFcm : { key: "none", provider: new DisabledPushProvider() }).provider;
  if (cachedFcm?.key !== json) cachedFcm = { key: json, provider: new FcmHttpV1Provider(json) };
  return cachedFcm.provider;
}
