import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("an activity summary keeps an existing capture draft instead of erasing it", async () => {
  const daytrace = await loadDaytraceModule();

  assert.equal(
    daytrace.mergeCaptureDraft("Remember this", "| Workstream | Work |\n| --- | --- |"),
    "Remember this\n\n| Workstream | Work |\n| --- | --- |"
  );
  assert.equal(daytrace.mergeCaptureDraft("", "Fetched activity"), "Fetched activity");
});

test("successful Activity stays out of Capture while fallback remains editable", async () => {
  const daytrace = await loadDaytraceModule();
  const summaryFile = new globalThis.__DaytraceTFile("summary.md");

  assert.equal(
    daytrace.activityCaptureDraft("Existing thought", {
      captureMarkdown: "AI table",
      evidenceFile: new globalThis.__DaytraceTFile("evidence.json"),
      summaryFile,
    }),
    "Existing thought"
  );
  assert.equal(
    daytrace.activityCaptureDraft("Existing thought", {
      captureMarkdown: "Deterministic activity",
      evidenceFile: new globalThis.__DaytraceTFile("evidence.json"),
      fallbackCode: "network",
    }),
    "Existing thought\n\nDeterministic activity"
  );
});

test("Activity regenerates only when evidence size changes by more than five percent", async () => {
  const daytrace = await loadDaytraceModule();
  const summary = [
    "---",
    "daytrace-evidence-bytes: 100",
    "---",
    "",
    "# Existing summary",
  ].join("\n");

  assert.equal(daytrace.shouldRegenerateDaytraceSummary(undefined, 100), true);
  assert.equal(daytrace.shouldRegenerateDaytraceSummary(summary, 105), false);
  assert.equal(daytrace.shouldRegenerateDaytraceSummary(summary, 95), false);
  assert.equal(daytrace.shouldRegenerateDaytraceSummary(summary, 106), true);
  assert.equal(daytrace.shouldRegenerateDaytraceSummary(summary, 94), true);
});

test("Activity date ranges are inclusive", async () => {
  const daytrace = await loadDaytraceModule();
  assert.deepEqual(
    daytrace.daytraceDatesInRange("2026-09-12", "2026-09-14"),
    ["2026-09-12", "2026-09-13", "2026-09-14"]
  );
});

test("multi-day Activity runs sequentially and continues after a failed date", async () => {
  const daytrace = await loadDaytraceModule();
  const timeline = [];
  const entries = await daytrace.processDaytraceRange(
    ["2026-09-12", "2026-09-13", "2026-09-14"],
    async (date) => {
      timeline.push(`start:${date}`);
      if (date === "2026-09-13") throw new Error("ActivityWatch unavailable");
      await Promise.resolve();
      timeline.push(`end:${date}`);
      return { summaryStatus: date.endsWith("12") ? "generated" : "unchanged" };
    }
  );

  assert.deepEqual(timeline, [
    "start:2026-09-12", "end:2026-09-12",
    "start:2026-09-13",
    "start:2026-09-14", "end:2026-09-14",
  ]);
  assert.deepEqual(entries.map((entry) => [entry.date, entry.status]), [
    ["2026-09-12", "generated"],
    ["2026-09-13", "failed"],
    ["2026-09-14", "unchanged"],
  ]);
  assert.match(entries[1].error.message, /ActivityWatch unavailable/);
});

test("multi-day Activity announces each date before its request starts", async () => {
  const daytrace = await loadDaytraceModule();
  const timeline = [];
  await daytrace.processDaytraceRange(
    ["2026-09-12", "2026-09-13"],
    async (date) => {
      timeline.push(`request:${date}`);
      return { summaryStatus: "unchanged" };
    },
    (date, index, total) => timeline.push(`notice:${index + 1}/${total}:${date}`)
  );
  assert.deepEqual(timeline, [
    "notice:1/2:2026-09-12", "request:2026-09-12",
    "notice:2/2:2026-09-13", "request:2026-09-13",
  ]);
});

test("cancelling Activity stops the remaining selected dates", async () => {
  const daytrace = await loadDaytraceModule();
  const started = [];
  await assert.rejects(
    daytrace.processDaytraceRange(
      ["2026-09-12", "2026-09-13"],
      async (date) => {
        started.push(date);
        throw new DOMException("cancelled", "AbortError");
      }
    ),
    (error) => error?.name === "AbortError"
  );
  assert.deepEqual(started, ["2026-09-12"]);
});

test("every DayTrace stage produces visible elapsed progress", async () => {
  const daytrace = await loadDaytraceModule();
  const cases = [
    [{ stage: "activitywatch:info", elapsedSeconds: 7 }, "ActivityWatch connected · 7s"],
    [{ stage: "activitywatch:buckets", elapsedSeconds: 7, current: 2, total: 2 }, "ActivityWatch buckets loaded · 2/2 · 7s"],
    [{ stage: "activitywatch:events", elapsedSeconds: 7, current: 2, total: 2 }, "Activity events loaded · 2/2 · 7s"],
    [{ stage: "pipeline:normalize", elapsedSeconds: 7, current: 8, total: 8 }, "Normalizing activity · 8/8 · 7s"],
    [{ stage: "pipeline:sanitize", elapsedSeconds: 7, current: 8, total: 8 }, "Sanitizing activity · 8/8 · 7s"],
    [{ stage: "pipeline:fuse", elapsedSeconds: 7, current: 8, total: 8 }, "Combining watcher data · 8/8 · 7s"],
    [{ stage: "pipeline:sessions", elapsedSeconds: 7, current: 4, total: 4 }, "Building activity sessions · 4/4 · 7s"],
    [{ stage: "pipeline:episodes", elapsedSeconds: 7, current: 3, total: 3 }, "Building activity episodes · 3/3 · 7s"],
    [{ stage: "summary:chunk", elapsedSeconds: 7, current: 1, total: 2 }, "Sending activity to AI · 1/2 · 7s"],
    [{ stage: "summary:response", elapsedSeconds: 7, current: 1, total: 2 }, "AI response received · 1/2 · 7s"],
    [{ stage: "summary:validate", elapsedSeconds: 7, current: 1, total: 2 }, "Validating AI summary · 1/2 · 7s"],
    [{ stage: "summary:repair", elapsedSeconds: 7, current: 1, total: 2 }, "Repairing AI allocation · 1/2 · 7s"],
    [{ stage: "summary:merge", elapsedSeconds: 7, current: 1, total: 2 }, "Merging AI workstreams · 1/2 · 7s"],
    [{ stage: "complete", elapsedSeconds: 7 }, "Activity collection complete · 7s"],
  ];

  for (const [event, expected] of cases) {
    assert.equal(daytrace.daytraceProgressMessage(event), expected);
  }
});

test("ActivityWatch transport sends the exact local request and respects query values", async () => {
  const daytrace = await loadDaytraceModule();
  let observed;
  const transport = daytrace.createActivityWatchTransport(async (request) => {
    observed = request;
    return { status: 200, json: [{ id: 1 }] };
  });

  const result = await transport.request({
    server: "http://127.0.0.1:5600",
    path: "/api/0/buckets/aw-watcher-window_test/events",
    query: {
      start: "2026-09-13T00:00:00-07:00",
      end: "2026-09-14T00:00:00-07:00",
    },
  });

  assert.deepEqual(result, [{ id: 1 }]);
  assert.equal(observed.method, "GET");
  assert.equal(observed.throw, false);
  assert.equal(
    observed.url,
    "http://127.0.0.1:5600/api/0/buckets/aw-watcher-window_test/events?start=2026-09-13T00%3A00%3A00-07%3A00&end=2026-09-14T00%3A00%3A00-07%3A00"
  );
});

test("OpenAI DayTrace requests use strict JSON output without provider storage", async () => {
  const daytrace = await loadDaytraceModule();
  let observed;
  const provider = daytrace.createDaytraceSummaryProvider(
    settings({ provider: "openai", openaiApiKey: "openai-secret", openaiModel: "gpt-5" }),
    async (request) => {
      observed = request;
      return {
        status: 200,
        json: {
          id: "chatcmpl_123",
          choices: [{ message: { content: '{"schema":"daytrace.workstream-digest.v2"}' } }],
          usage: { prompt_tokens: 21, completion_tokens: 8 },
        },
      };
    }
  );
  const format = responseFormat();

  const result = await provider.complete(providerRequest(format));
  const body = JSON.parse(observed.body);

  assert.equal(observed.url, "https://api.openai.com/v1/chat/completions");
  assert.equal(observed.headers.authorization, "Bearer openai-secret");
  assert.equal(body.store, false);
  assert.deepEqual(body.response_format, {
    type: "json_schema",
    json_schema: {
      name: "daytrace_workstream_digest_v2",
      strict: true,
      schema: format.schema,
    },
  });
  assert.deepEqual(JSON.parse(body.messages[1].content), { episodes: [] });
  assert.equal(JSON.stringify(body).includes("openai-secret"), false);
  assert.deepEqual(result, {
    payload: { schema: "daytrace.workstream-digest.v2" },
    provider: "openai",
    model: "gpt-5",
    inputTokens: 21,
    outputTokens: 8,
    responseId: "chatcmpl_123",
  });
});

test("Anthropic DayTrace requests translate the shared schema to output_config.format", async () => {
  const daytrace = await loadDaytraceModule();
  let observed;
  const provider = daytrace.createDaytraceSummaryProvider(
    settings({
      provider: "anthropic",
      anthropicApiKey: "anthropic-secret",
      anthropicModel: "claude-sonnet-4-6",
    }),
    async (request) => {
      observed = request;
      return {
        status: 200,
        json: {
          id: "msg_123",
          content: [{ type: "text", text: '{"schema":"daytrace.workstream-digest.v2"}' }],
          usage: { input_tokens: 34, output_tokens: 13 },
        },
      };
    }
  );
  const format = responseFormat();

  const result = await provider.complete(providerRequest(format));
  const body = JSON.parse(observed.body);

  assert.equal(observed.url, "https://api.anthropic.com/v1/messages");
  assert.equal(observed.headers["x-api-key"], "anthropic-secret");
  assert.deepEqual(body.output_config, {
    format: {
      type: "json_schema",
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["schema"],
        properties: {
          schema: { type: "string" },
          items: {
            type: "array",
            minItems: 1,
            items: { type: "string" },
          },
        },
      },
    },
  });
  assert.equal(JSON.stringify(body).includes("anthropic-secret"), false);
  assert.equal(result.provider, "anthropic");
  assert.equal(result.model, "claude-sonnet-4-6");
  assert.equal(result.inputTokens, 34);
  assert.equal(result.outputTokens, 13);
  assert.equal(result.responseId, "msg_123");
});

test("DayTrace provider calls share one content-free Activity interaction", async () => {
  const daytrace = await loadDaytraceModule();
  const events = [];
  daytrace.configureUsageEventSink((event) => events.push(event));
  let requestNumber = 0;
  const provider = daytrace.createDaytraceSummaryProvider(
    settings({ provider: "openai", openaiApiKey: "secret", openaiModel: "gpt-5" }),
    async () => {
      requestNumber += 1;
      return {
        status: 200,
        json: {
          id: `chatcmpl-daytrace-${requestNumber}`,
          choices: [{ message: { content: '{"schema":"daytrace.workstream-digest.v2"}' } }],
          usage: { prompt_tokens: 20 + requestNumber, completion_tokens: 5 },
        },
      };
    },
    { action: "Activity", interactionId: "activity-1" }
  );

  await provider.complete(providerRequest(responseFormat()));
  await provider.complete(providerRequest(responseFormat()));

  assert.equal(events.length, 2);
  assert.deepEqual(
    events.map(({ action, interactionId, provider, model, status }) => ({
      action,
      interactionId,
      provider,
      model,
      status,
    })),
    [
      { action: "Activity", interactionId: "activity-1", provider: "openai", model: "gpt-5", status: "completed" },
      { action: "Activity", interactionId: "activity-1", provider: "openai", model: "gpt-5", status: "completed" },
    ]
  );
  assert.doesNotMatch(JSON.stringify(events), /daytrace.workstream-digest/);
  daytrace.configureUsageEventSink(undefined);
});

test("generation migrates a legacy summary, stores Human evidence, and skips unchanged AI work", async () => {
  const daytrace = await loadDaytraceModule();
  const vault = new FakeVault(globalThis.__DaytraceTFile);
  const summaryPath =
    "🤖 AI/Activity/Daytrace/Summaries/2026/Q3/W37/2026-09-13.md";
  await vault.create(summaryPath, "# Legacy DayTrace summary without a size baseline");
  const app = { vault };
  let providerCalls = 0;
  const baseEventTitle = "daytrace integration";
  let eventTitle = baseEventTitle;
  const request = async (input) => {
    const url = new URL(input.url);
    if (url.pathname === "/api/0/info") {
      return { status: 200, json: { version: "0.13.2", testing: false } };
    }
    if (url.pathname === "/api/0/buckets") {
      return {
        status: 200,
        json: {
          "aw-watcher-window_test": {
            type: "currentwindow",
            client: "aw-watcher-window",
            hostname: "test",
          },
        },
      };
    }
    if (url.pathname.endsWith("/events")) {
      return {
        status: 200,
        json: [
          {
            id: 7,
            timestamp: "2026-09-13T16:00:00Z",
            duration: 1800,
            data: { app: "Visual Studio Code", title: eventTitle },
          },
        ],
      };
    }
    if (input.url === "https://api.openai.com/v1/chat/completions") {
      providerCalls += 1;
      const body = JSON.parse(input.body);
      const episodeId =
        body.response_format.json_schema.schema.properties.workstreams.items.properties
          .episode_ids.items.enum[0];
      return {
        status: 200,
        json: {
          id: "chatcmpl_daytrace",
          choices: [
            {
              message: {
                content: JSON.stringify({
                  schema: "daytrace.workstream-digest.v2",
                  workstreams: [
                    {
                      label: "DayTrace integration",
                      confidence: "high",
                      episode_ids: [episodeId],
                      topics: [{ text: "Connected the Obsidian plugin", evidence: [episodeId] }],
                      outcomes: [
                        {
                          text: "Worked on the integration",
                          strength: "observed",
                          evidence: [episodeId],
                        },
                      ],
                    },
                  ],
                  unassigned_episode_ids: [],
                }),
              },
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 50 },
        },
      };
    }
    throw new Error(`Unexpected request: ${input.url}`);
  };

  const result = await daytrace.generateDaytraceActivity(
    app,
    settings({ provider: "openai", openaiApiKey: "secret", openaiModel: "gpt-5" }),
    "2026-09-13",
    { request, timezoneName: "UTC" }
  );

  assert.equal(
    result.evidenceFile.path,
    "🧑 Me/Activity/Daytrace/Evidence/2026/Q3/W37/2026-09-13.json"
  );
  assert.equal(
    result.summaryFile.path,
    "🤖 AI/Activity/Daytrace/Summaries/2026/Q3/W37/2026-09-13.md"
  );
  assert.match(result.captureMarkdown, /\| Project \/ workstream \| Apparent achievements \| Work and topics \|/);
  assert.match(result.captureMarkdown, /DayTrace integration/);
  assert.equal(result.summaryStatus, "generated");
  assert.equal(result.fallbackCode, undefined);
  assert.match(vault.content(result.evidenceFile.path), /"schema": "daytrace\.episode-bundle\.v1"/);
  assert.match(vault.content(result.summaryFile.path), /daytrace-evidence-bytes: \d+/);
  assert.match(vault.content(result.summaryFile.path), /DayTrace integration/);

  await vault.modify(result.evidenceFile, "stale evidence that must be replaced");
  const unchanged = await daytrace.generateDaytraceActivity(
    app,
    settings({ provider: "openai", openaiApiKey: "secret", openaiModel: "gpt-5" }),
    "2026-09-13",
    { request, timezoneName: "UTC" }
  );
  assert.equal(providerCalls, 1, "unchanged evidence should not spend another AI call");
  assert.equal(unchanged.summaryStatus, "unchanged");
  assert.equal(unchanged.summaryFile.path, result.summaryFile.path);
  assert.match(
    vault.content(unchanged.evidenceFile.path),
    /"schema": "daytrace\.episode-bundle\.v1"/,
    "fresh raw evidence must still replace the saved evidence when AI is skipped"
  );

  const summaryBaseline = Number(
    vault.content(result.summaryFile.path).match(/daytrace-evidence-bytes: (\d+)/)?.[1]
  );
  let previousEvidenceBytes = new TextEncoder().encode(
    vault.content(unchanged.evidenceFile.path)
  ).length;
  let withinThresholdRuns = 0;
  let regenerated;
  for (let added = 1; added <= 200; added += 1) {
    eventTitle = `${baseEventTitle}${"x".repeat(added)}`;
    const candidate = await daytrace.generateDaytraceActivity(
      app,
      settings({ provider: "openai", openaiApiKey: "secret", openaiModel: "gpt-5" }),
      "2026-09-13",
      { request, timezoneName: "UTC" }
    );
    const evidenceBytes = new TextEncoder().encode(
      vault.content(candidate.evidenceFile.path)
    ).length;
    if (candidate.summaryStatus === "generated") {
      assert.ok(
        Math.abs(evidenceBytes - previousEvidenceBytes) / previousEvidenceBytes <= 0.05,
        "a small step from the latest evidence should still regenerate once it exceeds the fixed summary baseline"
      );
      assert.ok(
        Math.abs(evidenceBytes - summaryBaseline) / summaryBaseline > 0.05
      );
      regenerated = candidate;
      break;
    }
    withinThresholdRuns += 1;
    assert.equal(candidate.summaryStatus, "unchanged");
    assert.match(
      vault.content(candidate.summaryFile.path),
      new RegExp(`daytrace-evidence-bytes: ${summaryBaseline}(?:\\r?\\n|$)`),
      "an unchanged run must not roll the summary baseline forward"
    );
    previousEvidenceBytes = evidenceBytes;
  }
  assert.ok(withinThresholdRuns > 0, "the sequence should include within-threshold refreshes");
  assert.ok(regenerated, "cumulative evidence growth should eventually regenerate the AI summary");
  assert.equal(providerCalls, 2);
});

test("provider network failure returns deterministic activity and marks an older AI summary stale", async () => {
  const daytrace = await loadDaytraceModule();
  const vault = new FakeVault(globalThis.__DaytraceTFile);
  const summaryPath =
    "🤖 AI/Activity/Daytrace/Summaries/2026/Q3/W37/2026-09-13.md";
  await vault.create(summaryPath, "old AI summary");
  const app = { vault };
  const request = async (input) => {
    const url = new URL(input.url);
    if (url.pathname === "/api/0/info")
      return { status: 200, json: { version: "0.13.2" } };
    if (url.pathname === "/api/0/buckets") return { status: 200, json: {} };
    if (input.url === "https://api.openai.com/v1/chat/completions")
      throw new TypeError("offline");
    throw new Error(`Unexpected request: ${input.url}`);
  };

  const result = await daytrace.generateDaytraceActivity(
    app,
    settings({ provider: "openai", openaiApiKey: "secret" }),
    "2026-09-13",
    { request, timezoneName: "UTC" }
  );

  assert.equal(result.fallbackCode, "provider-network");
  assert.equal(result.summaryFile, undefined);
  assert.match(result.captureMarkdown, /Summary: Deterministic activity episodes/);
  assert.match(vault.content(summaryPath), /daytrace-status: unavailable/);
  assert.doesNotMatch(vault.content(summaryPath), /old AI summary/);
});

test("an aborted generation makes no requests or vault writes", async () => {
  const daytrace = await loadDaytraceModule();
  const vault = new FakeVault(globalThis.__DaytraceTFile);
  const controller = new AbortController();
  controller.abort();
  let requests = 0;

  await assert.rejects(
    daytrace.generateDaytraceActivity(
      { vault },
      settings({ provider: "openai", openaiApiKey: "secret" }),
      "2026-09-13",
      {
        signal: controller.signal,
        request: async () => {
          requests += 1;
          return { status: 200, json: {} };
        },
        timezoneName: "UTC",
      }
    ),
    (error) => error?.name === "AbortError"
  );
  assert.equal(requests, 0);
  assert.equal(vault.items.size, 0);
});

function settings(overrides) {
  return {
    provider: "openai",
    openaiApiKey: "",
    openaiModel: "gpt-5",
    anthropicApiKey: "",
    anthropicModel: "claude-sonnet-4-6",
    ...overrides,
  };
}

function responseFormat() {
  return {
    type: "json_schema",
    name: "daytrace_workstream_digest_v2",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["schema"],
      properties: {
        schema: { type: "string", maxLength: 80 },
        items: {
          type: "array",
          minItems: 1,
          maxItems: 3,
          items: { type: "string", maxLength: 80 },
        },
      },
    },
  };
}

function providerRequest(format) {
  return {
    passKind: "chunk",
    payload: { episodes: [] },
    instructions: "Return the DayTrace digest.",
    responseFormat: format,
  };
}

class FakeVault {
  constructor(TFile) {
    this.TFile = TFile;
    this.items = new Map();
  }
  getAbstractFileByPath(pathname) {
    return this.items.get(pathname) ?? null;
  }
  async createFolder(pathname) {
    this.items.set(pathname, { path: pathname, kind: "folder" });
  }
  async create(pathname, content) {
    const file = new this.TFile(pathname);
    file.content = content;
    this.items.set(pathname, file);
    return file;
  }
  async modify(file, content) {
    file.content = content;
  }
  async read(file) {
    return file.content;
  }
  content(pathname) {
    return this.items.get(pathname)?.content;
  }
}

let daytraceModule;

async function loadDaytraceModule() {
  daytraceModule ??= build({
    stdin: {
      contents: `
        export * from "./src/daytraceIntegration.ts";
        export { configureUsageEventSink } from "./src/usageTelemetry.ts";
      `,
      resolveDir: repoRoot,
      sourcefile: "daytrace-usage-test-entry.ts",
    },
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    plugins: [obsidianStubPlugin()],
  }).then(({ outputFiles }) => {
    const source = outputFiles[0].text;
    return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
  });
  return daytraceModule;
}

function obsidianStubPlugin() {
  return {
    name: "obsidian-daytrace-test-stub",
    setup(buildApi) {
      buildApi.onResolve({ filter: /^obsidian$/ }, () => ({
        path: "obsidian",
        namespace: "obsidian-daytrace-test-stub",
      }));
      buildApi.onLoad(
        { filter: /.*/, namespace: "obsidian-daytrace-test-stub" },
        () => ({
          contents: `
            export class TFile {
              constructor(path) { this.path = path; }
            }
            export class TFolder {}
            globalThis.__DaytraceTFile = TFile;
            export async function requestUrl() {
              throw new Error("Unexpected default requestUrl call");
            }
          `,
          loader: "js",
        })
      );
    },
  };
}
