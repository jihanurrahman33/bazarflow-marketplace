import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ConsoleShell } from "@/components/console-kit";

export const metadata: Metadata = { title: { default: "Seller console", template: "%s · Seller console" }, robots: { index: false } };

export default function VendorLayout({ children }: { children: ReactNode }) {
  return (
    <ConsoleShell role="vendor" nav={[
      { href: "/vendor", label: "Overview", exact: true }, { href: "/vendor/orders", label: "Orders" }, { href: "/vendor/products", label: "Products" },
      { href: "/vendor/inventory", label: "Inventory" }, { href: "/vendor/payouts", label: "Earnings & payouts" }, { href: "/vendor/settings", label: "Store settings" },
    ]}>{children}</ConsoleShell>
  );
}
