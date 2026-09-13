import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("file notice opens the exact file and dismisses itself", async () => {
  const { showFileNotice, TFile } = await loadFileNoticeModule();
  const file = new TFile("Reports/2026-09-13.md");
  const opened = [];
  const app = {
    workspace: {
      getLeaf(newLeaf) {
        assert.equal(newLeaf, false);
        return {
          async openFile(target) {
            opened.push(target);
          },
        };
      },
    },
  };

  const notice = showFileNotice(app, "Activity summary created", file);

  assert.equal(
    notice.message.textContent,
    "Activity summary created → Reports/2026-09-13.md · Open file"
  );
  const link = notice.message.children.at(-1);
  assert.equal(link.tagName, "a");
  assert.equal(link.textContent, "Open file");

  await link.click();

  assert.deepEqual(opened, [file]);
  assert.equal(notice.hidden, true);
});

test("file notice resolves a vault path before opening", async () => {
  const { showFileNotice, TFile } = await loadFileNoticeModule();
  const file = new TFile("Logs/2026-09-13.md");
  const opened = [];
  const app = {
    vault: {
      getAbstractFileByPath(path) {
        assert.equal(path, file.path);
        return file;
      },
    },
    workspace: {
      getLeaf() {
        return { async openFile(target) { opened.push(target); } };
      },
    },
  };

  const notice = showFileNotice(app, "Captured", file.path);
  assert.equal(
    notice.message.textContent,
    "Captured → Logs/2026-09-13.md · Open file"
  );
  await notice.message.children.at(-1).click();

  assert.deepEqual(opened, [file]);
});

async function loadFileNoticeModule() {
  const result = await build({
    entryPoints: [path.join(repoRoot, "src", "fileNotice.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    plugins: [obsidianStubPlugin()],
  });
  const source = result.outputFiles[0].text;
  const module = await import(
    `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
  );
  return { ...module, TFile: globalThis.__FileNoticeTFile };
}

function obsidianStubPlugin() {
  return {
    name: "obsidian-file-notice-test-stub",
    setup(buildApi) {
      buildApi.onResolve({ filter: /^obsidian$/ }, () => ({
        path: "obsidian",
        namespace: "obsidian-file-notice-test-stub",
      }));
      buildApi.onLoad(
        { filter: /.*/, namespace: "obsidian-file-notice-test-stub" },
        () => ({
          contents: `
            export class TFile {
              constructor(path) { this.path = path; }
            }
            globalThis.__FileNoticeTFile = TFile;
            export class Notice {
              constructor(message) {
                this.message = message;
                this.hidden = false;
              }
              hide() { this.hidden = true; }
            }
            export class App {}
          `,
          loader: "js",
        })
      );
    },
  };
}

class FakeNode {
  constructor(tagName = "") {
    this.tagName = tagName;
    this.textContent = "";
    this.children = [];
    this.listeners = new Map();
  }

  append(...values) {
    for (const value of values) {
      if (typeof value === "string") {
        this.textContent += value;
      } else {
        this.children.push(value);
        this.textContent += value.textContent;
      }
    }
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  async click() {
    const pending = this.listeners.get("click")?.({ preventDefault() {} });
    await pending;
  }
}

globalThis.document = {
  createDocumentFragment: () => new FakeNode(),
  createElement: (tagName) => new FakeNode(tagName),
};
