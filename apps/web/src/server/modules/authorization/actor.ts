import type { ObjectId } from "mongodb";
import { AppError } from "@/server/shared/errors";
import type { Role } from "@/server/db/schema";
import type { Permission } from "./permissions";

export interface Actor {
  userId: ObjectId;
  role: Role;
  permissions: readonly string[];
  vendorId?: ObjectId;
  /** Session family from the access token. */
  sessionId: string;
  emailVerified: boolean;
}

export function requireRole(actor: Actor, ...roles: Role[]): void {
  if (!roles.includes(actor.role)) throw new AppError("FORBIDDEN");
}

export function requirePermission(actor: Actor, permission: Permission): void {
  if (actor.role !== "admin" || !actor.permissions.includes(permission)) throw new AppError("FORBIDDEN");
}

/** Returns the vendor id the actor is bound to. Never read vendor ids from request bodies. */
export function requireVendor(actor: Actor): ObjectId {
  if (actor.role !== "vendor" || !actor.vendorId) throw new AppError("FORBIDDEN");
  return actor.vendorId;
}

export function requireVerifiedEmail(actor: Actor): void {
  if (!actor.emailVerified) {
    throw new AppError("FORBIDDEN", { message: "Verify your email address before continuing.", details: [{ field: "email", code: "UNVERIFIED" }] });
  }
}
