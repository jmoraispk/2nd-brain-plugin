import { requestUrl } from "obsidian";
import { SecondBrainSettings } from "./settings";

export interface ConnectionTestResult {
  ok: boolean;
  message: string;
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
  try {
    if (settings.provider === "openai") {
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
          model: settings.openaiModel,
          max_tokens: 5,
          messages: [{ role: "user", content: "hi" }],
        }),
        throw: false,
      });
      if (res.status >= 400) {
        const errMsg =
          res.json?.error?.message ||
          res.json?.error?.code ||
          `HTTP ${res.status}`;
        return { ok: false, message: errMsg };
      }
      return { ok: true, message: `OpenAI ${settings.openaiModel} responded.` };
    } else if (settings.provider === "anthropic") {
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
          model: settings.anthropicModel,
          max_tokens: 5,
          messages: [{ role: "user", content: "hi" }],
        }),
        throw: false,
      });
      if (res.status >= 400) {
        const errMsg =
          res.json?.error?.message || `HTTP ${res.status}`;
        return { ok: false, message: errMsg };
      }
      return {
        ok: true,
        message: `Anthropic ${settings.anthropicModel} responded.`,
      };
    }
    return { ok: false, message: `Unknown provider: ${settings.provider}` };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

export async function callLLM(
  settings: SecondBrainSettings,
  systemPrompt: string,
  userMessage: string
): Promise<string> {
  switch (settings.provider) {
    case "anthropic":
      return callAnthropic(settings, systemPrompt, userMessage);
    case "openai":
      return callOpenAI(settings, systemPrompt, userMessage);
    default:
      throw new Error(`Unknown provider: ${settings.provider}`);
  }
}

async function callAnthropic(
  settings: SecondBrainSettings,
  systemPrompt: string,
  userMessage: string
): Promise<string> {
  if (!settings.anthropicApiKey) {
    throw new Error("Anthropic API key not set. Configure in plugin settings.");
  }

  const body = JSON.stringify({
    model: settings.anthropicModel,
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
  return text;
}

async function callOpenAI(
  settings: SecondBrainSettings,
  systemPrompt: string,
  userMessage: string
): Promise<string> {
  if (!settings.openaiApiKey) {
    throw new Error("OpenAI API key not set. Configure in plugin settings.");
  }

  const body = JSON.stringify({
    model: settings.openaiModel,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
  });

  const res = await requestUrl({
    url: "https://api.openai.com/v1/chat/completions",
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${settings.openaiApiKey}`,
    },
    body,
    throw: false,
  });

  if (res.status >= 400) {
    const errMsg =
      res.json?.error?.message || res.text || `HTTP ${res.status}`;
    throw new Error(`OpenAI error: ${errMsg}`);
  }

  const text = res.json?.choices?.[0]?.message?.content;
  if (!text) throw new Error("No content returned by OpenAI API.");
  return text;
}
