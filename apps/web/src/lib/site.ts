import "server-only";

/** Storefront banner photos live in Cloudinary (`bazarflow/site/*`, uploaded by scripts/seed-demo.ts). */
export type BannerName = "hero-fashion" | "hero-tech" | "hero-home" | "hero-grocery" | "hero-sale" | "store-front";

export function siteImage(name: BannerName, opts: { w: number; h: number }): string | undefined {
  const cloud = process.env.CLOUDINARY_CLOUD_NAME;
  if (!cloud) return undefined;
  return `https://res.cloudinary.com/${cloud}/image/upload/c_fill,g_auto,w_${opts.w},h_${opts.h},q_auto,f_auto/bazarflow/site/${name}`;
}

export const CATEGORY_BANNER: Record<string, BannerName> = {
  fashion: "hero-fashion", electronics: "hero-tech", "home-living": "hero-home", grocery: "hero-grocery",
};
