import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("settings show the installed version after Logs", async () => {
  const settings = await loadSettingsModule();
  const plugin = {
    errorLog: { count: () => 0 },
    manifest: { version: "9.8.7" },
    settings: { ...settings.DEFAULT_SETTINGS },
  };
  const tab = new settings.SecondBrainSettingTab({}, plugin);

  tab.display();

  const topLevel = tab.containerEl.children;
  const logs = topLevel.at(-2);
  const footer = topLevel.at(-1);
  assert.equal(logs?.tagName, "details", "Logs should remain the final settings menu");
  assert.equal(logs?.children[0]?.textContent, "Logs");
  assert.equal(footer?.tagName, "p", "Version should sit outside the settings menus");
  assert.equal(footer?.className, "second-brain-settings-version");
  assert.equal(footer?.textContent, "Second Brain · v9.8.7");
});

async function loadSettingsModule() {
  const result = await build({
    entryPoints: [path.join(repoRoot, "src", "settings.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    plugins: [obsidianStubPlugin()],
  });
  const source = result.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
}

function obsidianStubPlugin() {
  return {
    name: "obsidian-settings-test-stub",
    setup(buildApi) {
      buildApi.onResolve({ filter: /^obsidian$/ }, () => ({
        path: "obsidian",
        namespace: "obsidian-settings-test-stub",
      }));
      buildApi.onLoad(
        { filter: /.*/, namespace: "obsidian-settings-test-stub" },
        () => ({
          contents: `
            class FakeElement {
              constructor(tagName, options = {}) {
                this.tagName = tagName;
                this.className = options.cls ?? "";
                this.textContent = options.text ?? "";
                this.children = [];
              }
              createEl(tagName, options = {}) {
                const child = new FakeElement(tagName, options);
                this.children.push(child);
                return child;
              }
              createDiv(options = {}) { return this.createEl("div", options); }
              addClass(className) { this.className = className; }
              empty() { this.children = []; this.textContent = ""; }
              setAttribute() {}
              appendText(text) { this.textContent += text; }
              setText(text) { this.textContent = text; }
            }

            class FakeControl {
              constructor() { this.inputEl = new FakeElement("input"); }
              addOption() { return this; }
              setButtonText() { return this; }
              setCta() { return this; }
              setDisabled() { return this; }
              setPlaceholder() { return this; }
              setTooltip() { return this; }
              setValue() { return this; }
              setWarning() { return this; }
              onChange() { return this; }
              onClick() { return this; }
            }

            export class PluginSettingTab {
              constructor(app, plugin) {
                this.app = app;
                this.plugin = plugin;
                this.containerEl = new FakeElement("div");
              }
            }
            export class Setting {
              constructor(parent) {
                this.settingEl = parent.createDiv({ cls: "setting-item" });
                this.descEl = this.settingEl.createDiv({ cls: "setting-item-description" });
              }
              setName(name) { this.settingEl.createEl("div", { text: name }); return this; }
              setDesc(description) { this.descEl.textContent = description; return this; }
              addButton(callback) { callback(new FakeControl()); return this; }
              addDropdown(callback) { callback(new FakeControl()); return this; }
              addText(callback) { callback(new FakeControl()); return this; }
              addTextArea(callback) { callback(new FakeControl()); return this; }
            }
            export class App {}
            export class Component {}
            export class ItemView {}
            export class Menu {}
            export class Modal {}
            export class Notice {}
            export class Plugin {}
            export class TFile {}
            export class TFolder {}
            export class WorkspaceLeaf {}
            export const MarkdownRenderer = {};
            export const Platform = {};
            export async function requestUrl() { return {}; }
          `,
          loader: "js",
        })
      );
    },
  };
}
