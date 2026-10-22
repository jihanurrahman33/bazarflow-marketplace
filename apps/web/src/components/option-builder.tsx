"use client";
import { useState } from "react";
import { OPTION_PRESETS, isColourOption, presetByName, sortLikePreset, swatchFor } from "@/lib/option-presets";
import { IconClose } from "./icons";
import { Button } from "./ui";

export interface OptionDraft { name: string; values: string[] }
export const MAX_OPTIONS = 3;
export const MAX_VALUES = 30;
const FEATURED = ["colour", "size", "fit", "shoe-size", "waist", "sleeve", "material", "pattern"];

/** A colour dot for colour values (known colours get their real shade). */
export function Swatch({ option, value }: { option: string; value: string }) {
  if (!isColourOption(option)) return null;
  const hex = swatchFor(option, value);
  return <span className="swatch-dot" style={hex ? { background: hex } : undefined} data-unknown={hex ? undefined : "true"} aria-hidden="true" />;
}

/**
 * Pick the options a product comes in (Colour, Size, Fit...) from the shared library, tick the values it is sold in,
 * or add custom ones. Produces the same {name, values[]} shape the API takes.
 */
export function OptionBuilder({ value, onChange }: { value: OptionDraft[]; onChange: (next: OptionDraft[]) => void }) {
  const [more, setMore] = useState(false);
  const [custom, setCustom] = useState<Record<number, string>>({});
  const used = new Set(value.map((o) => o.name.trim().toLowerCase()));
  const full = value.length >= MAX_OPTIONS;
  const featured = OPTION_PRESETS.filter((p) => FEATURED.includes(p.key));
  const rest = OPTION_PRESETS.filter((p) => !FEATURED.includes(p.key));

  const update = (i: number, patch: Partial<OptionDraft>) => onChange(value.map((o, j) => (j === i ? { ...o, ...patch } : o)));
  const toggle = (i: number, v: string) => {
    const o = value[i]!;
    const has = o.values.includes(v);
    if (!has && o.values.length >= MAX_VALUES) return;
    update(i, { values: has ? o.values.filter((x) => x !== v) : sortLikePreset(o.name, [...o.values, v]) });
  };
  const addCustom = (i: number) => {
    const o = value[i]!;
    const incoming = (custom[i] ?? "").split(",").map((s) => s.trim().slice(0, 60)).filter(Boolean);
    if (incoming.length === 0) return;
    const merged = [...new Set([...o.values, ...incoming])].slice(0, MAX_VALUES);
    update(i, { values: sortLikePreset(o.name, merged) });
    setCustom({ ...custom, [i]: "" });
  };

  const chip = (name: string, label: string) => (
    <button key={name} type="button" className="chip chip-add" disabled={full || used.has(name.toLowerCase())} onClick={() => onChange([...value, { name, values: [] }])}>+ {label}</button>
  );

  return (
    <div className="stack">
      <div className="opt-quick" role="group" aria-label="Add an option">
        {featured.map((p) => chip(p.name, p.name))}
        {more && rest.map((p) => chip(p.name, p.name))}
        <button type="button" className="chip" onClick={() => setMore(!more)} aria-expanded={more}>{more ? "Fewer" : "More…"}</button>
        <button type="button" className="chip chip-add" disabled={full} onClick={() => onChange([...value, { name: "", values: [] }])}>+ Custom option</button>
      </div>
      {value.length === 0 && <p className="muted small">Skip this if the product has one version. Add Colour, Size, Fit and more if buyers choose between versions. You can add up to {MAX_OPTIONS} options.</p>}

      {value.map((o, i) => {
        const preset = presetByName(o.name);
        const presetValues = preset?.values ?? [];
        const extras = o.values.filter((v) => !presetValues.some((p) => p.value === v));
        return (
          <div key={i} className="opt-card">
            <div className="opt-head">
              {preset ? <strong>{preset.name}</strong> : <input aria-label="Option name" className="input input-sm" placeholder="Option name, e.g. Style" maxLength={40} value={o.name} onChange={(e) => update(i, { name: e.target.value })} />}
              <span className="muted small">{o.values.length} selected{preset ? ` · ${preset.hint}` : ""}</span>
              <Button size="sm" variant="ghost" onClick={() => onChange(value.filter((_, j) => j !== i))}>Remove</Button>
            </div>
            {presetValues.length > 0 && (
              <div className="opt-values" role="group" aria-label={`${o.name} values`}>
                {presetValues.map((p) => (
                  <button key={p.value} type="button" className="opt-val" aria-pressed={o.values.includes(p.value)} onClick={() => toggle(i, p.value)}>
                    <Swatch option={o.name} value={p.value} />{p.value}
                  </button>
                ))}
              </div>
            )}
            {extras.length > 0 && (
              <div className="opt-values" aria-label="Your own values">
                {extras.map((v) => (
                  <span key={v} className="opt-val" aria-pressed="true"><Swatch option={o.name} value={v} />{v}<button type="button" aria-label={`Remove ${v}`} onClick={() => toggle(i, v)}><IconClose width={12} height={12} /></button></span>
                ))}
              </div>
            )}
            <div className="row">
              <input aria-label={`Add your own ${o.name || "option"} value`} className="input input-sm grow" placeholder={presetValues.length ? "Add your own value" : "Values, separated by commas"} maxLength={200} value={custom[i] ?? ""}
                onChange={(e) => setCustom({ ...custom, [i]: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCustom(i); } }} />
              <Button size="sm" onClick={() => addCustom(i)}>Add</Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
