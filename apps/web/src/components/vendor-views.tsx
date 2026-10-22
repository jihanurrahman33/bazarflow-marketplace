"use client";
import Link from "next/link";
import { useState } from "react";
import { api, messageFor } from "@/lib/api";
import { formatDate, humanize } from "@/lib/format";
import { useAction, useApi } from "@/lib/hooks";
import { ActionButton, FilterSelect, ListTable, ReasonButton } from "./console-kit";
import { useToast } from "./providers";
import { Alert, Button, ConfirmDialog, ErrorPanel, Field, fieldMessage, ListSkeleton, Money, PageHeader, Stat, StatusBadge, type Column } from "./ui";

// ---------- shapes ----------
interface Balance { availableMinor: number; pendingMinor: number; lifetimeSalesMinor: number }
export interface VOrder {
  id: string; orderNumber: string; status: string; paymentMethod?: string; paymentStatus?: string; collectOnDeliveryMinor: number; createdAt: string; deliveredAt?: string;
  items: { title: string; sku: string; variantLabel: string; quantity: number; unitPriceMinor: number; lineTotalMinor: number }[];
  totals: { subtotalMinor: number; shippingMinor: number; totalMinor: number }; commission: { bps: number; amountMinor: number; vendorNetMinor: number };
  shippingAddress: { recipient: string; phone: string; line1: string; line2?: string; city: string; district: string; postalCode: string };
  shipment?: { carrier: string; trackingNumber: string }; timeline: { status: string; at: string; note?: string }[];
}

// ---------- overview ----------
export function VendorOverview() {
  const bal = useApi<Balance>("/vendor/balance");
  const fresh = useApi<VOrder[]>("/vendor/orders?status=new&limit=5");
  const low = useApi<{ id: string; sku: string; available: number }[]>("/vendor/inventory?lowStock=3&limit=5");
  return (
    <div className="stack">
      <PageHeader title="Overview" />
      {bal.error ? <ErrorPanel error={bal.error} onRetry={bal.reload} /> : (
        <div className="grid grid-stats">
          <Stat label="Available to withdraw" value={bal.data ? <Money minor={bal.data.availableMinor} /> : "—"} />
          <Stat label="Pending (held until delivery)" value={bal.data ? <Money minor={bal.data.pendingMinor} /> : "—"} />
          <Stat label="Lifetime sales" value={bal.data ? <Money minor={bal.data.lifetimeSalesMinor} /> : "—"} />
        </div>
      )}
      <section className="card stack" aria-labelledby="neworders">
        <div className="row-between"><h2 id="neworders" style={{ marginBottom: 0 }}>Orders waiting for you</h2><Link href="/vendor/orders?status=new">See all</Link></div>
        {fresh.loading ? <ListSkeleton rows={2} /> : fresh.error ? <ErrorPanel error={fresh.error} onRetry={fresh.reload} />
          : fresh.data!.length === 0 ? <p className="muted">You&apos;re all caught up.</p>
          : fresh.data!.map((o) => <Link key={o.id} href={`/vendor/orders/${o.id}`} className="row-between"><span><strong>{o.orderNumber}</strong> · {o.items.length} item(s)</span><Money minor={o.totals.totalMinor} /></Link>)}
      </section>
      <section className="card stack" aria-labelledby="lowstock">
        <h2 id="lowstock">Low stock</h2>
        {low.loading ? <ListSkeleton rows={2} /> : low.error ? <ErrorPanel error={low.error} onRetry={low.reload} />
          : low.data!.length === 0 ? <p className="muted">Nothing is running low.</p>
          : low.data!.map((i) => <div key={i.id} className="row-between"><span className="mono">{i.sku}</span><span className={i.available === 0 ? "badge badge-danger" : "badge badge-warning"}>{i.available} left</span></div>)}
      </section>
    </div>
  );
}

// ---------- orders ----------
export function VendorOrders({ initialStatus }: { initialStatus: string }) {
  const [status, setStatus] = useState(initialStatus);
  const cols: Column<VOrder>[] = [
    { key: "n", header: "Order", render: (o) => <Link href={`/vendor/orders/${o.id}`}><strong>{o.orderNumber}</strong></Link> },
    { key: "s", header: "Status", render: (o) => <StatusBadge status={o.status} /> },
    { key: "i", header: "Items", render: (o) => `${o.items.reduce((a, i) => a + i.quantity, 0)} item(s)` },
    { key: "p", header: "Payment", render: (o) => (o.paymentMethod === "cod" ? <span className="badge badge-warning">COD · collect <Money minor={o.collectOnDeliveryMinor} /></span> : <StatusBadge status={o.paymentStatus ?? "paid"} />) },
    { key: "t", header: "Total", numeric: true, render: (o) => <Money minor={o.totals.totalMinor} /> },
    { key: "d", header: "Placed", render: (o) => formatDate(o.createdAt) },
  ];
  return (
    <div className="stack">
      <PageHeader title="Orders" />
      <FilterSelect label="Status" value={status} onChange={setStatus} options={[{ value: "", label: "All active" }, ...["new", "accepted", "shipped", "delivered", "return_requested", "returned", "cancelled"].map((s) => ({ value: s, label: humanize(s) }))]} />
      <ListTable<VOrder> path={`/vendor/orders?limit=20${status ? `&status=${status}` : ""}`} columns={cols} caption="Orders" empty="No orders here yet" />
    </div>
  );
}

export function VendorOrderDetail({ id }: { id: string }) {
  const order = useApi<VOrder>(`/vendor/orders/${id}`);
  const [shipOpen, setShipOpen] = useState(false);
  const [ship, setShip] = useState({ carrier: "", trackingNumber: "" });
  const { toast } = useToast();
  const doShip = useAction(async () => {
    await api(`/vendor/orders/${id}/ship`, { method: "POST", body: ship });
    setShipOpen(false);
    toast("Marked as shipped");
    order.reload();
  });
  if (order.loading) return <ListSkeleton rows={4} />;
  if (order.error && !order.data) return <ErrorPanel error={order.error} onRetry={order.reload} />;
  const o = order.data!;
  const a = o.shippingAddress;
  return (
    <div className="stack">
      <PageHeader title={`Order ${o.orderNumber}`} subtitle={`Placed ${formatDate(o.createdAt)}`}><StatusBadge status={o.status} /></PageHeader>
      <div className="row">
        {o.status === "new" && <ActionButton label="Accept order" variant="primary" size="md" path={`/vendor/orders/${id}/accept`} onDone={order.reload} success="Order accepted" />}
        {o.status === "accepted" && <Button variant="primary" onClick={() => setShipOpen(true)}>Mark as shipped</Button>}
        {o.status === "shipped" && <ActionButton label="Mark as delivered" variant="primary" size="md" path={`/vendor/orders/${id}/deliver`} onDone={order.reload} success="Marked as delivered" />}
        {(o.status === "new" || o.status === "accepted") && <ReasonButton label={o.status === "new" ? "Reject" : "Cancel order"} title="Cancel this order?" danger path={`/vendor/orders/${id}/cancel`} onDone={order.reload} success="Order cancelled" hint="The customer sees this reason. Online payments are refunded automatically." />}
        {o.status === "return_requested" && (
          <>
            <ActionButton label="Accept return" variant="primary" size="md" path={`/vendor/orders/${id}/return/approve`} onDone={order.reload} success="Return accepted" />
            <ReasonButton label="Decline return" title="Decline this return?" path={`/vendor/orders/${id}/return/reject`} onDone={order.reload} />
          </>
        )}
      </div>
      {o.paymentMethod === "cod" && <Alert tone="warning" title="Cash on delivery">Collect <Money minor={o.collectOnDeliveryMinor} /> from the customer on delivery.</Alert>}
      <div className="grid grid-2">
        <section className="card stack" aria-labelledby="items">
          <h2 id="items">Items</h2>
          {o.items.map((i, idx) => <div key={idx} className="row-between"><span>{i.title}{i.variantLabel !== "Default" && ` · ${i.variantLabel}`}<br /><span className="muted small mono">{i.sku} · {i.quantity} × <Money minor={i.unitPriceMinor} /></span></span><Money minor={i.lineTotalMinor} /></div>)}
          <hr />
          <dl className="kv"><dt>Subtotal</dt><dd className="right"><Money minor={o.totals.subtotalMinor} /></dd><dt>Shipping</dt><dd className="right"><Money minor={o.totals.shippingMinor} /></dd>
            <dt>Commission ({o.commission.bps / 100}%)</dt><dd className="right">−<Money minor={o.commission.amountMinor} /></dd><dt><strong>Your earnings</strong></dt><dd className="right"><strong><Money minor={o.commission.vendorNetMinor} /></strong></dd></dl>
        </section>
        <section className="card stack" aria-labelledby="ship-to">
          <h2 id="ship-to">Ship to</h2>
          <address style={{ fontStyle: "normal" }}><strong>{a.recipient}</strong><br />{a.line1}{a.line2 ? `, ${a.line2}` : ""}<br />{a.city}, {a.district} {a.postalCode}<br />{a.phone}</address>
          {o.shipment && <p><strong>{o.shipment.carrier}</strong> · <span className="mono">{o.shipment.trackingNumber}</span></p>}
          <details open><summary>History</summary><ol className="timeline small">{o.timeline.map((t, i) => <li key={i}><StatusBadge status={t.status} /> <span className="muted">{formatDate(t.at)}</span>{t.note && <span className="muted"> — {t.note}</span>}</li>)}</ol></details>
        </section>
      </div>
      <ConfirmDialog open={shipOpen} title="Add shipment details" confirmLabel="Mark as shipped" pending={doShip.pending} onClose={() => setShipOpen(false)} onConfirm={() => void doShip.run()}>
        {doShip.error && <Alert tone="danger">{messageFor(doShip.error)}</Alert>}
        <Field label="Carrier" error={fieldMessage(doShip.error, "carrier")}>{(p) => <input {...p} className="input" value={ship.carrier} onChange={(e) => setShip({ ...ship, carrier: e.target.value })} placeholder="e.g. Pathao, Steadfast" />}</Field>
        <Field label="Tracking number" error={fieldMessage(doShip.error, "trackingNumber")}>{(p) => <input {...p} className="input mono" value={ship.trackingNumber} onChange={(e) => setShip({ ...ship, trackingNumber: e.target.value })} />}</Field>
      </ConfirmDialog>
    </div>
  );
}
