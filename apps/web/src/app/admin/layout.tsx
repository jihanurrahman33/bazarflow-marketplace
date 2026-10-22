import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ConsoleShell } from "@/components/console-kit";

export const metadata: Metadata = { title: { default: "Admin", template: "%s · Admin" }, robots: { index: false } };

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <ConsoleShell role="admin" nav={[
      { href: "/admin", label: "Overview", exact: true }, { href: "/admin/applications", label: "Seller applications" }, { href: "/admin/vendors", label: "Sellers" },
      { href: "/admin/products", label: "Product review" }, { href: "/admin/orders", label: "Orders" }, { href: "/admin/payments", label: "Payment exceptions" },
      { href: "/admin/refunds", label: "Refunds" }, { href: "/admin/payouts", label: "Payouts" }, { href: "/admin/users", label: "Users" },
      { href: "/admin/categories", label: "Categories" }, { href: "/admin/audit", label: "Audit log" },
    ]}>{children}</ConsoleShell>
  );
}
