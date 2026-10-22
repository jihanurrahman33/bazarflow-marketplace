"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, messageFor, newIdempotencyKey } from "@/lib/api";
import { useAction, useApi } from "@/lib/hooks";
import { AddressForm } from "./address-form";
import { useSession } from "./providers";
import type { Address, OrderView, Quote } from "./types";
import { Alert, Button, EmptyState, ErrorPanel, ListSkeleton, Money } from "./ui";

export function CheckoutView() {
  const router = useRouter();
  const { setCartCount } = useSession();
  const addresses = useApi<Address[]>("/addresses");
  const [addressId, setAddressId] = useState<string>();
  const [adding, setAdding] = useState(false);
  const [method, setMethod] = useState<"online" | "cod">("online");
  const [quote, setQuote] = useState<Quote>();
  const [quoteError, setQuoteError] = useState<ApiError>();
  const [stale, setStale] = useState(false);

  useEffect(() => {
    if (!addressId && addresses.data?.length) setAddressId((addresses.data.find((a) => a.isDefault) ?? addresses.data[0])!.id);
  }, [addresses.data, addressId]);

  const loadQuote = useAction(async (id: string) => {
    setQuoteError(undefined);
    try {
      const r = await api<Quote>("/checkout/quote", { method: "POST", body: { addressId: id } });
      setQuote(r.data);
      setStale(false);
      if (!r.data.paymentMethods?.includes(method)) setMethod("online");
    } catch (e) {
      setQuoteError(e instanceof ApiError ? e : undefined);
      throw e;
    }
  });
  useEffect(() => { if (addressId) void loadQuote.run(addressId); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addressId]);

  // One idempotency key per logical submission: a retry after a network error reuses it and can never create a second order.
  const keyRef = useRef<{ sig: string; key: string } | undefined>(undefined);
  const place = useAction(async () => {
    if (!quote || !addressId) return;
    const sig = `${addressId}|${method}|${quote.totals.totalMinor}`;
    if (keyRef.current?.sig !== sig) keyRef.current = { sig, key: newIdempotencyKey() };
    try {
      const r = await api<OrderView>("/checkout", { method: "POST", idempotencyKey: keyRef.current.key, body: { addressId, paymentMethod: method, expectedTotalMinor: quote.totals.totalMinor } });
      keyRef.current = undefined;
      setCartCount(0);
      const pay = r.data.payment;
      if (pay?.redirectUrl) window.location.assign(pay.redirectUrl);
      else router.push(`/orders/${r.data.id}`);
    } catch (e) {
      if (e instanceof ApiError && ["PRICE_CHANGED", "INVENTORY_UNAVAILABLE", "PRODUCT_UNAVAILABLE"].includes(e.code)) {
        keyRef.current = undefined;
        setStale(true);
        if (addressId) void loadQuote.run(addressId).catch(() => undefined);
      }
      throw e;
    }
  });

  const blocked = useMemo(() => !quote || quote.groups.length === 0 || quote.issues.length > 0, [quote]);

  if (addresses.loading) return <ListSkeleton rows={3} />;
  if (addresses.error && !addresses.data) return <ErrorPanel error={addresses.error} onRetry={addresses.reload} />;

  return (
    <div className="split split-side">
      <div className="stack">
        <section className="card stack" aria-labelledby="ship">
          <h2 id="ship">1. Delivery address</h2>
          {(addresses.data?.length ?? 0) === 0 && !adding && <EmptyState title="Add your delivery address" action={<Button variant="primary" onClick={() => setAdding(true)}>Add address</Button>}>We deliver across Bangladesh.</EmptyState>}
          {addresses.data?.map((a) => (
            <label key={a.id} className="card row" style={{ alignItems: "flex-start", cursor: "pointer", borderColor: addressId === a.id ? "var(--color-primary)" : undefined }}>
              <input type="radio" name="address" checked={addressId === a.id} onChange={() => setAddressId(a.id)} />
              <span className="grow"><strong>{a.label}</strong> · {a.recipient}<br /><span className="muted small">{a.line1}{a.line2 ? `, ${a.line2}` : ""}, {a.city}, {a.district} {a.postalCode} · {a.phone}</span></span>
            </label>
          ))}
          {adding ? <AddressForm onSaved={(a) => { setAdding(false); addresses.reload(); setAddressId(a.id); }} onCancel={() => setAdding(false)} /> : (addresses.data?.length ?? 0) > 0 && <div><Button size="sm" onClick={() => setAdding(true)}>+ New address</Button></div>}
        </section>

        <section className="card stack" aria-labelledby="pay">
          <h2 id="pay">2. Payment</h2>
          <label className="row"><input type="radio" name="pm" checked={method === "online"} onChange={() => setMethod("online")} /> <span><strong>Pay online</strong><br /><span className="muted small">You&apos;ll complete payment on the provider&apos;s secure page.</span></span></label>
          {quote?.paymentMethods?.includes("cod") && <label className="row"><input type="radio" name="pm" checked={method === "cod"} onChange={() => setMethod("cod")} /> <span><strong>Cash on delivery</strong><br /><span className="muted small">Pay the courier when your order arrives.</span></span></label>}
        </section>
      </div>

      <aside className="card stack" aria-label="Order summary" style={{ alignSelf: "start" }}>
        <h2>Order summary</h2>
        {loadQuote.pending && !quote && <ListSkeleton rows={2} />}
        {quoteError && <Alert tone="danger">{messageFor(quoteError)}</Alert>}
        {stale && <Alert tone="warning" title="Your order changed">Prices or stock changed, so we refreshed your summary. Review it and place your order again.</Alert>}
        {quote && (
          <>
            {quote.groups.map((g) => (
              <div key={g.vendorId}><strong className="small">{g.vendor.name}</strong>
                {g.lines.map((l) => <div key={l.itemId} className="row-between small"><span>{l.quantity} × {l.title}</span><Money minor={l.lineTotalMinor} /></div>)}
                <div className="row-between small muted"><span>Shipping</span><Money minor={g.shippingMinor} /></div>
              </div>
            ))}
            {quote.issues.length > 0 && <Alert tone="warning">Some items are unavailable. <Link href="/cart">Review your cart</Link></Alert>}
            <dl className="kv">
              <dt><strong>Total</strong></dt><dd className="right"><strong><Money minor={quote.totals.totalMinor} /></strong></dd>
            </dl>
          </>
        )}
        {place.error && !stale && <Alert tone="danger">{messageFor(place.error)}</Alert>}
        <Button variant="primary" block loading={place.pending} disabled={blocked || !addressId || loadQuote.pending} onClick={() => void place.run()}>
          {method === "cod" ? "Place order" : "Continue to payment"}
        </Button>
        <p className="muted small">Clicking again after a connection problem is safe: your order is only created once.</p>
      </aside>
    </div>
  );
}
