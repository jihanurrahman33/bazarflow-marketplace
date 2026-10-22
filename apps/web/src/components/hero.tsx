"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { IconChevronLeft, IconChevronRight } from "./icons";
import { SmartImage } from "./smart-image";

export interface Slide { id: string; eyebrow: string; title: string; text: string; cta: string; href: string; image?: string; tone: "teal" | "indigo" | "amber" | "green" }

/** Auto-advancing banner carousel on native scroll-snap (swipe works for free). Autoplay pauses on hover/focus and honours reduced motion. */
export function HeroCarousel({ slides }: { slides: Slide[] }) {
  const track = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  const go = useCallback((i: number) => {
    const el = track.current;
    if (!el) return;
    const n = (i + slides.length) % slides.length;
    el.scrollTo({ left: n * el.clientWidth, behavior: "smooth" });
    setIndex(n);
  }, [slides.length]);

  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const onScroll = () => setIndex(Math.round(el.scrollLeft / el.clientWidth));
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (paused || slides.length < 2 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => go(index + 1), 6000);
    return () => clearInterval(t);
  }, [paused, index, go, slides.length]);

  return (
    <div className="hero" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={() => setPaused(false)} role="region" aria-roledescription="carousel" aria-label="Featured offers">
      <div className="hero-track" ref={track}>
        {slides.map((s, i) => (
          <article key={s.id} className={`hero-slide tone-${s.tone}`} aria-roledescription="slide" aria-label={`${i + 1} of ${slides.length}`}>
            <div className="hero-img"><SmartImage src={s.image} alt="" width={1600} height={640} priority={i === 0} /></div>
            <div className="hero-copy">
              <span className="hero-eyebrow">{s.eyebrow}</span>
              <h2>{s.title}</h2>
              <p>{s.text}</p>
              <Link href={s.href} className="btn btn-hero" tabIndex={i === index ? 0 : -1}>{s.cta} →</Link>
            </div>
          </article>
        ))}
      </div>
      {slides.length > 1 && (
        <>
          <button type="button" className="hero-arrow hero-prev" aria-label="Previous slide" onClick={() => go(index - 1)}><IconChevronLeft /></button>
          <button type="button" className="hero-arrow hero-next" aria-label="Next slide" onClick={() => go(index + 1)}><IconChevronRight /></button>
          <div className="hero-indicators">
            <div className="hero-counter" aria-hidden="true">
              <span>0{index + 1}</span> / 0{slides.length}
            </div>
            <div className="hero-dots" role="tablist" aria-label="Choose slide">
              {slides.map((s, i) => (
                <button
                  key={s.id}
                  type="button"
                  role="tab"
                  className={i === index ? "active" : ""}
                  aria-selected={i === index}
                  aria-label={`Slide ${i + 1}`}
                  onClick={() => go(i)}
                />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
