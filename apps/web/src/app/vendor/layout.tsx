import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ConsoleShell } from "@/components/console-kit";
import { IconBox, IconChart, IconChat, IconCoin, IconReceipt, IconSettings, IconStar, IconTag } from "@/components/icons";

export const metadata: Metadata = { title: { default: "Seller console", template: "%s · Seller console" }, robots: { index: false } };

export default function VendorLayout({ children }: { children: ReactNode }) {
  return (
    <ConsoleShell role="vendor" title="Seller console" nav={[
      { href: "/vendor", label: "Overview", exact: true, icon: <IconChart />, group: "Sell" },
      { href: "/vendor/orders", label: "Orders", icon: <IconReceipt />, group: "Sell" },
      { href: "/vendor/analytics", label: "Analytics", icon: <IconChart />, group: "Sell" },
      { href: "/vendor/products", label: "Products", icon: <IconTag />, group: "Catalogue" },
      { href: "/vendor/inventory", label: "Inventory", icon: <IconBox />, group: "Catalogue" },
      { href: "/vendor/coupons", label: "Coupons", icon: <IconTag />, group: "Catalogue" },
      { href: "/vendor/questions", label: "Questions", icon: <IconChat />, group: "Customers" },
      { href: "/vendor/reviews", label: "Reviews", icon: <IconStar />, group: "Customers" },
      { href: "/vendor/payouts", label: "Earnings & payouts", icon: <IconCoin />, group: "Money" },
      { href: "/vendor/settings", label: "Store settings", icon: <IconSettings />, group: "Store" },
    ]}>{children}</ConsoleShell>
  );
}
