import { getEnv } from "@/server/config/env";

/**
 * Model boundary. A model may only REPHRASE already-retrieved, already-authorized text. It has no tools, no URLs to
 * fetch and no data beyond the supplied sources; its output is validated by the caller before it is shown.
 */
export interface LlmProvider {
  complete(input: { system: string; user: string; maxTokens: number; timeoutMs: number }): Promise<string>;
}

export class AnthropicProvider implements LlmProvider {
  constructor(private readonly cfg: { apiKey: string; model: string; fetchImpl?: typeof fetch }) {}

  async complete(input: { system: string; user: string; maxTokens: number; timeoutMs: number }): Promise<string> {
    const res = await (this.cfg.fetchImpl ?? fetch)("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": this.cfg.apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: this.cfg.model, max_tokens: input.maxTokens, system: input.system, messages: [{ role: "user", content: input.user }] }),
      signal: AbortSignal.timeout(input.timeoutMs),
    });
    if (!res.ok) throw new Error(`llm status ${res.status}`);
    const body = (await res.json()) as { content?: { type: string; text?: string }[] };
    return (body.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("").trim();
  }
}

let override: LlmProvider | null | undefined;
/** Tests inject a provider (or null to force the no-model path). */
export const setLlmProvider = (p: LlmProvider | null | undefined): void => {
  override = p;
};

export function getLlmProvider(): LlmProvider | null {
  if (override !== undefined) return override;
  const env = getEnv();
  if (env.AI_PROVIDER === "anthropic" && env.ANTHROPIC_API_KEY) return new AnthropicProvider({ apiKey: env.ANTHROPIC_API_KEY, model: env.AI_MODEL });
  return null;
}
