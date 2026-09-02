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

test("simplified controls retain their intended laptop geometry", async () => {
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
  body { margin: 0; }
  .fixture { width: 1000px; }
  ${css}
</style>
<main class="fixture">
  <section class="second-brain-simple-card">
    <div class="second-brain-simple-actions" data-container="capture">
      <button class="second-brain-button second-brain-button-primary" data-action="capture">Capture</button>
    </div>
  </section>
  <section class="second-brain-simple-card" data-container="review">
    <button class="second-brain-button second-brain-button-primary second-brain-simple-review-button second-brain-simple-review-run" data-action="review">Review</button>
  </section>
  <section class="second-brain-simple-card" data-container="reflection">
    <button class="second-brain-button second-brain-button-primary second-brain-simple-review-button" data-action="reflection">Save reflection</button>
  </section>
  <button class="second-brain-simple-metric" data-control="metric">Captures</button>
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
  const measurements = {
    capture: width('[data-action="capture"]'),
    captureContainer: width('[data-container="capture"]'),
    review: width('[data-action="review"]'),
    reviewContainer: contentWidth('[data-container="review"]'),
    reflection: width('[data-action="reflection"]'),
    reflectionContainer: contentWidth('[data-container="reflection"]'),
    metricCenterOffset: Math.abs(
      metricBounds.left + metricBounds.width / 2 -
      (metricTextBounds.left + metricTextBounds.width / 2)
    ),
    metricTextAlign: getComputedStyle(metric).textAlign
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

    assert.equal(widths.capture, widths.captureContainer, "Capture should be full width");
    assert.equal(widths.review, widths.reviewContainer, "Review should be full width");
    assert.equal(
      widths.reflection,
      widths.reflectionContainer,
      "Save reflection should be full width"
    );
    assert.equal(widths.metricTextAlign, "center", "Metric label should be centered");
    assert.ok(widths.metricCenterOffset < 0.5, "Metric text should be geometrically centered");
    assert.equal(widths.metricMobileHeight, 44, "Mobile metric target should be 44px high");
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
