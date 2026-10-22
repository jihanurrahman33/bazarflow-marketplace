"use client";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { api, messageFor } from "@/lib/api";
import { formatMoneyShort } from "@/lib/format";
import { parseMoneyInput } from "@/lib/format";
import { useAction, useApi } from "@/lib/hooks";
import { BarChart, RankBars } from "./charts";
import { Alert, Button, EmptyState, ErrorPanel, ListSkeleton, Money, PageHeader, Stat } from "./ui";

// ---------- analytics ----------
interface Analytics {
  days: number;
  summary: { orders: number; units: number; grossMinor: number; netMinor: number; returnedOrders: number; lowStockItems: number };
  perDay: { day: string; orders: number; grossMinor: number; netMinor: number }[];
  topProducts: { title: string; slug?: string; units: number; revenueMinor: number }[];
  mostViewed: { title: string; slug?: string; views: number; addedToCart: number; unitsSold: number }[];
  rating: { count: number; average: number | null; positivePercent: number | null };
}

const dhakaDay = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka" }).format(d);

export function VendorAnalytics() {
  const [days, setDays] = useState(30);
  const a = useApi<Analytics>(`/vendor/analytics?days=${days}`);
  const series = useMemo(() => {
    const byDay = new Map((a.data?.perDay ?? []).map((d) => [d.day, d.netMinor]));
    const n = Math.min(days, 30);
    return Array.from({ length: n }, (_, i) => {
      const d = new Date(Date.now() - (n - 1 - i) * 86_400_000);
      return { label: d.toLocaleDateString("en-BD", { day: "numeric", month: "short", timeZone: "Asia/Dhaka" }), value: byDay.get(dhakaDay(d)) ?? 0 };
    });
  }, [a.data, days]);
  const s = a.data?.summary;

  return (
    <div className="stack">
      <PageHeader title="Analytics" subtitle="How your store is doing. Earnings are after the platform commission.">
        <select aria-label="Period" className="input input-sm" value={days} onChange={(e) => setDays(Number(e.target.value))}>{[7, 30, 90].map((d) => <option key={d} value={d}>Last {d} days</option>)}</select>
      </PageHeader>
      {a.loading ? <ListSkeleton rows={4} /> : a.error ? <ErrorPanel error={a.error} onRetry={a.reload} /> : a.data && s && (
        <>
          <div className="grid grid-stats">
            <Stat label="Earnings" value={<Money minor={s.netMinor} />} hint={`${s.orders} order${s.orders === 1 ? "" : "s"} · ${s.units} item${s.units === 1 ? "" : "s"}`} tone="success" />
            <Stat label="Average order" value={s.orders ? <Money minor={Math.round(s.grossMinor / s.orders)} /> : "—"} hint="what customers paid" />
            <Stat label="Rating" value={a.data.rating.average !== null ? `★ ${a.data.rating.average.toFixed(1)}` : "—"} hint={a.data.rating.count ? `${a.data.rating.count} reviews · ${a.data.rating.positivePercent}% positive` : "No reviews yet"} />
            <Stat label="Returned" value={s.orders ? `${Math.round((s.returnedOrders / s.orders) * 100)}%` : "—"} hint={`${s.returnedOrders} of ${s.orders} orders`} tone={s.returnedOrders > 0 ? "warning" : "primary"} />
          </div>
          {s.lowStockItems > 0 && <Alert tone="warning">{s.lowStockItems} item{s.lowStockItems === 1 ? " is" : "s are"} low or out of stock. <Link href="/vendor/inventory">Restock</Link></Alert>}

          <section className="card stack" aria-labelledby="earn-h"><h2 id="earn-h">Earnings by day</h2><BarChart data={series} format={formatMoneyShort} label="Earnings per day" /></section>

          <div className="grid grid-2">
            <section className="card stack" aria-labelledby="top-h">
              <h2 id="top-h">Best sellers</h2>
              {a.data.topProducts.length === 0 ? <p className="muted">No sales in this period yet.</p> : <RankBars format={formatMoneyShort} rows={a.data.topProducts.map((p) => ({ label: p.title, value: p.revenueMinor, hint: `${p.units} sold` }))} />}
            </section>
            <section className="card stack" aria-labelledby="views-h">
              <h2 id="views-h">Most viewed</h2>
              {a.data.mostViewed.length === 0 ? <p className="muted">No views recorded yet.</p> : (
                <div className="table-wrap"><table>
                  <thead><tr><th>Product</th><th className="num">Views</th><th className="num">In carts</th><th className="num">Sold</th></tr></thead>
                  <tbody>{a.data.mostViewed.map((p) => <tr key={p.title}><td>{p.slug ? <Link href={`/products/${p.slug}`}>{p.title}</Link> : p.title}</td><td className="num">{p.views}</td><td className="num">{p.addedToCart}</td><td className="num">{p.unitsSold}</td></tr>)}</tbody>
                </table></div>
              )}
              <p className="muted small">Views and carts count only shoppers whose browsers allow tracking, so real numbers are a little higher. Lots of views with few sales usually means price, photos or description need work.</p>
            </section>
          </div>
        </>
      )}
    </div>
  );
}

// ---------- bulk update ----------
interface CatalogRow { sku: string; product: string; variant: string; status: string; priceMinor: number; stock: number }
interface Row { sku: string; priceMinor?: number; stock?: number }
interface Result { sku: string; status: "updated" | "unchanged" | "error"; message?: string; price?: [number, number]; stock?: [number, number] }

/** Minimal CSV reader: quoted fields, commas inside quotes, doubled quotes, CRLF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(field); field = ""; if (row.some((x) => x.trim() !== "")) rows.push(row); row = []; }
    else field += ch;
  }
  row.push(field);
  if (row.some((x) => x.trim() !== "")) rows.push(row);
  return rows;
}

export const csvEscape = (v: string | number) => { const s = String(v); return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s; };

/** Reads sku / price / stock columns by header name. Price is in taka; blank cells leave that field alone. */
export function rowsFromCsv(text: string): { rows: Row[]; problems: string[] } {
  const table = parseCsv(text.replace(/^\uFEFF/, ""));
  const head = (table[0] ?? []).map((h) => h.trim().toLowerCase());
  const col = (names: string[]) => head.findIndex((h) => names.includes(h));
  const iSku = col(["sku"]), iPrice = col(["price", "price (৳)", "price_bdt"]), iStock = col(["stock", "quantity", "qty", "on hand"]);
  const problems: string[] = [];
  if (iSku < 0) return { rows: [], problems: ["The first row needs a column named sku."] };
  if (iPrice < 0 && iStock < 0) return { rows: [], problems: ["Add a price column, a stock column, or both."] };
  const rows: Row[] = [];
  table.slice(1).forEach((cells, n) => {
    const sku = (cells[iSku] ?? "").trim();
    if (!sku) return;
    const row: Row = { sku };
    const price = iPrice >= 0 ? (cells[iPrice] ?? "").trim() : "";
    const stock = iStock >= 0 ? (cells[iStock] ?? "").trim() : "";
    if (price) { const minor = parseMoneyInput(price); if (minor === null || minor < 1) { problems.push(`Row ${n + 2} (${sku}): price "${price}" is not a valid amount.`); return; } row.priceMinor = minor; }
    if (stock) { if (!/^\d{1,7}$/.test(stock)) { problems.push(`Row ${n + 2} (${sku}): stock "${stock}" must be a whole number.`); return; } row.stock = Number(stock); }
    if (row.priceMinor === undefined && row.stock === undefined) return;
    rows.push(row);
  });
  return { rows, problems };
}

export function BulkUpdate() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  const [preview, setPreview] = useState<Result[] | null>(null);
  const [done, setDone] = useState<{ updated: number; errors: number } | null>(null);

  const download = useAction(async () => {
    const data = (await api<CatalogRow[]>("/vendor/catalog-export")).data;
    const csv = ["sku,product,variant,status,price,stock", ...data.map((r) => [r.sku, r.product, r.variant, r.status, (r.priceMinor / 100).toFixed(2), r.stock].map(csvEscape).join(","))].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = "my-products.csv"; a.click();
    URL.revokeObjectURL(url);
  });
  const check = useAction(async (list: Row[]) => {
    const r = await api<Result[]>("/vendor/products/bulk-update", { method: "POST", body: { dryRun: true, rows: list } });
    setPreview(r.data);
  });
  const apply = useAction(async () => {
    const r = await api<Result[]>("/vendor/products/bulk-update", { method: "POST", body: { dryRun: false, rows } });
    setPreview(r.data);
    setDone({ updated: Number((r.meta as { updated?: number }).updated ?? 0), errors: Number((r.meta as { errors?: number }).errors ?? 0) });
  });

  const onFile = async (file: File) => {
    setDone(null); setPreview(null);
    if (file.size > 200 * 1024) { setRows([]); setProblems(["That file is too large. Keep it under 200 KB (about 500 rows)."]); return; }
    const parsed = rowsFromCsv(await file.text());
    setProblems(parsed.problems);
    if (parsed.rows.length > 500) { setRows([]); setProblems(["A single upload can have at most 500 rows."]); return; }
    setRows(parsed.rows);
    if (parsed.rows.length) void check.run(parsed.rows);
  };
  const changes = (preview ?? []).filter((r) => r.status === "updated").length;
  const errors = (preview ?? []).filter((r) => r.status === "error");

  return (
    <div className="stack">
      <PageHeader title="Bulk update" subtitle="Change prices and stock for many items at once with a spreadsheet." />
      <section className="card stack">
        <h2>1. Get your list</h2>
        <p className="muted">Download your products as a spreadsheet, change the <strong>price</strong> (in ৳) and <strong>stock</strong> columns, and save it as CSV. Leave a cell empty to keep it as it is.</p>
        {download.error && <Alert tone="danger">{messageFor(download.error)}</Alert>}
        <div><Button onClick={() => void download.run()} loading={download.pending}>Download my-products.csv</Button></div>
      </section>
      <section className="card stack">
        <h2>2. Upload it</h2>
        <input ref={fileRef} type="file" accept=".csv,text/csv" aria-label="CSV file" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void onFile(f); }} />
        {problems.length > 0 && <Alert tone="danger" title="Fix these first">{problems.slice(0, 8).map((p) => <div key={p}>{p}</div>)}{problems.length > 8 && <div>…and {problems.length - 8} more.</div>}</Alert>}
        {check.pending && <ListSkeleton rows={2} />}
        {check.error && <Alert tone="danger">{messageFor(check.error)}</Alert>}
      </section>
      {preview && (
        <section className="card stack" aria-live="polite">
          <h2>{done ? "Done" : "3. Review the changes"}</h2>
          {done ? <Alert tone={done.errors ? "warning" : "success"}>{done.updated} item{done.updated === 1 ? "" : "s"} updated{done.errors ? `, ${done.errors} skipped (see below)` : ""}.</Alert> : <p className="muted">{changes} item{changes === 1 ? "" : "s"} will change{errors.length ? `, ${errors.length} will be skipped` : ""}. Nothing has been changed yet.</p>}
          {preview.length === 0 ? <EmptyState title="Nothing to change" /> : (
            <div className="table-wrap"><table>
              <thead><tr><th>SKU</th><th>Price</th><th>Stock</th><th>Result</th></tr></thead>
              <tbody>{preview.map((r, i) => (
                <tr key={`${r.sku}-${i}`}>
                  <td className="mono">{r.sku}</td>
                  <td>{r.price ? <><Money minor={r.price[0]} /> → <strong><Money minor={r.price[1]} /></strong></> : "—"}</td>
                  <td>{r.stock ? <>{r.stock[0]} → <strong>{r.stock[1]}</strong></> : "—"}</td>
                  <td>{r.status === "error" ? <span className="badge badge-danger">{r.message}</span> : r.status === "updated" ? <span className="badge badge-success">{done ? "Updated" : "Will update"}</span> : <span className="badge badge-neutral">No change</span>}</td>
                </tr>))}</tbody>
            </table></div>
          )}
          {!done && <div className="row"><Button variant="primary" onClick={() => void apply.run()} loading={apply.pending} disabled={changes === 0}>Apply {changes} change{changes === 1 ? "" : "s"}</Button><Button variant="ghost" onClick={() => { setPreview(null); setRows([]); }}>Cancel</Button></div>}
          {apply.error && <Alert tone="danger">{messageFor(apply.error)}</Alert>}
        </section>
      )}
    </div>
  );
}
