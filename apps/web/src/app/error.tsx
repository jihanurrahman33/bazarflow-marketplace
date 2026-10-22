"use client";

import { Button } from "@/components/ui";

/** Last-resort boundary for unexpected render errors. Shows only the opaque digest, never the message or stack. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="container page stack" role="alert">
      <h1>Something went wrong</h1>
      <p className="muted">We couldn&apos;t show this page. Please try again.</p>
      {error.digest && <p className="muted small">Reference: <span className="mono">{error.digest}</span></p>}
      <div><Button variant="primary" onClick={reset}>Try again</Button></div>
    </div>
  );
}
