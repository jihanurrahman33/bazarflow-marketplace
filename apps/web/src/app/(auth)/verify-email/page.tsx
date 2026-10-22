import type { Metadata } from "next";
import { Suspense } from "react";
import { VerifyEmailForm } from "@/components/auth-forms";

export const metadata: Metadata = { title: "verify email", robots: { index: false } };

export default function Page() {
  return <Suspense><VerifyEmailForm /></Suspense>;
}
