/** Push provider boundary (FCM adapter plugs in here). Tokens are never logged. */
export interface PushMessage {
  token: string;
  title: string;
  body: string;
  /** Small, non-sensitive payload: resource ids / deep link only. */
  data: Record<string, string>;
}
export type PushResult = "sent" | "invalid_token";

export interface PushProvider {
  send(message: PushMessage): Promise<PushResult>;
}

export class MemoryPushProvider implements PushProvider {
  readonly sent: PushMessage[] = [];
  invalidTokens = new Set<string>();
  async send(message: PushMessage): Promise<PushResult> {
    if (this.invalidTokens.has(message.token)) return "invalid_token";
    this.sent.push(message);
    return "sent";
  }
}

/** Default until Firebase service credentials are provisioned: deliveries are recorded as skipped, never faked. */
export class DisabledPushProvider implements PushProvider {
  async send(): Promise<PushResult> {
    throw new Error("push provider not configured");
  }
}

let provider: PushProvider = new DisabledPushProvider();
export const getPushProvider = (): PushProvider => provider;
export const setPushProvider = (p: PushProvider): void => {
  provider = p;
};
