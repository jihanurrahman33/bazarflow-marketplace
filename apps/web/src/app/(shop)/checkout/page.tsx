"use client";
import { RequireAuth } from "@/components/guard";
import { CheckoutView } from "@/components/checkout-view";

export default function CheckoutPage() {
  return (
    <RequireAuth role="customer">
      {() => <div className="container page stack"><h1>Checkout</h1><CheckoutView /></div>}
    </RequireAuth>
  );
}
