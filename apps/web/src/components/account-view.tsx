"use client";
import { useState } from "react";
import { api, messageFor } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { useAction, useApi } from "@/lib/hooks";
import { AddressForm } from "./address-form";
import { useSession, useToast } from "./providers";
import type { Address } from "./types";
import { Alert, Button, ConfirmDialog, EmptyState, ErrorPanel, Field, fieldMessage, ListSkeleton } from "./ui";
import Link from "next/link";

interface SessionRow { id: string; device: { platform: string; name?: string }; lastUsedAt: string; current: boolean }

export function AccountView() {
  const { user, refresh } = useSession();
  const { toast } = useToast();
  const [name, setName] = useState(user?.name ?? "");
  const profile = useAction(async () => {
    await api("/me", { method: "PATCH", body: { name } });
    await refresh();
    toast("Profile updated");
  });
  const [pw, setPw] = useState({ currentPassword: "", newPassword: "" });
  const changePw = useAction(async () => {
    await api("/me/password", { method: "POST", body: pw });
    setPw({ currentPassword: "", newPassword: "" });
    toast("Password changed. Other devices were signed out.");
  });
  const sessions = useApi<SessionRow[]>("/me/sessions");
  const revoke = useAction(async (id: string) => {
    await api(`/me/sessions/${id}`, { method: "DELETE" });
    sessions.reload();
  });
  const addresses = useApi<Address[]>("/addresses");
  const [editing, setEditing] = useState<Address | "new" | null>(null);
  const [deleting, setDeleting] = useState<Address | null>(null);
  const del = useAction(async (id: string) => {
    await api(`/addresses/${id}`, { method: "DELETE" });
    setDeleting(null);
    addresses.reload();
  });

  if (!user) return null;
  return (
    <div className="stack">
      <h1>Your account</h1>
      {!user.emailVerified && <Alert tone="warning" title="Verify your email">We use it for order updates and account recovery. <Link href="/verify-email?next=/account">Verify now</Link></Alert>}
      <div className="grid grid-2">
        <section className="card stack" aria-labelledby="prof">
          <h2 id="prof">Profile</h2>
          <p className="muted">{user.email}</p>
          {profile.error && <Alert tone="danger">{messageFor(profile.error)}</Alert>}
          <form onSubmit={(e) => { e.preventDefault(); void profile.run(); }} className="stack">
            <Field label="Full name" error={fieldMessage(profile.error, "name")}>{(p) => <input {...p} className="input" value={name} onChange={(e) => setName(e.target.value)} required />}</Field>
            <div><Button type="submit" variant="primary" loading={profile.pending}>Save</Button></div>
          </form>
        </section>
        <section className="card stack" aria-labelledby="pwd">
          <h2 id="pwd">Change password</h2>
          {changePw.error && <Alert tone="danger">{messageFor(changePw.error)}</Alert>}
          <form onSubmit={(e) => { e.preventDefault(); void changePw.run(); }} className="stack">
            <Field label="Current password">{(p) => <input {...p} className="input" type="password" autoComplete="current-password" required value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} />}</Field>
            <Field label="New password" hint="At least 10 characters." error={fieldMessage(changePw.error, "newPassword")}>{(p) => <input {...p} className="input" type="password" autoComplete="new-password" minLength={10} required value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} />}</Field>
            <div><Button type="submit" loading={changePw.pending}>Update password</Button></div>
          </form>
        </section>
      </div>

      <section className="card stack" aria-labelledby="addr">
        <div className="row-between"><h2 id="addr" style={{ marginBottom: 0 }}>Addresses</h2>{!editing && <Button size="sm" onClick={() => setEditing("new")}>+ Add</Button>}</div>
        {editing && <AddressForm initial={editing === "new" ? undefined : editing} onSaved={() => { setEditing(null); addresses.reload(); }} onCancel={() => setEditing(null)} />}
        {addresses.loading ? <ListSkeleton rows={2} /> : addresses.error && !addresses.data ? <ErrorPanel error={addresses.error} onRetry={addresses.reload} />
          : (addresses.data?.length ?? 0) === 0 ? <EmptyState title="No saved addresses" />
          : addresses.data!.map((a) => (
            <div key={a.id} className="row-between card">
              <span><strong>{a.label}</strong>{a.isDefault && <span className="badge badge-info" style={{ marginLeft: 8 }}>Default</span>}<br /><span className="muted small">{a.recipient} · {a.line1}, {a.city}, {a.district} {a.postalCode}</span></span>
              <span className="row"><Button size="sm" onClick={() => setEditing(a)}>Edit</Button><Button size="sm" variant="ghost" onClick={() => setDeleting(a)}>Delete</Button></span>
            </div>
          ))}
      </section>

      <section className="card stack" aria-labelledby="sess">
        <h2 id="sess">Signed-in devices</h2>
        {sessions.loading ? <ListSkeleton rows={2} /> : sessions.error && !sessions.data ? <ErrorPanel error={sessions.error} onRetry={sessions.reload} />
          : sessions.data!.map((s) => (
            <div key={s.id} className="row-between">
              <span>{s.device.name ?? s.device.platform}{s.current && <span className="badge badge-success" style={{ marginLeft: 8 }}>This device</span>}<br /><span className="muted small">Last active {formatDate(s.lastUsedAt)}</span></span>
              {!s.current && <Button size="sm" onClick={() => void revoke.run(s.id)} loading={revoke.pending}>Sign out</Button>}
            </div>
          ))}
      </section>
      <ConfirmDialog open={!!deleting} title="Delete this address?" confirmLabel="Delete" danger pending={del.pending} onClose={() => setDeleting(null)} onConfirm={() => deleting && void del.run(deleting.id)} body="Orders you already placed keep their original delivery address." />
    </div>
  );
}
