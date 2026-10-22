/** Only same-site relative paths are allowed as post-login destinations (prevents open redirects). */
export function safeNext(next: string | null | undefined, fallback = "/"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\") || next.includes("\n")) return fallback;
  return next;
}
