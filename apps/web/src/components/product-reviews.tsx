"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { api, messageFor } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { useAction, useApi } from "@/lib/hooks";
import { useSession, useToast } from "./providers";
import { Alert, Button, ConfirmDialog, Field, Stars } from "./ui";

export interface ReviewItem {
  id: string;
  rating: number;
  title?: string;
  body: string;
  author: string;
  verifiedPurchase: boolean;
  createdAt: string;
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
}

export function ProductReviews({ productSlug, productTitle, initialReviews, initialSummary }: Props) {
  const { user, status } = useSession();
  const { toast } = useToast();
  const path = usePathname();

  const [reviews, setReviews] = useState<ReviewItem[]>(initialReviews);
  const [summary, setSummary] = useState<ReviewSummary>(initialSummary);
  const [writing, setWriting] = useState(false);
  const [posted, setPosted] = useState(false);
  const eligibility = useApi<{ canReview: boolean; reason?: string }>(user?.role === "customer" ? `/products/${productSlug}/reviews/eligibility` : null);
  const [rating, setRating] = useState(5);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

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
      return { ...prev, count: newCount, average: newAvg };
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

      {reviews.length === 0 ? (
        <div className="card" style={{ padding: "var(--space-xl)", textAlign: "center" }}>
          <p className="muted" style={{ marginBottom: 0 }}>
            No reviews yet. Only customers who purchased and received this product can leave a verified review.
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
