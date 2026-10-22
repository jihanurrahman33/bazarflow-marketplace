"use client";
import { use } from "react";
import { OrderAdminDetail } from "@/components/admin-views";

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return <OrderAdminDetail id={use(params).id} />;
}
