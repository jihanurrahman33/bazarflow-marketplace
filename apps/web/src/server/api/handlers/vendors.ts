import { z } from "zod";
import { created, ok, route } from "@/server/api/route";
import { requireRole, requireVendor } from "@/server/modules/authorization/actor";
import { SLUG_RE } from "@/server/shared/slug";
import {
  applyAsVendor, getMyApplication, getPublicVendorBySlug, getVendorForActor, resubmitApplication, toVendorDto, updateVendorProfile,
} from "@/server/modules/vendors/service";

const cloudinaryId = z.string().min(1).max(200).regex(/^[A-Za-z0-9_\-/]+$/);
const applicationBody = z.strictObject({
  business: z.strictObject({
    name: z.string().trim().min(2).max(100),
    slug: z.string().min(3).max(60).regex(SLUG_RE),
    phone: z.string().regex(/^\+?[0-9]{7,15}$/),
    address: z.string().trim().min(5).max(300),
    tradeLicenseNo: z.string().trim().max(60).optional(),
    description: z.string().trim().max(1000).optional(),
  }),
  documents: z.array(z.strictObject({ publicId: cloudinaryId, kind: z.enum(["trade_license", "national_id", "address_proof", "other"]) })).max(6).default([]),
});

export const applyHandler = route({ name: "vendor.apply", rateLimit: { rule: { name: "vendor.apply", limit: 5, windowSeconds: 3600 }, by: "actor" } }, async (ctx) =>
  created(await applyAsVendor(ctx.actor, await ctx.body(applicationBody))),
);

export const getApplicationHandler = route({ name: "vendor.application.get" }, async (ctx) => {
  requireRole(ctx.actor, "customer", "vendor");
  return ok(await getMyApplication(ctx.actor));
});

export const resubmitApplicationHandler = route({ name: "vendor.application.resubmit" }, async (ctx) => {
  requireRole(ctx.actor, "customer");
  return ok(await resubmitApplication(ctx.actor, await ctx.body(applicationBody)));
});

export const getProfileHandler = route({ name: "vendor.profile.get" }, async (ctx) =>
  ok(toVendorDto(await getVendorForActor(requireVendor(ctx.actor)))),
);

// commissionBps/status/slug are intentionally absent: strict schema rejects them (mass-assignment guard).
const profilePatch = z.strictObject({
  name: z.string().trim().min(2).max(100).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  logo: z.strictObject({ publicId: cloudinaryId, url: z.url().max(500) }).nullable().optional(),
  shipping: z.strictObject({ flatFeeMinor: z.number().int().min(0).max(10_000_000), freeOverMinor: z.number().int().min(0).max(1_000_000_000).nullable().optional() }).optional(),
});

export const patchProfileHandler = route({ name: "vendor.profile.patch" }, async (ctx) =>
  ok(await updateVendorProfile(requireVendor(ctx.actor), await ctx.body(profilePatch))),
);

export const publicVendorHandler = route<{ slug: string }>({ name: "vendors.get", auth: false }, async (ctx) =>
  ok(await getPublicVendorBySlug(ctx.params.slug), undefined, { cache: "public, s-maxage=60, stale-while-revalidate=300" }),
);
