"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { api, messageFor } from "@/lib/api";
import { useAction } from "@/lib/hooks";
import { safeNext } from "@/lib/nav";
import { useSession } from "./providers";
import { SocialLogin } from "./social-login";
import { Alert, Button, Field, fieldMessage } from "./ui";

const device = { platform: "web" as const };

export function LoginForm() {
  const { refresh } = useSession();
  const router = useRouter();
  const next = safeNext(useSearchParams().get("next"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const login = useAction(async () => {
    await api("/auth/login", { method: "POST", body: { email, password, device, transport: "cookie" } });
    await refresh();
    router.push(next);
    router.refresh();
  });
  const submit = (e: FormEvent) => { e.preventDefault(); void login.run(); };
  return (
    <form onSubmit={submit} className="stack" noValidate>
      <h1>Sign in</h1>
      {login.error && <Alert tone="danger">{messageFor(login.error)}</Alert>}
      <Field label="Email" error={fieldMessage(login.error, "email")}>{(p) => <input {...p} className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
      <Field label="Password" error={fieldMessage(login.error, "password")}>{(p) => <input {...p} className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />}</Field>
      <Button type="submit" variant="primary" loading={login.pending} block>Sign in</Button>
      <SocialLogin next={next} />
      <div className="row-between small"><Link href="/forgot-password">Forgot password?</Link><Link href={`/register?next=${encodeURIComponent(next)}`}>Create an account</Link></div>
    </form>
  );
}

export function RegisterForm() {
  const { refresh } = useSession();
  const router = useRouter();
  const next = safeNext(useSearchParams().get("next"));
  const [f, setF] = useState({ name: "", email: "", password: "", phone: "" });
  const reg = useAction(async () => {
    await api("/auth/register", { method: "POST", body: { name: f.name, email: f.email, password: f.password, ...(f.phone ? { phone: f.phone } : {}), device, transport: "cookie" } });
    await refresh();
    router.push(`/verify-email?next=${encodeURIComponent(next)}`);
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  return (
    <form onSubmit={(e) => { e.preventDefault(); void reg.run(); }} className="stack" noValidate>
      <h1>Create your account</h1>
      {reg.error && <Alert tone="danger">{messageFor(reg.error)}</Alert>}
      <Field label="Full name" error={fieldMessage(reg.error, "name")}>{(p) => <input {...p} className="input" autoComplete="name" required value={f.name} onChange={set("name")} />}</Field>
      <Field label="Email" error={fieldMessage(reg.error, "email")}>{(p) => <input {...p} className="input" type="email" autoComplete="email" required value={f.email} onChange={set("email")} />}</Field>
      <Field label="Mobile number (optional)" hint="Used for delivery updates." error={fieldMessage(reg.error, "phone")}>{(p) => <input {...p} className="input" type="tel" inputMode="tel" autoComplete="tel" placeholder="+8801…" value={f.phone} onChange={set("phone")} />}</Field>
      <Field label="Password" hint="At least 10 characters." error={fieldMessage(reg.error, "password")}>{(p) => <input {...p} className="input" type="password" autoComplete="new-password" required minLength={10} value={f.password} onChange={set("password")} />}</Field>
      <Button type="submit" variant="primary" loading={reg.pending} block>Create account</Button>
      <SocialLogin next={next} />
      <p className="small muted center">Already have an account? <Link href="/login">Sign in</Link></p>
    </form>
  );
}

export function VerifyEmailForm() {
  const { user, refresh } = useSession();
  const router = useRouter();
  const next = safeNext(useSearchParams().get("next"));
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const verify = useAction(async () => {
    await api("/auth/verify-contact", { method: "POST", body: { code } });
    await refresh();
    router.push(next);
  });
  const resend = useAction(async () => {
    await api("/auth/resend-verification", { method: "POST", body: {} });
    setSent(true);
  });
  if (user?.emailVerified) return <Alert tone="success" title="Email verified">You&apos;re all set. <Link href={next}>Continue</Link></Alert>;
  return (
    <form onSubmit={(e) => { e.preventDefault(); void verify.run(); }} className="stack" noValidate>
      <h1>Verify your email</h1>
      <p className="muted">We sent a 6-digit code to {user?.email ?? "your email"}. It expires in 15 minutes.</p>
      {verify.error && <Alert tone="danger">{fieldMessage(verify.error, "code") ?? messageFor(verify.error)}</Alert>}
      {sent && <Alert tone="success">A new code is on its way.</Alert>}
      <Field label="Verification code">{(p) => <input {...p} className="input mono" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />}</Field>
      <Button type="submit" variant="primary" loading={verify.pending} disabled={code.length !== 6} block>Verify</Button>
      <div className="row-between"><Button variant="ghost" size="sm" onClick={() => void resend.run()} loading={resend.pending}>Resend code</Button><Link href={next} className="small">Skip for now</Link></div>
    </form>
  );
}

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);
  const act = useAction(async () => {
    await api("/auth/password/forgot", { method: "POST", body: { email } });
    setDone(true);
  });
  if (done) return (
    <div className="stack"><h1>Check your email</h1><Alert tone="success">If an account exists for {email}, we sent a reset code.</Alert><Link className="btn btn-primary" href={`/reset-password?email=${encodeURIComponent(email)}`}>Enter reset code</Link></div>
  );
  return (
    <form onSubmit={(e) => { e.preventDefault(); void act.run(); }} className="stack" noValidate>
      <h1>Reset your password</h1>
      {act.error && <Alert tone="danger">{messageFor(act.error)}</Alert>}
      <Field label="Email">{(p) => <input {...p} className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
      <Button type="submit" variant="primary" loading={act.pending} block>Send reset code</Button>
    </form>
  );
}

export function ResetPasswordForm() {
  const params = useSearchParams();
  const router = useRouter();
  const [f, setF] = useState({ email: params.get("email") ?? "", code: "", newPassword: "" });
  const act = useAction(async () => {
    await api("/auth/password/reset", { method: "POST", body: f });
    router.push("/login");
  });
  return (
    <form onSubmit={(e) => { e.preventDefault(); void act.run(); }} className="stack" noValidate>
      <h1>Choose a new password</h1>
      {act.error && <Alert tone="danger">{fieldMessage(act.error, "code") ?? messageFor(act.error)}</Alert>}
      <Field label="Email">{(p) => <input {...p} className="input" type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />}</Field>
      <Field label="6-digit code">{(p) => <input {...p} className="input mono" inputMode="numeric" maxLength={6} required value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.replace(/\D/g, "") })} />}</Field>
      <Field label="New password" hint="At least 10 characters." error={fieldMessage(act.error, "newPassword")}>{(p) => <input {...p} className="input" type="password" autoComplete="new-password" minLength={10} required value={f.newPassword} onChange={(e) => setF({ ...f, newPassword: e.target.value })} />}</Field>
      <Button type="submit" variant="primary" loading={act.pending} block>Update password</Button>
    </form>
  );
}
