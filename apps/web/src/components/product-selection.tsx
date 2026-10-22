"use client";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

interface Selection {
  chosen: Record<string, string>;
  /** The option value picked most recently, so the gallery can jump to its photo. */
  last: { name: string; value: string } | null;
  choose: (name: string, value: string) => void;
}
const Ctx = createContext<Selection | null>(null);

/** Shares the shopper's option choices (Colour, Size...) between the buy box and the photo gallery. */
export function ProductSelection({ children }: { children: ReactNode }) {
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [last, setLast] = useState<Selection["last"]>(null);
  const choose = useCallback((name: string, value: string) => {
    setChosen((c) => ({ ...c, [name]: value }));
    setLast(value ? { name, value } : null);
  }, []);
  const value = useMemo(() => ({ chosen, last, choose }), [chosen, last, choose]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useSelection = (): Selection | null => useContext(Ctx);
