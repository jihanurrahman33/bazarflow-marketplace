import { hash, verify, type Algorithm } from "@node-rs/argon2";

// Argon2id (= 2; the const enum cannot be imported under isolatedModules) with
// OWASP-recommended minimums: 19 MiB memory, 2 iterations, 1 lane.
const OPTS = { algorithm: 2 as Algorithm, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (password: string): Promise<string> => hash(password, OPTS);

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

/** Used to equalise timing when the account does not exist. */
let dummy: Promise<string> | undefined;
export const dummyHash = (): Promise<string> => (dummy ??= hashPassword("not-a-real-password-for-timing"));
