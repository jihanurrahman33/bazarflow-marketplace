"use client";
import { use, Suspense } from "react";
import { RequireAuth } from "@/components/guard";
import { OrderDetail } from "@/components/order-views";

export default function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <RequireAuth role="customer">{() => <div className="container page"><Suspense><OrderDetail id={id} /></Suspense></div>}</RequireAuth>;
}
