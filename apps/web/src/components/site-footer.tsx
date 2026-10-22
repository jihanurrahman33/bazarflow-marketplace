import Link from "next/link";
import { getT } from "@/lib/i18n-server";
import { LanguageSwitch } from "./lang";
import type { NavCategory } from "./site-header";

export async function SiteFooter({ categories }: { categories: NavCategory[] }) {
  const t = await getT();
  return (
    <footer className="site-footer">
      <div className="container footer-grid">
        <div className="footer-about">
          <Link href="/" className="brand">Bazar<span>Flow</span></Link>
          <p>{t("Independent sellers, one checkout.")}</p>
          <LanguageSwitch />
        </div>
        <nav aria-label={t("Shop")}><h2>{t("Shop")}</h2><ul>
          {categories.slice(0, 6).map((c) => <li key={c.id}><Link href={`/category/${c.slug}`}>{c.name}</Link></li>)}
          <li><Link href="/categories">{t("All categories")}</Link></li>
          <li><Link href="/search?sort=newest">{t("New in")}</Link></li>
        </ul></nav>
        <nav aria-label={t("Sell")}><h2>{t("Sell")}</h2><ul>
          <li><Link href="/become-a-seller">{t("Become a seller")}</Link></li>
          <li><Link href="/vendor">{t("Seller console")}</Link></li>
        </ul></nav>
        <nav aria-label={t("Support")}><h2>{t("Support")}</h2><ul>
          <li><Link href="/help">{t("Help centre")}</Link></li>
          <li><Link href="/orders">{t("Track an order")}</Link></li>
          <li><Link href="/account">{t("My account")}</Link></li>
        </ul></nav>
      </div>
      <div className="container footer-base"><span>© {new Date().getFullYear()} BazarFlow</span><span>{t("Prices in BDT")}</span></div>
    </footer>
  );
}
