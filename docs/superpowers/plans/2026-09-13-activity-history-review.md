# Activity History and Review Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dashboard History shortcut, make successful Activity runs file-first, copy saved DayTrace tables into Simplified Reviews, and correct GPT-5 connection testing.

**Architecture:** Put DayTrace review discovery and exact-table rendering in a focused module, then let the existing runner consume those sources only for `date-range-logs`. Expose History opening through the plugin and setting-tab boundary, while a reusable top-bar renderer keeps both dashboard modes consistent. Preserve the existing usage ledger, provider adapter, storage paths, and notification durations.

**Tech Stack:** TypeScript, Obsidian plugin API, `@jmoraispk/daytrace`, esbuild, Node.js test runner, headless Edge UI fixtures, GitHub Actions releases.

**Spec:** `docs/superpowers/specs/2026-09-13-activity-history-review-design.md`

## Global Constraints

- Target plugin version is `0.18.1` in `manifest.json`, `package.json`, and both root version fields in `package-lock.json`.
- Activity collection remains desktop-only; saved summaries and Reviews remain readable on mobile.
- Successful Activity runs must not modify Capture; deterministic provider fallback must preserve the existing Capture merge.
- Simplified Review must use saved AI summaries, never raw ActivityWatch evidence JSON.
- Copied DayTrace table lines must remain byte-for-byte identical to the stored summary.
- History remains metadata-only and retains its current pricing and accuracy semantics.
- Successful file notices retain the current five-second default; no notice-duration code changes are allowed.
- Every behavior change starts with a failing test and ends with focused plus full verification.
- Delivery is incomplete until `origin/master`, tag `v0.18.1`, the release workflow, and all downloadable assets are verified.

---

### Task 1: Isolate DayTrace review sources and table rendering

**Files:**
- Create: `src/daytraceReview.ts`
- Modify: `src/daytraceIntegration.ts`
- Create: `tests/daytrace-review.test.mjs`
- Modify: `tests/daytrace-integration.test.mjs`

**Interfaces:**
- Consumes: `App`, `TFile`, and `applyDatePlaceholders(template, date)`.
- Produces: `DAYTRACE_SUMMARY_PATH`, `DaytraceReviewSource`, `loadDaytraceReviewSource(app, date)`, `extractDaytraceWorkstreamTable(markdown)`, and `renderDaytraceReviewAppendix(sources)`.
- Preserves: `DAYTRACE_SUMMARY_PATH` is re-exported from `src/daytraceIntegration.ts`.

- [ ] **Step 1: Write failing pure-behavior tests**

Create `tests/daytrace-review.test.mjs` with a real bundled module and fake `TFile`/vault boundary. Use literal stored Markdown:

```js
test("DayTrace review sources preserve the stored workstream table", async () => {
  const stored = [
    "# DayTrace — 2026-09-13", "",
    "| Project / workstream | Apparent achievements | Work and topics |",
    "| --- | --- | --- |",
    "| Plugin | Likely: Released history | Cost UI<br>Activity |",
    "", "## Details",
  ].join("\n");
  const { module, app } = await fixture({
    "🤖 AI/Activity/Daytrace/Summaries/2026/Q3/W37/2026-09-13.md": stored,
  });
  const source = await module.loadDaytraceReviewSource(app, "2026-09-13");
  const table = [
    "| Project / workstream | Apparent achievements | Work and topics |",
    "| --- | --- | --- |",
    "| Plugin | Likely: Released history | Cost UI<br>Activity |",
  ].join("\n");

  assert.equal(source.path, "🤖 AI/Activity/Daytrace/Summaries/2026/Q3/W37/2026-09-13.md");
  assert.equal(source.table, table);
  assert.equal(module.renderDaytraceReviewAppendix([source]),
    `## Activity\n\n### 2026-09-13\n\n${table}`);
});

test("missing and malformed summaries never fabricate a table", async () => {
  const { module, app } = await fixture({
    "🤖 AI/Activity/Daytrace/Summaries/2026/Q3/W37/2026-09-13.md":
      "# DayTrace — 2026-09-13\n\nNo workstream table.",
  });
  const malformed = await module.loadDaytraceReviewSource(app, "2026-09-13");
  assert.equal(malformed.table, undefined);
  assert.equal(module.renderDaytraceReviewAppendix([malformed]), "");
  assert.equal(await module.loadDaytraceReviewSource(app, "2026-09-14"), undefined);
});
```

The fixture must derive no expected text through production helpers. Its fake vault implements `getAbstractFileByPath()` and `read()` against the supplied literal map.

- [ ] **Step 2: Run the test and verify RED**

```powershell
node --test tests/daytrace-review.test.mjs
```

Expected: FAIL because the module and exports do not exist.

- [ ] **Step 3: Implement the focused source module**

Create `src/daytraceReview.ts` with these contracts:

```ts
export const DAYTRACE_SUMMARY_PATH =
  "🤖 AI/Activity/Daytrace/Summaries/{ISO_YEAR}/Q{Q}/W{WW}/{YYYY-MM-DD}.md";

export interface DaytraceReviewSource {
  date: string;
  path: string;
  content: string;
  table?: string;
}

export async function loadDaytraceReviewSource(
  app: App,
  date: string
): Promise<DaytraceReviewSource | undefined> {
  const path = applyDatePlaceholders(DAYTRACE_SUMMARY_PATH, date);
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return undefined;
  const content = await app.vault.read(file);
  if (!content.trim()) return undefined;
  const table = extractDaytraceWorkstreamTable(content);
  return { date, path, content, ...(table === undefined ? {} : { table }) };
}
```

`extractDaytraceWorkstreamTable()` locates the exact DayTrace header, requires a Markdown divider next, and returns consecutive pipe-delimited lines unchanged. `renderDaytraceReviewAppendix()` filters sources without a table, sorts by date, and joins sections beneath one `## Activity` heading.

Move the summary-path constant out of `src/daytraceIntegration.ts`, import it from the new module, and re-export it. Leave `DAYTRACE_EVIDENCE_PATH` in place.

- [ ] **Step 4: Run focused tests and verify GREEN**

```powershell
node --test tests/daytrace-review.test.mjs tests/daytrace-integration.test.mjs
```

Expected: all tests PASS and the stored summary path is unchanged.

- [ ] **Step 5: Commit the unit**

```powershell
git add src/daytraceReview.ts src/daytraceIntegration.ts tests/daytrace-review.test.mjs tests/daytrace-integration.test.mjs
git commit -m "feat(activity): add review table sources"
```

---

### Task 2: Include Activity-only dates and exact tables in Simplified Review

**Files:**
- Modify: `src/runner.ts`
- Create: `tests/runner-daytrace.test.mjs`

**Interfaces:**
- Consumes: `loadDaytraceReviewSource(app, date)` and `renderDaytraceReviewAppendix(sources)` from Task 1.
- Extends internal `InputContent` with `daytraceSources: DaytraceReviewSource[]`.
- Produces: date-range input containing logs and/or Activity summaries, plus a persisted exact-table appendix.

- [ ] **Step 1: Write failing runner integration tests**

Create `tests/runner-daytrace.test.mjs`. Bundle the real `runCommand()` and stub only Obsidian HTTP with a successful OpenAI response. The fake vault implements the runner's actual `getAbstractFileByPath`, `getMarkdownFiles`, `read`, `create`, `modify`, and `createFolder` effects.

Use one log-plus-Activity date and one Activity-only date:

```js
test("date-range Review reads Activity-only dates and copies exact tables", async () => {
  const fixture = await runnerFixture({
    "🧑 Me/Logs/2026/Q3/W37/2026-09-12.md": "[18:00] Finished release.",
    "🤖 AI/Activity/Daytrace/Summaries/2026/Q3/W37/2026-09-12.md":
      daytrace("2026-09-12", "| Plugin | Released v0.18 | History |"),
    "🤖 AI/Activity/Daytrace/Summaries/2026/Q3/W37/2026-09-13.md":
      daytrace("2026-09-13", "| DayTrace | Likely: Fixed review | Tables |"),
  });

  const result = await fixture.runDateRange("2026-09-12", "2026-09-13");
  const requestBody = JSON.parse(fixture.requests[0].body);
  const review = fixture.content(result.file.path);

  assert.match(requestBody.messages[1].content, /Finished release/);
  assert.match(requestBody.messages[1].content, /Activity summary/);
  assert.match(requestBody.messages[1].content, /Likely: Fixed review/);
  assert.match(review, /## Activity\n\n### 2026-09-12/);
  assert.match(review, /### 2026-09-13/);
  assert.equal(review.match(/\| DayTrace \| Likely: Fixed review \| Tables \|/g)?.length, 1);
});
```

Add a cache test: run twice unchanged and assert one provider request; modify only the saved Activity summary; run again and assert a second provider request and the replacement table. Add a malformed-summary test proving Review succeeds without an invented Activity appendix.

- [ ] **Step 2: Run the runner test and verify RED**

```powershell
node --test tests/runner-daytrace.test.mjs
```

Expected: FAIL because date-range input ignores DayTrace summaries and writes no appendix.

- [ ] **Step 3: Extend date-range input collection**

Import Task 1's contracts and extend the internal result:

```ts
interface InputContent {
  label: string;
  sourcePath: string;
  content: string;
  files: InputFingerprint[];
  daytraceSources: DaytraceReviewSource[];
}
```

Inside the existing multi-day loop, collect a labeled daily log when present. Only when `input.kind === "date-range-logs"`, collect the matching Activity source:

```ts
const activity = await loadDaytraceReviewSource(app, date);
if (activity) {
  dayParts.push(`#### Activity summary\n\n${activity.content}`);
  files.push({
    path: activity.path,
    size: new TextEncoder().encode(activity.content).length,
    sha1: await sha1Hex(activity.content),
  });
  daytraceSources.push(activity);
}
if (dayParts.length > 0) {
  sections.push(`### ${date}\n\n${dayParts.join("\n\n")}`);
}
```

Do not load Activity summaries for other input kinds. Throw `No daily logs or Activity summaries found for date-range-logs.` only when every selected date lacks both. Return `daytraceSources: []` on all other paths.

- [ ] **Step 4: Append exact tables outside the model output**

After `callLLM()` returns and before the Review file write:

```ts
const appendix = renderDaytraceReviewAppendix(
  inputs.flatMap((input) => input.daytraceSources)
);
const renderedBody = appendix ? `${body.trimEnd()}\n\n${appendix}` : body;
const result = buildFrontmatter(meta) + "\n\n" + renderedBody;
```

Keep the existing frontmatter and cache comparison unchanged so Activity fingerprints invalidate stale Reviews.

- [ ] **Step 5: Run focused tests and verify GREEN**

```powershell
node --test tests/daytrace-review.test.mjs tests/runner-daytrace.test.mjs tests/daytrace-integration.test.mjs
```

Expected: all tests PASS, including Activity-only dates, cache invalidation, malformed input, and exact copies.

- [ ] **Step 6: Commit Review integration**

```powershell
git add src/runner.ts tests/runner-daytrace.test.mjs
git commit -m "feat(review): include Activity tables"
```

---

### Task 3: Keep successful Activity results out of Capture

**Files:**
- Modify: `src/daytraceIntegration.ts`
- Modify: `src/view.ts`
- Modify: `tests/daytrace-integration.test.mjs`
- Create: `tests/view-activity-flow.test.mjs`

**Interfaces:**
- Consumes: `DaytraceGeneration` and `mergeCaptureDraft(current, fetched)`.
- Produces: `activityCaptureDraft(current, result): string`.
- Behavior: returns the original draft when `result.summaryFile` exists; merges deterministic Markdown otherwise.

- [ ] **Step 1: Replace the old merge-only test with failing outcome tests**

```js
test("successful Activity leaves Capture untouched", async () => {
  const daytrace = await loadDaytraceModule();
  assert.equal(daytrace.activityCaptureDraft("Remember this", {
    captureMarkdown: "| AI table |",
    evidenceFile: { path: "evidence.json" },
    summaryFile: { path: "summary.md" },
  }), "Remember this");
});

test("deterministic Activity fallback remains available in Capture", async () => {
  const daytrace = await loadDaytraceModule();
  assert.equal(daytrace.activityCaptureDraft("Remember this", {
    captureMarkdown: "Deterministic activity episodes",
    evidenceFile: { path: "evidence.json" },
    fallbackCode: "provider-network",
  }), "Remember this\n\nDeterministic activity episodes");
});
```

Create `tests/view-activity-flow.test.mjs` by bundling the real `SecondBrainView` while replacing only ActivityWatch/provider transport with controlled `DaytraceGeneration` results. Invoke the compiled private `fetchSimplifiedActivity()` method and assert the actual view state:

```js
test("the Activity view changes Capture only for deterministic fallback", async () => {
  const success = await viewFixture({
    captureMarkdown: "| AI table |",
    evidenceFile: { path: "evidence.json" },
    summaryFile: { path: "summary.md" },
  }, "Existing thought");
  await success.view.fetchSimplifiedActivity();
  assert.equal(success.view.simplifiedState.captureDraft, "Existing thought");

  const fallback = await viewFixture({
    captureMarkdown: "Deterministic activity episodes",
    evidenceFile: { path: "evidence.json" },
    fallbackCode: "provider-network",
  }, "Existing thought");
  await fallback.view.fetchSimplifiedActivity();
  assert.equal(
    fallback.view.simplifiedState.captureDraft,
    "Existing thought\n\nDeterministic activity episodes"
  );
});
```

The fixture keeps the real result-handling path, `mergeCaptureDraft`, notices, and view state. It stubs the external generator and rendering side effects only.

- [ ] **Step 2: Run the focused test and verify RED**

```powershell
node --test --test-name-pattern="successful Activity|deterministic Activity" tests/daytrace-integration.test.mjs tests/view-activity-flow.test.mjs
```

Expected: FAIL because `activityCaptureDraft` does not exist.

- [ ] **Step 3: Implement and use the outcome policy**

Add to `src/daytraceIntegration.ts`:

```ts
export function activityCaptureDraft(
  current: string,
  result: DaytraceGeneration
): string {
  return result.summaryFile
    ? current
    : mergeCaptureDraft(current, result.captureMarkdown);
}
```

In `src/view.ts`, replace the unconditional `mergeCaptureDraft()` assignment with `activityCaptureDraft(this.simplifiedState.captureDraft, result)`. Keep both file notices and their durations unchanged.

- [ ] **Step 4: Run focused tests and verify GREEN**

```powershell
node --test tests/daytrace-integration.test.mjs tests/view-activity-flow.test.mjs tests/simplified-action-layout.test.mjs
```

Expected: all tests PASS; compact Activity loading remains unchanged.

- [ ] **Step 5: Commit the policy**

```powershell
git add src/daytraceIntegration.ts src/view.ts tests/daytrace-integration.test.mjs tests/view-activity-flow.test.mjs
git commit -m "fix(activity): keep successful drafts clean"
```

---

### Task 4: Add the dashboard History shortcut

**Files:**
- Create: `src/dashboardUtilityButtons.ts`
- Modify: `src/view.ts`
- Modify: `src/settings.ts`
- Modify: `main.ts`
- Create: `tests/dashboard-utility-buttons.test.mjs`
- Modify: `tests/settings-version.test.mjs`

**Interfaces:**
- Produces: `renderDashboardUtilityButtons(parent, { onRefresh, onHistory, onSettings })`.
- Produces: `SecondBrainSettingTab.requestHistoryOpen(): void`.
- Produces: `SecondBrainPlugin.openUsageHistory(): void`.
- Consumes: Obsidian Settings controller `open()` and `openTabById(pluginId)` behind the plugin boundary.

- [ ] **Step 1: Write a failing utility-button test**

Create `tests/dashboard-utility-buttons.test.mjs`, bundle the real renderer with `setIcon` and fake-element stubs, and assert order, accessibility, icon, and behavior:

```js
test("dashboard utilities put Usage history beside Settings", async () => {
  const controls = await loadControls();
  const parent = controls.__makeElement("div");
  const calls = [];
  controls.renderDashboardUtilityButtons(parent, {
    onRefresh: () => calls.push("refresh"),
    onHistory: () => calls.push("history"),
    onSettings: () => calls.push("settings"),
  });

  assert.deepEqual(parent.children.map((item) => item.title), [
    "Refresh", "Usage history", "Settings",
  ]);
  assert.equal(parent.children[1].ariaLabel, "Usage history");
  assert.equal(parent.children[1].icon, "book-open");
  await parent.children[1].trigger("click");
  assert.deepEqual(calls, ["history"]);
});
```

In the same file, bundle `SecondBrainView` with the fake Obsidian element boundary and invoke both compiled top-bar methods. This catches either mode failing to adopt the shared renderer:

```js
test("both dashboard modes expose Usage history", async () => {
  const { view, completeRoot, simplifiedRoot } = await topBarFixture();
  view.renderTopBar(completeRoot);
  view.renderSimplifiedTopBar(simplifiedRoot);

  for (const root of [completeRoot, simplifiedRoot]) {
    const buttons = root.findAll("button");
    assert.equal(buttons.filter((item) => item.title === "Usage history").length, 1);
    assert.equal(buttons.find((item) => item.title === "Usage history").icon, "book-open");
  }
});
```

- [ ] **Step 2: Write a failing requested-History test**

Extend `tests/settings-version.test.mjs`'s fake element to retain listeners and `open`, count `scrollIntoView()`, and trigger listeners. Add a reusable `makePlugin()` fixture and:

```js
test("requested History opens, scrolls, and refreshes once", async () => {
  const settings = await loadSettingsModule();
  let refreshes = 0;
  const tab = new settings.SecondBrainSettingTab(
    {}, makePlugin(settings, () => { refreshes += 1; })
  );
  tab.requestHistoryOpen();
  tab.display();
  await Promise.resolve();

  const history = tab.containerEl.children.find(
    (item) => item.children[0]?.textContent === "History"
  );
  assert.equal(history.open, true);
  assert.equal(history.scrollCalls, 1);
  assert.equal(refreshes, 1);
});
```

Keep the version-footer test and assert normal `display()` leaves History closed.

- [ ] **Step 3: Run the UI tests and verify RED**

```powershell
node --test tests/dashboard-utility-buttons.test.mjs tests/settings-version.test.mjs
```

Expected: FAIL because the renderer and `requestHistoryOpen()` do not exist.

- [ ] **Step 4: Implement reusable top-bar utilities**

Create `src/dashboardUtilityButtons.ts`:

```ts
import { setIcon } from "obsidian";

export interface DashboardUtilityCallbacks {
  onRefresh: () => void;
  onHistory: () => void;
  onSettings: () => void;
}

export function renderDashboardUtilityButtons(
  parent: HTMLElement,
  callbacks: DashboardUtilityCallbacks
): void {
  const refresh = parent.createEl("button", {
    text: "↻", cls: "second-brain-iconbtn",
    attr: { type: "button", title: "Refresh", "aria-label": "Refresh" },
  });
  refresh.addEventListener("click", callbacks.onRefresh);
  const history = parent.createEl("button", {
    cls: "second-brain-iconbtn",
    attr: { type: "button", title: "Usage history", "aria-label": "Usage history" },
  });
  setIcon(history, "book-open");
  history.addEventListener("click", callbacks.onHistory);
  const settings = parent.createEl("button", {
    text: "⚙", cls: "second-brain-iconbtn",
    attr: { type: "button", title: "Settings", "aria-label": "Settings" },
  });
  settings.addEventListener("click", callbacks.onSettings);
}
```

Use this renderer in both dashboard top bars. Wire History to `this.plugin.openUsageHistory()` and preserve each mode's refresh callback.

- [ ] **Step 5: Implement the explicit Settings boundary**

Add a one-shot `historyRequested` flag to `SecondBrainSettingTab`. `requestHistoryOpen()` sets it. `display()` consumes it, opens History initially, scrolls it with `{ block: "start" }`, and invokes a factored idempotent refresh method. A normal display keeps History closed.

Retain the setting-tab instance in `main.ts` and add:

```ts
openUsageHistory(): void {
  this.settingTab.requestHistoryOpen();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const setting = (this.app as any).setting;
  setting?.open();
  setting?.openTabById?.(this.manifest.id);
}
```

Do not change the Settings gear path.

- [ ] **Step 6: Run focused tests and verify GREEN**

```powershell
node --test tests/dashboard-utility-buttons.test.mjs tests/settings-version.test.mjs tests/simplified-action-layout.test.mjs
```

Expected: all tests PASS; the book button is between Refresh and Settings, and direct History opening refreshes once.

- [ ] **Step 7: Commit the shortcut**

```powershell
git add src/dashboardUtilityButtons.ts src/view.ts src/settings.ts main.ts tests/dashboard-utility-buttons.test.mjs tests/settings-version.test.mjs
git commit -m "feat(history): add dashboard shortcut"
```

---

### Task 5: Correct the GPT-5 connection-test limit

**Files:**
- Modify: `src/llm.ts`
- Modify: `tests/llm-usage.test.mjs`

**Interfaces:**
- Consumes: `testConnection(settings)` and the existing `requestUrl(request)` boundary.
- Produces: OpenAI payload with `max_completion_tokens: 5` and no `max_tokens`; Anthropic keeps `max_tokens: 5`.

- [ ] **Step 1: Add failing provider payload assertions**

Change the existing OpenAI connection test to retain the actual request:

```js
test("Test Connection uses the GPT-5 completion limit and records usage", async () => {
  let observed;
  const llm = await loadLLM(async (request) => {
    observed = request;
    return {
      status: 200,
      json: {
        id: "chatcmpl-test",
        choices: [{ message: { content: "hi" } }],
        usage: { prompt_tokens: 8, completion_tokens: 1 },
      },
      text: "",
    };
  });
  const events = [];
  llm.configureUsageEventSink((event) => events.push(event));
  const result = await llm.testConnection(settings());
  const payload = JSON.parse(observed.body);

  assert.equal(result.ok, true);
  assert.equal(payload.max_completion_tokens, 5);
  assert.equal("max_tokens" in payload, false);
  assert.equal(events[0].action, "Test connection");
});
```

Add an Anthropic settings case asserting its request has `max_tokens: 5` and lacks `max_completion_tokens`.

- [ ] **Step 2: Run the focused test and verify RED**

```powershell
node --test --test-name-pattern="Test Connection" tests/llm-usage.test.mjs
```

Expected: FAIL because OpenAI currently sends `max_tokens: 5`.

- [ ] **Step 3: Make the provider-specific correction**

Change only the OpenAI request body field in `testConnection()`:

```ts
max_completion_tokens: 5,
```

Leave Anthropic, endpoints, provider errors, messages, usage extraction, and History recording untouched.

- [ ] **Step 4: Run the full LLM test and verify GREEN**

```powershell
node --test tests/llm-usage.test.mjs
```

Expected: all LLM usage and connection tests PASS.

- [ ] **Step 5: Commit the correction**

```powershell
git add src/llm.ts tests/llm-usage.test.mjs
git commit -m "fix(openai): use GPT-5 completion limit"
```

---

### Task 6: Package, verify, and publish v0.18.1

**Files:**
- Modify: `README.md`
- Modify: `manifest.json`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: Tasks 1-5.
- Produces: GitHub release `v0.18.1` with `main.js`, `manifest.json`, and `styles.css`.

- [ ] **Step 1: Update user-facing documentation**

Revise the daily loop to say Activity saves evidence and its AI summary without filling Capture, and that Simplified Review consumes and copies saved DayTrace tables. Add:

```markdown
- v0.18.1 — **Activity-aware Review and direct History.** A book button beside Settings opens usage History directly; successful Activity runs keep Capture untouched while selected-date Reviews consume saved DayTrace summaries and preserve their workstream tables verbatim. GPT-5 connection tests now use the supported completion-token field.
```

Document no notification-duration change.

- [ ] **Step 2: Bump all version fields**

Set `0.18.1` in:

```text
manifest.json                    version
package.json                     version
package-lock.json                version
package-lock.json packages[""]   version
```

- [ ] **Step 3: Run complete local verification**

```powershell
npm test
npm run build
npm audit --omit=dev
git diff --check
```

Expected: every test passes, TypeScript and esbuild succeed, audit reports zero vulnerabilities, and the diff has no whitespace errors.

- [ ] **Step 4: Verify version and worktree contents**

```powershell
$lock = Get-Content package-lock.json | ConvertFrom-Json -AsHashTable
@(
  (Get-Content manifest.json | ConvertFrom-Json).version,
  (Get-Content package.json | ConvertFrom-Json).version,
  $lock.version,
  $lock.packages[""].version
) | ForEach-Object { if ($_ -ne "0.18.1") { throw "Version mismatch: $_" } }
git status --short
git diff --stat
```

Expected: all versions are `0.18.1`; only release documentation and version files remain uncommitted at this task boundary.

- [ ] **Step 5: Commit release metadata**

```powershell
git add README.md manifest.json package.json package-lock.json
git commit -m "chore(release): prepare v0.18.1"
```

- [ ] **Step 6: Reconcile remote and reverify**

```powershell
git fetch origin master --tags
git rebase origin/master
npm test
npm run build
```

Expected: local commits rebase on the newest `origin/master`; tests and build pass again. Preserve both sides of any real overlap.

- [ ] **Step 7: Push master and tag**

```powershell
git push origin HEAD:master
git tag v0.18.1
git push origin v0.18.1
```

Expected: remote `master` and `refs/tags/v0.18.1` resolve to the same final commit.

- [ ] **Step 8: Wait for the release workflow**

```powershell
$runs = gh run list --workflow release.yml --limit 5 --json databaseId,headBranch,headSha,status,conclusion,url | ConvertFrom-Json
$releaseRun = $runs | Where-Object { $_.headBranch -eq "v0.18.1" } | Select-Object -First 1
if (-not $releaseRun) { throw "v0.18.1 release workflow not found" }
gh run watch $releaseRun.databaseId --exit-status
```

Expected: the run whose `headBranch` is `v0.18.1` completes with `success`.

- [ ] **Step 9: Verify downloadable assets**

```powershell
$releaseCheckDir = Join-Path $env:TEMP ("second-brain-v0.18.1-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $releaseCheckDir | Out-Null
gh release download v0.18.1 --dir $releaseCheckDir
Get-ChildItem -LiteralPath $releaseCheckDir | Select-Object Name,Length
if ((Get-Content (Join-Path $releaseCheckDir "manifest.json") | ConvertFrom-Json).version -ne "0.18.1") { throw "Wrong release manifest" }
if (-not (Select-String -LiteralPath (Join-Path $releaseCheckDir "main.js") -SimpleMatch "Usage history" -Quiet)) { throw "History shortcut missing" }
if (-not (Select-String -LiteralPath (Join-Path $releaseCheckDir "main.js") -SimpleMatch "max_completion_tokens" -Quiet)) { throw "OpenAI fix missing" }
```

Expected: all three assets download; manifest is `0.18.1`; bundle contains the History shortcut and OpenAI fix.
