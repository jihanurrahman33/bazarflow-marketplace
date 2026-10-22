"use client";
import { useEffect, useId, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import Link from "next/link";
import { ApiError, messageFor } from "@/lib/api";
import { formatMoney, humanize } from "@/lib/format";

export const cx = (...c: (string | false | undefined | null)[]) => c.filter(Boolean).join(" ");

// ---------- actions ----------
type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" | "ghost"; size?: "sm" | "md"; loading?: boolean; block?: boolean };
export function Button({ variant = "secondary", size = "md", loading, block, className, children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx("btn", `btn-${variant}`, size === "sm" && "btn-sm", block && "btn-block", className)}
    >
      {loading && <span className="spinner" aria-hidden="true" />}
      {children}
    </button>
  );
}

export function LinkButton({ href, variant = "secondary", size = "md", children, block }: { href: string; variant?: ButtonProps["variant"]; size?: "sm" | "md"; children: ReactNode; block?: boolean }) {
  return <Link href={href} className={cx("btn", `btn-${variant}`, size === "sm" && "btn-sm", block && "btn-block")}>{children}</Link>;
}

// ---------- forms ----------
interface FieldProps { label: string; error?: string; hint?: string; children: (p: { id: string; "aria-invalid"?: boolean; "aria-describedby"?: string }) => ReactNode }
export function Field({ label, error, hint, children }: FieldProps) {
  const id = useId();
  const desc = error ? `${id}-e` : hint ? `${id}-h` : undefined;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children({ id, "aria-invalid": error ? true : undefined, "aria-describedby": desc })}
      {error ? <span id={`${id}-e`} className="error" role="alert">{error}</span> : hint ? <span id={`${id}-h`} className="hint">{hint}</span> : null}
    </div>
  );
}

/** Translate stable server field codes to short human copy. */
export const FIELD_COPY: Record<string, string> = {
  TOO_SMALL: "Too short", TOO_BIG: "Too long", INVALID_FORMAT: "Invalid format", INVALID_STRING: "Invalid format", INVALID_VALUE: "Invalid value", INVALID_TYPE: "Invalid value",
  TAKEN: "Already in use", REQUIRED: "Required", INVALID_OR_EXPIRED: "Invalid or expired code", DUPLICATE_SKU: "Duplicate SKU", MUST_EXCEED_PRICE: "Must be higher than the price",
  NOT_OWNED: "This file does not belong to your store", ASSET_NOT_FOUND: "Upload not found", UNVERIFIED: "Verify your email first", BELOW_MINIMUM: "Below the minimum", EXCEEDS_AVAILABLE: "More than your available balance",
};
export const fieldMessage = (e: ApiError | undefined, field: string): string | undefined => {
  const hit = e?.details.find((d) => d.field === field || d.field.startsWith(`${field}.`));
  return hit ? FIELD_COPY[hit.code] ?? "Invalid value" : undefined;
};

// ---------- feedback ----------
export function Alert({ tone = "info", children, title }: { tone?: "info" | "success" | "warning" | "danger"; children: ReactNode; title?: string }) {
  const icon = { info: "ℹ", success: "✓", warning: "!", danger: "✕" }[tone];
  return (
    <div className={`alert alert-${tone}`} role={tone === "danger" ? "alert" : "status"}>
      <span aria-hidden="true">{icon}</span>
      <div>{title && <strong>{title}</strong>}{title ? <br /> : null}{children}</div>
    </div>
  );
}

export function ErrorPanel({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const retryable = error instanceof ApiError ? error.retryable : true;
  return (
    <div className="card stack-sm" role="alert">
      <strong>We couldn&apos;t load this.</strong>
      <span className="muted">{messageFor(error)}</span>
      {error instanceof ApiError && error.requestId && <span className="muted small">Reference: <span className="mono">{error.requestId}</span></span>}
      {onRetry && retryable && <div><Button variant="primary" size="sm" onClick={onRetry}>Try again</Button></div>}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return <div className="empty"><h3>{title}</h3>{children && <p>{children}</p>}{action}</div>;
}

export function Skeleton({ h = 16, w = "100%" }: { h?: number; w?: number | string }) {
  return <div className="skeleton" style={{ height: h, width: w }} aria-hidden="true" />;
}
export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="stack" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => <Skeleton key={i} h={56} />)}
    </div>
  );
}
export function GridSkeleton({ count = 8 }: { count?: number }) {
  return <div className="grid grid-products" aria-busy="true" aria-label="Loading">{Array.from({ length: count }, (_, i) => <Skeleton key={i} h={260} />)}</div>;
}
export const Spinner = () => <span className="spinner" role="status" aria-label="Loading" />;

// ---------- status ----------
type Tone = "success" | "warning" | "danger" | "info" | "neutral";
const STATUS: Record<string, [Tone, string]> = {
  // orders / vendor orders
  pending_payment: ["warning", "…"], awaiting_payment: ["warning", "…"], confirmed: ["info", "✓"], new: ["info", "●"], accepted: ["info", "✓"], processing: ["info", "…"],
  partially_fulfilled: ["info", "◐"], shipped: ["info", "→"], delivered: ["success", "✓"], cancelled: ["neutral", "✕"], closed: ["neutral", "✓"],
  return_requested: ["warning", "↩"], returned: ["neutral", "↩"],
  "in-transit": ["info", "→"], "pickup-pending": ["warning", "…"],
  // payments / refunds / payouts
  created: ["neutral", "…"], requires_action: ["warning", "!"], pending: ["warning", "…"], succeeded: ["success", "✓"], failed: ["danger", "✕"], unknown: ["warning", "?"],
  partially_refunded: ["info", "◐"], refunded: ["neutral", "↩"], paid: ["success", "✓"], none: ["neutral", "–"], cod_pending: ["warning", "₿"],
  requested: ["warning", "…"], approved: ["info", "✓"], rejected: ["danger", "✕"], under_review: ["warning", "…"],
  // catalogue / accounts
  draft: ["neutral", "✎"], pending_review: ["warning", "…"], published: ["success", "✓"], archived: ["neutral", "–"], active: ["success", "✓"], suspended: ["danger", "✕"],
  submitted: ["warning", "…"], more_info_required: ["warning", "!"], dead: ["danger", "✕"], done: ["success", "✓"],
};
/** Colour is never the only signal: every status carries an icon and a text label. */
export function StatusBadge({ status }: { status: string }) {
  const [tone, icon] = STATUS[status] ?? ["neutral", "•"];
  return <span className={`badge badge-${tone}`}><span aria-hidden="true">{icon}</span>{humanize(status)}</span>;
}

// ---------- data display ----------
export function Money({ minor, currency = "BDT", className }: { minor: number; currency?: string; className?: string }) {
  return <span className={cx("nowrap", className)}>{formatMoney(minor, currency)}</span>;
}

export function Stars({ value }: { value: number | null }) {
  if (value === null) return <span className="muted small">No ratings yet</span>;
  const full = Math.round(value);
  return <span className="stars" role="img" aria-label={`${value} out of 5 stars`}>{"★".repeat(full)}{"☆".repeat(5 - full)}</span>;
}

export function PageHeader({ title, children, subtitle }: { title: string; subtitle?: string; children?: ReactNode }) {
  return (
    <div className="row-between" style={{ marginBottom: "var(--space-lg)" }}>
      <div><h1 style={{ marginBottom: 0 }}>{title}</h1>{subtitle && <div className="muted">{subtitle}</div>}</div>
      {children && <div className="row">{children}</div>}
    </div>
  );
}

export function Stat({ label, value, hint, icon, tone = "primary", children }: { label: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode; tone?: "primary" | "warning" | "danger" | "info" | "success"; children?: ReactNode }) {
  return (
    <div className="stat">
      <div className="stat-head"><div className="label">{label}</div>{icon && <span className={`stat-icon tone-${tone}`} aria-hidden="true">{icon}</span>}</div>
      <div className="value">{value}</div>
      {hint && <div className="muted small">{hint}</div>}
      {children}
    </div>
  );
}

export function LoadMore({ hasMore, loading, onClick }: { hasMore: boolean; loading: boolean; onClick: () => void }) {
  if (!hasMore) return null;
  return <div className="center"><Button onClick={onClick} loading={loading}>Load more</Button></div>;
}

export interface Column<T> { key: string; header: string; render: (row: T) => ReactNode; numeric?: boolean }
export function DataTable<T extends { id: string }>({ rows, columns, caption }: { rows: T[]; columns: Column<T>[]; caption: string }) {
  return (
    <div className="table-wrap" role="region" aria-label={caption} tabIndex={0}>
      <table>
        <caption className="sr-only">{caption}</caption>
        <thead><tr>{columns.map((c) => <th key={c.key} scope="col" className={c.numeric ? "num" : undefined}>{c.header}</th>)}</tr></thead>
        <tbody>{rows.map((r) => <tr key={r.id}>{columns.map((c) => <td key={c.key} className={c.numeric ? "num" : undefined}>{c.render(r)}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

// ---------- dialog (native <dialog>: focus trap + Esc handled by the browser) ----------
export function Dialog({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} onClose={onClose} onCancel={onClose} className="dialog" aria-labelledby="dlg-title" style={{ border: 0 }}>
      <h2 id="dlg-title">{title}</h2>
      {open && children}
    </dialog>
  );
}

/** Irreversible actions always go through an explicit confirmation with a way back. */
export function ConfirmDialog({ open, title, body, confirmLabel, danger, pending, onConfirm, onClose, children }: {
  open: boolean; title: string; body?: ReactNode; confirmLabel: string; danger?: boolean; pending?: boolean; onConfirm: () => void; onClose: () => void; children?: ReactNode;
}) {
  return (
    <Dialog open={open} onClose={onClose} title={title}>
      <div className="stack">
        {body && <div className="muted">{body}</div>}
        {children}
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <Button onClick={onClose} disabled={pending}>Cancel</Button>
          <Button variant={danger ? "danger" : "primary"} loading={pending} onClick={onConfirm}>{confirmLabel}</Button>
        </div>
      </div>
    </Dialog>
  );
}
