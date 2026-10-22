"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { api, messageFor } from "@/lib/api";
import { formatDate, formatMoneyShort, humanize, timeAgo } from "@/lib/format";
import { useAction, useApi } from "@/lib/hooks";
import { BarChart, Donut, RankBars } from "./charts";
import { ActionButton, ListTable, ReasonButton, StatusTabs } from "./console-kit";
import { IconAlert, IconChart, IconCoin, IconReceipt } from "./icons";
import { TrackingDetails } from "./order-views";
import { useSession, useToast } from "./providers";
import { Alert, Button, ConfirmDialog, EmptyState, ErrorPanel, Field, fieldMessage, LinkButton, ListSkeleton, Money, PageHeader, Skeleton, Stat, StatusBadge, type Column } from "./ui";

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
const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
/** The last `n` calendar days (oldest first) with a label and a bucket key. */
const lastDays = (n: number) => Array.from({ length: n }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - (n - 1 - i)); return { key: dayKey(d), label: d.toLocaleDateString("en-BD", { day: "numeric", month: "short" }) }; });
const SOLD = new Set(["new", "accepted", "shipped", "delivered", "return_requested"]);

export function VendorOverview() {
  const { user } = useSession();
  const bal = useApi<Balance>("/vendor/balance");
  const orders = useApi<VOrder[]>("/vendor/orders?limit=50");
  const low = useApi<{ id: string; sku: string; available: number }[]>("/vendor/inventory?lowStock=3&limit=5");
  const stats = useMemo(() => {
    const list = orders.data ?? [];
    const days = lastDays(14);
    const byDay = new Map(days.map((d) => [d.key, { sales: 0, orders: 0 }]));
    const status = new Map<string, number>();
    const products = new Map<string, { revenue: number; qty: number }>();
    let sales = 0;
    let count = 0;
    for (const o of list) {
      status.set(o.status, (status.get(o.status) ?? 0) + 1);
      if (!SOLD.has(o.status)) continue;
      const slot = byDay.get(dayKey(new Date(o.createdAt)));
      if (slot) { slot.sales += o.totals.subtotalMinor; slot.orders += 1; sales += o.totals.subtotalMinor; count += 1; }
      for (const i of o.items) { const p = products.get(i.title) ?? { revenue: 0, qty: 0 }; p.revenue += i.lineTotalMinor; p.qty += i.quantity; products.set(i.title, p); }
    }
    return {
      series: days.map((d) => ({ label: d.label, value: byDay.get(d.key)!.sales })), perDay: days.map((d) => byDay.get(d.key)!.orders), sales, count, avg: count ? Math.round(sales / count) : 0,
      status: [...status.entries()].sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label: humanize(label), value })),
      top: [...products.entries()].sort((a, b) => b[1].revenue - a[1].revenue).slice(0, 5).map(([label, p]) => ({ label, value: p.revenue, hint: `${p.qty} sold` })),
      waiting: list.filter((o) => o.status === "new"), toShip: list.filter((o) => o.status === "accepted").length,
    };
  }, [orders.data]);
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <div className="stack">
      <PageHeader title={`${greeting}, ${user?.name.split(" ")[0] ?? "there"}`} subtitle="Here is how your store is doing.">
        <LinkButton href="/vendor/products/new" variant="primary">Add product</LinkButton>
        <LinkButton href="/vendor/orders?status=new">Review orders</LinkButton>
      </PageHeader>

      {bal.error ? <ErrorPanel error={bal.error} onRetry={bal.reload} /> : (
        <div className="grid grid-stats">
          <Stat label="Available to withdraw" icon={<IconCoin />} tone="success" value={bal.data ? <Money minor={bal.data.availableMinor} /> : <Skeleton h={28} w={110} />} hint={<Link href="/vendor/payouts">Request a payout →</Link>} />
          <Stat label="Pending (held until delivery)" icon={<IconReceipt />} tone="warning" value={bal.data ? <Money minor={bal.data.pendingMinor} /> : <Skeleton h={28} w={110} />} />
          <Stat label="Lifetime sales" icon={<IconChart />} value={bal.data ? <Money minor={bal.data.lifetimeSalesMinor} /> : <Skeleton h={28} w={110} />} />
          <Stat label="Orders waiting for you" icon={<IconAlert />} tone={stats.waiting.length ? "danger" : "success"} value={orders.data ? stats.waiting.length : <Skeleton h={28} w={50} />} hint={stats.toShip ? `${stats.toShip} accepted, ready to ship` : "You're all caught up"} />
        </div>
      )}

      <div className="dash-grid">
        <section className="card stack" aria-labelledby="sales-h">
          <div className="row-between"><div><h2 id="sales-h" style={{ marginBottom: 0 }}>Sales, last 14 days</h2><span className="muted small">Merchandise value of orders you have not cancelled</span></div>
            <div className="right"><strong style={{ fontSize: "var(--text-title)" }}><Money minor={stats.sales} /></strong><br /><span className="muted small">{stats.count} orders · avg <Money minor={stats.avg} /></span></div></div>
          {orders.loading ? <Skeleton h={180} /> : orders.error ? <ErrorPanel error={orders.error} onRetry={orders.reload} />
            : stats.count === 0 ? <EmptyState title="No sales in the last 14 days">New orders will appear here as they come in.</EmptyState>
            : <BarChart data={stats.series} format={(n) => formatMoneyShort(n)} label="Daily sales" />}
        </section>
        <section className="card stack" aria-labelledby="mix-h">
          <h2 id="mix-h" style={{ marginBottom: 0 }}>Orders by status</h2>
          {orders.loading ? <Skeleton h={160} /> : stats.status.length === 0 ? <p className="muted">No orders yet.</p> : <Donut label="Orders by status" slices={stats.status} centre={<><strong>{orders.data!.length}</strong><small>orders</small></>} />}
        </section>
      </div>

      <div className="dash-grid dash-grid-3">
        <section className="card stack" aria-labelledby="neworders">
          <div className="row-between"><h2 id="neworders" style={{ marginBottom: 0 }}>Needs your attention</h2><Link href="/vendor/orders?status=new">See all</Link></div>
          {orders.loading ? <ListSkeleton rows={3} /> : stats.waiting.length === 0 ? <p className="muted">No new orders right now.</p>
            : stats.waiting.slice(0, 5).map((o) => (
              <Link key={o.id} href={`/vendor/orders/${o.id}`} className="list-row">
                <span><strong>{o.orderNumber}</strong><small className="muted">{o.items.reduce((a, i) => a + i.quantity, 0)} item(s) · {timeAgo(o.createdAt)}</small></span><Money minor={o.totals.totalMinor} />
              </Link>
            ))}
        </section>
        <section className="card stack" aria-labelledby="top-h">
          <h2 id="top-h" style={{ marginBottom: 0 }}>Top products</h2>
          {orders.loading ? <ListSkeleton rows={3} /> : stats.top.length === 0 ? <p className="muted">Sell something to see your best sellers.</p> : <RankBars rows={stats.top} format={(n) => formatMoneyShort(n)} />}
        </section>
        <section className="card stack" aria-labelledby="lowstock">
          <div className="row-between"><h2 id="lowstock" style={{ marginBottom: 0 }}>Low stock</h2><Link href="/vendor/inventory">Inventory</Link></div>
          {low.loading ? <ListSkeleton rows={2} /> : low.error ? <ErrorPanel error={low.error} onRetry={low.reload} />
            : low.data!.length === 0 ? <p className="muted">Nothing is running low.</p>
            : low.data!.map((i) => <div key={i.id} className="list-row"><span className="mono">{i.sku}</span><span className={i.available === 0 ? "badge badge-danger" : "badge badge-warning"}>{i.available} left</span></div>)}
        </section>
      </div>
    </div>
  );
}

// ---------- orders ----------
export function VendorOrders({ initialStatus }: { initialStatus: string }) {
  const [status, setStatus] = useState(initialStatus);
  const cols: Column<VOrder>[] = [
    { key: "n", header: "Order", render: (o) => <Link href={`/vendor/orders/${o.id}`}><strong>{o.orderNumber}</strong></Link> },
    { key: "c", header: "Customer", render: (o) => <>{o.shippingAddress.recipient}<br /><span className="muted small">{o.shippingAddress.district}</span></> },
    { key: "s", header: "Status", render: (o) => <StatusBadge status={o.status} /> },
    { key: "i", header: "Items", render: (o) => <span title={o.items.map((i) => `${i.quantity} × ${i.title}`).join(", ")}>{o.items.reduce((a, i) => a + i.quantity, 0)} item(s)</span> },
    { key: "p", header: "Payment", render: (o) => (o.paymentMethod === "cod" ? <span className="badge badge-warning">COD · collect <Money minor={o.collectOnDeliveryMinor} /></span> : <StatusBadge status={o.paymentStatus ?? "paid"} />) },
    { key: "e", header: "Your earnings", numeric: true, render: (o) => <Money minor={o.commission.vendorNetMinor} /> },
    { key: "t", header: "Total", numeric: true, render: (o) => <Money minor={o.totals.totalMinor} /> },
    { key: "d", header: "Placed", render: (o) => <span title={formatDate(o.createdAt)}>{timeAgo(o.createdAt)}</span> },
  ];
  return (
    <div className="stack">
      <PageHeader title="Orders" subtitle="Accept, ship and track every order from one place." />
      <StatusTabs label="Order status" value={status} onChange={setStatus} options={[{ value: "", label: "All" }, ...["new", "accepted", "shipped", "delivered", "return_requested", "returned", "cancelled"].map((s) => ({ value: s, label: humanize(s) }))]} />
      <ListTable<VOrder> key={status} path={`/vendor/orders?limit=20${status ? `&status=${status}` : ""}`} columns={cols} caption="Orders" empty="No orders here yet"
        searchText={(o) => `${o.orderNumber} ${o.shippingAddress.recipient} ${o.items.map((i) => i.title).join(" ")}`} />
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
        {o.status === "accepted" && (
          <>
            <ActionButton label="Dispatch with REDX" variant="primary" size="md" path={`/vendor/orders/${id}/dispatch`} body={{ carrier: "redx" }} onDone={order.reload} success="Dispatched via REDX" />
            <Button variant="secondary" onClick={() => setShipOpen(true)}>Manual tracking</Button>
          </>
        )}
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
          {o.shipment && <TrackingDetails carrier={o.shipment.carrier} trackingNumber={o.shipment.trackingNumber} />}
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
