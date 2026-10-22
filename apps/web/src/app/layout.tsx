import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Inter, Noto_Sans_Bengali } from "next/font/google";
import { Suspense } from "react";
import "./globals.css";
import "./storefront.css";
import { Providers } from "@/components/providers";
import { WishlistProvider } from "@/components/wishlist";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { CATEGORY_BANNER, siteImage } from "@/lib/site";
import { TopProgress } from "@/components/top-progress";
import { getCategories } from "@/lib/server-data";
import { LangProvider } from "@/components/lang";
import { getLocale, getT } from "@/lib/i18n-server";

// Rendered per request: the category bar reads the database and must never be prerendered at build time.
export const dynamic = "force-dynamic";

const inter = Inter({ subsets: ["latin"], display: "swap", variable: "--font-sans" });
const bengali = Noto_Sans_Bengali({ subsets: ["bengali"], display: "swap", variable: "--font-bn", weight: ["400", "500", "600", "700"] });

export const metadata: Metadata = {
  title: { default: "BazarFlow — shop from trusted sellers", template: "%s · BazarFlow" },
  description: "A multi-vendor marketplace: discover products from independent sellers, pay securely and track every order.",
  metadataBase: new URL(process.env.APP_ORIGIN ?? "http://localhost:3000"),
  openGraph: { siteName: "BazarFlow", type: "website" },
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/favicon.ico", sizes: "32x32" },
    ],
    shortcut: "/favicon.ico",
    apple: "/icon.svg",
  },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export default async function RootLayout({ children }: { children: ReactNode }) {
  const [cats, locale, t] = await Promise.all([getCategories(), getLocale(), getT()]);
  const navCats = cats.ok ? cats.value.map((c) => ({ ...c, image: CATEGORY_BANNER[c.slug] ? siteImage(CATEGORY_BANNER[c.slug]!, { w: 640, h: 400 }) : undefined })) : [];
  return (
    <html lang={locale} className={`${inter.variable} ${bengali.variable}`}>
      <body>
        <a href="#main" className="skip-link">{t("Skip to content")}</a>
        <LangProvider locale={locale}>
        <Providers>
          <WishlistProvider>
          <Suspense fallback={null}><TopProgress /></Suspense>
          <SiteHeader categories={navCats} />
          <main id="main">{children}</main>
          <SiteFooter categories={cats.ok ? cats.value : []} />
        </WishlistProvider>
        </Providers>
        </LangProvider>
      </body>
    </html>
  );
}
