"use client";
import Link from "next/link";
import { api, messageFor } from "@/lib/api";
import { useAction, useApi } from "@/lib/hooks";
import { useSession } from "./providers";
import type { Quote } from "./types";
import { Alert, Button, EmptyState, ErrorPanel, LinkButton, ListSkeleton, Money } from "./ui";

const ISSUE_COPY: Record<string, string> = {
  PRODUCT_UNAVAILABLE: "No longer available", VARIANT_UNAVAILABLE: "This option is no longer available", VENDOR_INACTIVE: "This seller is not active", INSUFFICIENT_STOCK: "Not enough stock",
};

export function CartView() {
  const cart = useApi<Quote>("/cart");
  const { setCartCount } = useSession();
  const mutate = useAction(async (kind: "set" | "remove", itemId: string, quantity?: number) => {
    const r = kind === "set"
      ? await api<Quote>(`/cart/items/${encodeURIComponent(itemId)}`, { method: "PATCH", body: { quantity } })
      : await api<Quote>(`/cart/items/${encodeURIComponent(itemId)}`, { method: "DELETE" });
    setCartCount(r.data.itemCount);
    cart.reload();
  });

  if (cart.loading) return <ListSkeleton rows={3} />;
  if (cart.error && !cart.data) return <ErrorPanel error={cart.error} onRetry={cart.reload} />;
  const q = cart.data!;
  if (q.groups.length === 0 && q.issues.length === 0) {
    return <EmptyState title="Your cart is empty" action={<LinkButton href="/" variant="primary">Start shopping</LinkButton>}>Add products and they will show up here.</EmptyState>;
  }
  const issueFor = (id: string) => q.issues.find((i) => i.itemId === id);

  return (
    <div className="split split-side">
      <div className="stack">
        {mutate.error && <Alert tone="danger">{messageFor(mutate.error)}</Alert>}
        {q.issues.some((i) => !q.groups.some((g) => g.lines.some((l) => l.itemId === i.itemId))) && (
          <Alert tone="warning" title="Some items are no longer available">They were removed from your total. Remove them from your cart to continue.</Alert>
        )}
        {q.groups.map((g) => (
          <section key={g.vendorId} className="card stack" aria-label={`Items from ${g.vendor.name}`}>
            <div className="row-between"><strong>Sold by <Link href={`/vendors/${g.vendor.slug}`}>{g.vendor.name}</Link></strong><span className="muted small">Shipping <Money minor={g.shippingMinor} /></span></div>
            {g.lines.map((l) => {
              const issue = issueFor(l.itemId);
              return (
                <div key={l.itemId} className="row" style={{ alignItems: "flex-start" }}>
                  <div style={{ width: 72, height: 72, background: "var(--color-surface-container)", borderRadius: "var(--radius-md)", overflow: "hidden", flex: "0 0 auto" }}>{l.imageUrl && <img src={l.imageUrl} alt="" width={72} height={72} />}</div>
                  <div className="grow stack-sm">
                    <Link href={`/products/${l.productSlug}`}><strong>{l.title}</strong></Link>
                    {l.variantLabel !== "Default" && <span className="muted small">{l.variantLabel}</span>}
                    {issue && <span className="badge badge-warning">{ISSUE_COPY[issue.code] ?? "Check this item"}{issue.availableQuantity !== undefined ? ` (${issue.availableQuantity} left)` : ""}</span>}
                    <div className="row">
                      <div className="qty" role="group" aria-label={`Quantity for ${l.title}`}>
                        <button type="button" aria-label="Decrease" disabled={mutate.pending || l.quantity <= 1} onClick={() => void mutate.run("set", l.itemId, l.quantity - 1)}>−</button>
                        <span>{l.quantity}</span>
                        <button type="button" aria-label="Increase" disabled={mutate.pending || l.quantity >= 20} onClick={() => void mutate.run("set", l.itemId, l.quantity + 1)}>+</button>
                      </div>
                      <Button size="sm" variant="ghost" onClick={() => void mutate.run("remove", l.itemId)} disabled={mutate.pending}>Remove</Button>
                    </div>
                  </div>
                  <Money minor={l.lineTotalMinor} className="price" />
                </div>
              );
            })}
          </section>
        ))}
      </div>
      <aside className="card stack" aria-label="Order summary" style={{ alignSelf: "start" }}>
        <h2>Summary</h2>
        <dl className="kv">
          <dt>Items ({q.itemCount})</dt><dd className="right"><Money minor={q.totals.subtotalMinor} /></dd>
          <dt>Shipping</dt><dd className="right"><Money minor={q.totals.shippingMinor} /></dd>
          <dt><strong>Total</strong></dt><dd className="right"><strong><Money minor={q.totals.totalMinor} /></strong></dd>
        </dl>
        <LinkButton href="/checkout" variant="primary" block>Proceed to checkout</LinkButton>
        <p className="muted small">Prices and stock are confirmed again when you place your order.</p>
      </aside>
    </div>
  );
}
