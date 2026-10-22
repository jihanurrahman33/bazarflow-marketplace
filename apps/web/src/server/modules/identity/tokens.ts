import { SignJWT, jwtVerify, errors as joseErrors } from "jose";
import { getEnv } from "@/server/config/env";
import { AppError } from "@/server/shared/errors";
import { hmacHex, randomToken } from "@/server/shared/ids";

const ALG = "HS256";
const key = () => new TextEncoder().encode(getEnv().JWT_ACCESS_SECRET);

export interface AccessClaims {
  sub: string;
  sid: string;
  role: string;
}

export async function signAccessToken(claims: AccessClaims): Promise<{ token: string; expiresIn: number }> {
  const env = getEnv();
  const token = await new SignJWT({ sid: claims.sid, role: claims.role, typ: "access" })
    .setProtectedHeader({ alg: ALG, typ: "JWT" })
    .setSubject(claims.sub)
    .setIssuer(env.JWT_ISSUER)
    .setAudience(env.JWT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${env.ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(key());
  return { token, expiresIn: env.ACCESS_TOKEN_TTL_SECONDS };
}

export async function verifyAccessToken(token: string): Promise<AccessClaims> {
  const env = getEnv();
  try {
    const { payload } = await jwtVerify(token, key(), {
      algorithms: [ALG], // never trust the header's alg
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
      requiredClaims: ["sub", "sid", "exp", "iat"],
    });
    if (payload.typ !== "access" || typeof payload.sid !== "string" || typeof payload.sub !== "string") {
      throw new AppError("UNAUTHENTICATED");
    }
    return { sub: payload.sub, sid: payload.sid, role: String(payload.role) };
  } catch (e) {
    if (e instanceof AppError) throw e;
    if (e instanceof joseErrors.JWTExpired) throw new AppError("TOKEN_EXPIRED");
    throw new AppError("UNAUTHENTICATED");
  }
}

/** Opaque refresh token; only its keyed hash is stored server-side. */
export const newRefreshToken = (): string => randomToken(48);
export const hashRefreshToken = (token: string): string => hmacHex(getEnv().REFRESH_TOKEN_PEPPER, token);
