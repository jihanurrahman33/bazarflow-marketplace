import nodemailer, { type Transporter } from "nodemailer";
import { getEnv } from "@/server/config/env";
import { logger } from "@/server/shared/logger";

export interface OutboundMessage {
  to: string;
  template: "verify_email" | "password_reset";
  /** One-time secret shown to the recipient. Never persisted in plaintext and never logged. */
  code: string;
}

export interface Mailer {
  send(message: OutboundMessage): Promise<void>;
}

/** Test/dev sink. */
export class MemoryMailer implements Mailer {
  readonly sent: OutboundMessage[] = [];
  async send(message: OutboundMessage): Promise<void> {
    this.sent.push(message);
  }
  last(to: string, template?: OutboundMessage["template"]): OutboundMessage | undefined {
    return [...this.sent].reverse().find((m) => m.to === to && (!template || m.template === template));
  }
}

/**
 * Production default until a transactional-email provider is contracted (docs/14 open question).
 * Fails loudly in logs so the gap is visible instead of silently dropping codes.
 */
class UnconfiguredMailer implements Mailer {
  async send(message: OutboundMessage): Promise<void> {
    logger.warn("mailer not configured; message dropped", { action: message.template });
  }
}

/** SMTP delivery (vendor-neutral). Codes are delivered once and never logged or stored in plaintext. */
export class SmtpMailer implements Mailer {
  constructor(private readonly transport: Transporter, private readonly from: string) {}

  async send(message: OutboundMessage): Promise<void> {
    const subject = message.template === "verify_email" ? "Verify your BazarFlow email" : "Reset your BazarFlow password";
    const intro = message.template === "verify_email" ? "Use this code to verify your email address" : "Use this code to reset your password";
    await this.transport.sendMail({
      from: this.from,
      to: message.to,
      subject,
      text: `${intro}:\n\n  ${message.code}\n\nIt expires in 15 minutes. If you didn't request it, you can ignore this email.`,
    });
  }
}

let override: Mailer | undefined;
let configured: { key: string; mailer: Mailer } | undefined;
export const setMailer = (m: Mailer | undefined): void => {
  override = m;
};

export function getMailer(): Mailer {
  if (override) return override;
  const env = getEnv();
  if (!env.SMTP_URL) return (configured = configured?.key === "none" ? configured : { key: "none", mailer: new UnconfiguredMailer() }).mailer;
  const key = `${env.SMTP_URL}|${env.MAIL_FROM}`;
  if (configured?.key !== key) configured = { key, mailer: new SmtpMailer(nodemailer.createTransport(env.SMTP_URL), env.MAIL_FROM) };
  return configured.mailer;
}
