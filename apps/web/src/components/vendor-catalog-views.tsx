"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { api, messageFor } from "@/lib/api";
import { formatDate, parseMoneyInput } from "@/lib/format";
import { presetByName } from "@/lib/option-presets";
import { useAction, useApi } from "@/lib/hooks";
import { ListTable, StatusTabs } from "./console-kit";
import { OptionBuilder, Swatch, type OptionDraft } from "./option-builder";
import { SmartImage } from "./smart-image";
import { useToast } from "./providers";
import { Alert, Button, ConfirmDialog, ErrorPanel, Field, fieldMessage, LinkButton, ListSkeleton, Money, PageHeader, StatusBadge, type Column } from "./ui";

interface CategoryNode { id: string; name: string; slug: string; children: { id: string; name: string }[] }
interface PVariant { variantId: string; sku: string; optionValues: Record<string, string>; priceMinor: number; compareAtMinor?: number; active: boolean; stock?: { onHand: number; reserved: number; inventoryItemId: string } }
interface VProduct {
  id: string; slug: string; title: string; description: string; status: string; categoryIds: string[]; options: { name: string; values: string[] }[]; currency: string;
  variants: PVariant[]; media: { publicId: string; url: string }[]; minPriceMinor: number; moderation?: { reason?: string }; updatedAt: string;
}

function useCategoryOptions() {
  const cats = useApi<CategoryNode[]>("/categories");
  const flat = useMemo(() => (cats.data ?? []).flatMap((c) => [{ id: c.id, label: c.name }, ...c.children.map((x) => ({ id: x.id, label: `${c.name} › ${x.name}` }))]), [cats.data]);
  return { flat, loading: cats.loading, error: cats.error, reload: cats.reload };
}

// ---------- list ----------
export function ProductList() {
  const [status, setStatus] = useState("");
  const stockOf = (p: VProduct) => p.variants.reduce((a, x) => a + Math.max(0, (x.stock?.onHand ?? 0) - (x.stock?.reserved ?? 0)), 0);
  const cols: Column<VProduct>[] = [
    { key: "t", header: "Product", render: (p) => (
      <Link href={`/vendor/products/${p.id}`} className="prod-cell">
        <span className="prod-thumb">{p.media[0] ? <SmartImage src={p.media[0].url} alt="" width={96} height={96} /> : <span className="prod-thumb-empty" aria-hidden="true" />}</span>
        <span><strong>{p.title}</strong><small className="muted">{p.variants.length} variant{p.variants.length === 1 ? "" : "s"}</small></span>
      </Link>
    ) },
    { key: "s", header: "Status", render: (p) => <><StatusBadge status={p.status} />{p.status === "rejected" && p.moderation?.reason && <small className="muted" style={{ display: "block" }}>{p.moderation.reason}</small>}</> },
    { key: "k", header: "In stock", numeric: true, render: (p) => { const n = stockOf(p); return <span className={n === 0 ? "badge badge-danger" : n <= 5 ? "badge badge-warning" : undefined}>{n}</span>; } },
    { key: "p", header: "From", numeric: true, render: (p) => <Money minor={p.minPriceMinor} currency={p.currency} /> },
    { key: "u", header: "Updated", render: (p) => formatDate(p.updatedAt, { dateStyle: "medium" }) },
  ];
  return (
    <div className="stack">
      <PageHeader title="Products"><LinkButton href="/vendor/products/new" variant="primary">New product</LinkButton></PageHeader>
      <StatusTabs label="Product status" value={status} onChange={setStatus} options={[{ value: "", label: "All" }, ...["draft", "pending_review", "published", "rejected", "archived"].map((s) => ({ value: s, label: s.replace("_", " ") }))]} />
      <ListTable<VProduct> key={status} path={`/vendor/products?limit=20${status ? `&status=${status}` : ""}`} columns={cols} caption="Products" empty="No products yet" searchText={(p) => p.title} />
    </div>
  );
}

// ---------- create ----------
const combos = (options: { name: string; values: string[] }[]): Record<string, string>[] =>
  options.reduce<Record<string, string>[]>((acc, o) => acc.flatMap((a) => o.values.map((v) => ({ ...a, [o.name]: v }))), [{}]);

interface Row { sku: string; price: string; was: string; stock: string }
const EMPTY_ROW: Row = { sku: "", price: "", was: "", stock: "0" };
const MAX_VARIANTS = 100;
const compact = (s: string, n: number) => s.replace(/[^A-Za-z0-9]/g, "").slice(0, n).toUpperCase();

export function NewProduct() {
  const router = useRouter();
  const cats = useCategoryOptions();
  const [f, setF] = useState({ title: "", description: "", categoryId: "" });
  const [optDraft, setOptDraft] = useState<OptionDraft[]>([]);
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [bulk, setBulk] = useState({ price: "", was: "", stock: "" });
  const skuSeed = useRef(Math.random().toString(36).slice(2, 5).toUpperCase());
  const options = optDraft.map((o) => ({ name: o.name.trim(), values: [...new Set(o.values)] })).filter((o) => o.name && o.values.length);
  const combinations = useMemo(() => combos(options), [JSON.stringify(options)]); // eslint-disable-line react-hooks/exhaustive-deps
  const tooMany = combinations.length > MAX_VARIANTS;
  const keyOf = (c: Record<string, string>) => JSON.stringify(c);
  const row = (c: Record<string, string>): Row => rows[keyOf(c)] ?? EMPTY_ROW;
  const setRow = (c: Record<string, string>, patch: Partial<Row>) => setRows((r) => ({ ...r, [keyOf(c)]: { ...row(c), ...patch } }));
  // SKUs left blank are generated from the title and the chosen values, unique within this product.
  const autoSku = (c: Record<string, string>) => [compact(f.title, 5) || "ITEM", skuSeed.current, ...Object.values(c).map((v) => compact(v, 4))].filter(Boolean).join("-").slice(0, 40);
  const applyAll = () => setRows((r) => {
    const next: Record<string, Row> = { ...r };
    for (const c of combinations) next[keyOf(c)] = { ...(r[keyOf(c)] ?? EMPTY_ROW), ...(bulk.price ? { price: bulk.price } : {}), ...(bulk.was ? { was: bulk.was } : {}), ...(bulk.stock ? { stock: bulk.stock } : {}) };
    return next;
  });

  const create = useAction(async () => {
    const used = new Set<string>();
    const variants = combinations.map((c, i) => {
      const r = row(c);
      let sku = r.sku.trim() || autoSku(c);
      while (used.has(sku)) sku = `${sku.slice(0, 36)}-${i}`;
      used.add(sku);
      const was = parseMoneyInput(r.was);
      return { sku, optionValues: c, priceMinor: parseMoneyInput(r.price) ?? -1, ...(was ? { compareAtMinor: was } : {}), initialStock: Number(r.stock) };
    });
    const r = await api<VProduct>("/vendor/products", { method: "POST", body: { title: f.title, description: f.description, categoryIds: [f.categoryId], options, variants } });
    router.push(`/vendor/products/${r.data.id}`);
  });

  return (
    <form onSubmit={(e) => { e.preventDefault(); if (!tooMany) void create.run(); }} className="stack" noValidate>
      <PageHeader title="New product" />
      {create.error && <Alert tone="danger" title="Please fix the highlighted fields">{messageFor(create.error)}</Alert>}
      <section className="card stack">
        <Field label="Title" error={fieldMessage(create.error, "title")}>{(p) => <input {...p} className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} maxLength={150} required />}</Field>
        <Field label="Description" error={fieldMessage(create.error, "description")}>{(p) => <textarea {...p} className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={5000} required />}</Field>
        <Field label="Category" error={fieldMessage(create.error, "categoryIds")}>
          {(p) => <select {...p} className="input" value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })} required><option value="">Select…</option>{cats.flat.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select>}
        </Field>
      </section>
      <section className="card stack">
        <h2 style={{ marginBottom: 0 }}>Options</h2>
        <OptionBuilder value={optDraft} onChange={setOptDraft} />
      </section>
      <section className="card stack">
        <div className="row-between"><h2 style={{ marginBottom: 0 }}>Variants, prices and stock</h2><span className={tooMany ? "text-danger small" : "muted small"}>{combinations.length} variant{combinations.length === 1 ? "" : "s"}{tooMany ? ` · ${MAX_VARIANTS} is the most one product can have: remove some values` : ""}</span></div>
        {fieldMessage(create.error, "variants") && <Alert tone="danger">Check SKUs (must be unique), prices and option values: {fieldMessage(create.error, "variants")}</Alert>}
        {combinations.length > 1 && (
          <div className="bulk-bar">
            <span className="small muted">Fill every variant:</span>
            <input aria-label="Price for all" className="input input-sm" inputMode="decimal" placeholder="Price ৳" value={bulk.price} onChange={(e) => setBulk({ ...bulk, price: e.target.value })} />
            <input aria-label="Was price for all" className="input input-sm" inputMode="decimal" placeholder="Was ৳ (optional)" value={bulk.was} onChange={(e) => setBulk({ ...bulk, was: e.target.value })} />
            <input aria-label="Stock for all" className="input input-sm" inputMode="numeric" placeholder="Stock" value={bulk.stock} onChange={(e) => setBulk({ ...bulk, stock: e.target.value.replace(/\D/g, "") })} />
            <Button size="sm" onClick={applyAll}>Apply to all</Button>
          </div>
        )}
        <div className="table-wrap"><table>
          <thead><tr><th>Variant</th><th>SKU</th><th className="num">Price (৳)</th><th className="num">Was (৳)</th><th className="num">Stock</th></tr></thead>
          <tbody>{combinations.map((c) => (
            <tr key={keyOf(c)}>
              <td><span className="variant-cell">{Object.entries(c).map(([k, v]) => <span key={k} className="variant-part"><Swatch option={k} value={v} />{v}</span>)}{Object.keys(c).length === 0 && "Default"}</span></td>
              <td><input aria-label="SKU" className="input mono" value={row(c).sku} onChange={(e) => setRow(c, { sku: e.target.value })} placeholder={autoSku(c)} /></td>
              <td><input aria-label="Price" className="input" inputMode="decimal" value={row(c).price} onChange={(e) => setRow(c, { price: e.target.value })} placeholder="1200.00" /></td>
              <td><input aria-label="Was price" className="input" inputMode="decimal" value={row(c).was} onChange={(e) => setRow(c, { was: e.target.value })} placeholder="optional" /></td>
              <td><input aria-label="Stock" className="input" inputMode="numeric" value={row(c).stock} onChange={(e) => setRow(c, { stock: e.target.value.replace(/\D/g, "") })} /></td>
            </tr>))}</tbody>
        </table></div>
        <p className="muted small">Leave SKU blank and we generate one. "Was" is the old price: when it is higher than the price, shoppers see the discount.</p>
      </section>
      <div className="row"><Button type="submit" variant="primary" loading={create.pending} disabled={tooMany}>Create draft</Button><span className="muted small">You can add photos and submit for review next.</span></div>
    </form>
  );
}

// ---------- edit ----------
interface UploadAuth { cloudName: string; apiKey: string; timestamp: number; folder: string; allowedFormats: string; signature: string; uploadUrl: string }

export function ProductEditor({ id }: { id: string }) {
  const product = useApi<VProduct>(`/vendor/products/${id}`);
  const cats = useCategoryOptions();
  const { toast } = useToast();
  const [draft, setDraft] = useState<{ title: string; description: string; categoryId: string } | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const p = product.data;
  const d = draft ?? (p ? { title: p.title, description: p.description, categoryId: p.categoryIds[0] ?? "" } : null);

  const save = useAction(async () => {
    if (!d) return;
    await api(`/vendor/products/${id}`, { method: "PATCH", body: { title: d.title, description: d.description, categoryIds: [d.categoryId] } });
    toast("Saved");
    setDraft(null);
    product.reload();
  });
  const setMedia = useAction(async (ids: string[]) => {
    await api(`/vendor/products/${id}`, { method: "PATCH", body: { media: ids.map((publicId) => ({ publicId })) } });
    product.reload();
  });
  const upload = useAction(async (file: File) => {
    if (!p) return;
    if (file.size > 8 * 1024 * 1024) throw new Error("File is larger than 8 MB.");
    const sig = (await api<UploadAuth>("/vendor/uploads/signature", { method: "POST", body: {} })).data;
    const form = new FormData();
    form.set("file", file);
    form.set("api_key", sig.apiKey);
    form.set("timestamp", String(sig.timestamp));
    form.set("signature", sig.signature);
    form.set("folder", sig.folder);
    form.set("allowed_formats", sig.allowedFormats);
    const res = await fetch(sig.uploadUrl, { method: "POST", body: form });
    if (!res.ok) throw new Error("Upload failed. Use a JPG, PNG or WebP image.");
    const out = (await res.json()) as { public_id: string };
    await setMedia.run([...p.media.map((m) => m.publicId), out.public_id]);
  });
  const submit = useAction(async () => {
    await api(`/vendor/products/${id}/submit-review`, { method: "POST", body: {} });
    toast("Submitted for review");
    product.reload();
  });
  const archive = useAction(async () => {
    await api(`/vendor/products/${id}/archive`, { method: "POST", body: {} });
    setConfirmArchive(false);
    product.reload();
  });

  if (product.loading) return <ListSkeleton rows={4} />;
  if (product.error && !p) return <ErrorPanel error={product.error} onRetry={product.reload} />;
  if (!p || !d) return null;
  const locked = p.status === "pending_review" || p.status === "archived";
  const move = (i: number, dir: -1 | 1) => {
    const ids = p.media.map((m) => m.publicId);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    void setMedia.run(ids);
  };

  return (
    <div className="stack">
      <PageHeader title={p.title} subtitle={`/products/${p.slug}`}><StatusBadge status={p.status} /></PageHeader>
      {p.status === "rejected" && <Alert tone="danger" title="Rejected by moderation">{p.moderation?.reason ?? "Please review the product details."} Fix the issues and submit again.</Alert>}
      {p.status === "pending_review" && <Alert tone="info">This product is waiting for review and can&apos;t be edited right now.</Alert>}
      {p.status === "published" && <Alert tone="info">Changing the title, description, category or photos sends this product back to review. Price changes apply immediately.</Alert>}

      <section className="card stack">
        <h2>Details</h2>
        {save.error && <Alert tone="danger">{messageFor(save.error)}</Alert>}
        <Field label="Title" error={fieldMessage(save.error, "title")}>{(x) => <input {...x} className="input" disabled={locked} value={d.title} onChange={(e) => setDraft({ ...d, title: e.target.value })} />}</Field>
        <Field label="Description" error={fieldMessage(save.error, "description")}>{(x) => <textarea {...x} className="input" disabled={locked} value={d.description} onChange={(e) => setDraft({ ...d, description: e.target.value })} />}</Field>
        <Field label="Category">{(x) => <select {...x} className="input" disabled={locked} value={d.categoryId} onChange={(e) => setDraft({ ...d, categoryId: e.target.value })}>{cats.flat.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select>}</Field>
        <div><Button variant="primary" loading={save.pending} disabled={locked || !draft} onClick={() => void save.run()}>Save changes</Button></div>
      </section>

      <section className="card stack">
        <h2>Photos</h2>
        {(upload.error || setMedia.error) && <Alert tone="danger">{upload.error ? upload.error.message : messageFor(setMedia.error)}</Alert>}
        <div className="row" style={{ alignItems: "flex-start" }}>
          {p.media.map((m, i) => (
            <div key={m.publicId} className="stack-sm" style={{ width: 112 }}>
              <img src={m.url} alt={`Photo ${i + 1}`} width={112} height={112} style={{ borderRadius: "var(--radius-md)", objectFit: "cover", aspectRatio: "1" }} />
              <div className="row" style={{ gap: 4 }}>
                <Button size="sm" aria-label="Move earlier" disabled={locked || i === 0} onClick={() => move(i, -1)}>←</Button>
                <Button size="sm" aria-label="Move later" disabled={locked || i === p.media.length - 1} onClick={() => move(i, 1)}>→</Button>
                <Button size="sm" variant="ghost" aria-label="Remove photo" disabled={locked} onClick={() => void setMedia.run(p.media.filter((x) => x.publicId !== m.publicId).map((x) => x.publicId))}>✕</Button>
              </div>
            </div>
          ))}
        </div>
        <label className="btn btn-secondary" style={{ alignSelf: "flex-start", opacity: locked ? 0.55 : 1 }}>
          {upload.pending ? "Uploading…" : "+ Add photo"}
          <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={locked || upload.pending || p.media.length >= 10} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void upload.run(f); }} />
        </label>
      </section>

      <VariantsCard product={p} onChanged={product.reload} locked={p.status === "archived"} />

      <div className="row">
        {(p.status === "draft" || p.status === "rejected") && <Button variant="primary" loading={submit.pending} onClick={() => void submit.run()}>Submit for review</Button>}
        {p.status !== "archived" && <Button variant="danger" onClick={() => setConfirmArchive(true)}>Archive product</Button>}
        {submit.error && <span role="alert" style={{ color: "var(--color-danger)" }}>{messageFor(submit.error)}</span>}
      </div>
      <ConfirmDialog open={confirmArchive} title="Archive this product?" confirmLabel="Archive" danger pending={archive.pending} onClose={() => setConfirmArchive(false)} onConfirm={() => void archive.run()} body="It disappears from the store. Existing orders are not affected." />
    </div>
  );
}

function VariantsCard({ product, onChanged, locked }: { product: VProduct; onChanged: () => void; locked: boolean }) {
  const [editing, setEditing] = useState<Record<string, string>>({});
  const edit = useAction(async (v: PVariant, patch: { priceMinor?: number; active?: boolean }) => {
    await api(`/vendor/products/${product.id}/variants/${v.variantId}`, { method: "PATCH", body: patch });
    setEditing((e) => { const n = { ...e }; delete n[v.variantId]; return n; });
    onChanged();
  });
  const [adding, setAdding] = useState(false);
  return (
    <section className="card stack">
      <div className="row-between"><h2 style={{ marginBottom: 0 }}>Variants &amp; stock</h2>{!locked && <Button size="sm" onClick={() => setAdding(true)}>+ Add variant</Button>}</div>
      {edit.error && <Alert tone="danger">{messageFor(edit.error)}</Alert>}
      <div className="table-wrap"><table>
        <thead><tr><th>Variant</th><th>SKU</th><th className="num">Price</th><th className="num">On hand</th><th className="num">Reserved</th><th>Active</th></tr></thead>
        <tbody>{product.variants.map((v) => (
          <tr key={v.variantId}>
            <td>{Object.values(v.optionValues).join(" / ") || "Default"}</td>
            <td className="mono">{v.sku}</td>
            <td className="num">
              <span className="row" style={{ justifyContent: "flex-end", flexWrap: "nowrap" }}>
                <input aria-label={`Price for ${v.sku}`} className="input" inputMode="decimal" style={{ width: 110 }} disabled={locked} value={editing[v.variantId] ?? (v.priceMinor / 100).toFixed(2)} onChange={(e) => setEditing({ ...editing, [v.variantId]: e.target.value })} />
                {editing[v.variantId] !== undefined && <Button size="sm" variant="primary" loading={edit.pending} onClick={() => { const m = parseMoneyInput(editing[v.variantId]!); if (m) void edit.run(v, { priceMinor: m }); }}>Save</Button>}
              </span>
            </td>
            <td className="num">{v.stock?.onHand ?? "—"}</td><td className="num">{v.stock?.reserved ?? "—"}</td>
            <td><input type="checkbox" aria-label={`${v.sku} active`} checked={v.active} disabled={locked || edit.pending} onChange={(e) => void edit.run(v, { active: e.target.checked })} /></td>
          </tr>))}</tbody>
      </table></div>
      <p className="muted small">Change stock quantities on the <Link href="/vendor/inventory">Inventory</Link> page.</p>
      <AddVariant open={adding} product={product} onClose={() => setAdding(false)} onDone={() => { setAdding(false); onChanged(); }} />
    </section>
  );
}

function AddVariant({ open, product, onClose, onDone }: { open: boolean; product: VProduct; onClose: () => void; onDone: () => void }) {
  const [vals, setVals] = useState<Record<string, string>>({});
  const [f, setF] = useState({ sku: "", price: "", stock: "0" });
  const add = useAction(async () => {
    const newOptionValues = Object.fromEntries(product.options.map((o) => [o.name, o.values.includes(vals[o.name] ?? "") ? [] : [(vals[o.name] ?? "").trim()]]).filter(([, v]) => (v as string[]).length));
    await api(`/vendor/products/${product.id}/variants`, { method: "POST", body: { newOptionValues, variants: [{ sku: f.sku.trim(), optionValues: Object.fromEntries(product.options.map((o) => [o.name, (vals[o.name] ?? "").trim()])), priceMinor: parseMoneyInput(f.price) ?? -1, initialStock: Number(f.stock) }] } });
    setVals({});
    setF({ sku: "", price: "", stock: "0" });
    onDone();
  });
  return (
    <ConfirmDialog open={open} title="Add a variant" confirmLabel="Add variant" pending={add.pending} onClose={onClose} onConfirm={() => void add.run()}>
      {add.error && <Alert tone="danger">{messageFor(add.error)}</Alert>}
      {product.options.map((o) => <Field key={o.name} label={o.name} hint={`Existing: ${o.values.join(", ")}. Pick a suggestion or type a new value.`}>{(p) => <><input {...p} className="input" list={`dl-${o.name}`} value={vals[o.name] ?? ""} onChange={(e) => setVals({ ...vals, [o.name]: e.target.value })} /><datalist id={`dl-${o.name}`}>{[...new Set([...o.values, ...(presetByName(o.name)?.values.map((x) => x.value) ?? [])])].map((v) => <option key={v} value={v} />)}</datalist></>}</Field>)}
      <Field label="SKU" error={fieldMessage(add.error, "variants")}>{(p) => <input {...p} className="input mono" value={f.sku} onChange={(e) => setF({ ...f, sku: e.target.value })} />}</Field>
      <div className="form-grid"><Field label="Price (৳)">{(p) => <input {...p} className="input" inputMode="decimal" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} />}</Field><Field label="Initial stock">{(p) => <input {...p} className="input" inputMode="numeric" value={f.stock} onChange={(e) => setF({ ...f, stock: e.target.value.replace(/\D/g, "") })} />}</Field></div>
    </ConfirmDialog>
  );
}

// ---------- inventory ----------
interface InvRow { id: string; sku: string; productTitle?: string; onHand: number; reserved: number; available: number; productId: string }

export function InventoryTable() {
  const [adjust, setAdjust] = useState<InvRow | null>(null);
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState("Stock count");
  const [tick, setTick] = useState(0);
  const { toast } = useToast();
  const save = useAction(async () => {
    await api(`/vendor/inventory/${adjust!.id}`, { method: "PATCH", body: { set: Number(qty), reason } });
    toast("Stock updated");
    setAdjust(null);
    setTick((t) => t + 1);
  });
  const cols: Column<InvRow>[] = [
    { key: "p", header: "Product", render: (r) => <Link href={`/vendor/products/${r.productId}`}>{r.productTitle ?? r.productId}</Link> },
    { key: "s", header: "SKU", render: (r) => <span className="mono">{r.sku}</span> },
    { key: "h", header: "On hand", numeric: true, render: (r) => r.onHand },
    { key: "r", header: "Reserved", numeric: true, render: (r) => r.reserved },
    { key: "a", header: "Available", numeric: true, render: (r) => <span className={r.available <= 0 ? "badge badge-danger" : r.available <= 3 ? "badge badge-warning" : ""}>{r.available}</span> },
  ];
  return (
    <div className="stack">
      <PageHeader title="Inventory" />
      <ListTable<InvRow> key={tick} path="/vendor/inventory?limit=25" columns={cols} caption="Inventory" empty="No stock records yet" actions={(r) => <Button size="sm" onClick={() => { setAdjust(r); setQty(String(r.onHand)); }}>Adjust</Button>} />
      <ConfirmDialog open={!!adjust} title={`Adjust stock · ${adjust?.sku ?? ""}`} confirmLabel="Save" pending={save.pending} onClose={() => setAdjust(null)} onConfirm={() => void save.run()}>
        {save.error && <Alert tone="danger">{save.error.code === "CONFLICT" ? "Stock can't go below the quantity already reserved by customers." : messageFor(save.error)}</Alert>}
        <p className="muted small">{adjust?.reserved ?? 0} reserved by customers right now.</p>
        <Field label="New quantity on hand">{(p) => <input {...p} className="input" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value.replace(/\D/g, ""))} />}</Field>
        <Field label="Reason">{(p) => <input {...p} className="input" value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
      </ConfirmDialog>
    </div>
  );
}

