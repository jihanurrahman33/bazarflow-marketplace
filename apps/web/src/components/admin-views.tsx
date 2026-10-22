"use client";
import Link from "next/link";
import { useState } from "react";
import { api, messageFor } from "@/lib/api";
import { formatDate, humanize, parseMoneyInput } from "@/lib/format";
import { useAction, useApi } from "@/lib/hooks";
import { ActionButton, FilterSelect, ListTable, ReasonButton } from "./console-kit";
import { useSession, useToast } from "./providers";
import { Alert, Button, ConfirmDialog, Dialog, ErrorPanel, Field, ListSkeleton, Money, PageHeader, Stat, StatusBadge, type Column } from "./ui";

const can = (perms: string[], p: string) => perms.includes(p);

// ---------- overview ----------
interface Ops { outbox: { pending: number; dead: number; oldestPendingAgeSeconds: number }; payments: { unknown: number; stuckLive: number }; reservations: { expiredActive: number }; refunds: { processing: number; failed: number }; payouts: { requested: number; approved: number } }
interface Sales { paidOrders: number; grossMerchandiseMinor: number; platformCommissionMinor: number; refunds: { count: number; totalMinor: number } }

export function AdminOverview() {
  const { user } = useSession();
  const perms = user?.permissions ?? [];
  const ops = useApi<Ops>(can(perms, "report.read") ? "/admin/ops/health" : null);
  const to = new Date();
  const from = new Date(to.getTime() - 7 * 86_400_000);
  const sales = useApi<Sales>(can(perms, "report.read") ? `/admin/reports/sales?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}` : null);
  const warn = (n: number) => (n > 0 ? "badge badge-warning" : "badge badge-success");
  return (
    <div className="stack">
      <PageHeader title="Overview" subtitle="Last 7 days" />
      {!can(perms, "report.read") && <Alert tone="info">Your role has no reporting permission. Use the menu to open your work queues.</Alert>}
      {sales.error && <ErrorPanel error={sales.error} onRetry={sales.reload} />}
      {sales.data && (
        <div className="grid grid-stats">
          <Stat label="Paid orders" value={sales.data.paidOrders} /><Stat label="Gross merchandise" value={<Money minor={sales.data.grossMerchandiseMinor} />} />
          <Stat label="Platform commission" value={<Money minor={sales.data.platformCommissionMinor} />} /><Stat label="Refunds" value={<Money minor={sales.data.refunds.totalMinor} />} hint={`${sales.data.refunds.count} refund(s)`} />
        </div>
      )}
      <section className="card stack" aria-labelledby="health">
        <h2 id="health">System health</h2>
        {ops.loading ? <ListSkeleton rows={2} /> : ops.error ? <ErrorPanel error={ops.error} onRetry={ops.reload} /> : ops.data ? (
          <dl className="kv">
            <dt>Background queue</dt><dd><span className={warn(ops.data.outbox.dead)}>{ops.data.outbox.dead} dead</span> · {ops.data.outbox.pending} pending · oldest {ops.data.outbox.oldestPendingAgeSeconds}s</dd>
            <dt>Payments needing attention</dt><dd><span className={warn(ops.data.payments.unknown + ops.data.payments.stuckLive)}>{ops.data.payments.unknown} unknown · {ops.data.payments.stuckLive} stuck</span> <Link href="/admin/payments">Review</Link></dd>
            <dt>Expired reservations</dt><dd><span className={warn(ops.data.reservations.expiredActive)}>{ops.data.reservations.expiredActive}</span></dd>
            <dt>Refunds</dt><dd>{ops.data.refunds.processing} processing · <span className={warn(ops.data.refunds.failed)}>{ops.data.refunds.failed} failed</span> <Link href="/admin/refunds">Review</Link></dd>
            <dt>Payouts</dt><dd>{ops.data.payouts.requested} to approve · {ops.data.payouts.approved} to pay <Link href="/admin/payouts">Review</Link></dd>
          </dl>
        ) : null}
      </section>
    </div>
  );
}

// ---------- seller applications & sellers ----------
interface AppRow { id: string; status: string; business: { name: string; slug: string; phone: string; address: string; tradeLicenseNo?: string }; createdAt: string; reviewReason?: string }
export function ApplicationsAdmin() {
  const [status, setStatus] = useState("submitted");
  const cols: Column<AppRow>[] = [
    { key: "n", header: "Store", render: (a) => <><strong>{a.business.name}</strong><br /><span className="muted small mono">/{a.business.slug}</span></> },
    { key: "c", header: "Contact", render: (a) => <>{a.business.phone}<br /><span className="muted small">{a.business.address}</span></> },
    { key: "l", header: "Licence", render: (a) => a.business.tradeLicenseNo ?? "—" },
    { key: "s", header: "Status", render: (a) => <StatusBadge status={a.status} /> },
    { key: "d", header: "Applied", render: (a) => formatDate(a.createdAt, { dateStyle: "medium" }) },
  ];
  return (
    <div className="stack">
      <PageHeader title="Seller applications" />
      <FilterSelect label="Status" value={status} onChange={setStatus} options={["submitted", "more_info_required", "approved", "rejected"].map((s) => ({ value: s, label: humanize(s) }))} />
      <ListTable<AppRow> key={status} path={`/admin/vendor-applications?limit=20&status=${status}`} columns={cols} caption="Seller applications" empty="Nothing to review" actions={(a, reload) => a.status === "submitted" || a.status === "more_info_required" ? (
        <>
          {a.status === "submitted" && <ActionButton label="Approve" variant="primary" path={`/admin/vendor-applications/${a.id}/approve`} onDone={reload} success="Seller approved" />}
          {a.status === "submitted" && <ReasonButton label="Ask for info" title="Request more information" path={`/admin/vendor-applications/${a.id}/request-info`} onDone={reload} hint="The applicant sees this message." />}
          <ReasonButton label="Reject" danger title="Reject application" path={`/admin/vendor-applications/${a.id}/reject`} onDone={reload} hint="The applicant sees this message." />
        </>
      ) : null} />
    </div>
  );
}

interface VendorRow { id: string; slug: string; name: string; status: string; commissionBps: number; createdAt: string }
export function VendorsAdmin() {
  const { user } = useSession();
  const perms = user?.permissions ?? [];
  const [status, setStatus] = useState("");
  const [commission, setCommission] = useState<VendorRow | null>(null);
  const [pct, setPct] = useState("");
  const [reason, setReason] = useState("");
  const [tick, setTick] = useState(0);
  const { toast } = useToast();
  const save = useAction(async () => {
    const bps = Math.round(Number(pct) * 100);
    await api(`/admin/vendors/${commission!.id}/commission`, { method: "PATCH", body: { commissionBps: bps, reason } });
    toast("Commission updated");
    setCommission(null);
    setTick((t) => t + 1);
  });
  const cols: Column<VendorRow>[] = [
    { key: "n", header: "Seller", render: (v) => <><strong>{v.name}</strong><br /><Link href={`/vendors/${v.slug}`} className="small">/{v.slug}</Link></> },
    { key: "s", header: "Status", render: (v) => <StatusBadge status={v.status} /> },
    { key: "c", header: "Commission", numeric: true, render: (v) => `${v.commissionBps / 100}%` },
    { key: "d", header: "Joined", render: (v) => formatDate(v.createdAt, { dateStyle: "medium" }) },
  ];
  return (
    <div className="stack">
      <PageHeader title="Sellers" />
      <FilterSelect label="Status" value={status} onChange={setStatus} options={[{ value: "", label: "All" }, { value: "active", label: "Active" }, { value: "suspended", label: "Suspended" }]} />
      <ListTable<VendorRow> key={`${status}${tick}`} path={`/admin/vendors?limit=20${status ? `&status=${status}` : ""}`} columns={cols} caption="Sellers" empty="No sellers yet" actions={(v, reload) => (
        <>
          {can(perms, "vendor.suspend") && (v.status === "active"
            ? <ReasonButton label="Suspend" danger title={`Suspend ${v.name}?`} path={`/admin/vendors/${v.id}/suspend`} onDone={reload} hint="Their products are hidden immediately. They keep access to cancel open orders." />
            : <ReasonButton label="Reinstate" title={`Reinstate ${v.name}?`} path={`/admin/vendors/${v.id}/reinstate`} onDone={reload} />)}
          {can(perms, "settings.manage") && <Button size="sm" onClick={() => { setCommission(v); setPct(String(v.commissionBps / 100)); setReason(""); }}>Commission</Button>}
        </>
      )} />
      <ConfirmDialog open={!!commission} title={`Commission · ${commission?.name ?? ""}`} confirmLabel="Update" pending={save.pending} onClose={() => setCommission(null)} onConfirm={() => void save.run()}
        body="Applies to future orders only. Existing orders keep the rate they were sold under.">
        {save.error && <Alert tone="danger">{messageFor(save.error)}</Alert>}
        <Field label="Commission (%)" hint="0–50">{(p) => <input {...p} className="input" inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} />}</Field>
        <Field label="Reason">{(p) => <input {...p} className="input" value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
      </ConfirmDialog>
    </div>
  );
}

// ---------- product review ----------
interface QueueProduct { id: string; title: string; description: string; vendorId: string; minPriceMinor: number; currency: string; media: { url: string }[]; variants: { sku: string; priceMinor: number; optionValues: Record<string, string> }[]; updatedAt: string }
export function ProductReviewQueue() {
  const [view, setView] = useState<QueueProduct | null>(null);
  const cols: Column<QueueProduct>[] = [
    { key: "i", header: "", render: (p) => (p.media[0] ? <img src={p.media[0].url} alt="" width={48} height={48} style={{ borderRadius: 8, objectFit: "cover" }} /> : null) },
    { key: "t", header: "Product", render: (p) => <Button size="sm" variant="ghost" onClick={() => setView(p)}>{p.title}</Button> },
    { key: "p", header: "From", numeric: true, render: (p) => <Money minor={p.minPriceMinor} currency={p.currency} /> },
    { key: "v", header: "Variants", numeric: true, render: (p) => p.variants.length },
    { key: "u", header: "Submitted", render: (p) => formatDate(p.updatedAt) },
  ];
  return (
    <div className="stack">
      <PageHeader title="Product review" />
      <ListTable<QueueProduct> path="/admin/products/review-queue?limit=20" columns={cols} caption="Products waiting for review" empty="No products waiting" actions={(p, reload) => (
        <>
          <ActionButton label="Approve" variant="primary" path={`/admin/products/${p.id}/approve`} onDone={reload} success="Published" />
          <ReasonButton label="Reject" danger title="Reject product" path={`/admin/products/${p.id}/reject`} onDone={reload} hint="The seller sees this reason." />
        </>
      )} />
      <Dialog open={!!view} onClose={() => setView(null)} title={view?.title ?? ""}>
        {view && <div className="stack">
          <div className="row">{view.media.map((m) => <img key={m.url} src={m.url} alt="" width={96} height={96} style={{ borderRadius: 8, objectFit: "cover" }} />)}</div>
          <p style={{ whiteSpace: "pre-line" }}>{view.description}</p>
          <ul>{view.variants.map((v) => <li key={v.sku}><span className="mono">{v.sku}</span> {Object.values(v.optionValues).join(" / ")} · <Money minor={v.priceMinor} /></li>)}</ul>
          <div className="row" style={{ justifyContent: "flex-end" }}><Button onClick={() => setView(null)}>Close</Button></div>
        </div>}
      </Dialog>
    </div>
  );
}

// ---------- orders ----------
interface OrderRow { id: string; orderNumber: string; status: string; paymentStatus: string; paymentMethod: string; totals: { totalMinor: number }; createdAt: string }
export function OrdersAdmin() {
  const [q, setQ] = useState({ orderNumber: "", buyerEmail: "", status: "" });
  const [applied, setApplied] = useState(q);
  const qs = new URLSearchParams({ limit: "20", ...Object.fromEntries(Object.entries(applied).filter(([, v]) => v)) }).toString();
  const cols: Column<OrderRow>[] = [
    { key: "n", header: "Order", render: (o) => <Link href={`/admin/orders/${o.id}`}><strong>{o.orderNumber}</strong></Link> },
    { key: "s", header: "Status", render: (o) => <StatusBadge status={o.status} /> },
    { key: "p", header: "Payment", render: (o) => <><StatusBadge status={o.paymentStatus} /> <span className="muted small">{o.paymentMethod}</span></> },
    { key: "t", header: "Total", numeric: true, render: (o) => <Money minor={o.totals.totalMinor} /> },
    { key: "d", header: "Placed", render: (o) => formatDate(o.createdAt) },
  ];
  return (
    <div className="stack">
      <PageHeader title="Orders" />
      <form className="card row" onSubmit={(e) => { e.preventDefault(); setApplied(q); }}>
        <Field label="Order number">{(p) => <input {...p} className="input mono" value={q.orderNumber} onChange={(e) => setQ({ ...q, orderNumber: e.target.value })} placeholder="BF-XXXXXXXX" />}</Field>
        <Field label="Customer email (exact)">{(p) => <input {...p} className="input" type="email" value={q.buyerEmail} onChange={(e) => setQ({ ...q, buyerEmail: e.target.value })} />}</Field>
        <FilterSelect label="Status" value={q.status} onChange={(v) => setQ({ ...q, status: v })} options={[{ value: "", label: "Any" }, ...["pending_payment", "confirmed", "processing", "shipped", "delivered", "cancelled"].map((s) => ({ value: s, label: humanize(s) }))]} />
        <Button type="submit" variant="primary" style={{ alignSelf: "flex-end" }}>Search</Button>
      </form>
      <ListTable<OrderRow> key={qs} path={`/admin/orders?${qs}`} columns={cols} caption="Orders" empty="No orders match" />
    </div>
  );
}

interface AdminOrder {
  id: string; orderNumber: string; status: string; paymentStatus: string; paymentMethod: string; totals: { subtotalMinor: number; shippingMinor: number; totalMinor: number };
  buyer?: { name: string; email: string; phone?: string }; shippingAddress: { recipient: string; line1: string; city: string; district: string; postalCode: string; phone: string };
  vendorOrders: { id: string; vendorName: string; status: string; totals: { totalMinor: number }; commission: { bps: number; amountMinor: number; vendorNetMinor: number }; items: { title: string; sku: string; quantity: number }[] }[];
  payments: { id: string; status: string; merchantReference: string; amountMinor: number; refundedMinor: number; failureReason?: string }[];
  refunds: { id: string; status: string; amountMinor: number; reason: string; vendorOrderId?: string }[];
}
export function OrderAdminDetail({ id }: { id: string }) {
  const { user } = useSession();
  const perms = user?.permissions ?? [];
  const order = useApi<AdminOrder>(`/admin/orders/${id}`);
  const [refundFor, setRefundFor] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const { toast } = useToast();
  const refund = useAction(async () => {
    const m = parseMoneyInput(amount);
    if (!m) throw new Error("bad amount");
    await api("/admin/refunds", { method: "POST", body: { orderId: id, vendorOrderId: refundFor, amountMinor: m, reason } });
    toast("Refund requested for approval");
    setRefundFor(null);
    order.reload();
  });
  if (order.loading) return <ListSkeleton rows={4} />;
  if (order.error && !order.data) return <ErrorPanel error={order.error} onRetry={order.reload} />;
  const o = order.data!;
  return (
    <div className="stack">
      <PageHeader title={`Order ${o.orderNumber}`}><StatusBadge status={o.status} /><StatusBadge status={o.paymentStatus} /></PageHeader>
      <div className="grid grid-2">
        <section className="card"><h2>Customer</h2><p>{o.buyer?.name}<br />{o.buyer?.email}<br />{o.buyer?.phone}</p><address style={{ fontStyle: "normal" }} className="muted">{o.shippingAddress.recipient}, {o.shippingAddress.line1}, {o.shippingAddress.city}, {o.shippingAddress.district} {o.shippingAddress.postalCode} · {o.shippingAddress.phone}</address></section>
        <section className="card"><h2>Totals</h2><dl className="kv"><dt>Items</dt><dd><Money minor={o.totals.subtotalMinor} /></dd><dt>Shipping</dt><dd><Money minor={o.totals.shippingMinor} /></dd><dt><strong>Total</strong></dt><dd><strong><Money minor={o.totals.totalMinor} /></strong></dd><dt>Method</dt><dd>{o.paymentMethod}</dd></dl></section>
      </div>
      <section className="stack"><h2>Seller orders</h2>
        {o.vendorOrders.map((v) => (
          <div key={v.id} className="card stack">
            <div className="row-between"><strong>{v.vendorName}</strong><StatusBadge status={v.status} /></div>
            <div className="muted small">{v.items.map((i) => `${i.quantity} × ${i.title} (${i.sku})`).join(" · ")}</div>
            <div className="row-between small"><span>Total <Money minor={v.totals.totalMinor} /> · commission {v.commission.bps / 100}% = <Money minor={v.commission.amountMinor} /> · seller net <Money minor={v.commission.vendorNetMinor} /></span>
              <span className="row">
                {can(perms, "order.manage") && (v.status === "new" || v.status === "accepted") && <ReasonButton label="Cancel" danger title="Cancel this seller order?" path={`/admin/vendor-orders/${v.id}/cancel`} onDone={order.reload} hint="Online payments are refunded automatically." />}
                {can(perms, "refund.approve") && o.paymentMethod === "online" && <Button size="sm" onClick={() => { setRefundFor(v.id); setAmount((v.totals.totalMinor / 100).toFixed(2)); setReason(""); }}>Refund…</Button>}
              </span></div>
          </div>
        ))}
      </section>
      <section className="stack"><h2>Payments</h2>
        {o.payments.length === 0 ? <p className="muted">No payment attempts.</p> : o.payments.map((p) => <div key={p.id} className="card row-between"><span className="mono">{p.merchantReference}</span><span className="row"><StatusBadge status={p.status} /><Money minor={p.amountMinor} />{p.refundedMinor > 0 && <span className="muted small">refunded <Money minor={p.refundedMinor} /></span>}{p.failureReason && <span className="badge badge-warning">{humanize(p.failureReason)}</span>}</span></div>)}
      </section>
      {o.refunds.length > 0 && <section className="stack"><h2>Refunds</h2>{o.refunds.map((r) => <div key={r.id} className="card row-between"><span>{r.reason}</span><span className="row"><StatusBadge status={r.status} /><Money minor={r.amountMinor} /></span></div>)}</section>}
      <ConfirmDialog open={!!refundFor} title="Request a refund" confirmLabel="Request refund" pending={refund.pending} onClose={() => setRefundFor(null)} onConfirm={() => void refund.run()} body="A second administrator may need to approve large refunds.">
        {refund.error && <Alert tone="danger">{messageFor(refund.error)}</Alert>}
        <Field label="Amount (৳)">{(p) => <input {...p} className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />}</Field>
        <Field label="Reason">{(p) => <input {...p} className="input" value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
      </ConfirmDialog>
    </div>
  );
}

// ---------- money queues ----------
interface PayRow { id: string; orderId: string; merchantReference: string; status: string; amountMinor: number; failureReason?: string; updatedAt: string }
export function PaymentExceptions() {
  const cols: Column<PayRow>[] = [
    { key: "r", header: "Reference", render: (p) => <Link href={`/admin/orders/${p.orderId}`} className="mono">{p.merchantReference}</Link> },
    { key: "s", header: "Status", render: (p) => <StatusBadge status={p.status} /> },
    { key: "w", header: "Why", render: (p) => (p.failureReason ? humanize(p.failureReason) : "In flight too long") },
    { key: "a", header: "Amount", numeric: true, render: (p) => <Money minor={p.amountMinor} /> },
    { key: "u", header: "Last update", render: (p) => formatDate(p.updatedAt) },
  ];
  return (
    <div className="stack">
      <PageHeader title="Payment exceptions" subtitle="Unknown outcomes and attempts stuck in flight. Reconcile asks the provider." />
      <ListTable<PayRow> path="/admin/payments/reconciliation?limit=20" columns={cols} caption="Payment exceptions" empty="No exceptions 🎉" actions={(p, reload) => <ActionButton label="Reconcile" path={`/admin/payments/${p.id}/reconcile`} onDone={reload} success="Checked with provider" />} />
    </div>
  );
}

interface RefundRow { id: string; orderId: string; amountMinor: number; reason: string; status: string; system: boolean; failureReason?: string; createdAt: string }
export function RefundsAdmin() {
  const [status, setStatus] = useState("requested");
  const cols: Column<RefundRow>[] = [
    { key: "o", header: "Order", render: (r) => <Link href={`/admin/orders/${r.orderId}`}>Open</Link> },
    { key: "a", header: "Amount", numeric: true, render: (r) => <Money minor={r.amountMinor} /> },
    { key: "r", header: "Reason", render: (r) => <>{r.reason}{r.system && <span className="badge badge-neutral" style={{ marginLeft: 6 }}>auto</span>}</> },
    { key: "s", header: "Status", render: (r) => <><StatusBadge status={r.status} />{r.failureReason && <div className="muted small">{r.failureReason}</div>}</> },
    { key: "d", header: "Created", render: (r) => formatDate(r.createdAt) },
  ];
  return (
    <div className="stack">
      <PageHeader title="Refunds" />
      <FilterSelect label="Status" value={status} onChange={setStatus} options={["requested", "approved", "processing", "succeeded", "failed", "rejected"].map((s) => ({ value: s, label: humanize(s) }))} />
      <ListTable<RefundRow> key={status} path={`/admin/refunds?limit=20&status=${status}`} columns={cols} caption="Refunds" empty="No refunds in this state" actions={(r, reload) => (
        <>
          {r.status === "requested" && <><ActionButton label="Approve" variant="primary" path={`/admin/refunds/${r.id}/approve`} onDone={reload} success="Refund approved" /><ReasonButton label="Reject" danger title="Reject refund" path={`/admin/refunds/${r.id}/reject`} onDone={reload} /></>}
          {r.status === "failed" && <ActionButton label="Retry" path={`/admin/refunds/${r.id}/retry`} onDone={reload} />}
        </>
      )} />
    </div>
  );
}

interface PayoutRow { id: string; vendorId: string; amountMinor: number; status: string; destination: { method: string; accountName: string; accountRef: string }; createdAt: string; providerRef?: string }
export function PayoutsAdmin() {
  const [status, setStatus] = useState("requested");
  const cols: Column<PayoutRow>[] = [
    { key: "d", header: "Requested", render: (p) => formatDate(p.createdAt) },
    { key: "a", header: "Amount", numeric: true, render: (p) => <Money minor={p.amountMinor} /> },
    { key: "to", header: "Destination", render: (p) => <><strong>{humanize(p.destination.method)}</strong> · {p.destination.accountName}<br /><span className="mono">{p.destination.accountRef}</span></> },
    { key: "s", header: "Status", render: (p) => <StatusBadge status={p.status} /> },
    { key: "r", header: "Transfer ref", render: (p) => p.providerRef ?? "—" },
  ];
  return (
    <div className="stack">
      <PageHeader title="Payouts" subtitle="Approve, then record the bank/wallet transfer. Large payouts need a second administrator to confirm." />
      <FilterSelect label="Status" value={status} onChange={setStatus} options={["requested", "approved", "paid", "failed", "rejected", "cancelled"].map((s) => ({ value: s, label: humanize(s) }))} />
      <ListTable<PayoutRow> key={status} path={`/admin/payouts?limit=20&status=${status}`} columns={cols} caption="Payouts" empty="No payouts in this state" actions={(p, reload) => (
        <>
          {p.status === "requested" && <><ActionButton label="Approve" variant="primary" path={`/admin/payouts/${p.id}/approve`} onDone={reload} /><ReasonButton label="Reject" danger title="Reject payout" path={`/admin/payouts/${p.id}/reject`} onDone={reload} hint="The funds return to the seller's balance." /></>}
          {p.status === "approved" && <><ReasonButton label="Mark paid" title="Record the transfer" field="providerRef" fieldLabel="Transfer reference" single minLength={4} hint="Bank or wallet transaction id." path={`/admin/payouts/${p.id}/paid`} onDone={reload} confirmLabel="Mark as paid" /><ReasonButton label="Mark failed" danger title="Transfer failed" path={`/admin/payouts/${p.id}/failed`} onDone={reload} hint="The funds return to the seller's balance." /></>}
        </>
      )} />
    </div>
  );
}

// ---------- users, categories, audit ----------
interface UserRow { id: string; email: string; name: string; role: string; emailVerified: boolean; createdAt: string }
export function UsersAdmin() {
  const [email, setEmail] = useState("");
  const [applied, setApplied] = useState("");
  const [role, setRole] = useState("");
  const qs = new URLSearchParams({ limit: "20", ...(applied ? { email: applied } : {}), ...(role ? { role } : {}) }).toString();
  const cols: Column<UserRow>[] = [
    { key: "n", header: "User", render: (u) => <><strong>{u.name}</strong><br /><span className="muted small">{u.email}</span></> },
    { key: "r", header: "Role", render: (u) => humanize(u.role) },
    { key: "v", header: "Email verified", render: (u) => (u.emailVerified ? "Yes" : "No") },
    { key: "d", header: "Joined", render: (u) => formatDate(u.createdAt, { dateStyle: "medium" }) },
  ];
  return (
    <div className="stack">
      <PageHeader title="Users" />
      <form className="card row" onSubmit={(e) => { e.preventDefault(); setApplied(email); }}>
        <Field label="Email (exact match)">{(p) => <input {...p} className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
        <FilterSelect label="Role" value={role} onChange={setRole} options={[{ value: "", label: "Any" }, { value: "customer", label: "Customer" }, { value: "vendor", label: "Seller" }, { value: "admin", label: "Admin" }]} />
        <Button type="submit" variant="primary" style={{ alignSelf: "flex-end" }}>Search</Button>
      </form>
      <ListTable<UserRow> key={qs} path={`/admin/users?${qs}`} columns={cols} caption="Users" empty="No users match" actions={(u, reload) => u.role === "admin" ? null : (
        <>
          <ReasonButton label="Suspend" danger title={`Suspend ${u.email}?`} path={`/admin/users/${u.id}/suspend`} onDone={reload} hint="They are signed out everywhere immediately." />
          <ReasonButton label="Reinstate" title="Reinstate this user?" path={`/admin/users/${u.id}/reinstate`} onDone={reload} />
        </>
      )} />
    </div>
  );
}

interface Cat { id: string; name: string; slug: string; children: { id: string; name: string; slug: string }[] }
export function CategoriesAdmin() {
  const cats = useApi<Cat[]>("/categories");
  const [f, setF] = useState({ name: "", slug: "", parentId: "" });
  const { toast } = useToast();
  const create = useAction(async () => {
    await api("/admin/categories", { method: "POST", body: { name: f.name, slug: f.slug, ...(f.parentId ? { parentId: f.parentId } : {}) } });
    toast("Category created");
    setF({ name: "", slug: "", parentId: "" });
    cats.reload();
  });
  return (
    <div className="stack">
      <PageHeader title="Categories" />
      <form className="card row" onSubmit={(e) => { e.preventDefault(); void create.run(); }}>
        <Field label="Name">{(p) => <input {...p} className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value, slug: f.slug || e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") })} required />}</Field>
        <Field label="Slug">{(p) => <input {...p} className="input mono" value={f.slug} onChange={(e) => setF({ ...f, slug: e.target.value })} required />}</Field>
        <Field label="Parent">{(p) => <select {...p} className="input" value={f.parentId} onChange={(e) => setF({ ...f, parentId: e.target.value })}><option value="">None (top level)</option>{cats.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}</Field>
        <Button type="submit" variant="primary" loading={create.pending} style={{ alignSelf: "flex-end" }}>Add</Button>
      </form>
      {create.error && <Alert tone="danger">{messageFor(create.error)}</Alert>}
      {cats.loading ? <ListSkeleton rows={3} /> : cats.error ? <ErrorPanel error={cats.error} onRetry={cats.reload} /> : (
        <div className="stack">{cats.data!.map((c) => <div key={c.id} className="card"><strong>{c.name}</strong> <span className="muted small mono">/{c.slug}</span>{c.children.length > 0 && <div className="row" style={{ marginTop: 8 }}>{c.children.map((x) => <span key={x.id} className="badge badge-neutral">{x.name}</span>)}</div>}</div>)}</div>
      )}
    </div>
  );
}

interface AuditRow { id: string; actorRole?: string; action: string; resourceType: string; resourceId?: string; reason?: string; createdAt: string; requestId?: string }
export function AuditLog() {
  const [action, setAction] = useState("");
  const [applied, setApplied] = useState("");
  const cols: Column<AuditRow>[] = [
    { key: "d", header: "When", render: (a) => formatDate(a.createdAt) },
    { key: "a", header: "Action", render: (a) => <span className="mono">{a.action}</span> },
    { key: "w", header: "By", render: (a) => humanize(a.actorRole ?? "system") },
    { key: "r", header: "Resource", render: (a) => <span className="mono small">{a.resourceType}:{a.resourceId?.slice(-8) ?? "—"}</span> },
    { key: "n", header: "Reason", render: (a) => a.reason ?? "" },
  ];
  return (
    <div className="stack">
      <PageHeader title="Audit log" />
      <form className="card row" onSubmit={(e) => { e.preventDefault(); setApplied(action); }}>
        <Field label="Action (exact)">{(p) => <input {...p} className="input mono" value={action} onChange={(e) => setAction(e.target.value)} placeholder="vendor.suspend" />}</Field>
        <Button type="submit" variant="primary" style={{ alignSelf: "flex-end" }}>Filter</Button>
      </form>
      <ListTable<AuditRow> key={applied} path={`/admin/audit-logs?limit=30${applied ? `&action=${encodeURIComponent(applied)}` : ""}`} columns={cols} caption="Audit log" empty="No entries" />
    </div>
  );
}
