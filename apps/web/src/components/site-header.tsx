"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { useSession } from "./providers";
import { Button } from "./ui";

export function SiteHeader() {
  const { user, status, signOut, cartCount } = useSession();
  const router = useRouter();
  const path = usePathname();
  const [q, setQ] = useState("");
  const consoleHref = user?.role === "admin" ? "/admin" : user?.role === "vendor" ? "/vendor" : null;
  const hideSearch = path.startsWith("/admin") || path.startsWith("/vendor");

  return (
    <header className="site-header">
      <div className="container bar">
        <Link href="/" className="brand">BazarFlow</Link>
        {!hideSearch && (
          <form className="search" role="search" onSubmit={(e) => { e.preventDefault(); if (q.trim().length >= 2) router.push(`/search?q=${encodeURIComponent(q.trim())}`); }}>
            <label htmlFor="site-search" className="sr-only">Search products</label>
            <input id="site-search" className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products" minLength={2} maxLength={100} />
            <Button type="submit" variant="primary">Search</Button>
          </form>
        )}
        <nav className="nav" aria-label="Main">
          {user?.role !== "vendor" && user?.role !== "admin" && <Link href="/become-a-seller">Sell</Link>}
          {(!user || user.role === "customer") && (
            <Link href="/cart" className="cart-link">Cart{cartCount > 0 && <span className="count-pill" aria-label={`${cartCount} items`}>{cartCount}</span>}</Link>
          )}
          {status === "loading" ? null : user ? (
            <>
              {consoleHref && <Link href={consoleHref}>{user.role === "admin" ? "Admin" : "Seller console"}</Link>}
              {user.role === "customer" && <Link href="/orders">Orders</Link>}
              <Link href="/account">{user.name.split(" ")[0]}</Link>
              <Button size="sm" variant="ghost" onClick={() => void signOut()}>Sign out</Button>
            </>
          ) : (
            <>
              <Link href={`/login?next=${encodeURIComponent(path)}`}>Sign in</Link>
              <Link href="/register" className="btn btn-primary btn-sm">Create account</Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
