import {
  ASSISTANT_NAME,
  buildAssistantConfig,
} from "./vapi-assistant-config.mjs";

const privateKey = process.env.VAPI_PRIVATE_KEY?.trim();
if (!privateKey) {
  throw new Error("VAPI_PRIVATE_KEY is not set in this process.");
}

const apiBase = "https://api.vapi.ai";
const headers = {
  Authorization: `Bearer ${privateKey}`,
  "Content-Type": "application/json",
};

async function request(path, options = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    headers: { ...headers, ...options.headers },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = body?.message || body?.error || `HTTP ${response.status}`;
    throw new Error(`Vapi request failed: ${String(detail).slice(0, 500)}`);
  }
  return body;
}

const assistants = await request("/assistant?limit=1000");
const existing = assistants.find(
  (assistant) => assistant.name === ASSISTANT_NAME
);
const config = buildAssistantConfig();
const action = existing ? "updated" : "created";
const assistant = await request(
  existing ? `/assistant/${encodeURIComponent(existing.id)}` : "/assistant",
  {
    method: existing ? "PATCH" : "POST",
    body: JSON.stringify(config),
  }
);

console.log(
  JSON.stringify({
    action,
    assistantId: assistant.id,
    name: assistant.name,
    model: assistant.model?.model,
    voice: assistant.voice?.voiceId,
  })
);
