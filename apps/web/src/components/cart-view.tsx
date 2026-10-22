"use client";
import Link from "next/link";
import { useState } from "react";
import { api, messageFor } from "@/lib/api";
import { formatMoney } from "@/lib/format";
import { useAction, useApi } from "@/lib/hooks";
import { useT } from "./lang";
import { useSession } from "./providers";
import type { Quote, QuoteGroup } from "./types";
import { Alert, Button, EmptyState, ErrorPanel, LinkButton, ListSkeleton, Money } from "./ui";

const ISSUE_COPY: Record<string, string> = {
  PRODUCT_UNAVAILABLE: "No longer available", VARIANT_UNAVAILABLE: "This option is no longer available", VENDOR_INACTIVE: "This seller is not active", INSUFFICIENT_STOCK: "Not enough stock",
};

/** How far this seller's items are from free shipping, when the seller offers it. */
function FreeShipping({ g }: { g: QuoteGroup }) {
  const t = useT();
  const { flatFeeMinor, freeOverMinor } = g.shippingPolicy;
  if (freeOverMinor === null || flatFeeMinor === 0) return null;
  const left = freeOverMinor - g.subtotalMinor;
  if (left <= 0) return <p className="ship-note ship-note-done">{t("You've got free shipping from {store}", { store: g.vendor.name })}</p>;
  return (
    <div className="ship-bar" role="group" aria-label="Progress to free shipping">
      <p>{t("Add {amount} more from {store} for free shipping", { amount: formatMoney(left, "BDT"), store: g.vendor.name })}</p>
      <span className="ship-track"><i style={{ width: `${Math.min(100, Math.round((g.subtotalMinor / freeOverMinor) * 100))}%` }} /></span>
    </div>
  );
}

export function CartView() {
  const t = useT();
  const cart = useApi<Quote>("/cart");
  const [code, setCode] = useState("");
  const applyCode = useAction(async () => { await api<Quote>("/cart/coupon", { method: "PUT", body: { code } }); setCode(""); cart.reload(); });
  const removeCode = useAction(async () => { await api<Quote>("/cart/coupon", { method: "DELETE" }); cart.reload(); });
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
    return <EmptyState title={t("Your cart is empty")} action={<LinkButton href="/" variant="primary">{t("Start shopping")}</LinkButton>}>{t("Add products and they will show up here.")}</EmptyState>;
  }
  const issueFor = (id: string) => q.issues.find((i) => i.itemId === id);

  return (
    <div className="split split-side">
      <div className="stack">
        {mutate.error && <Alert tone="danger">{messageFor(mutate.error)}</Alert>}
        {q.issues.some((i) => !q.groups.some((g) => g.lines.some((l) => l.itemId === i.itemId))) && (
          <Alert tone="warning" title={t("Some items are no longer available")}>{t("They were removed from your total. Remove them from your cart to continue.")}</Alert>
        )}
        {q.groups.map((g) => (
          <section key={g.vendorId} className="card stack" aria-label={t("Items from {store}", { store: g.vendor.name })}>
            <div className="row-between"><strong>{t("Sold by")} <Link href={`/vendors/${g.vendor.slug}`}>{g.vendor.name}</Link></strong><span className="muted small">{t("Shipping")} {g.shippingMinor === 0 ? t("free") : <Money minor={g.shippingMinor} />}</span></div>
            <FreeShipping g={g} />
            {g.lines.map((l) => {
              const issue = issueFor(l.itemId);
              return (
                <div key={l.itemId} className="row" style={{ alignItems: "flex-start" }}>
                  <div style={{ width: 72, height: 72, background: "var(--color-surface-container)", borderRadius: "var(--radius-md)", overflow: "hidden", flex: "0 0 auto" }}>{l.imageUrl && <img src={l.imageUrl} alt="" width={72} height={72} />}</div>
                  <div className="grow stack-sm">
                    <Link href={`/products/${l.productSlug}`}><strong>{l.title}</strong></Link>
                    {l.variantLabel !== "Default" && <span className="muted small">{l.variantLabel}</span>}
                    {issue && <span className="badge badge-warning">{t(ISSUE_COPY[issue.code] ?? "Check this item")}{issue.availableQuantity !== undefined ? ` (${t("{n} left", { n: issue.availableQuantity })})` : ""}</span>}
                    <div className="row">
                      <div className="qty" role="group" aria-label={`${t("Quantity")}: ${l.title}`}>
                        <button type="button" aria-label={t("Decrease")} disabled={mutate.pending || l.quantity <= 1} onClick={() => void mutate.run("set", l.itemId, l.quantity - 1)}>−</button>
                        <span>{l.quantity}</span>
                        <button type="button" aria-label={t("Increase")} disabled={mutate.pending || l.quantity >= 20} onClick={() => void mutate.run("set", l.itemId, l.quantity + 1)}>+</button>
                      </div>
                      <Button size="sm" variant="ghost" onClick={() => void mutate.run("remove", l.itemId)} disabled={mutate.pending}>{t("Remove")}</Button>
                    </div>
                  </div>
                  <Money minor={l.lineTotalMinor} className="price" />
                </div>
              );
            })}
          </section>
        ))}
      </div>
      <aside className="card stack" aria-label={t("Order summary")} style={{ alignSelf: "start" }}>
        <h2>{t("Summary")}</h2>
        <dl className="kv">
          <dt>{t("Items ({n})", { n: q.itemCount })}</dt><dd className="right"><Money minor={q.totals.subtotalMinor} /></dd>
          {q.totals.discountMinor > 0 && <><dt>{q.coupon ? t("Discount ({code})", { code: q.coupon.code }) : t("Discount")}</dt><dd className="right discount-amt">−<Money minor={q.totals.discountMinor} /></dd></>}
          <dt>{t("Shipping")}</dt><dd className="right"><Money minor={q.totals.shippingMinor} /></dd>
          <dt><strong>{t("Total")}</strong></dt><dd className="right"><strong><Money minor={q.totals.totalMinor} /></strong></dd>
        </dl>
        <div className="coupon-box">
          {q.coupon ? (
            <div className="row-between"><span><strong className="mono">{q.coupon.code}</strong> <span className="muted small">{q.coupon.label}</span></span><Button size="sm" variant="ghost" onClick={() => void removeCode.run()} loading={removeCode.pending}>{t("Remove")}</Button></div>
          ) : (
            <form className="row" onSubmit={(e) => { e.preventDefault(); if (code.trim()) void applyCode.run(); }}>
              <input aria-label={t("Coupon code")} className="input input-sm grow" placeholder={t("Coupon code")} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={20} autoCapitalize="characters" autoComplete="off" />
              <Button size="sm" type="submit" loading={applyCode.pending} disabled={!code.trim()}>{t("Apply")}</Button>
            </form>
          )}
          {applyCode.error && <p className="coupon-msg" role="alert">{messageFor(applyCode.error)}</p>}
          {!q.coupon && q.couponIssue && <p className="coupon-msg" role="alert">{t("Your code {code} no longer applies: {reason}", { code: q.couponIssue.code, reason: q.couponIssue.message })}</p>}
        </div>
        <LinkButton href="/checkout" variant="primary" block>{t("Proceed to checkout")}</LinkButton>
        <p className="muted small">{t("Prices and stock are confirmed again when you place your order.")}</p>
      </aside>
    </div>
  );
}
