"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { api, messageFor } from "@/lib/api";
import { useAction, usePaged } from "@/lib/hooks";
import { RequireAuth } from "./guard";
import type { SessionUser } from "./providers";
import { useToast } from "./providers";
import { Alert, Button, ConfirmDialog, DataTable, EmptyState, ErrorPanel, Field, ListSkeleton, LoadMore, type Column } from "./ui";

export interface NavItem { href: string; label: string; exact?: boolean }

export function ConsoleShell({ role, permission, nav, children }: { role: SessionUser["role"]; permission?: string; nav: NavItem[]; children: ReactNode }) {
  const path = usePathname();
  return (
    <RequireAuth role={role} permission={permission}>
      {() => (
        <div className="console">
          <nav className="console-nav" aria-label={`${role} console`}>
            {nav.map((n) => <Link key={n.href} href={n.href} aria-current={(n.exact ? path === n.href : path === n.href || path.startsWith(n.href + "/")) ? "page" : undefined}>{n.label}</Link>)}
          </nav>
          <div className="console-main">{children}</div>
        </div>
      )}
    </RequireAuth>
  );
}

/** Paged, filterable table with the full loading / empty / error / retry contract. */
export function ListTable<T extends { id: string }>({ path, columns, caption, empty, actions }: {
  path: string; columns: Column<T>[]; caption: string; empty: string; actions?: (row: T, reload: () => void) => ReactNode;
}) {
  const list = usePaged<T>(path);
  if (list.loading) return <ListSkeleton rows={5} />;
  if (list.error && list.items.length === 0) return <ErrorPanel error={list.error} onRetry={list.reload} />;
  if (list.items.length === 0) return <EmptyState title={empty} />;
  const cols = actions ? [...columns, { key: "_actions", header: "", render: (r: T) => <div className="row">{actions(r, list.reload)}</div> }] : columns;
  return (
    <div className="stack">
      {list.error && <Alert tone="danger">{messageFor(list.error)}</Alert>}
      <DataTable rows={list.items} columns={cols} caption={caption} />
      <LoadMore hasMore={list.hasMore} loading={list.loadingMore} onClick={list.loadMore} />
    </div>
  );
}

export function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div className="field" style={{ minWidth: 180 }}>
      <label htmlFor={`f-${label}`}>{label}</label>
      <select id={`f-${label}`} className="input" value={value} onChange={(e) => onChange(e.target.value)}>{options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
    </div>
  );
}

/** One-click mutation with pending + error feedback. */
export function ActionButton({ label, path, method = "POST", body = {}, onDone, variant = "secondary", size = "sm", success }: {
  label: string; path: string; method?: "POST" | "PATCH" | "DELETE"; body?: unknown; onDone?: () => void; variant?: "primary" | "secondary" | "danger" | "ghost"; size?: "sm" | "md"; success?: string;
}) {
  const { toast } = useToast();
  const act = useAction(async () => {
    await api(path, { method, body: method === "DELETE" ? undefined : body });
    if (success) toast(success);
    onDone?.();
  });
  return (
    <>
      <Button variant={variant} size={size} loading={act.pending} onClick={() => void act.run()}>{label}</Button>
      {act.error && <span className="small" role="alert" style={{ color: "var(--color-danger)" }}>{messageFor(act.error)}</span>}
    </>
  );
}

/** Action that must carry a human-written reason (recorded in the audit log). */
export function ReasonButton({ label, title, path, method = "POST", extra, field = "reason", fieldLabel = "Reason", single, onDone, danger, confirmLabel, success, hint, minLength = 3 }: {
  label: string; fieldLabel?: string; /** Render a single-line input instead of a textarea. */ single?: boolean; title: string; path: string; method?: "POST" | "PATCH"; extra?: Record<string, unknown>; field?: string; onDone?: () => void; danger?: boolean; confirmLabel?: string; success?: string; hint?: string; minLength?: number;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const { toast } = useToast();
  const act = useAction(async () => {
    await api(path, { method, body: { ...extra, [field]: reason } });
    setOpen(false);
    setReason("");
    if (success) toast(success);
    onDone?.();
  });
  return (
    <>
      <Button size="sm" variant={danger ? "danger" : "secondary"} onClick={() => setOpen(true)}>{label}</Button>
      <ConfirmDialog open={open} title={title} confirmLabel={confirmLabel ?? label} danger={danger} pending={act.pending} onClose={() => setOpen(false)} onConfirm={() => void act.run()}>
        {act.error && <Alert tone="danger">{messageFor(act.error)}</Alert>}
        <Field label={fieldLabel} hint={hint ?? "Recorded in the audit log."}>{(p) => (single
          ? <input {...p} className="input mono" value={reason} minLength={minLength} maxLength={80} onChange={(e) => setReason(e.target.value)} />
          : <textarea {...p} className="input" value={reason} minLength={minLength} maxLength={500} onChange={(e) => setReason(e.target.value)} />)}</Field>
      </ConfirmDialog>
    </>
  );
}
