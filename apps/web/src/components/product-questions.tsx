"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { api, messageFor } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { useAction, usePaged } from "@/lib/hooks";
import { useInView } from "./in-view";
import { useT } from "./lang";
import { useSession } from "./providers";
import { Alert, Button, EmptyState, LoadMore } from "./ui";

export interface QuestionItem { id: string; body: string; asker: string; createdAt: string; answer?: { body: string; at: string; by: string } }

function Questions({ slug }: { slug: string }) {
  const t = useT();
  const { user, status } = useSession();
  const path = usePathname();
  const list = usePaged<QuestionItem>(`/products/${slug}/questions?limit=5`);
  const [text, setText] = useState("");
  const [sent, setSent] = useState(false);
  const submit = useAction(async () => {
    await api(`/products/${slug}/questions`, { method: "POST", body: { body: text.trim() } });
    setText("");
    setSent(true);
    list.reload();
  });

  return (
    <div className="stack">
      {status === "ready" && !user ? (
        <p className="muted small"><Link href={`/login?next=${encodeURIComponent(`${path}#questions`)}`}>{t("Sign in to ask the seller a question.")}</Link></p>
      ) : user?.role === "customer" ? (
        <form className="qa-form" onSubmit={(e) => { e.preventDefault(); if (text.trim().length >= 10) void submit.run(); }}>
          <label htmlFor="qa-ask" className="sr-only">{t("Your question")}</label>
          <input id="qa-ask" className="input" value={text} maxLength={300} placeholder={t("Ask the seller about size, material, delivery…")} onChange={(e) => { setText(e.target.value); setSent(false); }} />
          <Button type="submit" size="sm" variant="primary" loading={submit.pending} disabled={text.trim().length < 10}>{t("Ask")}</Button>
        </form>
      ) : null}
      {submit.error && <Alert tone="danger">{messageFor(submit.error)}</Alert>}
      {sent && <Alert tone="success">{t("Question posted. We'll notify you when the seller answers.")}</Alert>}

      {list.loading ? <div className="skeleton" style={{ height: 80 }} aria-busy="true" /> : list.items.length === 0 ? (
        <EmptyState title={t("No questions yet")}>{t("Be the first to ask. The seller will answer here for everyone to see.")}</EmptyState>
      ) : (
        <ul className="qa-list">
          {list.items.map((q) => (
            <li key={q.id}>
              <p className="qa-q"><strong>{t("Q:")}</strong> {q.body}</p>
              {q.answer ? <p className="qa-a"><strong>{t("A:")}</strong> {q.answer.body} <span className="muted small">· {q.answer.by}, {formatDate(q.answer.at, { dateStyle: "medium" })}</span></p> : <p className="muted small">{t("Waiting for the seller to answer.")}</p>}
              <p className="muted small">{q.asker} · {formatDate(q.createdAt, { dateStyle: "medium" })}</p>
            </li>
          ))}
        </ul>
      )}
      <LoadMore hasMore={list.hasMore} loading={list.loadingMore} onClick={list.loadMore} />
    </div>
  );
}

/** Questions and answers under a product. Loads when the shopper scrolls near it, so it costs nothing on first paint. */
export function ProductQuestions({ slug }: { slug: string }) {
  const t = useT();
  const [shown, setShown] = useState(false);
  const sentinel = useInView<HTMLDivElement>(() => setShown(true), !shown, "400px");
  return (
    <section id="questions" aria-labelledby="qa-h" className="stack">
      <h2 id="qa-h">{t("Questions & answers")}</h2>
      {shown ? <Questions slug={slug} /> : <div ref={sentinel} style={{ minHeight: 120 }} aria-hidden="true" />}
    </section>
  );
}
