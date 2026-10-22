"use client";
import { useState } from "react";
import { humanize, formatMoneyShort } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { RankBars } from "./charts";
import { ErrorPanel, ListSkeleton, PageHeader, Stat } from "./ui";

interface Funnel {
  days: number;
  steps: { type: string; visitors: number; events: number; ofViewers: number | null }[];
  purchases: number; revenueMinor: number;
  viewsBySource: { source: string; views: number }[];
  searches: number; searchesWithNoResults: { query: string; count: number }[];
}
interface Experiment {
  key: string; description: string; minPerVariant: number;
  verdict: "not_enough_data" | "no_clear_difference" | "difference_likely";
  variants: { variant: string; visitors: number; purchasers: number; rate: number | null }[];
}

const STEP_LABEL: Record<string, string> = { view_product: "Viewed a product", add_to_cart: "Added to cart", begin_checkout: "Started checkout", purchase: "Purchased" };
const VERDICT: Record<Experiment["verdict"], { label: string; tone: "neutral" | "success" | "warning" }> = {
  not_enough_data: { label: "Not enough data yet", tone: "neutral" },
  no_clear_difference: { label: "No clear difference", tone: "neutral" },
  difference_likely: { label: "Difference is unlikely to be chance", tone: "success" },
};

/** Where shoppers drop out of the buying funnel, which rows lead to product views, and how the A/B experiments are doing. */
export function AnalyticsView() {
  const [days, setDays] = useState(7);
  const funnel = useApi<Funnel>(`/admin/analytics/funnel?days=${days}`);
  const exps = useApi<Experiment[]>(`/admin/analytics/experiments?days=${days}`);
  const f = funnel.data;
  const buy = f?.steps.find((s) => s.type === "purchase");
  const top = f?.steps[0]?.visitors ?? 0;

  return (
    <div className="stack">
      <PageHeader title="Analytics" subtitle="Anonymous behaviour on the storefront. Shoppers with Do Not Track or Global Privacy Control on are not counted.">
        <select aria-label="Period" className="input input-sm" value={days} onChange={(e) => setDays(Number(e.target.value))}>
          {[1, 7, 30, 90].map((d) => <option key={d} value={d}>Last {d} day{d === 1 ? "" : "s"}</option>)}
        </select>
      </PageHeader>

      {funnel.loading ? <ListSkeleton rows={4} /> : funnel.error ? <ErrorPanel error={funnel.error} onRetry={funnel.reload} /> : f && (
        <>
          <div className="grid grid-stats">
            <Stat label="Product viewers" value={top.toLocaleString("en-BD")} hint="distinct browsers" />
            <Stat label="Purchases" value={f.purchases.toLocaleString("en-BD")} hint={top ? `${((f.purchases / top) * 100).toFixed(1)}% of viewers` : undefined} />
            <Stat label="Revenue from tracked purchases" value={formatMoneyShort(f.revenueMinor)} hint="orders confirmed by a tracked browser" />
            <Stat label="Searches" value={f.searches.toLocaleString("en-BD")} hint={`${f.searchesWithNoResults.reduce((a, r) => a + r.count, 0)} found nothing`} />
          </div>

          <section className="card stack" aria-labelledby="funnel-h">
            <h2 id="funnel-h">Buying funnel</h2>
            <RankBars format={(n) => n.toLocaleString("en-BD")} rows={f.steps.map((s) => ({ label: STEP_LABEL[s.type] ?? humanize(s.type), value: s.visitors, hint: s.ofViewers === null ? undefined : `${s.ofViewers}% of viewers` }))} />
            {top === 0 && <p className="muted small">No data yet. Events start flowing once shoppers browse the site.</p>}
            {buy && f.purchases > buy.visitors && <p className="muted small">Some purchases come from browsers that were not tracked on the way in.</p>}
          </section>

          <div className="grid grid-2">
            <section className="card stack" aria-labelledby="src-h">
              <h2 id="src-h">Which rows lead to product views</h2>
              {f.viewsBySource.length === 0 ? <p className="muted">No attributed views yet.</p> : <RankBars format={(n) => n.toLocaleString("en-BD")} rows={f.viewsBySource.map((s) => ({ label: humanize(s.source), value: s.views }))} />}
            </section>
            <section className="card stack" aria-labelledby="nores-h">
              <h2 id="nores-h">Searches that found nothing</h2>
              {f.searchesWithNoResults.length === 0 ? <p className="muted">None. Every search found something.</p> : <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>{f.searchesWithNoResults.map((s) => <li key={s.query} className="list-row"><span>{s.query}</span><span className="muted small">{s.count}×</span></li>)}</ul>}
              <p className="muted small">Add these products or synonyms: each one is a shopper who wanted to buy.</p>
            </section>
          </div>
        </>
      )}

      <section className="card stack" aria-labelledby="exp-h">
        <h2 id="exp-h">Experiments</h2>
        {exps.loading ? <ListSkeleton rows={2} /> : exps.error ? <ErrorPanel error={exps.error} onRetry={exps.reload} /> : (exps.data ?? []).map((e) => (
          <div key={e.key} className="stack">
            <div className="row-between"><div><strong>{e.description}</strong><div className="muted small mono">{e.key}</div></div><span className={`badge badge-${VERDICT[e.verdict].tone}`}>{VERDICT[e.verdict].label}</span></div>
            <div className="table-wrap"><table>
              <thead><tr><th>Variant</th><th className="num">Shoppers</th><th className="num">Purchased</th><th className="num">Purchase rate</th></tr></thead>
              <tbody>{e.variants.map((v) => <tr key={v.variant}><td>{humanize(v.variant)}</td><td className="num">{v.visitors.toLocaleString("en-BD")}</td><td className="num">{v.purchasers}</td><td className="num">{v.rate === null ? "—" : `${v.rate}%`}</td></tr>)}</tbody>
            </table></div>
            {e.verdict === "not_enough_data" && <p className="muted small">Each variant needs at least {e.minPerVariant} shoppers before a comparison means anything.</p>}
          </div>
        ))}
      </section>
    </div>
  );
}
