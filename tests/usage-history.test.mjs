import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadHistory() {
  const result = await build({
    entryPoints: [path.join(repoRoot, "src", "usageHistory.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
  });
  const source = Buffer.from(result.outputFiles[0].contents).toString("base64");
  return import(`data:text/javascript;base64,${source}`);
}

function llmEntry(overrides = {}) {
  return {
    id: "openai:req-1",
    interactionId: "interaction-1",
    occurredAt: "2026-09-13T12:00:00.000Z",
    action: "Review",
    component: "llm-request",
    provider: "openai",
    model: "gpt-5",
    status: "completed",
    accuracy: "estimated",
    costUsd: 0.01,
    usage: { inputTokens: 1_000, outputTokens: 200 },
    pricingVersion: "2026-09-13",
    ...overrides,
  };
}

test("OpenAI cached input is subtracted once and reasoning is not double billed", async () => {
  const history = await loadHistory();
  const entry = history.createProviderUsageEntry(
    {
      provider: "openai",
      model: "gpt-5",
      status: "completed",
      action: "Review",
      interactionId: "review-1",
      providerRequestId: "chatcmpl-1",
      usage: {
        inputTokens: 1_000,
        cachedInputTokens: 400,
        outputTokens: 200,
        reasoningTokens: 150,
      },
    },
    "2026-09-13T12:00:00.000Z"
  );

  assert.equal(entry.id, "openai:chatcmpl-1");
  assert.equal(entry.accuracy, "estimated");
  assert.equal(
    entry.costUsd,
    (600 * 1.25 + 400 * 0.125 + 200 * 10) / 1_000_000
  );
  assert.equal(entry.usage.reasoningTokens, 150);
  assert.equal(entry.pricingVersion, "2026-09-13");
});

test("Anthropic usage is estimated and malformed counts are discarded", async () => {
  const history = await loadHistory();
  const entry = history.createProviderUsageEntry(
    {
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      status: "completed",
      action: "Ask",
      interactionId: "ask-1",
      providerRequestId: "msg-1",
      usage: {
        inputTokens: 1_000,
        cachedInputTokens: 200,
        outputTokens: 100,
        reasoningTokens: -3,
      },
    },
    "2026-09-13T12:00:00.000Z"
  );

  assert.equal(
    entry.costUsd,
    (800 * 3 + 200 * 0.3 + 100 * 15) / 1_000_000
  );
  assert.deepEqual(entry.usage, {
    inputTokens: 1_000,
    cachedInputTokens: 200,
    outputTokens: 100,
  });
});

test("dated model aliases resolve while unknown models retain usage without a price", async () => {
  const history = await loadHistory();
  const dated = history.createProviderUsageEntry(
    {
      provider: "openai",
      model: "gpt-5-2026-08-01",
      status: "completed",
      usage: { inputTokens: 1_000, outputTokens: 100 },
    },
    "2026-09-13T12:00:00.000Z"
  );
  const unknown = history.createProviderUsageEntry(
    {
      provider: "openai",
      model: "gpt-experimental",
      status: "completed",
      usage: { inputTokens: 25, outputTokens: 7 },
    },
    "2026-09-13T12:00:01.000Z"
  );

  assert.equal(dated.accuracy, "estimated");
  assert.equal(dated.costUsd, (1_000 * 1.25 + 100 * 10) / 1_000_000);
  assert.equal(unknown.accuracy, "unknown");
  assert.equal(unknown.costUsd, undefined);
  assert.deepEqual(unknown.usage, { inputTokens: 25, outputTokens: 7 });
});

test("sanitization keeps only valid metadata fields and caps the ledger", async () => {
  const history = await loadHistory();
  const rawEntries = Array.from({ length: 505 }, (_, index) =>
    llmEntry({
      id: `openai:req-${index}`,
      interactionId: `interaction-${index}`,
      occurredAt: new Date(Date.UTC(2026, 8, 1, 0, index)).toISOString(),
      prompt: "private prompt",
      transcript: "private transcript",
      generatedText: "private output",
      apiKey: "secret-key",
    })
  );
  rawEntries.push({ provider: "openai", prompt: "invalid private prompt" });

  const state = history.sanitizeUsageHistoryState({
    schemaVersion: 1,
    entries: rawEntries,
    lastVapiSyncAt: "2026-09-13T12:00:00.000Z",
    apiKey: "top-level-secret",
  });
  const serialized = JSON.stringify(state);

  assert.equal(state.entries.length, 500);
  assert.equal(state.entries[0].id, "openai:req-504");
  assert.equal(state.lastVapiSyncAt, "2026-09-13T12:00:00.000Z");
  assert.doesNotMatch(serialized, /private prompt|private transcript|private output|secret-key|top-level-secret/);
  assert.doesNotMatch(serialized, /prompt|transcript|generatedText|apiKey/);
});

test("the store serializes writes and replaces duplicate call IDs", async () => {
  const history = await loadHistory();
  let activePersists = 0;
  let maximumPersists = 0;
  const persisted = [];
  const errors = [];
  const store = new history.UsageHistoryStore(
    undefined,
    async (state) => {
      activePersists += 1;
      maximumPersists = Math.max(maximumPersists, activePersists);
      await new Promise((resolve) => setTimeout(resolve, 2));
      persisted.push(state);
      activePersists -= 1;
    },
    (error) => errors.push(error)
  );

  const pending = {
    id: "vapi:call-1",
    interactionId: "voice-1",
    occurredAt: "2026-09-13T12:00:00.000Z",
    action: "Capture call",
    component: "vapi-call",
    provider: "vapi",
    status: "pending",
    accuracy: "pending",
    callId: "call-1",
  };
  await Promise.all([
    store.upsert(pending),
    store.upsert(llmEntry({ id: "openai:req-2" })),
  ]);
  await store.upsert({
    ...pending,
    id: "vapi:replacement-id",
    status: "completed",
    accuracy: "exact",
    costUsd: 0.16,
  });

  assert.equal(maximumPersists, 1);
  assert.equal(persisted.length, 3);
  assert.equal(errors.length, 0);
  assert.equal(store.snapshot().entries.length, 2);
  assert.equal(
    store.snapshot().entries.find((entry) => entry.callId === "call-1").costUsd,
    0.16
  );
});

test("history persistence failures are reported without rejecting the AI path", async () => {
  const history = await loadHistory();
  const errors = [];
  const store = new history.UsageHistoryStore(
    undefined,
    async () => {
      throw new Error("disk unavailable");
    },
    (error) => errors.push(error.message)
  );

  await assert.doesNotReject(() =>
    store.recordProviderUsage({
      provider: "openai",
      model: "gpt-5",
      status: "completed",
      providerRequestId: "req-safe",
      usage: { inputTokens: 10, outputTokens: 2 },
    })
  );
  assert.deepEqual(errors, ["disk unavailable"]);
  assert.equal(store.snapshot().entries.length, 1);
});

test("voice components group together without hiding pending or unknown costs", async () => {
  const history = await loadHistory();
  const exactVoice = {
    id: "vapi:call-1",
    interactionId: "voice-1",
    occurredAt: "2026-09-13T12:00:00.000Z",
    action: "Capture call",
    component: "vapi-call",
    provider: "vapi",
    status: "completed",
    accuracy: "exact",
    costUsd: 0.16,
    durationSeconds: 103,
    callId: "call-1",
  };
  const estimatedDraft = llmEntry({
    id: "openai:draft-1",
    interactionId: "voice-1",
    action: "Capture call",
    costUsd: 0.002,
  });
  const pendingVoice = {
    ...exactVoice,
    id: "vapi:call-2",
    interactionId: "voice-2",
    callId: "call-2",
    costUsd: undefined,
    status: "pending",
    accuracy: "pending",
  };

  const groups = history.groupUsageInteractions([
    pendingVoice,
    estimatedDraft,
    exactVoice,
  ]);

  assert.equal(groups.length, 2);
  assert.equal(groups[0].interactionId, "voice-2");
  assert.equal(groups[0].accuracy, "pending");
  assert.equal(groups[0].knownCostUsd, undefined);
  assert.equal(groups[0].hasUnpricedComponents, true);
  assert.equal(groups[1].knownCostUsd, 0.162);
  assert.equal(groups[1].accuracy, "estimated");
  assert.equal(groups[1].hasUnpricedComponents, false);
  assert.equal(groups[1].durationSeconds, 103);
});

test("cost windows use local calendar-day boundaries", async () => {
  const history = await loadHistory();
  const now = new Date(2026, 8, 13, 12, 0, 0);
  const atDaysAgo = (days, id, costUsd) => {
    const date = new Date(2026, 8, 13 - days, 9, 0, 0);
    return llmEntry({
      id,
      interactionId: id,
      occurredAt: date.toISOString(),
      costUsd,
    });
  };

  const summary = history.summarizeUsageWindows(
    [
      atDaysAgo(0, "today", 1),
      atDaysAgo(6, "six-days", 2),
      atDaysAgo(7, "seven-days", 4),
      atDaysAgo(29, "twenty-nine-days", 8),
      atDaysAgo(30, "thirty-days", 16),
    ],
    now
  );

  assert.equal(summary.today.knownCostUsd, 1);
  assert.equal(summary.sevenDays.knownCostUsd, 3);
  assert.equal(summary.thirtyDays.knownCostUsd, 15);
});
