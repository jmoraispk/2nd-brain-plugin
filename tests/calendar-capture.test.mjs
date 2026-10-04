import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

let modulePromise;
async function loadView() {
  modulePromise ??= build({
    entryPoints: ["src/view.ts"], bundle: true, format: "esm", platform: "node", write: false,
    plugins: [{ name: "calendar-host", setup(api) {
      api.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "host" }));
      api.onLoad({ filter: /.*/, namespace: "host" }, () => ({ contents: `
        export class ItemView { constructor(leaf) { this.app = leaf.app; } }
        export class Modal {} export class PluginSettingTab {} export class Component {}
        export class Menu {} export class Setting {} export class Notice { hide() {} }
        export class TFile { constructor(path) { this.path = path; this.basename = path.split('/').at(-1).replace(/\\.md$/, ''); } }
        export class TFolder { constructor() { this.children = []; } }
        export const Platform = { isDesktopApp: true };
        export const MarkdownRenderer = {};
        export function setIcon() {} export async function requestUrl() {}
        globalThis.__calendarFile = TFile;
      `, loader: "js" }));
      api.onResolve({ filter: /\/voiceInterviewModal$/ }, () => ({ path: "voice", namespace: "voice" }));
      api.onLoad({ filter: /.*/, namespace: "voice" }, () => ({ contents: `
        export class VoiceCallModal {
          constructor(app, plugin, options) { globalThis.__calendarVoice = options; }
          open() {}
        }
      `, loader: "js" }));
      api.onResolve({ filter: /\/fileNotice$/ }, () => ({ path: "notice", namespace: "notice" }));
      api.onLoad({ filter: /.*/, namespace: "notice" }, () => ({ contents: "export function showFileNotice() {}", loader: "js" }));
    } }],
  }).then(({ outputFiles }) => import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString("base64")}`));
  return modulePromise;
}

async function fixture() {
  const { SecondBrainView } = await loadView();
  const files = new Map();
  const app = { vault: {
    getAbstractFileByPath: (path) => files.get(path) ?? null,
    read: async (file) => file.content,
    modify: async (file, content) => { file.content = content; },
    createFolder: async () => {},
    create: async (path, content) => {
      const file = new globalThis.__calendarFile(path); file.content = content; files.set(path, file); return file;
    },
  } };
  const errors = [];
  const remembered = [];
  const contexts = [];
  const plugin = {
    settings: { logsFolder: "Logs", dailyLogPathTemplate: "Logs/{YYYY-MM-DD}.md" },
    errorLog: { push: (...args) => errors.push(args) },
    rememberSavedText: (content, date) => remembered.push({ content, date }),
    voiceMemory: { callContext: async input => { contexts.push(input); return "Saved compact memory"; } },
  };
  const view = new SecondBrainView({ app }, plugin);
  view.render = async () => {};
  return { view, files, errors, remembered, contexts };
}

test("typed capture saves to the underlined day even while a different review range is selected", async () => {
  const { view, files, errors, remembered } = await fixture();
  Object.assign(view.simplifiedState, { captureDate: "2026-09-30", rangeStart: "2026-10-01", rangeEnd: "2026-10-03" });
  await view.saveSimplifiedCapture("Late night note");
  assert.deepEqual(errors, []);
  assert.equal(files.size, 1);
  assert.match(files.get("Logs/2026-09-30.md")?.content ?? "", /Late night note/);
  assert.deepEqual(remembered, [{ content: "Late night note", date: "2026-09-30" }]);
});

test("audio uses compact memory and restores its chosen capture day with the returned draft", async () => {
  const { view, files, errors, remembered, contexts } = await fixture();
  view.simplifiedState.captureDate = "2026-09-30";
  await view.saveSimplifiedCapture("Earlier September context");
  view.openSimplifiedVoiceCall("capture");
  const options = globalThis.__calendarVoice;
  assert.equal(options.targetDate, "2026-09-30");
  assert.equal(await options.context(), "Saved compact memory");
  assert.equal(contexts[0].mode, "capture");
  assert.notEqual(contexts[0].today, "2026-09-30", "memory freshness uses the call date, not a backdated capture destination");
  assert.equal(remembered.length, 1, "starting a call cannot update memory");
  view.simplifiedState.captureDate = "2026-10-01";
  const realWindow = globalThis.window;
  globalThis.window = { setTimeout: () => {} };
  try { await options.onDraft("Audio after midnight"); } finally { globalThis.window = realWindow; }
  assert.equal(view.simplifiedState.captureDate, "2026-09-30");
  await view.saveSimplifiedCapture(view.simplifiedState.captureDraft);
  assert.match(files.get("Logs/2026-09-30.md").content, /Audio after midnight/);
  assert.equal(files.size, 1);
  assert.deepEqual(errors, []);
});

test("a failed capture never asks for a memory update", async () => {
  const { view, remembered } = await fixture();
  view.app.vault.create = async () => { throw new Error("disk failure"); };
  await view.saveSimplifiedCapture("This did not save");
  assert.deepEqual(remembered, []);
});

test("Save reflection passes only the saved reflection to memory", async () => {
  const { view, files, remembered } = await fixture();
  view.reviewState.resultFile = new globalThis.__calendarFile("🤖 AI/Reviews/Custom/2026-09-30--2026-10-03.md");
  view.reviewState.resultContent = "AI claims are not personal memory evidence";
  view.reviewState.userReview = "I decided to focus on voice next week.";
  await view.finishReview();
  assert.equal(files.size, 1);
  assert.equal(remembered.length, 1);
  assert.equal(remembered[0].content, "I decided to focus on voice next week.");
});
