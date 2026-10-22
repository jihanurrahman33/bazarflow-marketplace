"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, ApiError, messageFor, setStepUpHandler } from "@/lib/api";
import { Alert, Button, Dialog, Field } from "./ui";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: "customer" | "vendor" | "admin";
  permissions: string[];
  vendorId?: string;
  emailVerified: boolean;
}

interface SessionState {
  user: SessionUser | null;
  /** "loading" only before the first answer; afterwards stale-while-revalidate. */
  status: "loading" | "ready";
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
  cartCount: number;
  setCartCount: (n: number) => void;
}

const SessionCtx = createContext<SessionState | null>(null);
export const useSession = (): SessionState => {
  const v = useContext(SessionCtx);
  if (!v) throw new Error("useSession outside <Providers>");
  return v;
};

interface Toast { id: number; text: string; tone: "info" | "danger" }
interface ToastApi { toast: (text: string, tone?: Toast["tone"]) => void }
const ToastCtx = createContext<ToastApi>({ toast: () => undefined });
export const useToast = (): ToastApi => useContext(ToastCtx);

export function Providers({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [status, setStatus] = useState<"loading" | "ready">("loading");
  const [cartCount, setCartCount] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [online, setOnline] = useState(true);
  const [stepUp, setStepUp] = useState<{ resolve: (ok: boolean) => void } | null>(null);
  const [suPassword, setSuPassword] = useState("");
  const [suError, setSuError] = useState<string>();
  const [suPending, setSuPending] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const { data } = await api<SessionUser>("/me");
      setUser(data);
      if (data.role === "customer") api<{ itemCount: number }>("/cart").then((r) => setCartCount(r.data.itemCount)).catch(() => undefined);
    } catch (e) {
      if (!(e instanceof ApiError) || e.status === 401) setUser(null);
    } finally {
      setStatus("ready");
    }
  }, []);

  const signOut = useCallback(async () => {
    await api("/auth/logout", { method: "POST", body: {} }).catch(() => undefined);
    setUser(null);
    setCartCount(0);
    window.location.assign("/");
  }, []);

  useEffect(() => {
    void refresh();
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    setOnline(navigator.onLine);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, [refresh]);

  useEffect(() => {
    setStepUpHandler(() => new Promise<boolean>((resolve) => { setSuPassword(""); setSuError(undefined); setStepUp({ resolve }); }));
    return () => setStepUpHandler(null);
  }, []);
  const submitStepUp = async () => {
    setSuPending(true);
    setSuError(undefined);
    try {
      await api("/auth/step-up", { method: "POST", body: { password: suPassword } });
      stepUp?.resolve(true);
      setStepUp(null);
    } catch (e) {
      setSuError(messageFor(e));
    } finally {
      setSuPending(false);
    }
  };
  const cancelStepUp = () => { stepUp?.resolve(false); setStepUp(null); };

  const toast = useCallback((text: string, tone: Toast["tone"] = "info") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);

  const value = useMemo(() => ({ user, status, refresh, signOut, cartCount, setCartCount }), [user, status, refresh, signOut, cartCount]);
  const toastValue = useMemo(() => ({ toast }), [toast]);

  return (
    <SessionCtx.Provider value={value}>
      <ToastCtx.Provider value={toastValue}>
        {!online && <div className="offline-banner" role="status">You are offline. Changes will not be saved until you reconnect.</div>}
        {children}
        <Dialog open={!!stepUp} onClose={cancelStepUp} title="Confirm your password">
          <form className="stack" onSubmit={(e) => { e.preventDefault(); void submitStepUp(); }}>
            <p className="muted">This action moves money or changes settings, so we need you to confirm it&apos;s really you.</p>
            {suError && <Alert tone="danger">{suError}</Alert>}
            <Field label="Password">{(p) => <input {...p} className="input" type="password" autoComplete="current-password" autoFocus required value={suPassword} onChange={(e) => setSuPassword(e.target.value)} />}</Field>
            <div className="row" style={{ justifyContent: "flex-end" }}><Button onClick={cancelStepUp} disabled={suPending}>Cancel</Button><Button type="submit" variant="primary" loading={suPending}>Confirm</Button></div>
          </form>
        </Dialog>
        <div className="toasts" role="status" aria-live="polite">
          {toasts.map((t) => <div key={t.id} className={`toast ${t.tone === "danger" ? "toast-danger" : ""}`}>{t.text}</div>)}
        </div>
      </ToastCtx.Provider>
    </SessionCtx.Provider>
  );
}
