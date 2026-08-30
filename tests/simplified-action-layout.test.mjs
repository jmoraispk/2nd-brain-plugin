import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

test("simplified actions fill their laptop-width cards", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "second-brain-layout-"));
  const profileDir = path.join(tempDir, "edge-profile");
  const debugPort = 9300 + Math.floor(Math.random() * 500);
  let browser;
  try {
    const css = readFileSync(path.join(repoRoot, "styles.css"), "utf8");
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
</main>
<script>
  const width = (selector) => document.querySelector(selector).getBoundingClientRect().width;
  const contentWidth = (selector) => {
    const element = document.querySelector(selector);
    const style = getComputedStyle(element);
    return element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  };
  document.body.dataset.widths = JSON.stringify({
    capture: width('[data-action="capture"]'),
    captureContainer: width('[data-container="capture"]'),
    review: width('[data-action="review"]'),
    reviewContainer: contentWidth('[data-container="review"]'),
    reflection: width('[data-action="reflection"]'),
    reflectionContainer: contentWidth('[data-container="reflection"]')
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
    const widths = await waitForWidths(page.webSocketDebuggerUrl);

    assert.equal(widths.capture, widths.captureContainer, "Capture should be full width");
    assert.equal(widths.review, widths.reviewContainer, "Review should be full width");
    assert.equal(
      widths.reflection,
      widths.reflectionContainer,
      "Save reflection should be full width"
    );
  } finally {
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
            `$needle='--user-data-dir=${escapedProfile}'; Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'msedge.exe' -and $_.CommandLine -like \"*$needle*\" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`,
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
