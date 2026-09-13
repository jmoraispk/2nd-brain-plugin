import { requestUrl } from "obsidian";
import type { SecondBrainSettings } from "./settings";
import type { ProviderUsageEvent, TokenUsage } from "./usageHistory";
import { createInteractionId } from "./usageHistory";
import { emitUsageEvent } from "./usageTelemetry";

export interface ConnectionTestResult {
  ok: boolean;
  message: string;
}

export interface LLMCallContext {
  action?: string;
  interactionId?: string;
}

interface ProviderCompletion {
  text: string;
  providerRequestId?: string;
  usage?: TokenUsage;
}

/**
 * Make a small chat-completion call against the configured provider to verify
 * the API key, the model id, and quota/rate-limit headroom. Returns the
 * provider's error message verbatim on failure — useful for diagnosing
 * "insufficient_quota", "invalid_api_key", "model not found", etc.
 */
export async function testConnection(
  settings: SecondBrainSettings
): Promise<ConnectionTestResult> {
  const interactionId = createInteractionId();
  const action = "Test connection";
  const provider = settings.provider;
  const model =
    provider === "anthropic" ? settings.anthropicModel : settings.openaiModel;

  try {
    if (provider === "openai") {
      if (!settings.openaiApiKey.trim())
        return { ok: false, message: "OpenAI API key not set." };
      const res = await requestUrl({
        url: "https://api.openai.com/v1/chat/completions",
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${settings.openaiApiKey}`,
        },
        body: JSON.stringify({
          model,
          max_tokens: 5,
          messages: [{ role: "user", content: "hi" }],
        }),
        throw: false,
      });
      if (res.status >= 400) {
        await emitUsageEvent(
          failedUsageEvent(provider, model, action, interactionId)
        );
        const errMsg =
          res.json?.error?.message ||
          res.json?.error?.code ||
          `HTTP ${res.status}`;
        return { ok: false, message: errMsg };
      }
      await emitUsageEvent(
        successfulUsageEvent(provider, model, action, interactionId, {
          providerRequestId: stringField(res.json?.id),
          usage: openAIUsage(res.json?.usage),
          text: "",
        })
      );
      return { ok: true, message: `OpenAI ${model} responded.` };
    }

    if (provider === "anthropic") {
      if (!settings.anthropicApiKey.trim())
        return { ok: false, message: "Anthropic API key not set." };
      const res = await requestUrl({
        url: "https://api.anthropic.com/v1/messages",
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": settings.anthropicApiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: 5,
          messages: [{ role: "user", content: "hi" }],
        }),
        throw: false,
      });
      if (res.status >= 400) {
        await emitUsageEvent(
          failedUsageEvent(provider, model, action, interactionId)
        );
        const errMsg = res.json?.error?.message || `HTTP ${res.status}`;
        return { ok: false, message: errMsg };
      }
      await emitUsageEvent(
        successfulUsageEvent(provider, model, action, interactionId, {
          providerRequestId: stringField(res.json?.id),
          usage: anthropicUsage(res.json?.usage),
          text: "",
        })
      );
      return { ok: true, message: `Anthropic ${model} responded.` };
    }

    return { ok: false, message: `Unknown provider: ${provider}` };
  } catch (err) {
    await emitUsageEvent(
      failedUsageEvent(provider, model, action, interactionId)
    );
    return { ok: false, message: (err as Error).message };
  }
}

/**
 * Optional per-call override (v0.9.6 model orchestration). When `model` is
 * set, it wins over the provider/model in settings and the provider is
 * inferred from the model id. `effort` maps to OpenAI's reasoning_effort
 * ("off" omits it / "default" leaves the model's own default).
 */
export interface LLMOverride {
  model?: string;
  effort?: "default" | "off" | "low" | "high";
  usage?: LLMCallContext;
}

export async function callLLM(
  settings: SecondBrainSettings,
  systemPrompt: string,
  userMessage: string,
  override?: LLMOverride
): Promise<string> {
  let provider = settings.provider;
  let model =
    settings.provider === "anthropic"
      ? settings.anthropicModel
      : settings.openaiModel;
  if (override?.model) {
    model = override.model;
    provider = override.model.startsWith("claude") ? "anthropic" : "openai";
  }

  const action = override?.usage?.action ?? "AI request";
  const interactionId =
    override?.usage?.interactionId ?? createInteractionId();

  try {
    const result =
      provider === "anthropic"
        ? await callAnthropic(settings, systemPrompt, userMessage, model)
        : await callOpenAI(
            settings,
            systemPrompt,
            userMessage,
            model,
            override?.effort
          );
    await emitUsageEvent(
      successfulUsageEvent(provider, model, action, interactionId, result)
    );
    return result.text;
  } catch (error) {
    await emitUsageEvent(
      failedUsageEvent(provider, model, action, interactionId)
    );
    throw error;
  }
}

async function callAnthropic(
  settings: SecondBrainSettings,
  systemPrompt: string,
  userMessage: string,
  model: string
): Promise<ProviderCompletion> {
  if (!settings.anthropicApiKey) {
    throw new Error("Anthropic API key not set. Configure in plugin settings.");
  }

  const body = JSON.stringify({
    model,
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });

  const res = await requestUrl({
    url: "https://api.anthropic.com/v1/messages",
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": settings.anthropicApiKey,
      "anthropic-version": "2023-06-01",
    },
    body,
    throw: false,
  });

  if (res.status >= 400) {
    const errMsg =
      res.json?.error?.message || res.text || `HTTP ${res.status}`;
    throw new Error(`Anthropic error: ${errMsg}`);
  }

  const text = res.json?.content?.[0]?.text;
  if (!text) throw new Error("No content returned by Anthropic API.");
  return {
    text,
    ...(stringField(res.json?.id) === undefined
      ? {}
      : { providerRequestId: stringField(res.json?.id) }),
    ...(anthropicUsage(res.json?.usage) === undefined
      ? {}
      : { usage: anthropicUsage(res.json?.usage) }),
  };
}

async function callOpenAI(
  settings: SecondBrainSettings,
  systemPrompt: string,
  userMessage: string,
  model: string,
  effort?: "default" | "off" | "low" | "high"
): Promise<ProviderCompletion> {
  if (!settings.openaiApiKey) {
    throw new Error("OpenAI API key not set. Configure in plugin settings.");
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const payload: Record<string, any> = {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
  };
  if (effort === "low" || effort === "high") {
    payload.reasoning_effort = effort;
  }

  const res = await requestUrl({
    url: "https://api.openai.com/v1/chat/completions",
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${settings.openaiApiKey}`,
    },
    body: JSON.stringify(payload),
    throw: false,
  });

  if (res.status >= 400) {
    const errMsg =
      res.json?.error?.message || res.text || `HTTP ${res.status}`;
    throw new Error(`OpenAI error: ${errMsg}`);
  }

  const text = res.json?.choices?.[0]?.message?.content;
  if (!text) throw new Error("No content returned by OpenAI API.");
  return {
    text,
    ...(stringField(res.json?.id) === undefined
      ? {}
      : { providerRequestId: stringField(res.json?.id) }),
    ...(openAIUsage(res.json?.usage) === undefined
      ? {}
      : { usage: openAIUsage(res.json?.usage) }),
  };
}

function successfulUsageEvent(
  provider: "openai" | "anthropic",
  model: string,
  action: string,
  interactionId: string,
  completion: ProviderCompletion
): ProviderUsageEvent {
  return {
    provider,
    model,
    status: "completed",
    action,
    interactionId,
    ...(completion.providerRequestId === undefined
      ? {}
      : { providerRequestId: completion.providerRequestId }),
    ...(completion.usage === undefined ? {} : { usage: completion.usage }),
  };
}

function failedUsageEvent(
  provider: "openai" | "anthropic",
  model: string,
  action: string,
  interactionId: string
): ProviderUsageEvent {
  return { provider, model, status: "failed", action, interactionId };
}

function openAIUsage(value: unknown): TokenUsage | undefined {
  const usage = recordField(value);
  if (!usage) return undefined;
  return compactUsage({
    inputTokens: numberField(usage.prompt_tokens),
    cachedInputTokens: numberField(
      recordField(usage.prompt_tokens_details)?.cached_tokens
    ),
    outputTokens: numberField(usage.completion_tokens),
    reasoningTokens: numberField(
      recordField(usage.completion_tokens_details)?.reasoning_tokens
    ),
  });
}

function anthropicUsage(value: unknown): TokenUsage | undefined {
  const usage = recordField(value);
  if (!usage) return undefined;
  const uncached = numberField(usage.input_tokens);
  const cacheRead = numberField(usage.cache_read_input_tokens);
  const cacheCreation = numberField(usage.cache_creation_input_tokens);
  const inputParts = [uncached, cacheRead, cacheCreation].filter(
    (item): item is number => item !== undefined
  );
  return compactUsage({
    inputTokens:
      inputParts.length === 0
        ? undefined
        : inputParts.reduce((sum, item) => sum + item, 0),
    cachedInputTokens: cacheRead,
    outputTokens: numberField(usage.output_tokens),
  });
}

function compactUsage(usage: TokenUsage): TokenUsage | undefined {
  const compact = Object.fromEntries(
    Object.entries(usage).filter(([, value]) => value !== undefined)
  ) as TokenUsage;
  return Object.keys(compact).length === 0 ? undefined : compact;
}

function recordField(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberField(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}
