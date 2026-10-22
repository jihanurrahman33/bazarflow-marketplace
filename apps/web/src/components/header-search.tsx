"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { api } from "@/lib/api";
import { formatMoneyShort } from "@/lib/format";
import { IconClose, IconSearch } from "./icons";
import { useT } from "./lang";
import { SmartImage } from "./smart-image";
import { announceNavigation } from "./top-progress";

interface Hit { id: string; slug: string; title: string; image?: string; minPriceMinor: number; currency: string }
const RECENT_KEY = "bf.recent-searches";
const readRecent = (): string[] => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as string[]; } catch { return []; } };
const saveRecent = (q: string) => { try { localStorage.setItem(RECENT_KEY, JSON.stringify([q, ...readRecent().filter((x) => x !== q)].slice(0, 5))); } catch { /* storage unavailable: recents are a convenience */ } };

/** Search with live product suggestions, recent searches and full keyboard support (arrows, Enter, Escape). */
export function HeaderSearch({ categories }: { categories: { slug: string; name: string }[] }) {
  const t = useT();
  const router = useRouter();
  const listId = useId();
  const box = useRef<HTMLDivElement>(null);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [hits, setHits] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const [active, setActive] = useState(-1);
  const term = q.trim();

  useEffect(() => {
    if (term.length < 2) { setHits([]); setLoading(false); return; }
    setLoading(true);
    const ctl = new AbortController();
    const t = setTimeout(() => {
      api<Hit[]>(`/products?q=${encodeURIComponent(term)}&limit=6`, { signal: ctl.signal })
        .then((r) => { setHits(r.data); setActive(-1); })
        .catch(() => undefined)
        .finally(() => setLoading(false));
    }, 200);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [term]);

  useEffect(() => {
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, []);

  const go = (to: string, remember?: string) => {
    if (remember) saveRecent(remember);
    setOpen(false);
    announceNavigation();
    router.push(to);
  };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (active >= 0 && hits[active]) return go(`/products/${hits[active]!.slug}`);
    if (term.length >= 2) go(`/search?q=${encodeURIComponent(term)}`, term);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") setOpen(false);
    else if (e.key === "ArrowDown" && hits.length) { e.preventDefault(); setActive((a) => (a + 1) % hits.length); }
    else if (e.key === "ArrowUp" && hits.length) { e.preventDefault(); setActive((a) => (a <= 0 ? hits.length - 1 : a - 1)); }
  };
  const showPanel = open && (term.length >= 2 || recent.length > 0);

  return (
    <div className="hsearch" ref={box}>
      <form role="search" onSubmit={submit} onKeyDown={onKey}>
        <IconSearch className="hsearch-icon" />
        <label htmlFor="site-search" className="sr-only">{t("Search products")}</label>
        <input
          id="site-search" type="search" value={q} placeholder={t("Search products")} maxLength={100} autoComplete="off" role="combobox"
          aria-expanded={showPanel} aria-controls={listId} aria-autocomplete="list" aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => { setRecent(readRecent()); setOpen(true); }}
        />
        {q && <button type="button" className="hsearch-clear" aria-label={t("Clear search")} onClick={() => { setQ(""); setHits([]); }}><IconClose width={16} height={16} /></button>}
      </form>
      {showPanel && (
        <div className="hsearch-panel" id={listId} role="listbox">
          {term.length < 2 ? (
            <>
              <div className="hsearch-label">{t("Recent searches")}</div>
              {recent.map((r) => <button key={r} type="button" role="option" aria-selected="false" className="hsearch-row" onClick={() => go(`/search?q=${encodeURIComponent(r)}`, r)}><IconSearch width={16} height={16} />{r}</button>)}
              {categories.length > 0 && <div className="hsearch-label">{t("Browse")}</div>}
              <div className="hsearch-chips">{categories.slice(0, 8).map((c) => <Link key={c.slug} href={`/category/${c.slug}`} className="chip">{c.name}</Link>)}</div>
            </>
          ) : (
            <>
              {loading && hits.length === 0 && <div className="hsearch-empty">{t("Searching…")}</div>}
              {!loading && hits.length === 0 && <div className="hsearch-empty">{t("No matches for “{q}”. Try a different word.", { q: term })}</div>}
              {hits.map((h, i) => (
                <Link key={h.id} id={`${listId}-${i}`} role="option" aria-selected={i === active} href={`/products/${h.slug}`} className={`hsearch-hit ${i === active ? "is-active" : ""}`} onClick={() => { saveRecent(term); setOpen(false); }}>
                  <span className="hsearch-thumb"><SmartImage src={h.image} alt="" width={96} height={96} /></span>
                  <span className="hsearch-title">{h.title}</span>
                  <span className="hsearch-price">{formatMoneyShort(h.minPriceMinor, h.currency)}</span>
                </Link>
              ))}
              {hits.length > 0 && <button type="button" className="hsearch-all" onClick={() => go(`/search?q=${encodeURIComponent(term)}`, term)}>{t("See all results for “{q}”", { q: term })}</button>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
