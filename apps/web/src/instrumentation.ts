/** Runs once when the server starts: fail fast on bad configuration instead of at the first request. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getEnv } = await import("./server/config/env");
    getEnv();
  }
}
