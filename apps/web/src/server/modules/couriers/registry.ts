import { getEnv } from "@/server/config/env";
import { RedxAdapter } from "./redx";
import type { CourierAdapter } from "./types";

let defaultAdapter: CourierAdapter | undefined;

export function getCourierAdapter(carrier = "redx"): CourierAdapter {
  const normalized = carrier.toLowerCase();
  if (normalized === "redx") {
    if (!defaultAdapter) {
      const env = getEnv();
      defaultAdapter = new RedxAdapter({
        apiToken: env.REDX_API_TOKEN,
        mode: env.REDX_MODE,
      });
    }
    return defaultAdapter;
  }
  // Fall back to REDX
  return getCourierAdapter("redx");
}

export function setCourierAdapter(adapter: CourierAdapter | undefined): void {
  defaultAdapter = adapter;
}
