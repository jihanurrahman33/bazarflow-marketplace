import type { Metadata } from "next";
import { SellerApplication } from "@/components/seller-application";

export const metadata: Metadata = { title: "Sell on BazarFlow", description: "Open a store, list your products and reach customers across Bangladesh." };

export default function BecomeASeller() {
  return (
    <div className="container page stack" style={{ maxWidth: 760 }}>
      <h1>Sell on BazarFlow</h1>
      <p className="muted">Apply to open a store. After approval you can add products, manage stock and orders, and receive payouts. Applications are reviewed by our team.</p>
      <SellerApplication />
    </div>
  );
}
