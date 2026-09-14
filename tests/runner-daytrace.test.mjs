import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HEADER = "| Project / workstream | Apparent achievements | Work and topics |";
const table = (label) => `${HEADER}\n| --- | --- | --- |\n| ${label} | Done | Details |`;

test("selected-date Review accepts Activity-only dates and appends exact tables", async () => {
  const { runner, requests } = await loadRunner();
  const vault = new FakeVault(globalThis.__RunnerTFile);
  vault.seed("🧑 Me/Logs/2026/Q3/W37/2026-09-13.md", "Worked on capture UI.");
  vault.seed(summaryPath("2026-09-13", "W37"), `# DayTrace\n\n${table("Plugin")}`);
  vault.seed(summaryPath("2026-09-14", "W38"), `# DayTrace\n\n${table("DayTrace")}`);

  const result = await runner.runCommand(
    { vault },
    settings(),
    command(),
    "0.18.1",
    undefined,
    undefined,
    { start: "2026-09-13", end: "2026-09-14" }
  );

  assert.equal(result.kind, "fresh");
  assert.equal(requests.length, 1);
  const prompt = JSON.parse(requests[0].body).messages[1].content;
  assert.match(prompt, /#### Daily log\n\nWorked on capture UI\./);
  assert.match(prompt, /### 2026-09-14\n\n#### Activity summary/);
  const output = vault.content(result.file.path);
  assert.match(output, /Model review\n\n## Activity/);
  assert.match(output, new RegExp(escapeRegex(`### 2026-09-13\n\n${table("Plugin")}`)));
  assert.match(output, new RegExp(escapeRegex(`### 2026-09-14\n\n${table("DayTrace")}`)));
});

test("Activity fingerprints cache Reviews and invalidate after summary changes", async () => {
  const { runner, requests } = await loadRunner();
  const vault = new FakeVault(globalThis.__RunnerTFile);
  const activityPath = summaryPath("2026-09-14", "W38");
  vault.seed(activityPath, `# DayTrace\n\n${table("Before")}`);
  const args = [
    { vault }, settings(), command(), "0.18.1", undefined, undefined,
    { start: "2026-09-14", end: "2026-09-14" },
  ];

  await runner.runCommand(...args);
  const cached = await runner.runCommand(...args);
  assert.equal(cached.kind, "cache-hit");
  assert.equal(requests.length, 1);

  vault.write(activityPath, `# DayTrace\n\n${table("After")}`);
  const refreshed = await runner.runCommand(...args);
  assert.equal(refreshed.kind, "fresh");
  assert.equal(requests.length, 2);
  assert.match(vault.content(refreshed.file.path), new RegExp(escapeRegex(table("After"))));
});

test("malformed Activity is still useful model context but produces no invented table", async () => {
  const { runner } = await loadRunner();
  const vault = new FakeVault(globalThis.__RunnerTFile);
  vault.seed(summaryPath("2026-09-14", "W38"), "# DayTrace\n\nSummary without a table.");

  const result = await runner.runCommand(
    { vault }, settings(), command(), "0.18.1", undefined, undefined,
    { start: "2026-09-14", end: "2026-09-14" }
  );

  const output = vault.content(result.file.path);
  assert.doesNotMatch(output, /## Activity/);
  assert.doesNotMatch(output, /Project \/ workstream/);
});

function settings() {
  return {
    provider: "openai",
    openaiApiKey: "test-key",
    openaiModel: "gpt-5",
    anthropicApiKey: "",
    anthropicModel: "claude-sonnet-4-6",
    logsFolder: "🧑 Me/Logs",
    dailyLogPathTemplate: "🧑 Me/Logs/{ISO_YEAR}/Q{Q}/W{WW}/{YYYY-MM-DD}.md",
    reviewsPathTemplate: "🤖 AI/Reviews/Daily/{YYYY-MM-DD}.md",
    modelRoutes: {},
  };
}

function command() {
  return {
    id: "review-date-range",
    label: "Capture Review",
    inputs: [{ kind: "date-range-logs", label: "Captures in the selected range" }],
    outputPath: "🤖 AI/Reviews/Custom/{RANGE_START}--{RANGE_END}.md",
    systemPrompt: "Write a factual review.",
  };
}

function summaryPath(date, week) {
  return `🤖 AI/Activity/Daytrace/Summaries/2026/Q3/${week}/${date}.md`;
}

class FakeVault {
  constructor(TFile) {
    this.TFile = TFile;
    this.items = new Map();
  }
  seed(pathname, content) {
    const file = new this.TFile(pathname);
    file.content = content;
    this.items.set(pathname, file);
    return file;
  }
  getAbstractFileByPath(pathname) { return this.items.get(pathname) ?? null; }
  async read(file) { return file.content; }
  async create(pathname, content) { return this.seed(pathname, content); }
  async modify(file, content) { file.content = content; }
  async createFolder() {}
  content(pathname) { return this.items.get(pathname)?.content; }
  write(pathname, content) { this.items.get(pathname).content = content; }
}

async function loadRunner() {
  const requests = [];
  globalThis.__runnerRequester = async (request) => {
    requests.push(request);
    return {
      status: 200,
      text: "",
      json: {
        id: `chatcmpl-${requests.length}`,
        choices: [{ message: { content: "Model review" } }],
        usage: { prompt_tokens: 10, completion_tokens: 2 },
      },
    };
  };
  const result = await build({
    entryPoints: [path.join(repoRoot, "src", "runner.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    plugins: [obsidianStubPlugin()],
  });
  const source = Buffer.from(result.outputFiles[0].contents).toString("base64");
  const runner = await import(`data:text/javascript;base64,${source}#${Math.random()}`);
  return { runner, requests };
}

function obsidianStubPlugin() {
  return {
    name: "obsidian-runner-stub",
    setup(buildApi) {
      buildApi.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "runner-stub" }));
      buildApi.onLoad({ filter: /.*/, namespace: "runner-stub" }, () => ({
        contents: `
          export class TFile {
            constructor(path) {
              this.path = path;
              this.name = path.split('/').at(-1);
              this.basename = this.name.replace(/\\.md$/, '');
            }
          }
          export class TFolder { constructor(path) { this.path = path; this.children = []; } }
          globalThis.__RunnerTFile = TFile;
          export async function requestUrl(request) { return globalThis.__runnerRequester(request); }
        `,
        loader: "js",
      }));
    },
  };
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
