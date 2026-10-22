"use client";
import { useEffect, useState } from "react";
import { api, messageFor } from "@/lib/api";
import { formatDate, humanize, parseMoneyInput } from "@/lib/format";
import { useAction, useApi } from "@/lib/hooks";
import { ActionButton, ListTable } from "./console-kit";
import { useToast } from "./providers";
import { Alert, Button, ConfirmDialog, ErrorPanel, Field, fieldMessage, ListSkeleton, Money, PageHeader, Stat, StatusBadge, type Column } from "./ui";

interface Balance { availableMinor: number; pendingMinor: number; lifetimeSalesMinor: number }
interface Payout { id: string; amountMinor: number; status: string; destination: { method: string; accountRef: string }; providerRef?: string; createdAt: string }
interface LedgerRow { id: string; type: string; amountMinor: number; availableAt?: string; createdAt: string; vendorOrderId?: string }
interface Store {
  name: string; description?: string; shipping: { flatFeeMinor: number; freeOverMinor?: number };
  payoutDestination?: { method: "bank" | "bkash" | "nagad"; accountName: string; accountRef: string };
}

export function EarningsAndPayouts() {
  const bal = useApi<Balance>("/vendor/balance");
  const [tick, setTick] = useState(0);
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const { toast } = useToast();
  const request = useAction(async () => {
    const m = parseMoneyInput(amount);
    if (!m) throw new Error("bad amount");
    await api("/vendor/payouts", { method: "POST", body: { amountMinor: m } });
    setOpen(false);
    setAmount("");
    toast("Payout requested");
    bal.reload();
    setTick((t) => t + 1);
  });
  const pcols: Column<Payout>[] = [
    { key: "d", header: "Requested", render: (p) => formatDate(p.createdAt) },
    { key: "a", header: "Amount", numeric: true, render: (p) => <Money minor={p.amountMinor} /> },
    { key: "s", header: "Status", render: (p) => <StatusBadge status={p.status} /> },
    { key: "to", header: "To", render: (p) => <span className="mono">{humanize(p.destination.method)} {p.destination.accountRef}</span> },
    { key: "r", header: "Reference", render: (p) => p.providerRef ?? "—" },
  ];
  const lcols: Column<LedgerRow>[] = [
    { key: "d", header: "Date", render: (l) => formatDate(l.createdAt) },
    { key: "t", header: "Entry", render: (l) => humanize(l.type) },
    { key: "a", header: "Amount", numeric: true, render: (l) => <span style={{ color: l.amountMinor < 0 ? "var(--color-danger)" : undefined }}>{l.amountMinor < 0 ? "−" : "+"}<Money minor={Math.abs(l.amountMinor)} /></span> },
    { key: "av", header: "Payable from", render: (l) => (l.availableAt ? formatDate(l.availableAt, { dateStyle: "medium" }) : "After delivery") },
  ];
  return (
    <div className="stack">
      <PageHeader title="Earnings & payouts"><Button variant="primary" onClick={() => setOpen(true)} disabled={!bal.data || bal.data.availableMinor <= 0}>Request payout</Button></PageHeader>
      {bal.error ? <ErrorPanel error={bal.error} onRetry={bal.reload} /> : (
        <div className="grid grid-stats">
          <Stat label="Available to withdraw" value={bal.data ? <Money minor={bal.data.availableMinor} /> : "—"} hint="After the hold period" />
          <Stat label="Pending" value={bal.data ? <Money minor={bal.data.pendingMinor} /> : "—"} hint="Held until delivery + hold" />
          <Stat label="Lifetime sales" value={bal.data ? <Money minor={bal.data.lifetimeSalesMinor} /> : "—"} />
        </div>
      )}
      <section className="stack"><h2>Payouts</h2>
        <ListTable<Payout> key={tick} path="/vendor/payouts?limit=10" columns={pcols} caption="Payouts" empty="No payouts yet" actions={(p, reload) => (p.status === "requested" ? <ActionButton label="Cancel" path={`/vendor/payouts/${p.id}/cancel`} onDone={() => { reload(); bal.reload(); }} /> : null)} />
      </section>
      <section className="stack"><h2>Ledger</h2><ListTable<LedgerRow> key={`l${tick}`} path="/vendor/ledger?limit=20" columns={lcols} caption="Ledger" empty="No ledger entries yet" /></section>
      <ConfirmDialog open={open} title="Request a payout" confirmLabel="Request payout" pending={request.pending} onClose={() => setOpen(false)} onConfirm={() => void request.run()}>
        {request.error && <Alert tone="danger">{fieldMessage(request.error, "amountMinor") ?? (request.error.details.some((d) => d.field === "payoutDestination") ? "Add a payout destination in Store settings first." : fieldMessage(request.error, "email") ?? messageFor(request.error))}</Alert>}
        <p className="muted small">Available now: <Money minor={bal.data?.availableMinor ?? 0} />. Minimum ৳500.</p>
        <Field label="Amount (৳)">{(p) => <input {...p} className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="1000.00" />}</Field>
      </ConfirmDialog>
    </div>
  );
}

export function StoreSettings() {
  const store = useApi<Store>("/vendor/profile");
  const { toast } = useToast();
  const [f, setF] = useState({ name: "", description: "", flat: "0.00", free: "", method: "bkash", accountName: "", accountRef: "" });
  useEffect(() => {
    const s = store.data;
    if (!s) return;
    setF({ name: s.name, description: s.description ?? "", flat: (s.shipping.flatFeeMinor / 100).toFixed(2), free: s.shipping.freeOverMinor != null ? (s.shipping.freeOverMinor / 100).toFixed(2) : "", method: s.payoutDestination?.method ?? "bkash", accountName: s.payoutDestination?.accountName ?? "", accountRef: "" });
  }, [store.data]);
  const save = useAction(async () => {
    const flat = parseMoneyInput(f.flat);
    const free = f.free.trim() ? parseMoneyInput(f.free) : null;
    if (flat === null || (f.free.trim() && free === null)) throw new Error("bad money");
    const body: Record<string, unknown> = { name: f.name, description: f.description || null, shipping: { flatFeeMinor: flat, freeOverMinor: free } };
    if (f.accountRef.trim()) body.payoutDestination = { method: f.method, accountName: f.accountName, accountRef: f.accountRef.trim() };
    await api("/vendor/profile", { method: "PATCH", body });
    toast("Store settings saved");
    setF((s) => ({ ...s, accountRef: "" }));
    store.reload();
  });
  if (store.loading) return <ListSkeleton rows={3} />;
  if (store.error && !store.data) return <ErrorPanel error={store.error} onRetry={store.reload} />;
  const masked = store.data?.payoutDestination;
  return (
    <form onSubmit={(e) => { e.preventDefault(); void save.run(); }} className="stack" noValidate>
      <PageHeader title="Store settings" />
      {save.error && <Alert tone="danger">{messageFor(save.error)}</Alert>}
      <section className="card stack">
        <h2>Store</h2>
        <Field label="Store name" error={fieldMessage(save.error, "name")}>{(p) => <input {...p} className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />}</Field>
        <Field label="About">{(p) => <textarea {...p} className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={1000} />}</Field>
      </section>
      <section className="card stack">
        <h2>Shipping</h2>
        <div className="form-grid">
          <Field label="Flat shipping fee (৳)" hint="Charged once per order from your store.">{(p) => <input {...p} className="input" inputMode="decimal" value={f.flat} onChange={(e) => setF({ ...f, flat: e.target.value })} />}</Field>
          <Field label="Free shipping over (৳)" hint="Leave empty to always charge the fee.">{(p) => <input {...p} className="input" inputMode="decimal" value={f.free} onChange={(e) => setF({ ...f, free: e.target.value })} />}</Field>
        </div>
      </section>
      <section className="card stack">
        <h2>Payout destination</h2>
        {masked && <p className="muted">Current: <strong>{humanize(masked.method)}</strong> · {masked.accountName} · <span className="mono">{masked.accountRef}</span>. Enter a new account number below to replace it.</p>}
        <div className="form-grid">
          <Field label="Method">{(p) => <select {...p} className="input" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}><option value="bkash">bKash</option><option value="nagad">Nagad</option><option value="bank">Bank account</option></select>}</Field>
          <Field label="Account holder name">{(p) => <input {...p} className="input" value={f.accountName} onChange={(e) => setF({ ...f, accountName: e.target.value })} />}</Field>
          <Field label="Account / wallet number" error={fieldMessage(save.error, "payoutDestination")}>{(p) => <input {...p} className="input mono" value={f.accountRef} onChange={(e) => setF({ ...f, accountRef: e.target.value })} autoComplete="off" />}</Field>
        </div>
      </section>
      <div><Button type="submit" variant="primary" loading={save.pending}>Save settings</Button></div>
    </form>
  );
}
