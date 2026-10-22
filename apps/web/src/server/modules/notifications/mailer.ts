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

let mailer: Mailer = new UnconfiguredMailer();
export const getMailer = (): Mailer => mailer;
export const setMailer = (m: Mailer): void => {
  mailer = m;
};
