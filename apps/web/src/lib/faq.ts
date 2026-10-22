/** Approved help content. Rendered on /help and ingested as the support assistant's public knowledge base. */
export const FAQ: { id: string; q: string; a: string }[] = [
  { id: "payments", q: "How do I pay?", a: "Choose Pay online at checkout and finish on the payment provider's secure page, or choose Cash on delivery where it is offered. Your order is only confirmed after the provider confirms your payment — returning from the payment page alone does not confirm it." },
  { id: "payment-pending", q: "My payment is pending. Should I pay again?", a: "No. If the status says pending or being confirmed, wait a moment and use Check status on your order page. Paying again can charge you twice. If a duplicate payment does happen, it is refunded automatically." },
  { id: "shipping", q: "How is shipping charged and delivered?", a: "Each seller ships their own items, so one order can arrive in several parcels. Shipping is calculated per seller and shown before you pay. Tracking appears on your order page once a seller ships." },
  { id: "cancel", q: "Can I cancel an order?", a: "Yes, until a seller starts working on it. Orders waiting for payment can always be cancelled. Paid orders cancelled before a seller accepts them are refunded in full." },
  { id: "returns", q: "How do returns work?", a: "Within 7 days of delivery you can request a return from your order page. The seller reviews the request; once accepted, the refund goes to finance for approval and is returned to your original payment method." },
  { id: "refunds", q: "When will I get my refund?", a: "Refunds are sent to the original payment method as soon as they are approved. Your bank or mobile wallet may take a few more days to show them." },
  { id: "sellers", q: "How do I become a seller?", a: "Create an account, verify your email and submit a store application. After approval you can list products, manage stock and orders, and request payouts of your available balance." },
  { id: "payouts", q: "When do sellers get paid?", a: "Earnings from an order become available a few days after delivery, then sellers can request a payout. Refunds reduce the balance." },
];
