import { readFileSync } from "node:fs";

/** Minimal .env.local loader for scripts (Next loads it itself for the app). */
export function loadDotEnv(file = ".env.local"): void {
  try {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m && !line.trim().startsWith("#") && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, "");
    }
  } catch {
    /* no file: rely on process env */
  }
}
