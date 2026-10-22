"use client";
import { RequireAuth } from "@/components/guard";
import { AccountView } from "@/components/account-view";

export default function AccountPage() {
  return <RequireAuth>{() => <div className="container page"><AccountView /></div>}</RequireAuth>;
}
