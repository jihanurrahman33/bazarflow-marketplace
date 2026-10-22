import type { Metadata } from "next";
import { Suspense } from "react";
import { ForgotPasswordForm } from "@/components/auth-forms";

export const metadata: Metadata = { title: "forgot password", robots: { index: false } };

export default function Page() {
  return <Suspense><ForgotPasswordForm /></Suspense>;
}
