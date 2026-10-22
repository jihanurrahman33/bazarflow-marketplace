"use client";
import Link from "next/link";
import { useState } from "react";
import { api, messageFor } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { useAction, usePaged } from "@/lib/hooks";
import { StatusTabs } from "./console-kit";
import { Alert, Button, EmptyState, ErrorPanel, ListSkeleton, LoadMore, PageHeader, Stars } from "./ui";

function ReplyBox({ initial, label, onSend }: { initial?: string; label: string; onSend: (text: string) => Promise<void> }) {
  const [text, setText] = useState(initial ?? "");
  const send = useAction(async () => { await onSend(text.trim()); });
  return (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); if (text.trim().length >= 2) void send.run(); }}>
      {send.error && <Alert tone="danger">{messageFor(send.error)}</Alert>}
      <label className="sr-only" htmlFor={`r-${label}`}>{label}</label>
      <textarea id={`r-${label}`} className="input" rows={2} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} placeholder="Write a clear, polite answer. It is public." />
      <div><Button type="submit" size="sm" variant="primary" loading={send.pending} disabled={text.trim().length < 2}>{initial ? "Update reply" : "Send reply"}</Button></div>
    </form>
  );
}

interface Q { id: string; body: string; asker: string; createdAt: string; product: { title: string; slug?: string }; answer?: { body: string; at: string } }

/** Shopper questions about this seller's products. Answering quickly is one of the best trust signals a store has. */
export function QuestionsInbox() {
  const [tab, setTab] = useState("false");
  const list = usePaged<Q>(`/vendor/questions?limit=10&answered=${tab}`);
  return (
    <div className="stack">
      <PageHeader title="Questions" subtitle="Shoppers ask before they buy. Your answer appears publicly on the product page." />
      <StatusTabs label="Questions" value={tab} onChange={setTab} options={[{ value: "false", label: "Waiting for an answer" }, { value: "true", label: "Answered" }]} />
      {list.loading ? <ListSkeleton rows={3} /> : list.error && list.items.length === 0 ? <ErrorPanel error={list.error} onRetry={list.reload} /> : list.items.length === 0 ? (
        <EmptyState title={tab === "false" ? "Nothing waiting" : "No answered questions yet"}>{tab === "false" ? "New questions from shoppers will appear here and in your notifications." : "Answered questions show here."}</EmptyState>
      ) : (
        list.items.map((q) => (
          <article key={q.id} className="card stack">
            <div className="row-between"><strong>{q.body}</strong><span className="muted small">{formatDate(q.createdAt, { dateStyle: "medium" })}</span></div>
            <p className="muted small">{q.asker} asked about {q.product.slug ? <Link href={`/products/${q.product.slug}#questions`}>{q.product.title}</Link> : q.product.title}</p>
            <ReplyBox label={`answer-${q.id}`} initial={q.answer?.body} onSend={async (text) => { await api(`/vendor/questions/${q.id}/answer`, { method: "PUT", body: { body: text } }); list.reload(); }} />
          </article>
        ))
      )}
      <LoadMore hasMore={list.hasMore} loading={list.loadingMore} onClick={list.loadMore} />
    </div>
  );
}

interface R { id: string; rating: number; title?: string; body: string; author: string; createdAt: string; product: { title: string; slug?: string }; reply?: { body: string; at: string } }

/** Reviews on this seller's products, with a public reply. Answering a bad review well often earns the sale back. */
export function ReviewsInbox() {
  const [tab, setTab] = useState("true");
  const list = usePaged<R>(`/vendor/reviews?limit=10&unanswered=${tab}`);
  return (
    <div className="stack">
      <PageHeader title="Reviews" subtitle="Reply publicly to what customers say about your products." />
      <StatusTabs label="Reviews" value={tab} onChange={setTab} options={[{ value: "true", label: "Not replied yet" }, { value: "false", label: "All reviews" }]} />
      {list.loading ? <ListSkeleton rows={3} /> : list.error && list.items.length === 0 ? <ErrorPanel error={list.error} onRetry={list.reload} /> : list.items.length === 0 ? (
        <EmptyState title="No reviews here">{tab === "true" ? "You have replied to everything. Nice." : "Reviews appear after customers receive their orders."}</EmptyState>
      ) : (
        list.items.map((r) => (
          <article key={r.id} className="card stack">
            <div className="row-between"><span><Stars value={r.rating} /> {r.title && <strong>{r.title}</strong>}</span><span className="muted small">{formatDate(r.createdAt, { dateStyle: "medium" })}</span></div>
            <p>{r.body}</p>
            <p className="muted small">{r.author} on {r.product.slug ? <Link href={`/products/${r.product.slug}#reviews`}>{r.product.title}</Link> : r.product.title}</p>
            <ReplyBox label={`reply-${r.id}`} initial={r.reply?.body} onSend={async (text) => { await api(`/vendor/reviews/${r.id}/reply`, { method: "PUT", body: { body: text } }); list.reload(); }} />
          </article>
        ))
      )}
      <LoadMore hasMore={list.hasMore} loading={list.loadingMore} onClick={list.loadMore} />
    </div>
  );
}
