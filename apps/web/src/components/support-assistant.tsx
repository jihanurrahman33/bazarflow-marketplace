"use client";
import Link from "next/link";
import { useState } from "react";
import { api, messageFor } from "@/lib/api";
import { useAction } from "@/lib/hooks";
import { Alert, Button, Field } from "./ui";

interface Answer { answer: string; outcome: string; sources: { id: string; title: string }[]; escalate: boolean; supportContact?: string }

/** Answers come only from approved help content (plus read-only lookups of the signed-in user's own orders). */
export function SupportAssistant() {
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<Answer>();
  const ask = useAction(async () => {
    const r = await api<Answer>("/support/ask", { method: "POST", body: { question } });
    setResult(r.data);
  });
  return (
    <section className="card stack" aria-labelledby="ask-title">
      <h2 id="ask-title">Ask a question</h2>
      <form onSubmit={(e) => { e.preventDefault(); void ask.run(); }} className="stack">
        <Field label="What do you need help with?" hint="Answers come from our help articles. Never share passwords or card details.">
          {(p) => <textarea {...p} className="input" value={question} maxLength={500} onChange={(e) => setQuestion(e.target.value)} />}
        </Field>
        <div><Button type="submit" variant="primary" loading={ask.pending} disabled={question.trim().length < 3}>Ask</Button></div>
      </form>
      {ask.error && <Alert tone="danger">{ask.error.code === "RATE_LIMITED" ? "Please wait a moment before asking again." : messageFor(ask.error)}</Alert>}
      {result && (
        <div className="stack-sm" aria-live="polite">
          <Alert tone={result.escalate ? "warning" : "info"}>{result.answer}</Alert>
          {result.sources.length > 0 && (
            <p className="small muted">Source: {result.sources.map((s, i) => <span key={s.id}>{i > 0 && ", "}<Link href={`/help#${s.id}`}>{s.title}</Link></span>)}</p>
          )}
          {result.outcome === "needs_sign_in" && <Link className="btn btn-primary btn-sm" href="/login?next=/help">Sign in</Link>}
        </div>
      )}
    </section>
  );
}
