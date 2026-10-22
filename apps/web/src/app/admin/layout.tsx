import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ConsoleShell } from "@/components/console-kit";
import { IconAlert, IconBox, IconCard, IconChart, IconCoin, IconReceipt, IconRefund, IconShieldLock, IconStore, IconTag, IconUsers } from "@/components/icons";

export const metadata: Metadata = { title: { default: "Admin", template: "%s · Admin" }, robots: { index: false } };

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <ConsoleShell role="admin" title="Administrator" nav={[
      { href: "/admin", label: "Overview", exact: true, icon: <IconChart />, group: "Dashboard" },
      { href: "/admin/orders", label: "Orders", icon: <IconReceipt />, group: "Marketplace" },
      { href: "/admin/applications", label: "Seller applications", icon: <IconStore />, group: "Marketplace" },
      { href: "/admin/vendors", label: "Sellers", icon: <IconUsers />, group: "Marketplace" },
      { href: "/admin/products", label: "Product review", icon: <IconTag />, group: "Marketplace" },
      { href: "/admin/categories", label: "Categories", icon: <IconBox />, group: "Marketplace" },
      { href: "/admin/payments", label: "Payment exceptions", icon: <IconAlert />, group: "Money" },
      { href: "/admin/refunds", label: "Refunds", icon: <IconRefund />, group: "Money" },
      { href: "/admin/payouts", label: "Payouts", icon: <IconCoin />, group: "Money" },
      { href: "/admin/users", label: "Users", icon: <IconCard />, group: "Security" },
      { href: "/admin/audit", label: "Activity & audit log", icon: <IconShieldLock />, group: "Security" },
    ]}>{children}</ConsoleShell>
  );
}
