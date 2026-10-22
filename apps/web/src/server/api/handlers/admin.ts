import { z } from "zod";
import { ok, page, route } from "@/server/api/route";
import { requirePermission } from "@/server/modules/authorization/actor";
import { parseObjectId } from "@/server/shared/ids";
import { pageQuery } from "@/server/shared/pagination";
import { listAuditLogs, listUsers, setUserStatus } from "@/server/modules/identity/admin";
import {
  approveApplication, decideApplication, listApplications, listVendors, setVendorCommission, setVendorStatus,
} from "@/server/modules/vendors/service";

const reason = z.strictObject({ reason: z.string().trim().min(3).max(500) });

export const listApplicationsHandler = route({ name: "admin.applications.list" }, async (ctx) => {
  requirePermission(ctx.actor, "vendor.review");
  const q = ctx.query(pageQuery.extend({ status: z.enum(["submitted", "more_info_required", "approved", "rejected"]).optional() }));
  const r = await listApplications(q);
  return page(r.items, r);
});

export const approveApplicationHandler = route<{ id: string }>({ name: "admin.applications.approve" }, async (ctx) => {
  requirePermission(ctx.actor, "vendor.review");
  return ok(await approveApplication(ctx.actor, parseObjectId(ctx.params.id), ctx.requestId));
});

export const rejectApplicationHandler = route<{ id: string }>({ name: "admin.applications.reject" }, async (ctx) => {
  requirePermission(ctx.actor, "vendor.review");
  const b = await ctx.body(reason);
  return ok(await decideApplication(ctx.actor, parseObjectId(ctx.params.id), "rejected", b.reason, ctx.requestId));
});

export const requestInfoHandler = route<{ id: string }>({ name: "admin.applications.request_info" }, async (ctx) => {
  requirePermission(ctx.actor, "vendor.review");
  const b = await ctx.body(reason);
  return ok(await decideApplication(ctx.actor, parseObjectId(ctx.params.id), "more_info_required", b.reason, ctx.requestId));
});

export const listVendorsHandler = route({ name: "admin.vendors.list" }, async (ctx) => {
  requirePermission(ctx.actor, "vendor.review");
  const r = await listVendors(ctx.query(pageQuery.extend({ status: z.enum(["active", "suspended"]).optional() })));
  return page(r.items, r);
});

export const suspendVendorHandler = route<{ id: string }>({ name: "admin.vendors.suspend" }, async (ctx) => {
  requirePermission(ctx.actor, "vendor.suspend");
  const b = await ctx.body(reason);
  return ok(await setVendorStatus(ctx.actor, parseObjectId(ctx.params.id), "suspended", b.reason, ctx.requestId));
});

export const reinstateVendorHandler = route<{ id: string }>({ name: "admin.vendors.reinstate" }, async (ctx) => {
  requirePermission(ctx.actor, "vendor.suspend");
  const b = await ctx.body(reason);
  return ok(await setVendorStatus(ctx.actor, parseObjectId(ctx.params.id), "active", b.reason, ctx.requestId));
});

export const commissionHandler = route<{ id: string }>({ name: "admin.vendors.commission" }, async (ctx) => {
  requirePermission(ctx.actor, "settings.manage");
  const b = await ctx.body(z.strictObject({ commissionBps: z.number().int().min(0).max(5000), reason: reason.shape.reason }));
  return ok(await setVendorCommission(ctx.actor, parseObjectId(ctx.params.id), b.commissionBps, b.reason, ctx.requestId));
});

export const listUsersHandler = route({ name: "admin.users.list" }, async (ctx) => {
  requirePermission(ctx.actor, "user.read");
  const r = await listUsers(ctx.query(pageQuery.extend({
    role: z.enum(["customer", "vendor", "admin"]).optional(), status: z.enum(["active", "suspended"]).optional(), email: z.string().max(254).optional(),
  })));
  return page(r.items, r);
});

export const suspendUserHandler = route<{ id: string }>({ name: "admin.users.suspend" }, async (ctx) => {
  requirePermission(ctx.actor, "user.suspend");
  const b = await ctx.body(reason);
  return ok(await setUserStatus(ctx.actor, parseObjectId(ctx.params.id), "suspended", b.reason, ctx.requestId));
});

export const reinstateUserHandler = route<{ id: string }>({ name: "admin.users.reinstate" }, async (ctx) => {
  requirePermission(ctx.actor, "user.suspend");
  const b = await ctx.body(reason);
  return ok(await setUserStatus(ctx.actor, parseObjectId(ctx.params.id), "active", b.reason, ctx.requestId));
});

export const auditLogsHandler = route({ name: "admin.audit.list" }, async (ctx) => {
  requirePermission(ctx.actor, "audit.read");
  const r = await listAuditLogs(ctx.query(pageQuery.extend({ resourceType: z.string().max(60).optional(), resourceId: z.string().max(60).optional(), action: z.string().max(80).optional() })));
  return page(r.items, r);
});

