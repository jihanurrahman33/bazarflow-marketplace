"use client";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { LANG_COOKIE, makeT, type Locale, type T } from "@/lib/i18n";

interface LangApi { locale: Locale; t: T }
const Ctx = createContext<LangApi>({ locale: "en", t: makeT("en") });

/** Gives client components the language the server rendered the page in. */
export function LangProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const value = useMemo(() => ({ locale, t: makeT(locale) }), [locale]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useT = (): T => useContext(Ctx).t;
export const useLocale = (): Locale => useContext(Ctx).locale;

/** English / বাংলা. Saves the choice in a cookie and re-renders the page in that language. */
export function LanguageSwitch({ className }: { className?: string }) {
  const { locale } = useContext(Ctx);
  const router = useRouter();
  const pick = useCallback((next: Locale) => {
    if (next === locale) return;
    document.cookie = `${LANG_COOKIE}=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
    router.refresh();
  }, [locale, router]);
  return (
    <div className={className ?? "lang-switch"} role="group" aria-label="Language">
      <button type="button" lang="en" aria-pressed={locale === "en"} onClick={() => pick("en")}>English</button>
      <button type="button" lang="bn" aria-pressed={locale === "bn"} onClick={() => pick("bn")}>বাংলা</button>
    </div>
  );
}
