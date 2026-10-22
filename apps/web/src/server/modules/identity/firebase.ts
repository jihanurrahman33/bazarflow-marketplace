import { createRemoteJWKSet, jwtVerify } from "jose";
import { getEnv } from "@/server/config/env";
import { AppError } from "@/server/shared/errors";

/** What we trust from a verified Firebase ID token. Nothing here comes from the client's own claims. */
export interface FirebaseIdentity {
  provider: string;
  subject: string;
  email?: string;
  emailVerified: boolean;
  name?: string;
}
export type FirebaseVerifier = (idToken: string) => Promise<FirebaseIdentity>;

const JWKS_URL = new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com");
let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;
let override: FirebaseVerifier | undefined;
/** Tests inject a verifier so no network or real Firebase project is needed. */
export const setFirebaseVerifier = (v: FirebaseVerifier | undefined): void => {
  override = v;
};

export function enabledProviders(): string[] {
  return getEnv().FIREBASE_SIGN_IN_PROVIDERS.split(",").map((p) => p.trim()).filter(Boolean);
}
export function socialLoginConfigured(): boolean {
  const e = getEnv();
  return !!(e.FIREBASE_PROJECT_ID && e.FIREBASE_WEB_API_KEY && e.FIREBASE_AUTH_DOMAIN) || !!override;
}

/**
 * Verifies a Firebase ID token against Google's published keys: RS256 only, issuer and audience pinned to our project,
 * expiry enforced. The provider and subject are taken from the signed token, never from the request body.
 */
export async function verifyFirebaseIdToken(idToken: string): Promise<FirebaseIdentity> {
  if (override) return override(idToken);
  const projectId = getEnv().FIREBASE_PROJECT_ID;
  if (!projectId) throw new AppError("BUSINESS_RULE_VIOLATION", { message: "Social sign-in is not available." });
  jwks ??= createRemoteJWKSet(JWKS_URL, { cooldownDuration: 30_000, cacheMaxAge: 6 * 3600_000 });
  let payload: Record<string, unknown>;
  try {
    ({ payload } = await jwtVerify(idToken, jwks, { algorithms: ["RS256"], issuer: `https://securetoken.google.com/${projectId}`, audience: projectId, clockTolerance: 5 }));
  } catch {
    throw new AppError("UNAUTHENTICATED", { message: "That sign-in could not be verified. Please try again." });
  }
  const fb = (payload.firebase ?? {}) as { sign_in_provider?: string; identities?: Record<string, unknown[]> };
  const provider = fb.sign_in_provider;
  const sub = typeof payload.sub === "string" ? payload.sub : "";
  if (!provider || !sub) throw new AppError("UNAUTHENTICATED", { message: "That sign-in could not be verified. Please try again." });
  const providerId = fb.identities?.[provider]?.[0];
  return {
    provider,
    subject: typeof providerId === "string" ? providerId : sub,
    email: typeof payload.email === "string" ? payload.email : undefined,
    emailVerified: payload.email_verified === true,
    name: typeof payload.name === "string" ? payload.name : undefined,
  };
}
