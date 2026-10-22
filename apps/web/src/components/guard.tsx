"use client";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { useSession, type SessionUser } from "./providers";
import { Alert, ListSkeleton } from "./ui";

/** UI convenience only: the API authorises every request independently. */
export function RequireAuth({ role, permission, children }: { role?: SessionUser["role"]; permission?: string; children: (user: SessionUser) => ReactNode }) {
  const { user, status } = useSession();
  const router = useRouter();
  const path = usePathname();
  useEffect(() => {
    if (status === "ready" && !user) router.replace(`/login?next=${encodeURIComponent(path)}`);
  }, [status, user, router, path]);
  if (status === "loading" || !user) return <div className="container page"><ListSkeleton rows={3} /></div>;
  if ((role && user.role !== role) || (permission && !user.permissions.includes(permission))) {
    return <div className="container page"><Alert tone="warning" title="You don't have access to this page">Sign in with an account that has the right permissions.</Alert></div>;
  }
  return <>{children(user)}</>;
}
