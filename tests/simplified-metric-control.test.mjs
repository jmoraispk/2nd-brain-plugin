import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("activity metric cycling advances and wraps", async () => {
  const dashboard = await loadDashboardModule();

  assert.equal(dashboard.nextActivityMetric?.("captures"), "words");
  assert.equal(dashboard.nextActivityMetric?.("words"), "captures");
});

test("releasing before the hold threshold resolves as a short press", async () => {
  const dashboard = await loadDashboardModule();
  const controller = dashboard.createLongPressController?.(() => {}, 20);

  assert.ok(controller, "the metric control should expose press handling");
  controller.start();
  assert.equal(controller.finish(), "short");
});

test("holding through the threshold opens the menu without a short press", async () => {
  const dashboard = await loadDashboardModule();
  let menuOpenCount = 0;
  const controller = dashboard.createLongPressController?.(
    () => {
      menuOpenCount += 1;
    },
    20
  );

  assert.ok(controller, "the metric control should expose press handling");
  controller.start();
  await new Promise((resolve) => setTimeout(resolve, 40));

  assert.equal(menuOpenCount, 1);
  assert.equal(controller.finish(), "long");
});

let dashboardModule;

async function loadDashboardModule() {
  dashboardModule ??= build({
    entryPoints: [path.join(repoRoot, "src", "simplifiedDashboard.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    plugins: [obsidianStubPlugin()],
  }).then(({ outputFiles }) => {
    const source = outputFiles[0].text;
    return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
  });
  return dashboardModule;
}

function obsidianStubPlugin() {
  return {
    name: "obsidian-test-stub",
    setup(buildApi) {
      buildApi.onResolve({ filter: /^obsidian$/ }, () => ({
        path: "obsidian",
        namespace: "obsidian-test-stub",
      }));
      buildApi.onLoad(
        { filter: /.*/, namespace: "obsidian-test-stub" },
        () => ({
          contents: `
            export class Component {}
            export class Menu {}
            export class TFile {}
            export class TFolder {}
            export const MarkdownRenderer = {};
          `,
          loader: "js",
        })
      );
    },
  };
}
