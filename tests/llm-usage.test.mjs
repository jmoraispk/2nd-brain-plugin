import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function settings(overrides = {}) {
  return {
    provider: "openai",
    openaiApiKey: "openai-secret",
    openaiModel: "gpt-5",
    anthropicApiKey: "anthropic-secret",
    anthropicModel: "claude-sonnet-4-6",
    ...overrides,
  };
}

async function loadLLM(requester) {
  globalThis.__secondBrainLlmRequester = requester;
  const result = await build({
    stdin: {
      contents: `
        export * from "./src/llm.ts";
        export { configureUsageEventSink } from "./src/usageTelemetry.ts";
      `,
      resolveDir: repoRoot,
      sourcefile: "llm-usage-test-entry.ts",
    },
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    plugins: [obsidianStubPlugin()],
  });
  const source = Buffer.from(result.outputFiles[0].contents).toString("base64");
  return import(`data:text/javascript;base64,${source}#${Math.random()}`);
}

function obsidianStubPlugin() {
  return {
    name: "obsidian-llm-usage-test-stub",
    setup(buildApi) {
      buildApi.onResolve({ filter: /^obsidian$/ }, () => ({
        path: "obsidian",
        namespace: "obsidian-llm-usage-test-stub",
      }));
      buildApi.onLoad(
        { filter: /.*/, namespace: "obsidian-llm-usage-test-stub" },
        () => ({
          contents: `
            export async function requestUrl(request) {
              return globalThis.__secondBrainLlmRequester(request);
            }
          `,
          loader: "js",
        })
      );
    },
  };
}

test("OpenAI emits cached and reasoning token metadata without request content", async () => {
  const requests = [];
  const llm = await loadLLM(async (request) => {
    requests.push(request);
    return {
      status: 200,
      json: {
        id: "chatcmpl-usage-1",
        choices: [{ message: { content: "A factual review" } }],
        usage: {
          prompt_tokens: 1_000,
          completion_tokens: 200,
          prompt_tokens_details: { cached_tokens: 400 },
          completion_tokens_details: { reasoning_tokens: 150 },
        },
      },
      text: "",
    };
  });
  const events = [];
  llm.configureUsageEventSink((event) => events.push(event));

  const text = await llm.callLLM(
    settings(),
    "private system prompt",
    "private user message",
    {
      model: "gpt-5",
      effort: "low",
      usage: { action: "Review", interactionId: "review-1" },
    }
  );

  assert.equal(text, "A factual review");
  assert.equal(requests.length, 1);
  assert.deepEqual(events, [
    {
      provider: "openai",
      model: "gpt-5",
      status: "completed",
      action: "Review",
      interactionId: "review-1",
      providerRequestId: "chatcmpl-usage-1",
      usage: {
        inputTokens: 1_000,
        cachedInputTokens: 400,
        outputTokens: 200,
        reasoningTokens: 150,
      },
    },
  ]);
  assert.doesNotMatch(JSON.stringify(events), /private system prompt|private user message/);
});

test("Anthropic normalizes cache reads into total input usage", async () => {
  const llm = await loadLLM(async () => ({
    status: 200,
    json: {
      id: "msg-usage-1",
      content: [{ type: "text", text: "Answer" }],
      usage: {
        input_tokens: 800,
        cache_read_input_tokens: 200,
        output_tokens: 75,
      },
    },
    text: "",
  }));
  const events = [];
  llm.configureUsageEventSink((event) => events.push(event));

  await llm.callLLM(
    settings({ provider: "anthropic" }),
    "system",
    "question",
    { usage: { action: "Ask", interactionId: "ask-1" } }
  );

  assert.deepEqual(events[0], {
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    status: "completed",
    action: "Ask",
    interactionId: "ask-1",
    providerRequestId: "msg-usage-1",
    usage: {
      inputTokens: 1_000,
      cachedInputTokens: 200,
      outputTokens: 75,
    },
  });
});

test("provider errors emit content-free failure metadata and preserve the error", async () => {
  const llm = await loadLLM(async () => ({
    status: 401,
    json: { error: { message: "Incorrect API key" } },
    text: "",
  }));
  const events = [];
  llm.configureUsageEventSink((event) => events.push(event));

  await assert.rejects(
    () =>
      llm.callLLM(settings(), "secret prompt", "secret message", {
        usage: { action: "Project AI", interactionId: "project-1" },
      }),
    /Incorrect API key/
  );

  assert.deepEqual(events, [
    {
      provider: "openai",
      model: "gpt-5",
      status: "failed",
      action: "Project AI",
      interactionId: "project-1",
    },
  ]);
  assert.doesNotMatch(JSON.stringify(events), /secret prompt|secret message/);
});

test("a telemetry sink failure cannot fail a successful model response", async () => {
  const llm = await loadLLM(async () => ({
    status: 200,
    json: {
      id: "chatcmpl-safe",
      choices: [{ message: { content: "Still succeeds" } }],
      usage: { prompt_tokens: 5, completion_tokens: 2 },
    },
    text: "",
  }));
  llm.configureUsageEventSink(async () => {
    throw new Error("history unavailable");
  });

  await assert.doesNotReject(async () => {
    const result = await llm.callLLM(settings(), "system", "message");
    assert.equal(result, "Still succeeds");
  });
});

test("Test Connection records its small provider interaction", async () => {
  const llm = await loadLLM(async () => ({
    status: 200,
    json: {
      id: "chatcmpl-test",
      choices: [{ message: { content: "hi" } }],
      usage: { prompt_tokens: 8, completion_tokens: 1 },
    },
    text: "",
  }));
  const events = [];
  llm.configureUsageEventSink((event) => events.push(event));

  const result = await llm.testConnection(settings());

  assert.equal(result.ok, true);
  assert.equal(events.length, 1);
  assert.equal(events[0].action, "Test connection");
  assert.equal(events[0].providerRequestId, "chatcmpl-test");
  assert.deepEqual(events[0].usage, { inputTokens: 8, outputTokens: 1 });
});
