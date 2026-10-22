"use client";
import Link from "next/link";
import { track } from "@/lib/track";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api, messageFor } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { useAction, useApi, usePaged } from "@/lib/hooks";
import { useToast } from "./providers";
import type { OrderItem, OrderView, PaymentView, VendorOrderView } from "./types";
import { Alert, Button, ConfirmDialog, EmptyState, ErrorPanel, Field, ListSkeleton, LoadMore, Money, StatusBadge } from "./ui";

export function OrderList() {
  const orders = usePaged<OrderView>("/orders?limit=10");
  if (orders.loading) return <ListSkeleton rows={3} />;
  if (orders.error && orders.items.length === 0) return <ErrorPanel error={orders.error} onRetry={orders.reload} />;
  if (orders.items.length === 0) return <EmptyState title="No orders yet" action={<Link className="btn btn-primary" href="/">Start shopping</Link>}>When you place an order it will appear here.</EmptyState>;
  return (
    <div className="stack">
      {orders.items.map((o) => (
        <Link key={o.id} href={`/orders/${o.id}`} className="card row-between" style={{ color: "inherit" }}>
          <span><strong>{o.orderNumber}</strong><br /><span className="muted small">{formatDate(o.createdAt)}</span></span>
          <span className="row"><StatusBadge status={o.status} /><Money minor={o.totals.totalMinor} currency={o.currency} className="price" /></span>
        </Link>
      ))}
      <LoadMore hasMore={orders.hasMore} loading={orders.loadingMore} onClick={orders.loadMore} />
    </div>
  );
}

const POLL_EVERY_MS = 5000;
const POLL_MAX = 12;

export function OrderDetail({ id }: { id: string }) {
  const returned = useSearchParams().get("payment") === "returned";
  const order = useApi<OrderView>(`/orders/${id}`);
  const payment = useApi<PaymentView | null>(`/orders/${id}/payment`);
  const { toast } = useToast();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [polls, setPolls] = useState(0);
  const polling = useRef(false);

  const o = order.data;
  const p = payment.data;
  const awaiting = o?.status === "pending_payment";
  // One purchase event per confirmed order (the server verifies the order and ignores repeats).
  useEffect(() => {
    if (!o || o.status === "pending_payment" || o.status === "cancelled") return;
    try { const k = `bf.purchase.${o.id}`; if (localStorage.getItem(k)) return; localStorage.setItem(k, "1"); } catch { return; }
    track({ type: "purchase", orderId: o.id });
  }, [o]);
  const verifying = awaiting && (p?.status === "pending" || p?.status === "unknown" || (returned && p?.status !== "failed" && p?.status !== "cancelled"));

  const check = useAction(async () => {
    await api(`/orders/${id}/payments/refresh`, { method: "POST", body: {} });
    order.reload();
    payment.reload();
  });
  // While the provider is still confirming, ask it (server-side) every few seconds, then hand control back to the user.
  useEffect(() => {
    if (!verifying || polls >= POLL_MAX) return;
    const t = setTimeout(() => {
      if (polling.current) return;
      polling.current = true;
      check.run().finally(() => { polling.current = false; setPolls((n) => n + 1); });
    }, POLL_EVERY_MS);
    return () => clearTimeout(t);
  }, [verifying, polls, check.run]); // eslint-disable-line react-hooks/exhaustive-deps

  const retryPay = useAction(async () => {
    const r = await api<PaymentView>(`/orders/${id}/payments`, { method: "POST", body: {} });
    if (r.data.redirectUrl) window.location.assign(r.data.redirectUrl);
    else payment.reload();
  });
  const cancel = useAction(async () => {
    await api(`/orders/${id}/cancel`, { method: "POST", body: {} });
    setConfirmCancel(false);
    toast("Order cancelled");
    order.reload();
    payment.reload();
  });

  if (order.loading) return <ListSkeleton rows={4} />;
  if (order.error && !o) return <ErrorPanel error={order.error} onRetry={order.reload} />;
  if (!o) return null;
  const cancellable = (o.status === "pending_payment" || o.status === "confirmed") && o.vendorOrders.every((v) => v.status === "awaiting_payment" || v.status === "new");

  return (
    <div className="stack">
      <div className="row-between">
        <div><h1 style={{ marginBottom: 0 }}>Order {o.orderNumber}</h1><span className="muted">Placed {formatDate(o.createdAt)}</span></div>
        <div className="row"><StatusBadge status={o.status} /><StatusBadge status={o.paymentStatus} /></div>
      </div>

      {awaiting && p?.status === "requires_action" && p.redirectUrl && (
        <Alert tone="warning" title="Complete your payment"><a className="btn btn-primary btn-sm" href={p.redirectUrl}>Pay now</a></Alert>
      )}
      {verifying && (
        <Alert tone="info" title={p?.status === "unknown" ? "We are confirming your payment" : "Waiting for payment confirmation"}>
          {p?.message ?? "This usually takes a few seconds."} <strong>Please don&apos;t pay again.</strong>{" "}
          {polls >= POLL_MAX && <Button size="sm" onClick={() => { setPolls(0); }} loading={check.pending}>Check status</Button>}
        </Alert>
      )}
      {awaiting && p && p.canRetry && (
        <Alert tone="danger" title="Payment not completed"><Button variant="primary" size="sm" onClick={() => void retryPay.run()} loading={retryPay.pending}>Try payment again</Button>{retryPay.error && <div>{messageFor(retryPay.error)}</div>}</Alert>
      )}
      {o.status === "cancelled" && <Alert tone="warning" title="This order was cancelled">{o.cancellationReason === "payment_expired" ? "Payment was not completed in time." : o.paymentStatus === "refunded" || o.paymentStatus === "partially_refunded" ? "Your payment has been refunded." : ""}</Alert>}

      <div className="split split-side">
        <div className="stack">{o.vendorOrders.map((v) => <VendorOrderCard key={v.id} v={v} onChanged={order.reload} />)}</div>
        <aside className="stack" style={{ alignSelf: "start" }}>
          <section className="card stack" aria-label="Payment summary">
            <h2>Summary</h2>
            <dl className="kv">
              <dt>Items</dt><dd className="right"><Money minor={o.totals.subtotalMinor} currency={o.currency} /></dd>
              <dt>Shipping</dt><dd className="right"><Money minor={o.totals.shippingMinor} currency={o.currency} /></dd>
              <dt><strong>Total</strong></dt><dd className="right"><strong><Money minor={o.totals.totalMinor} currency={o.currency} /></strong></dd>
              <dt>Payment</dt><dd className="right">{o.paymentMethod === "cod" ? "Cash on delivery" : "Online"}</dd>
            </dl>
          </section>
          <section className="card" aria-label="Delivery address">
            <h2>Delivery address</h2>
            <address style={{ fontStyle: "normal" }}>{o.shippingAddress.recipient}<br />{o.shippingAddress.line1}{o.shippingAddress.line2 ? `, ${o.shippingAddress.line2}` : ""}<br />{o.shippingAddress.city}, {o.shippingAddress.district} {o.shippingAddress.postalCode}<br />{o.shippingAddress.phone}</address>
          </section>
          {cancellable && <Button variant="danger" onClick={() => setConfirmCancel(true)}>Cancel order</Button>}
        </aside>
      </div>
      <ConfirmDialog open={confirmCancel} title="Cancel this order?" confirmLabel="Yes, cancel order" danger pending={cancel.pending} onClose={() => setConfirmCancel(false)} onConfirm={() => void cancel.run()}
        body={o.paymentStatus === "paid" ? "Any payment will be refunded to your original payment method." : "Items in this order will be released."}>
        {cancel.error && <Alert tone="danger">{messageFor(cancel.error)}</Alert>}
      </ConfirmDialog>
    </div>
  );
}

function VendorOrderCard({ v, onChanged }: { v: VendorOrderView; onChanged: () => void }) {
  const [returning, setReturning] = useState(false);
  const [reviewing, setReviewing] = useState<OrderItem | null>(null);
  return (
    <section className="card stack" aria-label={`Items from ${v.vendor.name}`}>
      <div className="row-between"><strong>Sold by <Link href={`/vendors/${v.vendor.slug}`}>{v.vendor.name}</Link></strong><StatusBadge status={v.status} /></div>
      {v.items.map((i) => (
        <div key={i.variantId + i.productId} className="row-between">
          <span><Link href={`/products/${i.productSlug}`}>{i.title}</Link>{i.variantLabel !== "Default" && <span className="muted"> · {i.variantLabel}</span>}<br /><span className="muted small">{i.quantity} × <Money minor={i.unitPriceMinor} /></span></span>
          <span className="row"><Money minor={i.lineTotalMinor} />{v.status === "delivered" && <Button size="sm" variant="ghost" onClick={() => setReviewing(i)}>Review</Button>}</span>
        </div>
      ))}
      {v.shipment && <TrackingDetails carrier={v.shipment.carrier} trackingNumber={v.shipment.trackingNumber} />}
      <details><summary className="small">Progress</summary>
        <ol className="timeline small">{v.timeline.map((t, idx) => <li key={idx}><StatusBadge status={t.status} /> <span className="muted">{formatDate(t.at)}</span>{t.note && <span className="muted"> — {t.note}</span>}</li>)}</ol>
      </details>
      {v.status === "delivered" && <div><Button size="sm" onClick={() => setReturning(true)}>Request a return</Button></div>}
      <ReturnDialog open={returning} id={v.id} onClose={() => setReturning(false)} onDone={() => { setReturning(false); onChanged(); }} />
      <ReviewDialog item={reviewing} onClose={() => setReviewing(null)} />
    </section>
  );
}

export function TrackingDetails({ carrier, trackingNumber }: { carrier: string; trackingNumber: string }) {
  const [open, setOpen] = useState(false);
  const track = useApi<{ carrier: string; trackingId: string; status: string; events: { messageEn: string; messageBn?: string; time: string }[] }>(
    open ? `/tracking/${encodeURIComponent(carrier)}/${encodeURIComponent(trackingNumber)}` : null,
  );

  return (
    <div className="stack small" style={{ marginTop: "var(--space-2)" }}>
      <div className="row-between">
        <p className="small" style={{ margin: 0 }}>
          <strong>{carrier}</strong> · tracking <span className="mono">{trackingNumber}</span>
        </p>
        <Button size="sm" variant="ghost" onClick={() => setOpen((prev) => !prev)}>
          {open ? "Hide courier updates" : "Track live package"}
        </Button>
      </div>
      {open && (
        <div className="card" style={{ padding: "var(--space-3)", background: "var(--color-surface-subtle)" }}>
          {track.loading && <p className="muted small">Connecting to {carrier} tracking...</p>}
          {track.error && <p className="muted small">Courier updates temporarily unavailable.</p>}
          {track.data && (
            <div className="stack small">
              <div className="row-between">
                <span><strong>Carrier:</strong> {track.data.carrier}</span>
                <StatusBadge status={track.data.status} />
              </div>
              <p className="small mono muted">Tracking #{track.data.trackingId}</p>
              {track.data.events.length === 0 ? (
                <p className="muted small">No scan events recorded yet.</p>
              ) : (
                <ol className="timeline small" style={{ marginTop: "var(--space-2)" }}>
                  {track.data.events.map((e, idx) => (
                    <li key={idx}>
                      <span className="bold">{e.messageEn}</span>
                      {e.messageBn && <span className="muted"> ({e.messageBn})</span>}
                      <br />
                      <span className="muted small">{formatDate(e.time)}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ReturnDialog({ open, id, onClose, onDone }: { open: boolean; id: string; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const { toast } = useToast();
  const send = useAction(async () => {
    await api(`/vendor-orders/${id}/return-requests`, { method: "POST", body: { reason } });
    toast("Return requested. The seller will respond soon.");
    onDone();
  });
  return (
    <ConfirmDialog open={open} title="Request a return" confirmLabel="Send request" pending={send.pending} onClose={onClose} onConfirm={() => void send.run()}>
      {send.error && <Alert tone="danger">{messageFor(send.error)}</Alert>}
      <Field label="What went wrong?" hint="At least 3 characters.">{(p) => <textarea {...p} className="input" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />}</Field>
    </ConfirmDialog>
  );
}

function ReviewDialog({ item, onClose }: { item: OrderItem | null; onClose: () => void }) {
  const [rating, setRating] = useState(5);
  const [body, setBody] = useState("");
  const { toast } = useToast();
  const send = useAction(async () => {
    await api(`/products/${item!.productSlug}/reviews`, { method: "POST", body: { rating, body } });
    toast("Thanks for your review!");
    onClose();
  });
  return (
    <ConfirmDialog open={!!item} title={`Review ${item?.title ?? ""}`} confirmLabel="Post review" pending={send.pending} onClose={onClose} onConfirm={() => void send.run()}>
      {send.error && <Alert tone="danger">{messageFor(send.error)}</Alert>}
      <Field label="Rating">{(p) => <select {...p} className="input" value={rating} onChange={(e) => setRating(Number(e.target.value))}>{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{"★".repeat(n)} ({n})</option>)}</select>}</Field>
      <Field label="Your review" hint="At least 10 characters.">{(p) => <textarea {...p} className="input" value={body} maxLength={2000} onChange={(e) => setBody(e.target.value)} />}</Field>
    </ConfirmDialog>
  );
}
