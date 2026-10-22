"use client";
import { use, useEffect, useState } from "react";
import { Alert, Button, Money } from "@/components/ui";

export default function MockPayPage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = use(params);
  const [info, setInfo] = useState<{ amountMinor: number; currency: string; orderNumber?: string } | null | undefined>(undefined);
  const [busy, setBusy] = useState<string>();
  const [err, setErr] = useState<string>();
  useEffect(() => {
    fetch(`/mock-pay/${encodeURIComponent(ref)}/action`).then((r) => (r.ok ? r.json() : null)).then(setInfo).catch(() => setInfo(null));
  }, [ref]);
  const act = async (outcome: "success" | "fail" | "cancel") => {
    setBusy(outcome);
    setErr(undefined);
    try {
      const r = await fetch(`/mock-pay/${encodeURIComponent(ref)}/action`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ outcome }) });
      const j = await r.json();
      if (!r.ok) throw new Error("failed");
      window.location.assign(j.redirect);
    } catch {
      setErr("Could not complete the sandbox payment.");
      setBusy(undefined);
    }
  };
  if (info === undefined) return <div className="container page">Loading…</div>;
  if (info === null) return <div className="container page"><Alert tone="danger">This sandbox payment page is not available.</Alert></div>;
  return (
    <div className="container page" style={{ maxWidth: 480 }}>
      <div className="card stack">
        <Alert tone="warning" title="Sandbox payment page">No real money moves. This stands in for the provider&apos;s hosted checkout.</Alert>
        <h1>Pay <Money minor={info.amountMinor} currency={info.currency} /></h1>
        <p className="muted">Order {info.orderNumber} · reference <span className="mono">{ref}</span></p>
        {err && <Alert tone="danger">{err}</Alert>}
        <Button variant="primary" loading={busy === "success"} disabled={!!busy} onClick={() => void act("success")}>Pay successfully</Button>
        <Button loading={busy === "fail"} disabled={!!busy} onClick={() => void act("fail")}>Simulate a declined payment</Button>
        <Button variant="ghost" loading={busy === "cancel"} disabled={!!busy} onClick={() => void act("cancel")}>Cancel and go back</Button>
      </div>
    </div>
  );
}
