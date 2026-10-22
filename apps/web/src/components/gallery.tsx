"use client";
import { useEffect, useRef, useState } from "react";
import { useSelection } from "./product-selection";
import { SmartImage } from "./smart-image";

/** Product gallery: thumbnails, and a hover-zoom on mouse devices (touch users just see the full image). */
export function Gallery({ media, title }: { media: { url: string; width?: number; height?: number; forOption?: { name: string; value: string } }[]; title: string }) {
  const [i, setI] = useState(0);
  const last = useSelection()?.last;
  // Picking an option value (say Colour: Black) shows the first photo the seller tied to it.
  useEffect(() => {
    if (!last) return;
    const idx = media.findIndex((m) => m.forOption?.name === last.name && m.forOption.value === last.value);
    if (idx >= 0) setI(idx);
  }, [last, media]);
  const zoom = useRef<HTMLDivElement>(null);
  if (media.length === 0) return <div className="gallery"><div className="main"><SmartImage alt="No image available" width={1080} height={1080} /></div></div>;
  const current = media[Math.min(i, media.length - 1)]!;
  const move = (e: React.MouseEvent) => {
    const el = zoom.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--zx", `${((e.clientX - r.left) / r.width) * 100}%`);
    el.style.setProperty("--zy", `${((e.clientY - r.top) / r.height) * 100}%`);
  };
  return (
    <div className="gallery">
      <div className="main zoomable" ref={zoom} onMouseMove={move}>
        <SmartImage key={current.url} src={current.url} alt={`${title} — image ${i + 1} of ${media.length}`} width={current.width ?? 1080} height={current.height ?? 1080} fit="contain" priority />
      </div>
      {media.length > 1 && (
        <div className="thumbs" role="group" aria-label="Product images">
          {media.map((m, idx) => <button key={m.url} type="button" aria-pressed={idx === i} aria-label={`Show image ${idx + 1}`} onClick={() => setI(idx)}><SmartImage src={m.url} alt="" width={64} height={64} /></button>)}
        </div>
      )}
    </div>
  );
}
