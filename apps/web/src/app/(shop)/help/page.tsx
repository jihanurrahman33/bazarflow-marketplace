import type { Metadata } from "next";
import { SupportAssistant } from "@/components/support-assistant";
import { getEnv } from "@/server/config/env";
import { FAQ } from "@/lib/faq";

export const metadata: Metadata = { title: "Help & policies", description: "Shipping, payments, returns and refunds on BazarFlow." };

export default function HelpPage() {
  return (
    <div className="container page stack" style={{ maxWidth: 760 }}>
      <h1>Help &amp; policies</h1>
      {getEnv().AI_ASSISTANT_ENABLED && <SupportAssistant />}
      {FAQ.map((f) => (
        <section key={f.id} id={f.id} className="card"><h2>{f.q}</h2><p style={{ marginBottom: 0 }}>{f.a}</p></section>
      ))}
    </div>
  );
}
