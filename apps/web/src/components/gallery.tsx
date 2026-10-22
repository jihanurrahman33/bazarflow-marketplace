"use client";
import { useState } from "react";

export function Gallery({ media, title }: { media: { url: string; width?: number; height?: number }[]; title: string }) {
  const [i, setI] = useState(0);
  if (media.length === 0) return <div className="gallery"><div className="main" role="img" aria-label="No image available" /></div>;
  const current = media[Math.min(i, media.length - 1)]!;
  return (
    <div className="gallery">
      <div className="main"><img src={current.url} alt={`${title} — image ${i + 1} of ${media.length}`} width={current.width ?? 1080} height={current.height ?? 1080} /></div>
      {media.length > 1 && (
        <div className="thumbs" role="group" aria-label="Product images">
          {media.map((m, idx) => <button key={m.url} type="button" aria-pressed={idx === i} aria-label={`Show image ${idx + 1}`} onClick={() => setI(idx)}><img src={m.url} alt="" loading="lazy" /></button>)}
        </div>
      )}
    </div>
  );
}
