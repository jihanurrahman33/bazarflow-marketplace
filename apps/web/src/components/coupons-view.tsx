"use client";
import { useState } from "react";
import { api, messageFor } from "@/lib/api";
import { formatDate, parseMoneyInput } from "@/lib/format";
import { useAction, useApi } from "@/lib/hooks";
import { Alert, Button, EmptyState, ErrorPanel, Field, fieldMessage, ListSkeleton, Money, PageHeader } from "./ui";

interface Coupon {
  id: string; code: string; kind: "percent" | "fixed"; value: number; label: string; minSubtotalMinor?: number; maxDiscountMinor?: number;
  startsAt?: string; expiresAt?: string; maxRedemptions?: number; perUserLimit: number; usedCount: number; active: boolean;
}

const blank = { code: "", kind: "percent" as "percent" | "fixed", value: "10", min: "", max: "", expires: "", uses: "", perUser: "1" };

/** Seller-funded discount codes. A code takes money off this seller's items only; the seller bears the discount. */
export function CouponsView() {
  const list = useApi<Coupon[]>("/vendor/coupons");
  const [f, setF] = useState(blank);
  const [open, setOpen] = useState(false);

  const create = useAction(async () => {
    const value = f.kind === "percent" ? Number(f.value) : parseMoneyInput(f.value) ?? -1;
    await api("/vendor/coupons", { method: "POST", body: {
      code: f.code, kind: f.kind, value,
      ...(f.min ? { minSubtotalMinor: parseMoneyInput(f.min) ?? -1 } : {}),
      ...(f.kind === "percent" && f.max ? { maxDiscountMinor: parseMoneyInput(f.max) ?? -1 } : {}),
      ...(f.expires ? { expiresAt: new Date(`${f.expires}T23:59:59`).toISOString() } : {}),
      ...(f.uses ? { maxRedemptions: Number(f.uses) } : {}),
      perUserLimit: Number(f.perUser) || 1,
    } });
    setF(blank);
    setOpen(false);
    list.reload();
  });
  const toggle = useAction(async (c: Coupon) => { await api(`/vendor/coupons/${c.id}`, { method: "PATCH", body: { active: !c.active } }); list.reload(); });

  return (
    <div className="stack">
      <PageHeader title="Coupons" subtitle="Discount codes for your store. The discount comes out of your sale, and only applies to your items.">
        <Button variant="primary" size="sm" onClick={() => setOpen(!open)}>{open ? "Close" : "New coupon"}</Button>
      </PageHeader>

      {open && (
        <form className="card stack" onSubmit={(e) => { e.preventDefault(); void create.run(); }} noValidate>
          {create.error && <Alert tone="danger">{messageFor(create.error)}</Alert>}
          <div className="grid grid-2">
            <Field label="Code" hint="Letters, numbers and dashes, 3 to 20 characters." error={fieldMessage(create.error, "code")}>{(p) => <input {...p} className="input mono" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} maxLength={20} placeholder="EID10" required />}</Field>
            <Field label="Type">{(p) => <select {...p} className="input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as "percent" | "fixed" })}><option value="percent">Percent off</option><option value="fixed">Fixed amount off (৳)</option></select>}</Field>
            <Field label={f.kind === "percent" ? "Percent (1 to 90)" : "Amount (৳)"} error={fieldMessage(create.error, "value")}>{(p) => <input {...p} className="input" inputMode="decimal" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} required />}</Field>
            {f.kind === "percent" && <Field label="Largest discount (৳)" hint="Optional cap.">{(p) => <input {...p} className="input" inputMode="decimal" value={f.max} onChange={(e) => setF({ ...f, max: e.target.value })} placeholder="e.g. 500" />}</Field>}
            <Field label="Minimum spend (৳)" hint="On your items. Optional.">{(p) => <input {...p} className="input" inputMode="decimal" value={f.min} onChange={(e) => setF({ ...f, min: e.target.value })} placeholder="e.g. 1000" />}</Field>
            <Field label="Last day" hint="Optional.">{(p) => <input {...p} className="input" type="date" value={f.expires} onChange={(e) => setF({ ...f, expires: e.target.value })} />}</Field>
            <Field label="Total uses" hint="Optional. Leave empty for unlimited.">{(p) => <input {...p} className="input" inputMode="numeric" value={f.uses} onChange={(e) => setF({ ...f, uses: e.target.value.replace(/\D/g, "") })} />}</Field>
            <Field label="Uses per shopper">{(p) => <input {...p} className="input" inputMode="numeric" value={f.perUser} onChange={(e) => setF({ ...f, perUser: e.target.value.replace(/\D/g, "") })} />}</Field>
          </div>
          <div className="row"><Button type="submit" variant="primary" loading={create.pending}>Create coupon</Button></div>
        </form>
      )}

      {toggle.error && <Alert tone="danger">{messageFor(toggle.error)}</Alert>}
      {list.loading ? <ListSkeleton rows={3} /> : list.error ? <ErrorPanel error={list.error} onRetry={list.reload} /> : (list.data ?? []).length === 0 ? (
        <EmptyState title="No coupons yet">Create a code to reward repeat customers or run a sale. Share it anywhere: shoppers enter it in their cart.</EmptyState>
      ) : (
        <div className="table-wrap"><table>
          <thead><tr><th>Code</th><th>Discount</th><th>Rules</th><th className="num">Used</th><th>Status</th><th /></tr></thead>
          <tbody>{(list.data ?? []).map((c) => (
            <tr key={c.id}>
              <td><strong className="mono">{c.code}</strong></td>
              <td>{c.label}{c.maxDiscountMinor ? <small className="muted"> (up to <Money minor={c.maxDiscountMinor} />)</small> : null}</td>
              <td className="small muted">
                {c.minSubtotalMinor ? <>Min <Money minor={c.minSubtotalMinor} /> · </> : null}{c.perUserLimit}× per shopper{c.expiresAt ? ` · until ${formatDate(c.expiresAt, { dateStyle: "medium" })}` : ""}
              </td>
              <td className="num">{c.usedCount}{c.maxRedemptions ? ` / ${c.maxRedemptions}` : ""}</td>
              <td><span className={`badge badge-${c.active ? "success" : "neutral"}`}>{c.active ? "Active" : "Paused"}</span></td>
              <td><Button size="sm" variant="ghost" onClick={() => void toggle.run(c)} disabled={toggle.pending}>{c.active ? "Pause" : "Resume"}</Button></td>
            </tr>))}</tbody>
        </table></div>
      )}
    </div>
  );
}
