"use client";
import Link from "next/link";
import { useState } from "react";
import { api, messageFor } from "@/lib/api";
import { useAction } from "@/lib/hooks";
import { useApi } from "@/lib/hooks";
import { useSession } from "./providers";
import { Alert, Button, ErrorPanel, Field, fieldMessage, ListSkeleton, StatusBadge } from "./ui";

interface Application { id: string; status: string; reviewReason?: string; business: { name: string; slug: string; phone: string; address: string; tradeLicenseNo?: string; description?: string } }

const slugify = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

export function SellerApplication() {
  const { user } = useSession();
  const existing = useApi<Application>("/vendor/application");
  const [f, setF] = useState({ name: "", slug: "", phone: "", address: "", tradeLicenseNo: "", description: "" });
  const [slugTouched, setSlugTouched] = useState(false);
  const resubmit = existing.data?.status === "more_info_required";
  const submit = useAction(async () => {
    const body = { business: { name: f.name, slug: f.slug, phone: f.phone, address: f.address, ...(f.tradeLicenseNo ? { tradeLicenseNo: f.tradeLicenseNo } : {}), ...(f.description ? { description: f.description } : {}) }, documents: [] };
    // New applications POST to the collection; a "more information" resubmission PUTs the existing application.
    await api(resubmit ? "/vendor/application" : "/vendor/applications", { method: resubmit ? "PUT" : "POST", body });
    existing.reload();
  });
  if (!user) return <Alert tone="info" title="Sign in to apply"><Link href="/login?next=/become-a-seller">Sign in</Link> or <Link href="/register?next=/become-a-seller">create an account</Link> to open a store.</Alert>;
  if (user.role === "vendor") return <Alert tone="success" title="You already have a store"><Link href="/vendor">Open your seller console</Link></Alert>;
  if (user.role === "admin") return <Alert tone="info">Admin accounts cannot open a store.</Alert>;
  if (existing.loading) return <ListSkeleton rows={2} />;
  if (existing.error && existing.error.status !== 404) return <ErrorPanel error={existing.error} onRetry={existing.reload} />;

  const app = existing.data;
  if (app && app.status !== "more_info_required" && app.status !== "rejected") {
    return (
      <div className="card stack">
        <div className="row-between"><h2 style={{ marginBottom: 0 }}>{app.business.name}</h2><StatusBadge status={app.status} /></div>
        <p className="muted">{app.status === "approved" ? "Approved! Sign out and back in to open your seller console." : "We are reviewing your application. You'll be notified by email and in the app."}</p>
      </div>
    );
  }
  return (
    <form onSubmit={(e) => { e.preventDefault(); void submit.run(); }} className="stack" noValidate>
      {!user.emailVerified && <Alert tone="warning" title="Verify your email first"><Link href="/verify-email?next=/become-a-seller">Verify now</Link> — sellers must have a verified email.</Alert>}
      {app?.status === "rejected" && <Alert tone="danger" title="Your previous application was rejected">{app.reviewReason}</Alert>}
      {app?.status === "more_info_required" && <Alert tone="warning" title="We need more information">{app.reviewReason}</Alert>}
      {submit.error && !submit.error.details.length && <Alert tone="danger">{messageFor(submit.error)}</Alert>}
      <div className="form-grid">
        <Field label="Store name" error={fieldMessage(submit.error, "business.name")}>{(p) => <input {...p} className="input" required value={f.name} onChange={(e) => setF((s) => ({ ...s, name: e.target.value, slug: slugTouched ? s.slug : slugify(e.target.value) }))} />}</Field>
        <Field label="Store URL" hint={`bazarflow.example/vendors/${f.slug || "your-store"}`} error={fieldMessage(submit.error, "business.slug")}>{(p) => <input {...p} className="input mono" required value={f.slug} onChange={(e) => { setSlugTouched(true); setF({ ...f, slug: slugify(e.target.value) }); }} />}</Field>
        <Field label="Business phone" error={fieldMessage(submit.error, "business.phone")}>{(p) => <input {...p} className="input" type="tel" placeholder="+8801…" required value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />}</Field>
        <Field label="Trade licence no. (optional)">{(p) => <input {...p} className="input" value={f.tradeLicenseNo} onChange={(e) => setF({ ...f, tradeLicenseNo: e.target.value })} />}</Field>
      </div>
      <Field label="Business address" error={fieldMessage(submit.error, "business.address")}>{(p) => <input {...p} className="input" required value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} />}</Field>
      <Field label="About your store (optional)">{(p) => <textarea {...p} className="input" maxLength={1000} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />}</Field>
      <div><Button type="submit" variant="primary" loading={submit.pending} disabled={!user.emailVerified}>{resubmit ? "Resubmit application" : "Submit application"}</Button></div>
    </form>
  );
}
