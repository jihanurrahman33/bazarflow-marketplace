import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return <div className="container page" style={{ maxWidth: 440 }}><div className="card">{children}</div></div>;
}
