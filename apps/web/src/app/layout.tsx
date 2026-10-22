import type { ReactNode } from "react";

export const metadata = { title: "BazarFlow", description: "Multi-vendor marketplace" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
