import type { Metadata, Viewport } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import "./globals.css";
import { Providers } from "@/components/providers";
import { SiteHeader } from "@/components/site-header";
import { getCategories } from "@/lib/server-data";

// Rendered per request: the category bar reads the database and must never be prerendered at build time.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: "BazarFlow — shop from trusted sellers", template: "%s · BazarFlow" },
  description: "A multi-vendor marketplace: discover products from independent sellers, pay securely and track every order.",
  metadataBase: new URL(process.env.APP_ORIGIN ?? "http://localhost:3000"),
  openGraph: { siteName: "BazarFlow", type: "website" },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export default async function RootLayout({ children }: { children: ReactNode }) {
  const cats = await getCategories();
  return (
    <html lang="en">
      <body>
        <a href="#main" className="skip-link">Skip to content</a>
        <Providers>
          <SiteHeader />
          {cats.ok && cats.value.length > 0 && (
            <nav className="category-bar" aria-label="Categories">
              <div className="container">
                {cats.value.map((c) => <Link key={c.id} href={`/category/${c.slug}`}>{c.name}</Link>)}
              </div>
            </nav>
          )}
          <main id="main">{children}</main>
          <footer className="site-footer">
            <div className="container row-between">
              <span>© {new Date().getFullYear()} BazarFlow</span>
              <span className="row"><Link href="/become-a-seller">Sell on BazarFlow</Link><Link href="/help">Help</Link></span>
            </div>
          </footer>
        </Providers>
      </body>
    </html>
  );
}
