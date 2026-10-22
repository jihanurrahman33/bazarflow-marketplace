"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { api, messageFor } from "@/lib/api";
import { useAction, usePaged } from "@/lib/hooks";
import { RequireAuth } from "./guard";
import type { SessionUser } from "./providers";
import { useToast } from "./providers";
import { IconExternal } from "./icons";
import { Alert, Button, ConfirmDialog, DataTable, EmptyState, ErrorPanel, Field, ListSkeleton, LoadMore, type Column } from "./ui";

export interface NavItem { href: string; label: string; exact?: boolean; icon?: ReactNode; group?: string }

/** Sidebar console: grouped navigation with icons, the signed-in person, and a way back to the storefront. */
export function ConsoleShell({ role, permission, nav, title, children }: { role: SessionUser["role"]; permission?: string; nav: NavItem[]; title: string; children: ReactNode }) {
  const path = usePathname();
  const groups = nav.reduce<{ name: string; items: NavItem[] }[]>((acc, n) => {
    const name = n.group ?? "";
    const g = acc.find((x) => x.name === name);
    if (g) g.items.push(n);
    else acc.push({ name, items: [n] });
    return acc;
  }, []);
  const active = (n: NavItem) => (n.exact ? path === n.href : path === n.href || path.startsWith(n.href + "/"));
  return (
    <RequireAuth role={role} permission={permission}>
      {(user) => (
        <div className="console">
          <aside className="console-side">
            <div className="console-id">
              <span className="avatar" aria-hidden="true">{user.name.slice(0, 1).toUpperCase()}</span>
              <span><strong>{user.name}</strong><small>{title}</small></span>
            </div>
            <nav className="console-nav" aria-label={`${role} console`}>
              {groups.map((g) => (
                <div key={g.name} className="nav-group">
                  {g.name && <span className="nav-group-name">{g.name}</span>}
                  {g.items.map((n) => (
                    <Link key={n.href} href={n.href} aria-current={active(n) ? "page" : undefined}>{n.icon}<span>{n.label}</span></Link>
                  ))}
                </div>
              ))}
            </nav>
            <Link href="/" className="console-back"><IconExternal width={16} height={16} />View storefront</Link>
          </aside>
          <div className="console-main">{children}</div>
        </div>
      )}
    </RequireAuth>
  );
}

/** Status pills ("All · New · Shipped…") that replace a dropdown when there are only a handful of states. */
export function StatusTabs({ value, onChange, options, label }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; label: string }) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {options.map((o) => <button key={o.value} type="button" role="tab" aria-selected={value === o.value} className="tab" onClick={() => onChange(o.value)}>{o.label}</button>)}
    </div>
  );
}

export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="search-box">
      <label className="sr-only" htmlFor="console-search">{placeholder}</label>
      <input id="console-search" type="search" className="input" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

/** Paged, filterable table with the full loading / empty / error / retry contract. */
export function ListTable<T extends { id: string }>({ path, columns, caption, empty, actions, searchText }: {
  path: string; columns: Column<T>[]; caption: string; empty: string; actions?: (row: T, reload: () => void) => ReactNode;
  /** When given, shows a search box that filters the rows already loaded (not a server search). */
  searchText?: (row: T) => string;
}) {
  const list = usePaged<T>(path);
  const [q, setQ] = useState("");
  if (list.loading) return <ListSkeleton rows={5} />;
  if (list.error && list.items.length === 0) return <ErrorPanel error={list.error} onRetry={list.reload} />;
  if (list.items.length === 0) return <EmptyState title={empty} />;
  const cols = actions ? [...columns, { key: "_actions", header: "", render: (r: T) => <div className="row">{actions(r, list.reload)}</div> }] : columns;
  const rows = searchText && q.trim() ? list.items.filter((r) => searchText(r).toLowerCase().includes(q.trim().toLowerCase())) : list.items;
  return (
    <div className="stack">
      {searchText && <SearchBox value={q} onChange={setQ} placeholder="Search these results" />}
      {list.error && <Alert tone="danger">{messageFor(list.error)}</Alert>}
      {rows.length === 0 ? <EmptyState title="No matches">Nothing in the loaded results matches “{q}”.</EmptyState> : <DataTable rows={rows} columns={cols} caption={caption} />}
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
