import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

test("controls and settings footer retain their intended geometry", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "second-brain-layout-"));
  const profileDir = path.join(tempDir, "edge-profile");
  const debugPort = 9300 + Math.floor(Math.random() * 500);
  let browser;
  try {
    const css = readFileSync(path.join(repoRoot, "styles.css"), "utf8");
    const mobileFixture = `<!doctype html><style>* { box-sizing: border-box; } ${css}</style><button class="second-brain-simple-metric">Captures</button>`;
    const fixturePath = path.join(tempDir, "fixture.html");
    writeFileSync(
      fixturePath,
      `<!doctype html>
<style>
  * { box-sizing: border-box; }
  :root {
    --font-ui-smaller: 12px;
    --text-faint: rgb(100, 100, 100);
    --text-muted: rgb(70, 70, 70);
  }
  body { margin: 0; }
  .fixture { width: 1000px; }
  ${css}
</style>
<main class="fixture">
  <section class="second-brain-simple-card">
    <div class="second-brain-simple-actions" data-container="capture">
      <button class="second-brain-button second-brain-button-primary" data-action="capture">Capture</button>
      <button class="second-brain-simple-call-button" data-action="capture-call" aria-label="Talk through a capture">Call</button>
    </div>
  </section>
  <section class="second-brain-simple-card">
    <div class="second-brain-simple-actions" data-container="review">
      <button class="second-brain-simple-activity-button" data-action="activity"><svg></svg></button>
      <button class="second-brain-button second-brain-button-primary second-brain-simple-review-button second-brain-simple-review-run" data-action="review">Review</button>
    </div>
  </section>
  <section class="second-brain-simple-card" data-container="reflection">
    <div class="second-brain-simple-actions">
      <button class="second-brain-button second-brain-button-primary second-brain-simple-review-button" data-action="reflection">Save reflection</button>
      <button class="second-brain-simple-call-button" data-action="review-call" aria-label="Talk through this review">Call</button>
    </div>
  </section>
  <button class="second-brain-simple-metric" data-control="metric">Captures</button>
  <p class="second-brain-settings-version" data-control="settings-version">Second Brain · v9.8.7</p>
</main>
<script>
  const width = (selector) => document.querySelector(selector).getBoundingClientRect().width;
  const contentWidth = (selector) => {
    const element = document.querySelector(selector);
    const style = getComputedStyle(element);
    return element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  };
  const metric = document.querySelector('[data-control="metric"]');
  const metricText = document.createRange();
  metricText.selectNodeContents(metric);
  const metricBounds = metric.getBoundingClientRect();
  const metricTextBounds = metricText.getBoundingClientRect();
  const settingsVersionStyle = getComputedStyle(
    document.querySelector('[data-control="settings-version"]')
  );
  const measurements = {
    activity: width('[data-action="activity"]'),
    activityHeight: document.querySelector('[data-action="activity"]').getBoundingClientRect().height,
    activityIconWidth: width('[data-action="activity"] svg'),
    capture: width('[data-action="capture"]'),
    captureContainer: width('[data-container="capture"]'),
    captureCallWidth: width('[data-action="capture-call"]'),
    captureCallHeight: document.querySelector('[data-action="capture-call"]').getBoundingClientRect().height,
    review: width('[data-action="review"]'),
    reviewContainer: contentWidth('[data-container="review"]'),
    reflection: width('[data-action="reflection"]'),
    reflectionContainer: contentWidth('[data-container="reflection"]'),
    reviewCallWidth: width('[data-action="review-call"]'),
    reviewCallHeight: document.querySelector('[data-action="review-call"]').getBoundingClientRect().height,
    metricCenterOffset: Math.abs(
      metricBounds.left + metricBounds.width / 2 -
      (metricTextBounds.left + metricTextBounds.width / 2)
    ),
    metricTextAlign: getComputedStyle(metric).textAlign,
    settingsVersionColor: settingsVersionStyle.color,
    settingsVersionFontSize: settingsVersionStyle.fontSize,
    settingsVersionTextAlign: settingsVersionStyle.textAlign
  };
  const mobileFrame = document.createElement('iframe');
  mobileFrame.style.width = '390px';
  mobileFrame.addEventListener('load', () => {
    const mobileMetric = mobileFrame.contentDocument.querySelector('.second-brain-simple-metric');
    measurements.metricMobileHeight = mobileMetric.getBoundingClientRect().height;
    document.body.dataset.widths = JSON.stringify(measurements);
  });
  mobileFrame.srcdoc = ${JSON.stringify(mobileFixture)};
  document.body.appendChild(mobileFrame);
</script>`,
      "utf8"
    );

    browser = spawn(
      edgePath,
      [
        "--headless=new",
        "--disable-gpu",
        "--no-first-run",
        `--remote-debugging-port=${debugPort}`,
        `--user-data-dir=${profileDir}`,
        pathToFileURL(fixturePath).href,
      ],
      { stdio: "ignore" }
    );
    const page = await waitForPage(debugPort, pathToFileURL(fixturePath).href);
    const widths = await waitForWidths(page.webSocketDebuggerUrl);

    assert.equal(
      widths.capture + widths.captureCallWidth + 10,
      widths.captureContainer,
      "Capture and the call button should fill the action row"
    );
    assert.equal(widths.activity, 44, "Activity should be a square 44px target");
    assert.equal(widths.activityHeight, 44, "Activity should match the call button height");
    assert.equal(widths.activityIconWidth, 19, "Activity should use the compact icon size");
    assert.equal(
      widths.activity + widths.review + 10,
      widths.reviewContainer,
      "Activity and Review should fill the Review action row"
    );
    assert.equal(widths.captureCallWidth, 44, "Capture call should be a square 44px target");
    assert.equal(widths.captureCallHeight, 44, "Capture call should be a square 44px target");
    assert.equal(
      widths.reflection + widths.reviewCallWidth + 10,
      widths.reflectionContainer,
      "Save reflection and its call button should fill the action row"
    );
    assert.equal(widths.reviewCallWidth, 44, "Review call should be a square 44px target");
    assert.equal(widths.reviewCallHeight, 44, "Review call should be a square 44px target");
    assert.equal(widths.metricTextAlign, "center", "Metric label should be centered");
    assert.ok(widths.metricCenterOffset < 0.5, "Metric text should be geometrically centered");
    assert.equal(widths.metricMobileHeight, 44, "Mobile metric target should be 44px high");
    assert.equal(widths.settingsVersionTextAlign, "center", "Version should be centered");
    assert.equal(widths.settingsVersionFontSize, "12px", "Version should use smaller UI text");
    assert.equal(
      widths.settingsVersionColor,
      "rgb(70, 70, 70)",
      "Version should use the readable muted Obsidian text token"
    );
  } finally {
    await cleanupBrowser(browser, debugPort, profileDir, tempDir);
  }
});

test("metric pointer lifecycle opens only intentional long presses", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "second-brain-metric-"));
  const profileDir = path.join(tempDir, "edge-profile");
  const debugPort = 9800 + Math.floor(Math.random() * 500);
  let browser;
  try {
    const bundle = await buildDashboardBrowserBundle();
    const fixturePath = path.join(tempDir, "fixture.html");
    writeFileSync(
      fixturePath,
      `<!doctype html>
<main id="host"></main>
<script>
  HTMLElement.prototype.createEl = function(tag, options = {}) {
    const element = document.createElement(tag);
    if (options.text !== undefined) element.textContent = options.text;
    if (options.cls) element.className = options.cls;
    for (const [name, value] of Object.entries(options.attr ?? {})) {
      element.setAttribute(name, value);
    }
    this.appendChild(element);
    return element;
  };
</script>
<script>${bundle}</script>
<script type="module">
  const changes = [];
  const button = dashboard.renderActivityMetricControl(
    document.querySelector('#host'),
    'captures',
    (metric) => changes.push(metric)
  );
  button.setPointerCapture = () => {};
  button.hasPointerCapture = () => true;
  button.releasePointerCapture = () => {};

  const pointer = (type) => {
    const event = new PointerEvent(type, {
      bubbles: true,
      button: 0,
      clientX: 20,
      clientY: 20,
      pointerId: 1,
      pointerType: 'touch',
    });
    Object.defineProperty(event, 'isPrimary', { value: true });
    return event;
  };

  button.dispatchEvent(pointer('pointerdown'));
  await new Promise((resolve) => setTimeout(resolve, 550));
  button.dispatchEvent(pointer('pointerup'));
  button.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
  button.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));

  const showsAfterLongPress = globalThis.__metricMenuShows ?? 0;
  const cancelled = dashboard.renderActivityMetricControl(
    document.querySelector('#host'),
    'captures',
    (metric) => changes.push(metric)
  );
  cancelled.setPointerCapture = () => {};
  cancelled.hasPointerCapture = () => false;
  cancelled.dispatchEvent(pointer('pointerdown'));
  cancelled.dispatchEvent(pointer('lostpointercapture'));
  await new Promise((resolve) => setTimeout(resolve, 550));

  document.body.dataset.metricResult = JSON.stringify({
    changes,
    expanded: button.getAttribute('aria-expanded'),
    hides: globalThis.__metricMenuHides ?? 0,
    showsAfterLongPress,
    shows: globalThis.__metricMenuShows ?? 0,
  });
</script>`,
      "utf8"
    );

    browser = spawn(
      edgePath,
      [
        "--headless=new",
        "--disable-gpu",
        "--no-first-run",
        `--remote-debugging-port=${debugPort}`,
        `--user-data-dir=${profileDir}`,
        pathToFileURL(fixturePath).href,
      ],
      { stdio: "ignore" }
    );
    const page = await waitForPage(debugPort, pathToFileURL(fixturePath).href);
    const result = await waitForDataset(page.webSocketDebuggerUrl, "metricResult");

    assert.deepEqual(result.changes, [], "Long press should not cycle the metric");
    assert.equal(result.showsAfterLongPress, 1, "Long press should open one menu");
    assert.equal(result.shows, 1, "Losing pointer capture should cancel the next menu");
    assert.equal(result.hides, 0, "Follow-up pointer events should not dismiss the menu");
    assert.equal(result.expanded, "true", "The trigger should expose the open menu state");
  } finally {
    await cleanupBrowser(browser, debugPort, profileDir, tempDir);
  }
});

test("desktop Activity control uses the Review selection and stays off Capture and mobile", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "second-brain-activity-"));
  const profileDir = path.join(tempDir, "edge-profile");
  const debugPort = 10300 + Math.floor(Math.random() * 500);
  let browser;
  try {
    const bundle = await buildDashboardBrowserBundle();
    const fixturePath = path.join(tempDir, "fixture.html");
    writeFileSync(
      fixturePath,
      `<!doctype html>
<main id="host"></main>
<script>
  HTMLElement.prototype.createEl = function(tag, options = {}) {
    const element = document.createElement(tag);
    if (options.text !== undefined) element.textContent = options.text;
    if (options.cls) element.className = options.cls;
    for (const [name, value] of Object.entries(options.attr ?? {})) {
      element.setAttribute(name, value);
    }
    this.appendChild(element);
    return element;
  };
  HTMLElement.prototype.createDiv = function(options = {}) {
    return this.createEl('div', options);
  };
  HTMLElement.prototype.createSpan = function(options = {}) {
    return this.createEl('span', options);
  };
  HTMLElement.prototype.setText = function(text) {
    this.textContent = text;
  };
</script>
<script>${bundle}</script>
<script type="module">
  const drafts = [];
  let fetches = 0;
  let reviews = 0;
  let finishFetch;
  const callbacks = {
      setCaptureDraft: (value) => drafts.push(value),
      saveCapture: async () => {},
      startCaptureCall: () => {},
      fetchActivity: () => new Promise((resolve) => {
        fetches += 1;
        finishFetch = () => {
          drafts.push('view updated its latest state');
          resolve();
        };
      }),
      changeMonth: () => {}, selectCalendarDate: () => {},
      setRangeStart: () => {}, setRangeEnd: () => {}, setMetric: () => {},
      runReview: async () => { reviews += 1; }, setUserReview: () => {},
      finishReview: async () => {}, startReviewCall: () => {}, openResult: () => {},
  };
  const plugin = {
    app: { vault: {
      getAbstractFileByPath: (path) => path.includes('/Activity/Daytrace/Summaries/')
        ? new globalThis.__DashboardTFile(path)
        : null,
      cachedRead: async () => '',
      read: async () => '# DayTrace\\n\\n| Project / workstream | Apparent achievements | Work and topics |\\n| --- | --- | --- |\\n| Plugin | Done | Tests |',
    } },
    settings: {
      logsFolder: 'Logs',
      dailyLogPathTemplate: 'Logs/{YYYY-MM-DD}.md',
    },
  };
  const state = {
    captureDraft: 'Existing thought', month: '2026-09',
    rangeStart: '2026-09-13', rangeEnd: '2026-09-14', metric: 'captures',
  };
  await dashboard.renderSimplifiedDashboard(
    document.querySelector('#host'),
    plugin,
    state,
    { resultContent: '', userReview: '' },
    callbacks,
    {}
  );
  const captureActivityButtons = document.querySelectorAll('.second-brain-simple-capture [data-action="activity"]').length;
  const activityButton = document.querySelector('.second-brain-simple-review [data-action="activity"]');
  const reviewDisabledWithoutCaptures = document.querySelector('[data-action="activity"]')
    .parentElement.querySelector('.second-brain-simple-review-run').hasAttribute('disabled');
  const reviewButton = activityButton.parentElement.querySelector('.second-brain-simple-review-run');
  const initialIcon = activityButton.dataset.icon;
  activityButton.click();
  activityButton.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const fetchesBeforeCompletion = fetches;
  const busyDuringFetch = activityButton.getAttribute('aria-busy');
  const loadingIcon = activityButton.dataset.icon;
  const disabledDuringFetch = activityButton.hasAttribute('disabled');
  const reviewDisabledDuringFetch = reviewButton.hasAttribute('disabled');
  reviewButton.click();
  const reviewsDuringFetch = reviews;
  const rerendered = document.body.createDiv();
  await dashboard.renderSimplifiedDashboard(
    rerendered,
    plugin,
    state,
    { resultContent: '', userReview: '' },
    callbacks,
    {},
    'activity'
  );
  const rerenderedActivity = rerendered.querySelector('[data-action="activity"]');
  const rerenderedReview = rerendered.querySelector('.second-brain-simple-review-run');
  const rerenderedActivityDisabled = rerenderedActivity.hasAttribute('disabled');
  const rerenderedReviewDisabled = rerenderedReview.hasAttribute('disabled');
  rerenderedReview.click();
  const reviewsAfterRerender = reviews;
  finishFetch();
  await new Promise((resolve) => setTimeout(resolve, 0));
  reviewButton.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const textarea = document.querySelector('textarea');
  const empty = document.body.createDiv();
  await dashboard.renderSimplifiedDashboard(
    empty,
    { ...plugin, app: { vault: {
      getAbstractFileByPath: () => null, cachedRead: async () => '', read: async () => '',
    } } },
    state,
    { resultContent: '', userReview: '' },
    callbacks,
    {}
  );
  const emptyReviewDisabled = empty.querySelector('.second-brain-simple-review-run').hasAttribute('disabled');
  globalThis.__obsidianPlatform.isDesktopApp = false;
  const mobile = document.body.createDiv();
  await dashboard.renderSimplifiedDashboard(
    mobile,
    plugin,
    { ...state, captureDraft: '' },
    { resultContent: '', userReview: '' },
    { ...callbacks, fetchActivity: async () => 'not used' },
    {}
  );
  document.body.dataset.activityResult = JSON.stringify({
    fetches,
    fetchesBeforeCompletion,
    initialIcon,
    busyDuringFetch,
    loadingIcon,
    disabledDuringFetch,
    reviewDisabledDuringFetch,
    reviewsDuringFetch,
    rerenderedActivityDisabled,
    rerenderedReviewDisabled,
    reviewsAfterRerender,
    reviews,
    value: textarea.value,
    draft: drafts.at(-1),
    buttonText: document.querySelector('[data-action="activity"]').textContent,
    captureActivityButtons,
    reviewDisabledWithoutCaptures,
    emptyReviewDisabled,
    mobileButtons: mobile.querySelectorAll('[data-action="activity"]').length,
  });
</script>`,
      "utf8"
    );

    browser = spawn(
      edgePath,
      [
        "--headless=new",
        "--disable-gpu",
        "--no-first-run",
        `--remote-debugging-port=${debugPort}`,
        `--user-data-dir=${profileDir}`,
        pathToFileURL(fixturePath).href,
      ],
      { stdio: "ignore" }
    );
    const page = await waitForPage(debugPort, pathToFileURL(fixturePath).href);
    const result = await waitForDataset(page.webSocketDebuggerUrl, "activityResult");

    assert.equal(result.fetches, 1);
    assert.equal(result.fetchesBeforeCompletion, 1, "A running button should be single-flight");
    assert.equal(result.initialIcon, "activity");
    assert.equal(result.busyDuringFetch, "true");
    assert.equal(result.loadingIcon, "loader-circle");
    assert.equal(result.disabledDuringFetch, true);
    assert.equal(result.reviewDisabledDuringFetch, true);
    assert.equal(result.reviewsDuringFetch, 0, "Review must not run against partial Activity files");
    assert.equal(result.rerenderedActivityDisabled, true);
    assert.equal(result.rerenderedReviewDisabled, true);
    assert.equal(
      result.reviewsAfterRerender,
      0,
      "A rerender must preserve the Activity/Review operation lock"
    );
    assert.equal(result.reviews, 1, "Review should run after Activity finishes");
    assert.equal(result.value, "Existing thought");
    assert.equal(result.draft, "view updated its latest state");
    assert.equal(result.buttonText, "");
    assert.equal(result.captureActivityButtons, 0, "Capture should no longer own Activity fetching");
    assert.equal(
      result.reviewDisabledWithoutCaptures,
      false,
      "Activity-only selections should remain reviewable"
    );
    assert.equal(result.emptyReviewDisabled, true, "Review should disable when no source exists");
    assert.equal(result.mobileButtons, 0, "Activity fetching should stay off mobile");
  } finally {
    await cleanupBrowser(browser, debugPort, profileDir, tempDir);
  }
});

test("desktop hotkey routing submits only the focused non-empty Capture box", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "second-brain-capture-hotkey-"));
  const profileDir = path.join(tempDir, "edge-profile");
  const debugPort = 10300 + Math.floor(Math.random() * 500);
  let browser;
  try {
    const bundle = await buildDashboardBrowserBundle();
    const fixturePath = path.join(tempDir, "fixture.html");
    writeFileSync(
      fixturePath,
      `<!doctype html>
<main id="host"></main>
<button id="outside">Outside</button>
<script>
  HTMLElement.prototype.createEl = function(tag, options = {}) {
    const element = document.createElement(tag);
    if (options.text !== undefined) element.textContent = options.text;
    if (options.cls) element.className = options.cls;
    for (const [name, value] of Object.entries(options.attr ?? {})) {
      element.setAttribute(name, value);
    }
    this.appendChild(element);
    return element;
  };
  HTMLElement.prototype.createDiv = function(options = {}) { return this.createEl('div', options); };
  HTMLElement.prototype.createSpan = function(options = {}) { return this.createEl('span', options); };
  HTMLElement.prototype.setText = function(text) { this.textContent = text; };
</script>
<script>${bundle}</script>
<script>
  const saved = [];
  const desktopCommands = [];
  const mobileCommands = [];
  const registrationAvailable =
    typeof dashboard.registerSimplifiedCaptureHotkey === 'function';
  if (registrationAvailable) {
    dashboard.registerSimplifiedCaptureHotkey(
      {
        app: { workspace: { containerEl: document.body } },
        addCommand: (command) => desktopCommands.push(command),
      },
      true
    );
    dashboard.registerSimplifiedCaptureHotkey(
      {
        app: { workspace: { containerEl: document.body } },
        addCommand: (command) => mobileCommands.push(command),
      },
      false
    );
  }
  dashboard.renderCapture(
    document.querySelector('#host'),
    { captureDraft: 'Shortcut capture' },
    {
      setCaptureDraft: () => {},
      saveCapture: async (content) => { saved.push(content); },
      startCaptureCall: () => {},
    }
  );
  const textarea = document.querySelector('.second-brain-simple-capture-input');
  textarea.focus();
  textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  const savesAfterPlainEnter = saved.length;
  const command = desktopCommands[0];
  const checkingHandled = command?.checkCallback(true) ?? false;
  const savesAfterChecking = saved.length;
  document.addEventListener('keydown', (event) => {
    if (event.ctrlKey && event.key === 'Enter') command?.checkCallback(false);
  }, { capture: true });
  textarea.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'Enter', ctrlKey: true, bubbles: true,
  }));
  Promise.resolve().then(() => {
    textarea.value = '';
    textarea.focus();
    const emptyHandled = command?.checkCallback(false) ?? false;
    textarea.value = 'Ignored while unfocused';
    document.querySelector('#outside').focus();
    const unfocusedHandled = command?.checkCallback(false) ?? false;
    document.body.dataset.captureHotkey = JSON.stringify({
      registrationAvailable,
      desktopCommandCount: desktopCommands.length,
      mobileCommandCount: mobileCommands.length,
      modifiers: command?.hotkeys?.[0]?.modifiers ?? [],
      key: command?.hotkeys?.[0]?.key ?? '',
      checkingHandled,
      savesAfterChecking,
      emptyHandled,
      unfocusedHandled,
      savesAfterPlainEnter,
      saved,
    });
  });
</script>`,
      "utf8"
    );

    browser = spawn(
      edgePath,
      [
        "--headless=new",
        "--disable-gpu",
        "--no-first-run",
        `--remote-debugging-port=${debugPort}`,
        `--user-data-dir=${profileDir}`,
        pathToFileURL(fixturePath).href,
      ],
      { stdio: "ignore" }
    );
    const page = await waitForPage(debugPort, pathToFileURL(fixturePath).href);
    const result = await waitForDataset(page.webSocketDebuggerUrl, "captureHotkey");

    assert.equal(result.registrationAvailable, true);
    assert.equal(result.desktopCommandCount, 1);
    assert.equal(result.mobileCommandCount, 0);
    assert.deepEqual(result.modifiers, ["Ctrl"]);
    assert.equal(result.key, "Enter");
    assert.equal(result.checkingHandled, true);
    assert.equal(result.savesAfterChecking, 0, "Checking shortcut availability must not submit");
    assert.deepEqual(result.saved, ["Shortcut capture"]);
    assert.equal(result.savesAfterPlainEnter, 0, "Plain Enter must remain a newline");
    assert.equal(result.emptyHandled, false, "Empty Capture text must not submit");
    assert.equal(result.unfocusedHandled, false, "The hotkey must not target an unfocused Capture box");
  } finally {
    await cleanupBrowser(browser, debugPort, profileDir, tempDir);
  }
});

async function waitForPage(port, expectedUrl) {
  const endpoint = `http://127.0.0.1:${port}/json/list`;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const pages = await fetch(endpoint).then((response) => response.json());
      const page = pages.find(
        (candidate) => candidate.type === "page" && candidate.url === expectedUrl
      );
      if (page) return page;
    } catch {
      // Edge may need a moment to open its debugging endpoint.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Edge debugging endpoint did not become ready");
}

async function waitForWidths(webSocketUrl) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const widths = await evaluate(
      webSocketUrl,
      `document.body?.dataset.widths ? JSON.parse(document.body.dataset.widths) : null`
    );
    if (widths) return widths;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Browser fixture did not finish measuring action widths");
}

async function waitForDataset(webSocketUrl, key) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const result = await evaluate(
      webSocketUrl,
      `document.body?.dataset[${JSON.stringify(key)}] ? JSON.parse(document.body.dataset[${JSON.stringify(key)}]) : null`
    );
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Browser fixture did not publish ${key}`);
}

async function buildDashboardBrowserBundle() {
  const result = await build({
    stdin: {
      contents: `import * as dashboard from "./src/simplifiedDashboard.ts"; globalThis.dashboard = dashboard;`,
      resolveDir: repoRoot,
      sourcefile: "metric-browser-entry.ts",
    },
    bundle: true,
    format: "iife",
    platform: "browser",
    write: false,
    plugins: [obsidianBrowserStubPlugin()],
  });
  return result.outputFiles[0].text;
}

function obsidianBrowserStubPlugin() {
  return {
    name: "obsidian-browser-stub",
    setup(buildApi) {
      buildApi.onResolve({ filter: /^obsidian$/ }, () => ({
        path: "obsidian",
        namespace: "obsidian-browser-stub",
      }));
      buildApi.onLoad(
        { filter: /.*/, namespace: "obsidian-browser-stub" },
        () => ({
          contents: `
            class MenuItem {
              setTitle() { return this; }
              setChecked() { return this; }
              onClick(callback) { this.callback = callback; return this; }
            }
            export class Menu {
              setNoIcon() { return this; }
              addItem(callback) { callback(new MenuItem()); return this; }
              onHide(callback) { this.hideCallback = callback; }
              showAtPosition() {
                globalThis.__metricMenuShows = (globalThis.__metricMenuShows ?? 0) + 1;
                document.addEventListener('click', () => this.hide(), { once: true });
                document.addEventListener('contextmenu', () => this.hide(), { once: true });
                return this;
              }
              hide() {
                globalThis.__metricMenuHides = (globalThis.__metricMenuHides ?? 0) + 1;
                this.hideCallback?.();
                return this;
              }
            }
            export class Component {}
            export class TFile {
              constructor(path = '') {
                this.path = path;
                this.name = path.split('/').at(-1) ?? '';
                this.basename = this.name.replace(/\.md$/, '');
              }
            }
            globalThis.__DashboardTFile = TFile;
            export class TFolder {}
            export const MarkdownRenderer = {};
            export const Platform = { isDesktopApp: true };
            globalThis.__obsidianPlatform = Platform;
            export async function requestUrl() { return {}; }
            export function setIcon(element, icon) {
              element.dataset.icon = icon;
            }
          `,
          loader: "js",
        })
      );
    },
  };
}

function evaluate(webSocketUrl, expression) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketUrl);
    socket.addEventListener("open", () => {
      socket.send(
        JSON.stringify({
          id: 1,
          method: "Runtime.evaluate",
          params: { expression, returnByValue: true },
        })
      );
    });
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== 1) return;
      socket.close();
      if (message.result?.exceptionDetails) {
        reject(new Error(JSON.stringify(message.result.exceptionDetails)));
        return;
      }
      resolve(message.result.result.value);
    });
    socket.addEventListener("error", () => reject(new Error("Edge debugging socket failed")));
  });
}

async function closeBrowser(port) {
  try {
    const version = await fetch(`http://127.0.0.1:${port}/json/version`).then((response) =>
      response.json()
    );
    await sendCommand(version.webSocketDebuggerUrl, "Browser.close");
  } catch {
    // The spawned process may already have exited after a failing assertion.
  }
}

function sendCommand(webSocketUrl, method) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketUrl);
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ id: 1, method }));
    });
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== 1) return;
      socket.close();
      resolve(message.result);
    });
    socket.addEventListener("error", () => reject(new Error("Edge debugging socket failed")));
  });
}

async function cleanupBrowser(browser, debugPort, profileDir, tempDir) {
  await closeBrowser(debugPort);
  browser?.kill();
  if (browser?.pid && process.platform === "win32") {
    try {
      execFileSync("taskkill", ["/PID", String(browser.pid), "/T", "/F"], {
        stdio: "ignore",
      });
    } catch {
      // Browser.close may already have terminated the full process tree.
    }
    const escapedProfile = profileDir.replaceAll("'", "''");
    try {
      execFileSync(
        "powershell",
        [
          "-NoProfile",
          "-Command",
          `$profile='${escapedProfile}'; $processes=@(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'msedge.exe' -and $_.CommandLine -like \"*$profile*\" }); $processes | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; $processes | ForEach-Object { Wait-Process -Id $_.ProcessId -Timeout 5 -ErrorAction SilentlyContinue }`,
        ],
        { stdio: "ignore" }
      );
    } catch {
      // Only test-owned Edge processes use this unique temporary profile.
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
  rmSync(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
