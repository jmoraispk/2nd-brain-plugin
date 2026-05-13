import { requestUrl } from "obsidian";
import { SecondBrainSettings } from "./settings";

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
