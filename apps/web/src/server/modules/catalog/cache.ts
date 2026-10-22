import { logger } from "@/server/shared/logger";

/**
 * Public-catalog cache invalidation hook. The web app registers a revalidator (Next.js `revalidateTag`)
 * at startup; in tests and scripts it is a no-op. Failures never break the business flow.
 */
type Revalidator = (slug?: string) => Promise<void> | void;
let revalidator: Revalidator | undefined;

export const setCatalogRevalidator = (fn: Revalidator | undefined): void => {
  revalidator = fn;
};

export async function invalidateCatalog(slug?: string): Promise<void> {
  try {
    await revalidator?.(slug);
  } catch {
    logger.warn("catalog revalidation failed", { action: "catalog.revalidate" });
  }
}
