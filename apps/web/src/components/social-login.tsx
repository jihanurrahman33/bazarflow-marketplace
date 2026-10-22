"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, messageFor } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { useSession } from "./providers";
import { Alert } from "./ui";

interface SocialConfig {
  enabled: boolean;
  providers: string[];
  firebase?: { apiKey: string; authDomain: string; projectId: string; appId?: string };
}

const LABEL: Record<string, string> = { "google.com": "Google", "apple.com": "Apple", "facebook.com": "Facebook" };

const Icon = ({ id }: { id: string }) => {
  if (id === "google.com") return <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" /><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z" /><path fill="#FBBC05" d="M10.5 28.7a14.5 14.5 0 0 1 0-9.4l-7.9-6.1a24 24 0 0 0 0 21.6l7.9-6.1z" /><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.8 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z" /></svg>;
  if (id === "apple.com") return <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16.4 12.6c0-2.3 1.9-3.4 2-3.5-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.1-2.8.9-3.5.9-.7 0-1.8-.8-3-.8-1.5 0-3 .9-3.8 2.3-1.6 2.8-.4 7 1.2 9.3.8 1.1 1.7 2.4 2.9 2.3 1.2 0 1.6-.7 3-.7s1.8.7 3 .7c1.3 0 2.1-1.1 2.8-2.2.9-1.3 1.2-2.5 1.3-2.6-.1 0-2.5-1-2.5-3.9zM14.1 5.8c.6-.8 1.1-1.8.9-2.8-.9 0-2 .6-2.7 1.4-.6.7-1.1 1.8-1 2.7 1 .1 2-.5 2.8-1.3z" /></svg>;
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="#1877F2" aria-hidden="true"><path d="M24 12a12 12 0 1 0-13.9 11.9v-8.4H7.1V12h3V9.4c0-3 1.8-4.7 4.5-4.7 1.3 0 2.7.2 2.7.2v3h-1.5c-1.5 0-2 .9-2 1.9V12h3.4l-.5 3.5h-2.9v8.4A12 12 0 0 0 24 12z" /></svg>;
};

/**
 * "Continue with Google / Apple / Facebook". The Firebase SDK is loaded only when someone clicks, and is used just to get an
 * ID token; our server verifies that token and issues the real session. Renders nothing until Firebase is configured.
 */
export function SocialLogin({ next }: { next: string }) {
  const cfg = useApi<SocialConfig>("/auth/social/config");
  const { refresh } = useSession();
  const router = useRouter();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  if (!cfg.data?.enabled || !cfg.data.firebase || cfg.data.providers.length === 0) return null;
  const { firebase, providers } = cfg.data;

  const start = async (providerId: string) => {
    setBusy(providerId);
    setError(undefined);
    try {
      const [{ getApp, getApps, initializeApp }, auth] = await Promise.all([import("firebase/app"), import("firebase/auth")]);
      const app = getApps().length ? getApp() : initializeApp(firebase);
      const fbAuth = auth.getAuth(app);
      const provider = providerId === "google.com" ? new auth.GoogleAuthProvider() : providerId === "facebook.com" ? new auth.FacebookAuthProvider() : new auth.OAuthProvider("apple.com");
      if (providerId === "apple.com") { provider.addScope("email"); provider.addScope("name"); }
      if (providerId === "facebook.com") provider.addScope("email");
      const cred = await auth.signInWithPopup(fbAuth, provider);
      const idToken = await cred.user.getIdToken();
      await auth.signOut(fbAuth); // we only needed the token; our own session takes over from here
      await api("/auth/social", { method: "POST", body: { idToken, device: { platform: "web" }, transport: "cookie" } });
      await refresh();
      router.push(next);
      router.refresh();
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") return; // they changed their mind
      if (code === "auth/popup-blocked") setError("Your browser blocked the sign-in window. Allow pop-ups for this site and try again.");
      else if (code === "auth/account-exists-with-different-credential") setError("An account with this email already exists. Sign in with your original method.");
      else if (code?.startsWith("auth/")) setError("We couldn't complete that sign-in. Please try again or use your email and password.");
      else setError(messageFor(e));
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <div className="social stack-sm">
      <div className="social-divider" role="separator"><span>or continue with</span></div>
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="social-buttons">
        {providers.map((p) => (
          <button key={p} type="button" className="btn btn-social" disabled={!!busy} aria-busy={busy === p || undefined} onClick={() => void start(p)}>
            {busy === p ? <span className="spinner" aria-hidden="true" /> : <Icon id={p} />}
            <span>{LABEL[p] ?? p}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
