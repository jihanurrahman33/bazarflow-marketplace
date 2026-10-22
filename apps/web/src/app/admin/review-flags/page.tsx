"use client";
import Link from "next/link";
import { formatDate } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { ReasonButton } from "@/components/console-kit";
import { EmptyState, ErrorPanel, ListSkeleton, PageHeader, Stars } from "@/components/ui";

interface Flag {
  kind: string; summary: string; vendorName?: string; product?: { id: string; title: string; slug: string };
  reviews: { id: string; rating: number; body: string; author: string; accountAgeDays: number; createdAt: string }[];
}
const KIND: Record<string, string> = { burst_from_new_accounts: "Burst from new accounts", new_account_praise: "Mostly 5-star from new accounts", one_account_many_reviews: "One account, many reviews" };

export default function Page() {
  const flags = useApi<Flag[]>("/admin/reviews/flags");
  return (
    <div className="stack">
      <PageHeader title="Review checks" subtitle="Patterns that sometimes mean reviews were arranged. Nothing is hidden automatically: look, then decide." />
      {flags.loading ? <ListSkeleton rows={3} /> : flags.error ? <ErrorPanel error={flags.error} onRetry={flags.reload} /> : (flags.data ?? []).length === 0 ? (
        <EmptyState title="Nothing suspicious">No review patterns need a look right now.</EmptyState>
      ) : (flags.data ?? []).map((f, i) => (
        <section key={i} className="card stack">
          <div className="row-between"><strong>{KIND[f.kind] ?? f.kind}</strong>{f.product && <Link href={`/products/${f.product.slug}#reviews`} className="small">{f.product.title}{f.vendorName ? ` · ${f.vendorName}` : ""}</Link>}</div>
          <p className="muted">{f.summary}</p>
          {f.reviews.map((r) => (
            <div key={r.id} className="list-row">
              <span><Stars value={r.rating} /> {r.body}<br /><span className="muted small">{r.author} · account {r.accountAgeDays} day(s) old when reviewing · {formatDate(r.createdAt, { dateStyle: "medium" })}</span></span>
              <ReasonButton label="Hide" title="Hide this review" path={`/admin/reviews/${r.id}/hide`} danger confirmLabel="Hide review" success="Review hidden" onDone={flags.reload} />
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
