import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const completedCall = {
  id: "call-1",
  assistantId: "assistant-1",
  createdAt: "2026-09-13T18:47:30.000Z",
  startedAt: "2026-09-13T18:47:30.000Z",
  endedAt: "2026-09-13T18:49:13.000Z",
  status: "ended",
  cost: 0.1619,
  costBreakdown: {
    transport: 0.002,
    stt: 0.0172,
    llm: 0.0154,
    tts: 0.0416,
    vapi: 0.0857,
  },
  messages: [{ role: "user", message: "private transcript" }],
  artifact: { transcript: "also private" },
  analysis: { summary: "private summary" },
};

async function loadVapiUsage() {
  const result = await build({
    entryPoints: [path.join(repoRoot, "src", "vapiUsage.ts")],
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
    name: "obsidian-vapi-usage-test-stub",
    setup(buildApi) {
      buildApi.onResolve({ filter: /^obsidian$/ }, () => ({
        path: "obsidian",
        namespace: "obsidian-vapi-usage-test-stub",
      }));
      buildApi.onLoad(
        { filter: /.*/, namespace: "obsidian-vapi-usage-test-stub" },
        () => ({
          contents: `
            export async function requestUrl(request) {
              return globalThis.__secondBrainVapiRequester(request);
            }
          `,
          loader: "js",
        })
      );
    },
  };
}

function emptyState(overrides = {}) {
  return { schemaVersion: 1, entries: [], ...overrides };
}

function pending(vapi, callId = "call-1", interactionId = "voice-1") {
  return vapi.createPendingVapiEntry({
    callId,
    interactionId,
    action: "Capture call",
    occurredAt: "2026-09-13T18:47:30.000Z",
  });
}

test("pending Vapi calls retain local status and duration without inventing cost", async () => {
  const vapi = await loadVapiUsage();
  const entry = pending(vapi);

  assert.deepEqual(entry, {
    id: "vapi:call-1",
    interactionId: "voice-1",
    occurredAt: "2026-09-13T18:47:30.000Z",
    action: "Capture call",
    component: "vapi-call",
    provider: "vapi",
    status: "pending",
    accuracy: "pending",
    callId: "call-1",
  });
  assert.deepEqual(
    vapi.completePendingVapiEntry({
      entry,
      status: "completed",
      durationSeconds: 103.4,
    }),
    { ...entry, status: "completed", durationSeconds: 103.4 }
  );
});

test("completed calls reconcile to exact allowlisted costs and omit private content", async () => {
  const vapi = await loadVapiUsage();
  const result = await vapi.reconcileVapiUsage(
    emptyState({
      entries: [pending(vapi)],
      lastVapiSyncAt: "2026-09-12T00:00:00.000Z",
    }),
    {
      assistantId: "assistant-1",
      privateKey: "private-key",
      now: new Date("2026-09-13T20:00:00.000Z"),
      request: async (request) => {
        assert.equal(request.url, "https://api.vapi.ai/call/call-1");
        assert.equal(request.headers.authorization, "Bearer private-key");
        return { status: 200, json: completedCall };
      },
    }
  );

  assert.equal(result.status, "updated");
  assert.equal(result.reconciled, 1);
  assert.equal(result.imported, 0);
  assert.deepEqual(result.state.entries[0], {
    id: "vapi:call-1",
    interactionId: "voice-1",
    occurredAt: "2026-09-13T18:47:30.000Z",
    action: "Capture call",
    component: "vapi-call",
    provider: "vapi",
    status: "completed",
    accuracy: "exact",
    costUsd: 0.1619,
    durationSeconds: 103,
    callId: "call-1",
    vapiBreakdown: {
      transport: 0.002,
      transcription: 0.0172,
      model: 0.0154,
      voice: 0.0416,
      platform: 0.0857,
    },
  });
  assert.doesNotMatch(
    JSON.stringify(result.state),
    /private transcript|also private|private summary|messages|artifact|analysis/
  );
});

test("a completed call with no final cost remains pending", async () => {
  const vapi = await loadVapiUsage();
  const existing = vapi.completePendingVapiEntry({
    entry: pending(vapi),
    status: "completed",
    durationSeconds: 50,
  });
  const result = await vapi.reconcileVapiUsage(
    emptyState({
      entries: [existing],
      lastVapiSyncAt: "2026-09-12T00:00:00.000Z",
    }),
    {
      assistantId: "assistant-1",
      privateKey: "private-key",
      request: async () => ({
        status: 200,
        json: { ...completedCall, cost: undefined, costBreakdown: undefined },
      }),
    }
  );

  assert.equal(result.state.entries[0].accuracy, "pending");
  assert.equal(result.state.entries[0].status, "completed");
  assert.equal(result.state.entries[0].durationSeconds, 50);
  assert.equal(result.state.entries[0].costUsd, undefined);
});

test("first reconciliation performs one idempotent 30-day assistant backfill", async () => {
  const vapi = await loadVapiUsage();
  const urls = [];
  const options = {
    assistantId: "assistant-1",
    privateKey: "private-key",
    now: new Date("2026-09-13T20:00:00.000Z"),
    request: async (request) => {
      urls.push(request.url);
      return { status: 200, json: [completedCall] };
    },
  };
  const first = await vapi.reconcileVapiUsage(emptyState(), options);
  const second = await vapi.reconcileVapiUsage(first.state, options);

  assert.equal(first.imported, 1);
  assert.equal(first.state.entries.length, 1);
  assert.equal(first.state.entries[0].action, "Voice call");
  assert.equal(first.state.entries[0].interactionId, "vapi:call-1");
  assert.equal(second.imported, 0);
  assert.equal(second.state.entries.length, 1);
  assert.equal(urls.length, 1);
  const backfill = new URL(urls[0]);
  assert.equal(`${backfill.origin}${backfill.pathname}`, "https://api.vapi.ai/call");
  assert.equal(backfill.searchParams.get("assistantId"), "assistant-1");
  assert.equal(backfill.searchParams.get("limit"), "1000");
  assert.equal(
    backfill.searchParams.get("createdAtGe"),
    "2026-08-14T20:00:00.000Z"
  );
});

test("known pending calls use at most three requests concurrently", async () => {
  const vapi = await loadVapiUsage();
  const entries = Array.from({ length: 8 }, (_, index) =>
    pending(vapi, `call-${index + 1}`, `voice-${index + 1}`)
  );
  let active = 0;
  let maximum = 0;
  const result = await vapi.reconcileVapiUsage(
    emptyState({ entries, lastVapiSyncAt: "2026-09-12T00:00:00.000Z" }),
    {
      assistantId: "assistant-1",
      privateKey: "private-key",
      request: async (request) => {
        active += 1;
        maximum = Math.max(maximum, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        const id = request.url.split("/").at(-1);
        return { status: 200, json: { ...completedCall, id } };
      },
    }
  );

  assert.equal(result.status, "updated");
  assert.equal(result.reconciled, 8);
  assert.equal(maximum, 3);
});

test("one failed request makes reconciliation transactional and content-free", async () => {
  const vapi = await loadVapiUsage();
  const original = emptyState({
    entries: [pending(vapi, "call-1"), pending(vapi, "call-2")],
    lastVapiSyncAt: "2026-09-12T00:00:00.000Z",
  });
  const result = await vapi.reconcileVapiUsage(original, {
    assistantId: "assistant-1",
    privateKey: "private-key",
    request: async (request) => {
      if (request.url.endsWith("call-2")) {
        throw new Error("private transcript from raw response");
      }
      return { status: 200, json: completedCall };
    },
  });

  assert.equal(result.status, "failed");
  assert.deepEqual(result.state, original);
  assert.doesNotMatch(result.message, /private transcript/);
});

test("private-key and mobile guards make no network requests", async () => {
  const vapi = await loadVapiUsage();
  assert.equal(vapi.readVapiPrivateKey({ VAPI_PRIVATE_KEY: " secret " }), "secret");
  assert.equal(vapi.readVapiPrivateKey(undefined), undefined);
  let requests = 0;
  const request = async () => {
    requests += 1;
    throw new Error("must not run");
  };

  const missing = await vapi.reconcileVapiUsage(emptyState(), {
    assistantId: "assistant-1",
    request,
  });
  const mobile = await vapi.reconcileVapiUsage(emptyState(), {
    assistantId: "assistant-1",
    privateKey: "private-key",
    isMobile: true,
    request,
  });

  assert.equal(missing.status, "missing-key");
  assert.match(missing.message, /VAPI_PRIVATE_KEY/);
  assert.match(missing.message, /fully restart Obsidian/i);
  assert.match(missing.message, /mobile/i);
  assert.equal(mobile.status, "mobile");
  assert.match(mobile.message, /desktop reconciliation/i);
  assert.equal(requests, 0);
});
