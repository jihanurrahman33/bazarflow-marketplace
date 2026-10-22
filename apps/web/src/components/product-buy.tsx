"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { api, messageFor } from "@/lib/api";
import { useAction } from "@/lib/hooks";
import { formatMoney } from "@/lib/format";
import { isColourOption, swatchFor } from "@/lib/option-presets";
import { track } from "@/lib/track";
import { useSession, useToast } from "./providers";
import { Alert, Button, LinkButton } from "./ui";

interface Variant { variantId: string; optionValues: Record<string, string>; label: string; priceMinor: number; compareAtMinor?: number; inStock: boolean; lowStock?: number }
interface Props { productId: string; slug: string; currency: string; options: { name: string; values: string[] }[]; variants: Variant[] }

export function ProductBuy({ productId, slug, currency, options, variants }: Props) {
  const { user, status, setCartCount } = useSession();
  const { toast } = useToast();
  const path = usePathname();
  const [chosen, setChosen] = useState<Record<string, string>>(() => (options.length === 0 ? {} : Object.fromEntries(options.map((o) => [o.name, ""]))));
  const [qty, setQty] = useState(1);

  const variant = useMemo(
    () => variants.find((v) => options.every((o) => v.optionValues[o.name] === chosen[o.name])),
    [variants, options, chosen],
  );
  // A value is selectable if at least one in-stock variant matches the other current choices.
  const available = (opt: string, value: string) =>
    variants.some((v) => v.inStock && v.optionValues[opt] === value && options.every((o) => o.name === opt || !chosen[o.name] || v.optionValues[o.name] === chosen[o.name]));

  const add = useAction(async () => {
    if (!variant) return;
    const r = await api<{ itemCount: number }>("/cart/items", { method: "POST", body: { productId, variantId: variant.variantId, quantity: qty } });
    setCartCount(r.data.itemCount);
    toast("Added to cart");
    track({ type: "add_to_cart", productId });
  });

  const price = variant?.priceMinor ?? Math.min(...variants.map((v) => v.priceMinor));
  const canBuy = !!variant && variant.inStock;
  const maxQty = Math.min(20, variant?.lowStock ?? 20);

  return (
    <div className="stack">
      <div>
        <span className="price" style={{ fontSize: "var(--text-headline)" }}>{!variant && variants.length > 1 ? "From " : ""}{formatMoney(price, currency)}</span>
        {variant?.compareAtMinor && variant.compareAtMinor > variant.priceMinor && (
          <>
            <span className="price-was">{formatMoney(variant.compareAtMinor, currency)}</span>
            <span className="discount-tag">-{Math.round(((variant.compareAtMinor - variant.priceMinor) / variant.compareAtMinor) * 100)}%</span>
          </>
        )}
      </div>

      {options.map((o) => (
        <fieldset key={o.name} style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="small muted" style={{ marginBottom: 6 }}>{o.name}{chosen[o.name] ? `: ${chosen[o.name]}` : ""}</legend>
          <div className="options">
            {o.values.map((val) => {
              const pick = () => { setChosen((c) => ({ ...c, [o.name]: c[o.name] === val ? "" : val })); setQty(1); };
              const hex = swatchFor(o.name, val);
              return isColourOption(o.name) && hex ? (
                <button key={val} type="button" className="swatch-btn" style={{ "--swatch": hex } as React.CSSProperties} aria-label={val} title={val} aria-pressed={chosen[o.name] === val} disabled={!available(o.name, val)} onClick={pick} />
              ) : (
                <button key={val} type="button" className="option" aria-pressed={chosen[o.name] === val} disabled={!available(o.name, val)} onClick={pick}>{val}</button>
              );
            })}
          </div>
        </fieldset>
      ))}

      {variant && !variant.inStock && <Alert tone="warning">This option is out of stock.</Alert>}
      {variant?.lowStock && <p className="small" style={{ color: "var(--color-warning)" }}>Only {variant.lowStock} left</p>}

      <div className="row">
        <div className="qty" role="group" aria-label="Quantity">
          <button type="button" aria-label="Decrease quantity" onClick={() => setQty((q) => Math.max(1, q - 1))}>−</button>
          <span aria-live="polite">{qty}</span>
          <button type="button" aria-label="Increase quantity" onClick={() => setQty((q) => Math.min(maxQty, q + 1))}>+</button>
        </div>
        {status === "ready" && !user ? (
          <LinkButton href={`/login?next=${encodeURIComponent(path)}`} variant="primary">Sign in to buy</LinkButton>
        ) : user && user.role !== "customer" ? (
          <span className="muted small">Sign in with a customer account to buy.</span>
        ) : (
          <Button variant="primary" className="btn-cta" onClick={() => void add.run()} loading={add.pending} disabled={!canBuy}>
            {options.length > 0 && !variant ? "Select options" : canBuy ? "Add to cart" : "Unavailable"}
          </Button>
        )}
        {user?.role === "customer" && <Link href="/cart" className="small">View cart</Link>}
      </div>
      {add.error && <Alert tone="danger">{messageFor(add.error)}</Alert>}
      <span className="sr-only">{slug}</span>
    </div>
  );
}
