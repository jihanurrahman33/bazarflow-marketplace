"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { SmartImage } from "./smart-image";
import { IconCart, IconChevronDown, IconChevronRight, IconClose, IconGrid, IconHome, IconMenu, IconReceipt, IconStore, IconUser } from "./icons";
import { HeaderSearch } from "./header-search";
import { useSession } from "./providers";
import { Button, cx } from "./ui";

export interface NavCategory { id: string; name: string; slug: string; image?: string; children: { id: string; name: string; slug: string }[] }

export function SiteHeader({ categories }: { categories: NavCategory[] }) {
  const { user, status, signOut, cartCount } = useSession();
  const path = usePathname();
  const [drawer, setDrawer] = useState(false);
  const [mega, setMega] = useState(false);
  const megaRef = useRef<HTMLDivElement>(null);
  const [activeCat, setActiveCat] = useState(0);
  const current = categories[activeCat] ?? categories[0];
  const isConsole = path.startsWith("/admin") || path.startsWith("/vendor");
  const consoleHref = user?.role === "admin" ? "/admin" : user?.role === "vendor" ? "/vendor" : null;
  const shopper = !user || user.role === "customer";

  useEffect(() => { setDrawer(false); setMega(false); }, [path]);
  useEffect(() => {
    if (!drawer && !mega) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { setDrawer(false); setMega(false); } };
    const outside = (e: MouseEvent) => { if (mega && megaRef.current && !megaRef.current.contains(e.target as Node)) setMega(false); };
    document.addEventListener("keydown", esc);
    document.addEventListener("mousedown", outside);
    document.body.style.overflow = drawer ? "hidden" : "";
    return () => { document.removeEventListener("keydown", esc); document.removeEventListener("mousedown", outside); document.body.style.overflow = ""; };
  }, [drawer, mega]);

  if (isConsole) {
    return (
      <header className="site-header site-header-compact">
        <div className="container bar">
          <Link href="/" className="brand">Bazar<span>Flow</span></Link>
          <nav className="nav" aria-label="Main">
            <Link href="/">Storefront</Link>
            {user && <Link href="/account">{user.name}</Link>}
            {user && <Button size="sm" variant="ghost" onClick={() => void signOut()}>Sign out</Button>}
          </nav>
        </div>
      </header>
    );
  }

  const signIn = `/login?next=${encodeURIComponent(path)}`;
  return (
    <>
      <header className="site-header">
        <div className="container bar">
          <button type="button" className="icon-btn menu-btn" aria-label="Open menu" aria-expanded={drawer} onClick={() => setDrawer(true)}><IconMenu /></button>
          <Link href="/" className="brand" aria-label="BazarFlow home">Bazar<span>Flow</span></Link>
          <HeaderSearch categories={categories} />
          <nav className="actions" aria-label="Account">
            {status === "loading" ? <span className="action skeleton" style={{ width: 84, height: 36 }} aria-hidden="true" /> : user ? (
              <>
                {consoleHref && <Link href={consoleHref} className="action action-hide-sm"><IconStore /><span className="action-text">{user.role === "admin" ? "Admin" : "My store"}</span></Link>}
                {user.role === "customer" && <Link href="/orders" className="action action-hide-sm"><IconReceipt /><span className="action-text">Orders</span></Link>}
                <Link href="/account" className="action"><IconUser /><span className="action-text">{user.name.split(" ")[0]}</span></Link>
              </>
            ) : (
              <Link href={signIn} className="action"><IconUser /><span className="action-text">Sign in</span></Link>
            )}
            {shopper && (
              <Link href="/cart" className="action cart-link" aria-label={`Cart${cartCount ? `, ${cartCount} items` : ""}`}>
                <IconCart /><span className="action-text">Cart</span>
                {cartCount > 0 && <span className="count-pill" aria-hidden="true">{cartCount > 99 ? "99+" : cartCount}</span>}
              </Link>
            )}
          </nav>
        </div>

        <nav className="catnav" aria-label="Categories">
          <div className="container catnav-in">
            <div className="mega" ref={megaRef}>
              <button type="button" className="mega-btn" aria-expanded={mega} aria-controls="mega-panel" onClick={() => setMega((v) => !v)}>
                <IconMenu width={18} height={18} /> All categories <IconChevronDown width={14} height={14} />
              </button>
              {mega && (
                <div id="mega-panel" className="mega-panel">
                  {!current ? <p className="muted">No categories yet.</p> : (
                    <>
                      <ul className="mega-list">
                        {categories.map((c, i) => (
                          <li key={c.id}>
                            <Link href={`/category/${c.slug}`} className={cx(i === activeCat && "on")} onMouseEnter={() => setActiveCat(i)} onFocus={() => setActiveCat(i)}>
                              {c.name}<IconChevronRight width={16} height={16} />
                            </Link>
                          </li>
                        ))}
                      </ul>
                      <div className="mega-detail">
                        <Link href={`/category/${current.slug}`} className="mega-visual" tabIndex={-1} aria-hidden="true">
                          <SmartImage src={current.image} alt="" width={640} height={400} />
                        </Link>
                        <div className="mega-info">
                          <h3>{current.name}</h3>
                          {current.children.length > 0 && <div className="mega-subs">{current.children.map((ch) => <Link key={ch.id} href={`/category/${ch.slug}`}>{ch.name}</Link>)}</div>}
                          <div className="mega-actions">
                            <Link href={`/category/${current.slug}`} className="btn btn-primary btn-sm">Shop {current.name}</Link>
                            <Link href={`/category/${current.slug}?sort=newest`} className="btn btn-sm">New in</Link>
                          </div>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
            <div className="catnav-links">
              {categories.map((c) => <Link key={c.id} href={`/category/${c.slug}`} aria-current={path === `/category/${c.slug}` ? "page" : undefined}>{c.name}</Link>)}
              <Link href="/search?sort=newest">New in</Link>
            </div>
            <div className="catnav-end">
              {shopper && <Link href="/become-a-seller">Sell on BazarFlow</Link>}
              <Link href="/help">Help</Link>
            </div>
          </div>
        </nav>
      </header>

      {drawer && (
        <div className="drawer-backdrop" onClick={() => setDrawer(false)}>
          <aside className="drawer" role="dialog" aria-modal="true" aria-label="Menu" onClick={(e) => e.stopPropagation()}>
            <div className="row-between drawer-head">
              <Link href="/" className="brand">Bazar<span>Flow</span></Link>
              <button type="button" className="icon-btn" aria-label="Close menu" onClick={() => setDrawer(false)} autoFocus><IconClose /></button>
            </div>
            {user ? <p className="muted">Signed in as <strong>{user.name}</strong></p> : <div className="row"><Link href={signIn} className="btn btn-primary">Sign in</Link><Link href="/register" className="btn">Create account</Link></div>}
            <h2 className="drawer-h">Shop by category</h2>
            <ul className="drawer-list">
              {categories.map((c) => <li key={c.id}><Link href={`/category/${c.slug}`}>{c.name}</Link></li>)}
              <li><Link href="/search?sort=newest">New arrivals</Link></li>
            </ul>
            <h2 className="drawer-h">More</h2>
            <ul className="drawer-list">
              {user?.role === "customer" && <li><Link href="/orders">My orders</Link></li>}
              {shopper && <li><Link href="/become-a-seller">Sell on BazarFlow</Link></li>}
              {consoleHref && <li><Link href={consoleHref}>{user?.role === "admin" ? "Admin console" : "Seller console"}</Link></li>}
              <li><Link href="/help">Help centre</Link></li>
              {user && <li><button type="button" className="linklike" onClick={() => void signOut()}>Sign out</button></li>}
            </ul>
          </aside>
        </div>
      )}

      {shopper && (
        <nav className="tabbar" aria-label="Primary">
          <Link href="/" className={cx(path === "/" && "on")} aria-current={path === "/" ? "page" : undefined}><IconHome /><span>Home</span></Link>
          <button type="button" onClick={() => setDrawer(true)}><IconGrid /><span>Categories</span></button>
          <Link href="/cart" className={cx(path === "/cart" && "on")}><span className="tab-ico"><IconCart />{cartCount > 0 && <i>{cartCount > 99 ? "99+" : cartCount}</i>}</span><span>Cart</span></Link>
          <Link href={user ? "/account" : signIn} className={cx(path.startsWith("/account") && "on")}><IconUser /><span>{user ? "Account" : "Sign in"}</span></Link>
        </nav>
      )}
    </>
  );
}
