"use client";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, messageFor } from "@/lib/api";
import { IconHeart } from "./icons";
import { useSession, useToast } from "./providers";

interface WishlistApi { saved: (id: string) => boolean; toggle: (id: string) => Promise<void>; count: number; enabled: boolean }
const Ctx = createContext<WishlistApi>({ saved: () => false, toggle: async () => undefined, count: 0, enabled: true });
export const useWishlist = () => useContext(Ctx);

/** Which products this customer has saved, loaded once (ids only) and updated optimistically as they tap hearts. */
export function WishlistProvider({ children }: { children: ReactNode }) {
  const { user } = useSession();
  const { toast } = useToast();
  const router = useRouter();
  const path = usePathname();
  const [ids, setIds] = useState<Set<string>>(new Set());
  const customer = user?.role === "customer";

  useEffect(() => {
    if (!customer) { setIds(new Set()); return; }
    let live = true;
    api<string[]>("/me/wishlist/ids").then((r) => live && setIds(new Set(r.data))).catch(() => undefined);
    return () => { live = false; };
  }, [customer, user?.id]);

  const toggle = useCallback(async (id: string) => {
    if (!user) { router.push(`/login?next=${encodeURIComponent(path)}`); return; }
    const had = ids.has(id);
    setIds((s) => { const n = new Set(s); if (had) n.delete(id); else n.add(id); return n; });
    try {
      await api(`/me/wishlist/${id}`, { method: had ? "DELETE" : "PUT", ...(had ? {} : { body: {} }) });
      if (!had) toast("Saved. We'll tell you if the price drops.");
    } catch (e) {
      setIds((s) => { const n = new Set(s); if (had) n.add(id); else n.delete(id); return n; });
      toast(messageFor(e));
    }
  }, [ids, user, router, path, toast]);

  const value = useMemo<WishlistApi>(() => ({ saved: (id) => ids.has(id), toggle, count: ids.size, enabled: !user || customer }), [ids, toggle, user, customer]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Heart on a product card or page. Hidden for seller and admin accounts, which cannot save items. */
export function WishButton({ productId, title, className = "wish-btn" }: { productId: string; title?: string; className?: string }) {
  const { saved, toggle, enabled } = useWishlist();
  if (!enabled) return null;
  const on = saved(productId);
  return (
    <button type="button" className={className} aria-pressed={on} aria-label={on ? `Remove ${title ?? "item"} from saved items` : `Save ${title ?? "item"} for later`} onClick={(e) => { e.preventDefault(); e.stopPropagation(); void toggle(productId); }}>
      <IconHeart width={18} height={18} />
    </button>
  );
}
