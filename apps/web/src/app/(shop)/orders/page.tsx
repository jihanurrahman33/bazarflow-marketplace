"use client";
import { RequireAuth } from "@/components/guard";
import { OrderList } from "@/components/order-views";

export default function OrdersPage() {
  return <RequireAuth role="customer">{() => <div className="container page stack"><h1>Your orders</h1><OrderList /></div>}</RequireAuth>;
}
