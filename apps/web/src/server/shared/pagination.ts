import { z } from "zod";
import { AppError } from "./errors";

export const pageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().max(512).optional(),
});

export function encodeCursor(value: Record<string, string | number>): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

export function decodeCursor<T extends Record<string, string | number>>(cursor: string | undefined): T | undefined {
  if (!cursor) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as T;
  } catch {
    /* fall through */
  }
  throw new AppError("VALIDATION_FAILED", { details: [{ field: "cursor", code: "INVALID" }] });
}

/** Trim the over-fetched row and report whether more remain. Fetch `limit + 1` rows. */
export function slicePage<T>(rows: T[], limit: number): { items: T[]; hasMore: boolean } {
  return { items: rows.slice(0, limit), hasMore: rows.length > limit };
}
