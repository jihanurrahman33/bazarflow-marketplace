import Link from "next/link";
import type { NavCategory } from "./site-header";

export function SiteFooter({ categories }: { categories: NavCategory[] }) {
  return (
    <footer className="site-footer">
      <div className="container footer-grid">
        <div className="footer-about">
          <Link href="/" className="brand">Bazar<span>Flow</span></Link>
          <p>Independent sellers, one checkout.</p>
        </div>
        <nav aria-label="Shop"><h2>Shop</h2><ul>
          {categories.map((c) => <li key={c.id}><Link href={`/category/${c.slug}`}>{c.name}</Link></li>)}
          <li><Link href="/search?sort=newest">New in</Link></li>
        </ul></nav>
        <nav aria-label="Sell"><h2>Sell</h2><ul>
          <li><Link href="/become-a-seller">Become a seller</Link></li>
          <li><Link href="/vendor">Seller console</Link></li>
        </ul></nav>
        <nav aria-label="Support"><h2>Support</h2><ul>
          <li><Link href="/help">Help centre</Link></li>
          <li><Link href="/orders">Track an order</Link></li>
          <li><Link href="/account">My account</Link></li>
        </ul></nav>
      </div>
      <div className="container footer-base"><span>© {new Date().getFullYear()} BazarFlow</span><span>Prices in BDT</span></div>
    </footer>
  );
}
