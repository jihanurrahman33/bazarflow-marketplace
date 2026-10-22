"use client";
import { use } from "react";
import { ProductEditor } from "@/components/vendor-catalog-views";

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return <ProductEditor id={use(params).id} />;
}
