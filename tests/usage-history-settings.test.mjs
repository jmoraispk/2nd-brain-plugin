import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("History renders totals, grouped component details, and controls", async () => {
  const history = await loadHistorySettings();
  const now = new Date();
  const occurredAt = now.toISOString();
  const entries = [
    {
      id: "vapi:call-1",
      interactionId: "voice-1",
      occurredAt,
      action: "Capture call",
      component: "vapi-call",
      provider: "vapi",
      status: "completed",
      accuracy: "exact",
      costUsd: 0.08,
      durationSeconds: 92,
      callId: "call-1",
      vapiBreakdown: {
        transport: 0.002,
        transcription: 0.012,
        model: 0.014,
        voice: 0.032,
        platform: 0.02,
      },
    },
    {
      id: "openai:response-1",
      interactionId: "voice-1",
      occurredAt,
      action: "Capture call",
      component: "llm-request",
      provider: "openai",
      model: "gpt-5",
      status: "completed",
      accuracy: "estimated",
      costUsd: 0.002,
      usage: {
        inputTokens: 1200,
        cachedInputTokens: 200,
        outputTokens: 50,
        reasoningTokens: 20,
      },
      pricingVersion: "2026-09-13",
    },
  ];
  const root = history.__makeElement("div");
  const plugin = {
    app: {},
    usageHistory: { snapshot: () => ({ schemaVersion: 1, entries }) },
    refreshExactUsageCosts: async () => ({
      state: { schemaVersion: 1, entries },
      status: "updated",
      message: "Exact Vapi costs are current.",
      imported: 0,
      reconciled: 0,
    }),
    clearUsageHistory: async () => {},
  };

  history.renderUsageHistory(root, plugin);
  const text = collectText(root);

  for (const expected of [
    "Today",
    "7 days",
    "30 days",
    "Capture call",
    "OpenAI · gpt-5",
    "1m 32s",
    "≈$0.08",
    "Transport",
    "Transcription",
    "Model",
    "Voice",
    "Platform",
    "Input 1,200",
    "Cached 200",
    "Output 50",
    "Reasoning 20",
    "Refresh exact costs",
    "Clear history",
  ]) {
    assert.match(text, new RegExp(escapeRegex(expected)));
  }
});

test("usage cost formatting never presents pending or unknown as zero", async () => {
  const history = await loadHistorySettings();

  assert.equal(history.formatUsageCost(undefined, "pending", true), "Pending");
  assert.equal(history.formatUsageCost(undefined, "unknown", true), "Unknown");
  assert.equal(history.formatUsageCost(0.0042, "estimated", false), "≈$0.0042");
  assert.equal(history.formatUsageCost(0.08, "exact", false), "$0.08");
  assert.equal(history.formatUsageCost(0.08, "exact", true), "$0.08 + pending");
});

test("clearing History requires the modal confirmation", async () => {
  const history = await loadHistorySettings();
  let cleared = 0;
  const modal = new history.ClearUsageHistoryModal({}, async () => {
    cleared += 1;
  });

  modal.open();
  assert.equal(cleared, 0);
  const confirm = findByText(globalThis.__lastModal.contentEl, "Clear history");
  assert.ok(confirm);
  await confirm.trigger("click");
  assert.equal(cleared, 1);
});

function collectText(element) {
  return [element.textContent, ...element.children.map(collectText)]
    .filter(Boolean)
    .join(" ");
}

function findByText(element, text) {
  if (element.textContent === text) return element;
  for (const child of element.children) {
    const found = findByText(child, text);
    if (found) return found;
  }
  return undefined;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function loadHistorySettings() {
  const result = await build({
    stdin: {
      contents: `
        export * from "./src/usageHistorySettings.ts";
        export { __makeElement } from "obsidian";
      `,
      resolveDir: repoRoot,
      sourcefile: "usage-history-settings-test-entry.ts",
    },
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    plugins: [obsidianStubPlugin()],
  });
  const source = result.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}#${Math.random()}`);
}

function obsidianStubPlugin() {
  return {
    name: "obsidian-history-settings-test-stub",
    setup(buildApi) {
      buildApi.onResolve({ filter: /^obsidian$/ }, () => ({
        path: "obsidian",
        namespace: "obsidian-history-settings-test-stub",
      }));
      buildApi.onLoad(
        { filter: /.*/, namespace: "obsidian-history-settings-test-stub" },
        () => ({
          contents: `
            class FakeElement {
              constructor(tagName, options = {}) {
                this.tagName = tagName;
                this.className = options.cls ?? "";
                this.textContent = options.text ?? "";
                this.children = [];
                this.listeners = new Map();
              }
              createEl(tagName, options = {}) {
                const child = new FakeElement(tagName, options);
                this.children.push(child);
                return child;
              }
              createDiv(options = {}) { return this.createEl("div", options); }
              createSpan(options = {}) { return this.createEl("span", options); }
              empty() { this.children = []; this.textContent = ""; }
              addClass(className) { this.className += " " + className; }
              setText(text) { this.textContent = text; }
              setAttribute() {}
              addEventListener(name, callback) { this.listeners.set(name, callback); }
              async trigger(name) { return this.listeners.get(name)?.(); }
            }
            export function __makeElement(tagName) { return new FakeElement(tagName); }
            export class Modal {
              constructor(app) {
                this.app = app;
                this.modalEl = new FakeElement("div");
                this.contentEl = new FakeElement("div");
              }
              open() { globalThis.__lastModal = this; this.onOpen?.(); }
              close() { this.onClose?.(); }
            }
            export class Notice { constructor() {} }
          `,
          loader: "js",
        })
      );
    },
  };
}
