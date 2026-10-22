"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api, messageFor } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { useAction, useApi } from "@/lib/hooks";
import { useSession, useToast } from "./providers";
import { Alert, Button, ConfirmDialog, Field, LoadMore, Stars } from "./ui";

export interface ReviewItem {
  id: string;
  rating: number;
  title?: string;
  body: string;
  author: string;
  verifiedPurchase: boolean;
  createdAt: string;
  reply?: { body: string; at: string };
}

export interface ReviewSummary {
  count: number;
  average: number | null;
  distribution?: Record<string | number, number>;
}

interface Props {
  productSlug: string;
  productTitle: string;
  initialReviews: ReviewItem[];
  initialSummary: ReviewSummary;
  initialCursor?: string | null;
}

type SortKey = "newest" | "highest" | "lowest";
const SORTS: { value: SortKey; label: string }[] = [{ value: "newest", label: "Newest" }, { value: "highest", label: "Highest rated" }, { value: "lowest", label: "Lowest rated" }];
const PAGE = 10;

export function ProductReviews({ productSlug, productTitle, initialReviews, initialSummary, initialCursor = null }: Props) {
  const { user, status } = useSession();
  const { toast } = useToast();
  const path = usePathname();

  const [reviews, setReviews] = useState<ReviewItem[]>(initialReviews);
  const [summary, setSummary] = useState<ReviewSummary>(initialSummary);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [filter, setFilter] = useState<number | null>(null);
  const [sort, setSort] = useState<SortKey>("newest");
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string>();
  const first = useRef(true);
  const [writing, setWriting] = useState(false);
  const [posted, setPosted] = useState(false);
  const eligibility = useApi<{ canReview: boolean; reason?: string }>(user?.role === "customer" ? `/products/${productSlug}/reviews/eligibility` : null);
  const [rating, setRating] = useState(5);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  const pageUrl = (after: string | null) => `/products/${productSlug}/reviews?limit=${PAGE}&sort=${sort}${filter ? `&rating=${filter}` : ""}${after ? `&cursor=${encodeURIComponent(after)}` : ""}`;
  const fetchPage = async (after: string | null) => {
    setBusy(true);
    setLoadError(undefined);
    try {
      const r = await api<ReviewItem[]>(pageUrl(after));
      setReviews((prev) => (after ? [...prev, ...r.data.filter((x) => !prev.some((p) => p.id === x.id))] : r.data));
      setCursor((r.meta as { nextCursor?: string | null }).nextCursor ?? null);
    } catch (e) {
      setLoadError(messageFor(e));
    } finally {
      setBusy(false);
    }
  };
  // Changing the star filter or the sort order starts again from the first page.
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    void fetchPage(null);
  }, [filter, sort]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = useAction(async () => {
    const res = await api<ReviewItem>(`/products/${productSlug}/reviews`, {
      method: "POST",
      body: { rating, title: title.trim() || undefined, body: body.trim() },
    });
    const newReview = res.data;
    setReviews((prev) => [newReview, ...prev.filter((r) => r.id !== newReview.id)]);
    setSummary((prev) => {
      const newCount = prev.count + 1;
      const newTotal = (prev.average ?? 0) * prev.count + rating;
      const newAvg = Math.round((newTotal / newCount) * 10) / 10;
      return { ...prev, count: newCount, average: newAvg, distribution: prev.distribution ? { ...prev.distribution, [rating]: Number(prev.distribution[rating] ?? 0) + 1 } : prev.distribution };
    });
    toast("Thank you for your review!");
    setWriting(false);
    setPosted(true);
    setTitle("");
    setBody("");
    setRating(5);
  });

  return (
    <section aria-labelledby="reviews-heading" id="reviews" className="stack">
      <div className="row-between" style={{ alignItems: "center", flexWrap: "wrap", gap: "var(--space-md)" }}>
        <div>
          <h2 id="reviews-heading" style={{ marginBottom: 4 }}>Customer reviews</h2>
          <div className="row" style={{ alignItems: "center", gap: "var(--space-sm)" }}>
            {summary.count > 0 && <Stars value={summary.average} />}
            <span className="muted small">
              {summary.count > 0
                ? `${summary.average} out of 5 · ${summary.count} ${summary.count === 1 ? "review" : "reviews"}`
                : "No reviews yet"}
            </span>
          </div>
        </div>

        <div>
          {status === "ready" && !user ? (
            <Link href={`/login?next=${encodeURIComponent(path + "#reviews")}`} className="muted small">Bought this? Sign in to review</Link>
          ) : user?.role === "customer" && eligibility.data ? (
            posted || eligibility.data.reason === "already_reviewed" ? (
              <span className="muted small">You've reviewed this product</span>
            ) : eligibility.data.canReview ? (
              <Button size="sm" variant="primary" onClick={() => setWriting(true)}>Write a review</Button>
            ) : (
              <span className="muted small">Reviews open after your order is delivered</span>
            )
          ) : null}
        </div>
      </div>

      {summary.count > 0 && summary.distribution && (
        <div className="review-controls">
          <div className="review-dist" role="group" aria-label="Filter reviews by rating">
            {[5, 4, 3, 2, 1].map((n) => {
              const count = Number(summary.distribution?.[n] ?? 0);
              return (
                <button key={n} type="button" className="dist-row dist-btn" aria-pressed={filter === n} disabled={count === 0} onClick={() => setFilter(filter === n ? null : n)}>
                  <span>{n}★</span><span className="dist-bar"><i style={{ width: `${(count / summary.count) * 100}%` }} /></span><span className="muted small">{count.toLocaleString("en-BD")}</span>
                </button>
              );
            })}
          </div>
          <div className="review-sort">
            <label htmlFor="review-sort" className="muted small">Sort by</label>
            <select id="review-sort" className="input input-sm" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>{SORTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
            {filter && <button type="button" className="chip" onClick={() => setFilter(null)}>{filter}★ only ×</button>}
          </div>
        </div>
      )}

      {reviews.length === 0 && !busy ? (
        <div className="card" style={{ padding: "var(--space-xl)", textAlign: "center" }}>
          <p className="muted" style={{ marginBottom: 0 }}>
            {filter ? `No ${filter}-star reviews.` : "No reviews yet. Only customers who purchased and received this product can leave a verified review."}
          </p>
        </div>
      ) : (
        <div className="stack">
          {reviews.map((r) => (
            <article key={r.id} className="card stack" style={{ gap: "var(--space-xs)" }}>
              <div className="row-between">
                <span>
                  <Stars value={r.rating} /> {r.title && <strong>{r.title}</strong>}
                </span>
                <span className="muted small">{formatDate(r.createdAt, { dateStyle: "medium" })}</span>
              </div>
              <p style={{ whiteSpace: "pre-line", marginBottom: 4 }}>{r.body}</p>
              {r.reply && <div className="seller-reply"><strong className="small">Seller response</strong><p>{r.reply.body}</p></div>}
              <div className="row" style={{ alignItems: "center", gap: "var(--space-xs)" }}>
                <span className="muted small">{r.author}</span>
                {r.verifiedPurchase && (
                  <span className="badge badge-success small" style={{ fontSize: "var(--text-caption)", padding: "2px 6px" }}>
                    Verified purchase
                  </span>
                )}
              </div>
            </article>
          ))}
        </div>
      )}

      {loadError && <Alert tone="danger">{loadError}</Alert>}
      {busy && reviews.length === 0 && <div className="skeleton" style={{ height: 120 }} aria-busy="true" />}
      <LoadMore hasMore={cursor !== null} loading={busy} onClick={() => void fetchPage(cursor)} />

      <ConfirmDialog
        open={writing}
        title={`Review ${productTitle}`}
        confirmLabel="Post review"
        pending={submit.pending}
        onClose={() => setWriting(false)}
        onConfirm={() => void submit.run()}
      >
        {submit.error && <Alert tone="danger">{messageFor(submit.error)}</Alert>}
        <Field label="Rating">
          {(p) => (
            <select
              {...p}
              className="input"
              value={rating}
              onChange={(e) => setRating(Number(e.target.value))}
            >
              {[5, 4, 3, 2, 1].map((n) => (
                <option key={n} value={n}>
                  {"★".repeat(n)} ({n} {n === 1 ? "star" : "stars"})
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Headline (optional)" hint="Sum up your experience in one line.">
          {(p) => (
            <input
              {...p}
              type="text"
              className="input"
              maxLength={100}
              placeholder="e.g. Great quality, fits perfectly"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          )}
        </Field>
        <Field label="Your review" hint="At least 10 characters describing the product.">
          {(p) => (
            <textarea
              {...p}
              className="input"
              rows={4}
              maxLength={2000}
              placeholder="What did you like or dislike? How was the fit or quality?"
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          )}
        </Field>
      </ConfirmDialog>
    </section>
  );
}
