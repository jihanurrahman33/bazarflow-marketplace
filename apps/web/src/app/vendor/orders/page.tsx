"use client";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { VendorOrders } from "@/components/vendor-views";

function Inner() {
  return <VendorOrders initialStatus={useSearchParams().get("status") ?? ""} />;
}
export default function Page() {
  return <Suspense><Inner /></Suspense>;
}
