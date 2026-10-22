import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const base = process.env.APP_ORIGIN ?? "http://localhost:3000";
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/cart", "/checkout", "/orders", "/account", "/vendor", "/admin", "/login", "/register"] }],
    sitemap: `${base}/sitemap.xml`,
  };
}
