"use client";
import { use } from "react";
import { VendorOrderDetail } from "@/components/vendor-views";

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return <VendorOrderDetail id={use(params).id} />;
}
