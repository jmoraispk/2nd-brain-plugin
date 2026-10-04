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

test("week bounds include every day across month and year boundaries", async () => {
  const dashboard = await loadDashboardModule();
  assert.deepEqual(dashboard.calendarBounds?.({ calendarMode: "week", weekAnchor: "2026-01-01" }),
    { start: "2025-12-29", end: "2026-01-04" });
  assert.deepEqual(dashboard.calendarBounds?.({ calendarMode: "week", weekAnchor: "2026-03-08" }),
    { start: "2026-03-02", end: "2026-03-08" });
});

test("review clicks preserve capture day; a double selection moves both", async () => {
  const dashboard = await loadDashboardModule();
  const state = { captureDate: "2026-10-03", rangeStart: "2026-10-03", rangeEnd: "2026-10-03" };
  assert.equal(typeof dashboard.selectCalendarDay, "function");
  dashboard.selectCalendarDay(state, "2026-09-30");
  dashboard.selectCalendarDay(state, "2026-10-02");
  assert.equal(state.captureDate, "2026-10-03");
  assert.equal(state.rangeStart, "2026-09-30");
  assert.equal(state.rangeEnd, "2026-10-02");
  dashboard.selectCalendarDay(state, "2026-10-01", true);
  assert.equal(state.captureDate, "2026-10-01");
  assert.equal(state.rangeStart, "2026-10-01");
  assert.equal(state.rangeEnd, "2026-10-01");
  assert.equal(state.rangeAnchor, undefined);
});

test("calendar hold changes capture only, double tap survives a rebuilt cell", async () => {
  const dashboard = await loadDashboardModule();
  assert.equal(typeof dashboard.bindCalendarDayGestures, "function");
  const taps = {};
  const actions = [];
  const makeCell = () => {
    const cell = new EventTarget();
    cell.getBoundingClientRect = () => ({ left: 0, top: 0, right: 50, bottom: 50 });
    cell.setPointerCapture = () => {};
    cell.hasPointerCapture = () => false;
    dashboard.bindCalendarDayGestures(cell, "2026-10-03", taps, {
      selectCalendarDate: (date) => actions.push(["review", date]),
      setCaptureDate: (date) => actions.push(["capture", date]),
      selectSingleDay: (date) => actions.push(["both", date]),
    });
    return cell;
  };
  const event = (name, props) => Object.assign(new Event(name, { cancelable: true }), props);
  let cell = makeCell();
  cell.dispatchEvent(event("click", { detail: 1 }));
  cell = makeCell();
  cell.dispatchEvent(event("click", { detail: 1 }));
  assert.deepEqual(actions, [["review", "2026-10-03"], ["both", "2026-10-03"]]);
  actions.length = 0;
  cell.dispatchEvent(event("pointerdown", { isPrimary: true, button: 0, pointerId: 1, clientX: 10, clientY: 10 }));
  await new Promise((resolve) => setTimeout(resolve, 550));
  cell.dispatchEvent(event("pointerup", { pointerId: 1, clientX: 10, clientY: 10 }));
  cell.dispatchEvent(event("click", { detail: 1 }));
  assert.deepEqual(actions, [["capture", "2026-10-03"]]);
  actions.length = 0;
  cell.dispatchEvent(event("pointerdown", { isPrimary: true, button: 0, pointerId: 2, clientX: 10, clientY: 10 }));
  cell.dispatchEvent(event("pointermove", { pointerId: 2, clientX: 30, clientY: 10 }));
  await new Promise((resolve) => setTimeout(resolve, 550));
  assert.deepEqual(actions, []);
  cell.dispatchEvent(event("dblclick", { detail: 2 }));
  assert.deepEqual(actions, [["both", "2026-10-03"]], "Native laptop double-click must also honor the OS timing");
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
            export const Platform = { isDesktopApp: true };
            export async function requestUrl() { return {}; }
            export function setIcon() {}
          `,
          loader: "js",
        })
      );
    },
  };
}
