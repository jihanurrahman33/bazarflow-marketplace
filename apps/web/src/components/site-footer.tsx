import Link from "next/link";
import { IconHeadset, IconReturn, IconShield, IconTruck } from "./icons";
import type { NavCategory } from "./site-header";

export function SiteFooter({ categories }: { categories: NavCategory[] }) {
  return (
    <footer className="site-footer">
      <div className="footer-perks"><div className="container perks">
        <div><IconShield /><span><strong>Secure payments</strong><small>Verified before your order is confirmed</small></span></div>
        <div><IconTruck /><span><strong>Tracked delivery</strong><small>Follow every seller&apos;s shipment</small></span></div>
        <div><IconReturn /><span><strong>Easy returns</strong><small>Request a return from your order page</small></span></div>
        <div><IconHeadset /><span><strong>Help when you need it</strong><small>Answers in our help centre</small></span></div>
      </div></div>
      <div className="container footer-cols">
        <div className="footer-about">
          <Link href="/" className="brand">Bazar<span>Flow</span></Link>
          <p>A marketplace for independent sellers. Pay securely, track every shipment, and get your money back when something goes wrong.</p>
        </div>
        <nav aria-label="Shop"><h2>Shop</h2><ul>
          {categories.map((c) => <li key={c.id}><Link href={`/category/${c.slug}`}>{c.name}</Link></li>)}
          <li><Link href="/search?sort=newest">New arrivals</Link></li>
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
      <div className="footer-base"><div className="container row-between"><span>© {new Date().getFullYear()} BazarFlow. All rights reserved.</span><span className="muted">Prices in BDT</span></div></div>
    </footer>
  );
}
