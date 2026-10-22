import { z } from "zod";
import { noContent, ok, route } from "@/server/api/route";
import { requireRole } from "@/server/modules/authorization/actor";
import { parseObjectId } from "@/server/shared/ids";
import { addToWishlist, listWishlist, removeFromWishlist, wishlistIds } from "@/server/modules/wishlist/service";

export const listWishlistHandler = route({ name: "wishlist.list" }, async (ctx) => {
  requireRole(ctx.actor, "customer");
  return ok(await listWishlist(ctx.actor.userId));
});

/** Just the ids, so every product card can show whether it is saved without loading the whole list. */
export const wishlistIdsHandler = route({ name: "wishlist.ids" }, async (ctx) => {
  requireRole(ctx.actor, "customer");
  return ok(await wishlistIds(ctx.actor.userId));
});

export const addWishlistHandler = route<{ productId: string }>({ name: "wishlist.add", rateLimit: { rule: { name: "wishlist.write", limit: 120, windowSeconds: 3600 }, by: "actor" } }, async (ctx) => {
  requireRole(ctx.actor, "customer");
  await ctx.body(z.strictObject({}).optional());
  await addToWishlist(ctx.actor.userId, parseObjectId(ctx.params.productId));
  return noContent();
});

export const removeWishlistHandler = route<{ productId: string }>({ name: "wishlist.remove", rateLimit: { rule: { name: "wishlist.write", limit: 120, windowSeconds: 3600 }, by: "actor" } }, async (ctx) => {
  requireRole(ctx.actor, "customer");
  await removeFromWishlist(ctx.actor.userId, parseObjectId(ctx.params.productId));
  return noContent();
});
