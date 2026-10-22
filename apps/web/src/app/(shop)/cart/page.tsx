"use client";
import { RequireAuth } from "@/components/guard";
import { CartView } from "@/components/cart-view";

export default function CartPage() {
  return (
    <RequireAuth role="customer">
      {() => <div className="container page stack"><h1>Your cart</h1><CartView /></div>}
    </RequireAuth>
  );
}
