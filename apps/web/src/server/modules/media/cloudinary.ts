import { createHash } from "node:crypto";
import { getEnv } from "@/server/config/env";
import { AppError } from "@/server/shared/errors";

export const UPLOAD_FORMATS = "jpg,jpeg,png,webp";

export interface UploadAuthorization {
  cloudName: string;
  apiKey: string;
  timestamp: number;
  folder: string;
  allowedFormats: string;
  signature: string;
  uploadUrl: string;
}

export interface VerifiedAsset {
  publicId: string;
  width?: number;
  height?: number;
  format?: string;
  bytes?: number;
}

/** Boundary for the media provider so tests and alternative providers never touch Cloudinary specifics. */
export interface MediaProvider {
  /** Narrow, short-lived signed upload parameters for a folder the caller owns. */
  authorizeUpload(folder: string): UploadAuthorization;
  /** Confirms an uploaded asset really exists (server-to-server). Returns null when missing. */
  verifyAsset(publicId: string): Promise<VerifiedAsset | null>;
  /** Centralised delivery URLs — features never hand-build transformation URLs. */
  deliveryUrl(publicId: string, variant: "thumb" | "card" | "gallery" | "zoom"): string;
}

const TRANSFORMS = {
  thumb: "c_fill,w_160,h_160,q_auto,f_auto",
  card: "c_fill,w_480,h_480,q_auto,f_auto",
  gallery: "c_limit,w_1080,q_auto,f_auto",
  zoom: "c_limit,w_2000,q_auto,f_auto",
} as const;

/** Sign per Cloudinary's rule: sorted "k=v" pairs joined by "&", append the API secret, SHA-1. */
export function signParams(params: Record<string, string | number>, apiSecret: string): string {
  const toSign = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join("&");
  return createHash("sha1").update(toSign + apiSecret).digest("hex");
}

export class CloudinaryProvider implements MediaProvider {
  constructor(private readonly cfg: { cloudName: string; apiKey: string; apiSecret: string }, private readonly clock: () => number = () => Date.now()) {}

  authorizeUpload(folder: string): UploadAuthorization {
    const timestamp = Math.floor(this.clock() / 1000);
    const signed = { allowed_formats: UPLOAD_FORMATS, folder, timestamp };
    return {
      cloudName: this.cfg.cloudName, apiKey: this.cfg.apiKey, timestamp, folder, allowedFormats: UPLOAD_FORMATS,
      signature: signParams(signed, this.cfg.apiSecret),
      uploadUrl: `https://api.cloudinary.com/v1_1/${this.cfg.cloudName}/image/upload`,
    };
  }

  async verifyAsset(publicId: string): Promise<VerifiedAsset | null> {
    const auth = Buffer.from(`${this.cfg.apiKey}:${this.cfg.apiSecret}`).toString("base64");
    const res = await fetch(`https://api.cloudinary.com/v1_1/${this.cfg.cloudName}/resources/image/upload/${encodeURI(publicId)}`, {
      headers: { authorization: `Basic ${auth}` },
      signal: AbortSignal.timeout(8000),
    }).catch(() => undefined);
    if (!res) throw new AppError("PAYMENT_PROVIDER_UNAVAILABLE", { message: "Media service is unavailable." });
    if (res.status === 404) return null;
    if (!res.ok) throw new AppError("PAYMENT_PROVIDER_UNAVAILABLE", { message: "Media service is unavailable." });
    const body = (await res.json()) as { public_id: string; width?: number; height?: number; format?: string; bytes?: number };
    return { publicId: body.public_id, width: body.width, height: body.height, format: body.format, bytes: body.bytes };
  }

  deliveryUrl(publicId: string, variant: keyof typeof TRANSFORMS): string {
    return `https://res.cloudinary.com/${this.cfg.cloudName}/image/upload/${TRANSFORMS[variant]}/${publicId}`;
  }
}

/** In-memory provider for tests and local development without Cloudinary credentials. */
export class FakeMediaProvider implements MediaProvider {
  readonly assets = new Set<string>();
  authorizeUpload(folder: string): UploadAuthorization {
    return { cloudName: "fake", apiKey: "k", timestamp: 1, folder, allowedFormats: UPLOAD_FORMATS, signature: "sig", uploadUrl: "http://fake/upload" };
  }
  async verifyAsset(publicId: string): Promise<VerifiedAsset | null> {
    return this.assets.has(publicId) ? { publicId, width: 800, height: 800, format: "jpg", bytes: 1000 } : null;
  }
  deliveryUrl(publicId: string, variant: keyof typeof TRANSFORMS): string {
    return `https://fake.cdn/${variant}/${publicId}`;
  }
}

let override: MediaProvider | undefined;
export const setMediaProvider = (p: MediaProvider | undefined): void => {
  override = p;
};

export function getMediaProvider(): MediaProvider {
  if (override) return override;
  const env = getEnv();
  if (!env.CLOUDINARY_CLOUD_NAME || !env.CLOUDINARY_API_KEY || !env.CLOUDINARY_API_SECRET) {
    throw new AppError("CAPABILITY_UNSUPPORTED", { message: "Media uploads are not configured." });
  }
  return new CloudinaryProvider({ cloudName: env.CLOUDINARY_CLOUD_NAME, apiKey: env.CLOUDINARY_API_KEY, apiSecret: env.CLOUDINARY_API_SECRET });
}

/** Each vendor may only reference assets under their own folder. */
export const vendorMediaFolder = (vendorId: string): string => `bazarflow/vendors/${vendorId}/products`;
