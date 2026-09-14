import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("dashboard utilities render a book History button between Refresh and Settings", async () => {
  const utilities = await loadModule();
  const parent = new FakeElement();
  const clicked = [];
  utilities.renderDashboardUtilityButtons(parent, {
    onRefresh: () => clicked.push("refresh"),
    onHistory: () => clicked.push("history"),
    onSettings: () => clicked.push("settings"),
  });

  assert.deepEqual(parent.children.map((item) => item.attributes.title), [
    "Refresh", "Usage history", "Settings",
  ]);
  assert.equal(parent.children[1].icon, "book-open");
  assert.equal(parent.children[1].attributes["aria-label"], "Usage history");
  for (const child of parent.children) child.trigger("click");
  assert.deepEqual(clicked, ["refresh", "history", "settings"]);
});

test("both dashboard top bars use the shared History utilities", async () => {
  const source = await readFile(path.join(repoRoot, "src", "view.ts"), "utf8");
  assert.equal(
    source.match(/renderDashboardUtilityButtons\(right,/g)?.length,
    2,
    "complete and simplified top bars should both render the utility group"
  );
});

class FakeElement {
  constructor() { this.children = []; this.listeners = new Map(); this.attributes = {}; }
  createEl(_tag, options = {}) {
    const child = new FakeElement();
    child.textContent = options.text ?? "";
    child.className = options.cls ?? "";
    child.attributes = { ...(options.attr ?? {}) };
    this.children.push(child);
    return child;
  }
  addEventListener(name, callback) { this.listeners.set(name, callback); }
  trigger(name) { this.listeners.get(name)?.(); }
}

async function loadModule() {
  const result = await build({
    entryPoints: [path.join(repoRoot, "src", "dashboardUtilityButtons.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    plugins: [{
      name: "obsidian-utility-stub",
      setup(buildApi) {
        buildApi.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "utility-stub" }));
        buildApi.onLoad({ filter: /.*/, namespace: "utility-stub" }, () => ({
          contents: "export function setIcon(element, icon) { element.icon = icon; }",
          loader: "js",
        }));
      },
    }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString("base64")}`);
}
