"use client";
import { useState } from "react";
import { api, messageFor } from "@/lib/api";
import { useAction } from "@/lib/hooks";
import { canonicalDistrict, DIVISIONS } from "@/lib/bd-geo";
import type { Address } from "./types";
import { Alert, Button, Field, fieldMessage } from "./ui";

const EMPTY = { label: "Home", recipient: "", phone: "", line1: "", line2: "", city: "", district: "", postalCode: "" };

export function AddressForm({ onSaved, onCancel, initial }: { onSaved: (a: Address) => void; onCancel?: () => void; initial?: Partial<Address> }) {
  const [f, setF] = useState({ ...EMPTY, ...initial });
  const save = useAction(async () => {
    const body = { label: f.label, recipient: f.recipient, phone: f.phone, line1: f.line1, ...(f.line2 ? { line2: f.line2 } : {}), city: f.city, district: f.district, postalCode: f.postalCode };
    const r = initial?.id ? await api<Address>(`/addresses/${initial.id}`, { method: "PATCH", body }) : await api<Address>("/addresses", { method: "POST", body });
    onSaved(r.data);
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  const err = (k: string) => fieldMessage(save.error, k);
  return (
    <form onSubmit={(e) => { e.preventDefault(); void save.run(); }} className="stack" noValidate>
      {save.error && !save.error.details.length && <Alert tone="danger">{messageFor(save.error)}</Alert>}
      <div className="form-grid">
        <Field label="Label" error={err("label")}>{(p) => <input {...p} className="input" value={f.label} onChange={set("label")} maxLength={40} required />}</Field>
        <Field label="Recipient name" error={err("recipient")}>{(p) => <input {...p} className="input" autoComplete="name" value={f.recipient} onChange={set("recipient")} required />}</Field>
        <Field label="Mobile number" error={err("phone")}>{(p) => <input {...p} className="input" type="tel" inputMode="tel" autoComplete="tel" placeholder="+8801…" value={f.phone} onChange={set("phone")} required />}</Field>
      </div>
      <Field label="Address line 1" error={err("line1")}>{(p) => <input {...p} className="input" autoComplete="address-line1" value={f.line1} onChange={set("line1")} required />}</Field>
      <Field label="Address line 2 (optional)">{(p) => <input {...p} className="input" autoComplete="address-line2" value={f.line2 ?? ""} onChange={set("line2")} />}</Field>
      <div className="form-grid">
        <Field label="City" error={err("city")}>{(p) => <input {...p} className="input" autoComplete="address-level2" value={f.city} onChange={set("city")} required />}</Field>
        <Field label="District" error={err("district")}>{(p) => (
          <select {...p} className="input" autoComplete="address-level1" value={canonicalDistrict(f.district) ?? f.district} onChange={set("district")} required>
            <option value="">Select a district…</option>
            {Object.entries(DIVISIONS).map(([division, list]) => <optgroup key={division} label={`${division} division`}>{list.map((d) => <option key={d} value={d}>{d}</option>)}</optgroup>)}
          </select>
        )}</Field>
        <Field label="Postal code" hint="4 digits" error={err("postalCode")}>{(p) => <input {...p} className="input" inputMode="numeric" autoComplete="postal-code" maxLength={4} value={f.postalCode} onChange={set("postalCode")} required />}</Field>
      </div>
      <div className="row"><Button type="submit" variant="primary" loading={save.pending}>Save address</Button>{onCancel && <Button onClick={onCancel}>Cancel</Button>}</div>
    </form>
  );
}
