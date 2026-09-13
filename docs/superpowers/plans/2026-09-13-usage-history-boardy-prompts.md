# Usage History and Conversational Voice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a more context-sensitive Capture/Review voice agent and a private Settings → History view that reports exact Vapi charges and token-based OpenAI/Anthropic estimates.

**Architecture:** Provider calls emit content-free usage events into a serialized `UsageHistoryStore` owned by the plugin. Voice calls create a pending Vapi component locally, share an interaction ID with their post-call synthesis request, and become exact when desktop Obsidian reconciles them through Vapi's private API; Settings groups those components without presenting pending or unknown amounts as zero.

**Tech Stack:** TypeScript, Obsidian plugin APIs, `@vapi-ai/web`, Vapi REST API, Node test runner, esbuild, CSS, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-13-usage-history-boardy-prompts-design.md`

## Global Constraints

- Release the complete feature as `v0.18.0`; update `manifest.json`, `package.json`, `package-lock.json`, and the README release log together.
- Store at most 500 metadata-only history entries and show at most 50 interactions, newest first.
- Never persist prompts, transcripts, captures, reviews, generated text, provider keys, or raw provider responses in History.
- Keep `VAPI_PRIVATE_KEY` exclusively in the desktop process environment; never add it to settings, `data.json`, the bundle, logs, notices, or mobile storage.
- Do not request or store an OpenAI Admin key, add a hosted backend, or replace Vapi with a direct realtime stack in this release.
- Use `exact`, `estimated`, `pending`, and `unknown` accuracy states. Never silently count a pending or unknown component as zero.
- Perform an idempotent 30-day Vapi backfill on the first successful desktop reconciliation, then reconcile known pending call IDs.
- Keep Vapi GPT-4.1, the Elliot voice, talkativeness 5, no tools, and call recording disabled.
- Cap combined Capture call draft/context at 12,000 characters, prioritizing the current draft and the newest portion of today's log; Review context remains unchanged.
- Preserve custom voice prompts. Built-in defaults and Reset to defaults receive the new active-listening behavior.
- History recording and reconciliation failures must never fail Capture, Review, Ask, Activity, or another AI action.
- Include the new DayTrace Activity provider calls added in `v0.17.0` under one `Activity` interaction.
- Deliver through `origin/master`, the `v0.18.0` tag, a successful GitHub release with `main.js`, `manifest.json`, and `styles.css`, and an exact-asset install into the local vault that preserves `data.json`.

---

### Task 1: Conversational defaults and bounded Capture context

**Files:**
- Modify: `src/voiceCallSupport.ts:27-75`
- Modify: `scripts/vapi-assistant-config.mjs:3-42`
- Modify: `tests/voice-call.test.mjs:13-73`
- Modify: `tests/vapi-assistant-config.test.mjs:4-20`

**Interfaces:**
- Consumes: `VoiceSessionInput` and Vapi template variables already used by `VoiceCallModal`.
- Produces: `MAX_CAPTURE_CONTEXT_CHARS`, `boundCaptureVoiceContext(input: VoiceSessionInput): { currentDraft: string; context: string }`, and revised `DEFAULT_CAPTURE_CALL_PROMPT` / `DEFAULT_REVIEW_CALL_PROMPT`.

- [ ] **Step 1: Write failing tests for active listening and the 12,000-character boundary**

Add assertions that the defaults require one question, specific follow-ups, thread depth, concrete examples, brief verification, and avoidance of generic praise. Add this boundary test to `tests/voice-call.test.mjs`:

```js
test("capture context keeps the draft and newest log text within 12,000 characters", async () => {
  const { buildVoiceSessionVariables, MAX_CAPTURE_CONTEXT_CHARS } = await loadVoiceSupport();
  const currentDraft = "D".repeat(2_000);
  const oldLog = "O".repeat(8_000);
  const recentLog = "R".repeat(8_000);
  const variables = buildVoiceSessionVariables({
    mode: "capture",
    today: "2026-09-13",
    context: oldLog + recentLog,
    currentDraft,
    talkativeness: 5,
  });

  assert.equal(MAX_CAPTURE_CONTEXT_CHARS, 12_000);
  assert.equal(variables.currentDraft, currentDraft);
  assert.ok(variables.sessionContext.startsWith("[Older capture context omitted]"));
  assert.ok(variables.sessionContext.endsWith("R".repeat(8_000)));
  assert.ok(variables.currentDraft.length + variables.sessionContext.length <= 12_000);
});
```

Also test that Review context is returned byte-for-byte and that a draft longer than 12,000 characters keeps its newest portion with an omission marker and sends `(no additional context)` as `sessionContext`.

- [ ] **Step 2: Run the focused tests and verify the new assertions fail**

Run: `node --test tests/voice-call.test.mjs tests/vapi-assistant-config.test.mjs`

Expected: FAIL because the new conversational phrases and bounded-context exports do not exist.

- [ ] **Step 3: Implement the exact context-priority rule and revise both editable defaults**

In `src/voiceCallSupport.ts`, add:

```ts
export const MAX_CAPTURE_CONTEXT_CHARS = 12_000;
const CONTEXT_OMISSION = "[Older capture context omitted]\n";
const DRAFT_OMISSION = "[Older draft text omitted]\n";
const NO_ADDITIONAL_CONTEXT = "(no additional context)";

export function boundCaptureVoiceContext(
  input: VoiceSessionInput
): { currentDraft: string; context: string } {
  const draft = input.currentDraft.trim();
  const context = input.context.trim();
  if (input.mode !== "capture") return { currentDraft: draft, context };
  const maximumDraft = MAX_CAPTURE_CONTEXT_CHARS - NO_ADDITIONAL_CONTEXT.length;
  if (draft.length >= maximumDraft) {
    const keep = maximumDraft - DRAFT_OMISSION.length;
    return {
      currentDraft: DRAFT_OMISSION + draft.slice(-keep),
      context: NO_ADDITIONAL_CONTEXT,
    };
  }
  const budget = MAX_CAPTURE_CONTEXT_CHARS - draft.length;
  if (context.length <= budget) return { currentDraft: draft, context };
  const keep = Math.max(0, budget - CONTEXT_OMISSION.length);
  return {
    currentDraft: draft,
    context: CONTEXT_OMISSION + context.slice(-keep),
  };
}
```

Call this from `buildVoiceSessionVariables`. Rewrite the defaults so they explicitly say to anchor the next question in the most specific or emotionally important phrase, stay on a promising thread for two or three turns, request a concrete event/decision/consequence when vague, briefly reflect an interpretation every few turns, and avoid canned praise, therapy language, unsolicited advice, and multi-part questions.

- [ ] **Step 4: Align the managed Vapi system prompt**

Update `SYSTEM_PROMPT` in `scripts/vapi-assistant-config.mjs` with the same active-listening rules and increment `metadata.schemaVersion` from `"1"` to `"2"`. Do not change these assertions:

```js
assert.equal(config.model.model, "gpt-4.1");
assert.equal(config.voice.voiceId, "Elliot");
assert.equal(config.artifactPlan.recordingEnabled, false);
assert.equal(config.server, undefined);
```

- [ ] **Step 5: Run the focused tests and commit**

Run: `node --test tests/voice-call.test.mjs tests/vapi-assistant-config.test.mjs`

Expected: PASS.

```powershell
git add src/voiceCallSupport.ts scripts/vapi-assistant-config.mjs tests/voice-call.test.mjs tests/vapi-assistant-config.test.mjs
git commit -m "feat(voice): deepen contextual follow-ups"
```

---

### Task 2: Usage schema, pricing, aggregation, and redaction

**Files:**
- Create: `src/usageHistory.ts`
- Create: `tests/usage-history.test.mjs`
- Modify: `src/modelRoutes.ts:107-129`
- Modify: `src/settings.ts:27-41`

**Interfaces:**
- Consumes: `MODEL_CATALOG` model IDs and provider names.
- Produces: `UsageHistoryEntry`, `UsageHistoryState`, `ProviderUsageEvent`, `UsageHistoryStore`, `createProviderUsageEntry`, `sanitizeUsageHistoryState`, `groupUsageInteractions`, `summarizeUsageWindows`, and `createInteractionId`.

- [ ] **Step 1: Write failing domain tests**

Create `tests/usage-history.test.mjs` using the same esbuild data-URL loader pattern as `tests/voice-call.test.mjs`. Cover:

```js
test("OpenAI cached input is subtracted once and reasoning is not double billed", async () => {
  const history = await loadHistory();
  const entry = history.createProviderUsageEntry({
    provider: "openai",
    model: "gpt-5",
    status: "completed",
    action: "Review",
    interactionId: "review-1",
    providerRequestId: "chatcmpl-1",
    usage: {
      inputTokens: 1_000,
      cachedInputTokens: 400,
      outputTokens: 200,
      reasoningTokens: 150,
    },
  }, "2026-09-13T12:00:00.000Z");

  assert.equal(entry.id, "openai:chatcmpl-1");
  assert.equal(entry.accuracy, "estimated");
  assert.equal(entry.costUsd, ((600 * 1.25) + (400 * 0.125) + (200 * 10)) / 1_000_000);
  assert.equal(entry.usage.reasoningTokens, 150);
});
```

Also cover Anthropic input/output estimation, unknown models with retained tokens and no `costUsd`, timestamped model aliases, invalid-record skipping, 500-entry retention, duplicate IDs, duplicate Vapi call IDs, voice grouping, mixed exact/estimated aggregation, pending display metadata, today/7-day/30-day windows, and JSON redaction.

The redaction test must pass an object containing `prompt`, `transcript`, `generatedText`, and `apiKey` through `sanitizeUsageHistoryState`, then assert none of those keys or values appear in `JSON.stringify(result)`.

- [ ] **Step 2: Run the history tests and verify they fail**

Run: `node --test tests/usage-history.test.mjs`

Expected: FAIL because `src/usageHistory.ts` does not exist.

- [ ] **Step 3: Extend the model catalog with versioned cached-input rates**

Change `ModelInfo` to:

```ts
export interface ModelInfo {
  id: string;
  label: string;
  provider: "openai" | "anthropic";
  inPrice: number;
  cachedInPrice?: number;
  outPrice: number;
}
```

Use a single exported `MODEL_PRICING_VERSION = "2026-09-13"`. Add cached-input rates to the OpenAI entries already shown in Settings: `gpt-5.5: 0.50`, `gpt-5.4: 0.25`, `gpt-5: 0.125`, `gpt-5-mini: 0.025`, and `gpt-4.1-nano: 0.025`, all USD per million tokens. Exact IDs win; dated IDs resolve against the longest catalog ID followed by `-`.

Remove the duplicated model-price arrays from `src/settings.ts` and derive provider dropdown options from `MODEL_CATALOG`, keeping the current quality-first order and labels. This makes the catalog the only price source used by both routing hints and History.

- [ ] **Step 4: Implement the allowlisted data model and pure calculations**

Define the persisted interfaces exactly as the spec, with these constants:

```ts
export const USAGE_HISTORY_SCHEMA_VERSION = 1 as const;
export const MAX_USAGE_HISTORY_ENTRIES = 500;
export const MAX_VISIBLE_USAGE_INTERACTIONS = 50;
```

Define the provider event and aggregate contracts used by later tasks:

```ts
export interface ProviderUsageEvent {
  provider: "openai" | "anthropic";
  model: string;
  status: "completed" | "failed";
  action?: string;
  interactionId?: string;
  providerRequestId?: string;
  occurredAt?: string;
  usage?: {
    inputTokens?: number;
    cachedInputTokens?: number;
    outputTokens?: number;
    reasoningTokens?: number;
  };
}

export interface UsageInteractionGroup {
  interactionId: string;
  occurredAt: string;
  action: string;
  entries: UsageHistoryEntry[];
  accuracy: "exact" | "estimated" | "pending" | "unknown";
  knownCostUsd?: number;
  hasUnpricedComponents: boolean;
  durationSeconds?: number;
}
```

`createProviderUsageEntry` must build a new allowlisted object rather than spread provider data. For OpenAI, bill `(inputTokens - cachedInputTokens)` at `inPrice`, cached input at `cachedInPrice ?? inPrice`, and all `outputTokens` at `outPrice`; show reasoning as detail only. Treat Anthropic usage as already normalized to total input plus cached-read detail and use the same formula. Clamp all token counts and monetary fields to finite non-negative numbers.

`groupUsageInteractions` must return one row per `interactionId`; its aggregate accuracy is `pending` if any component is pending, `unknown` if none is pending and any component is unknown, `estimated` if any known component is estimated, otherwise `exact`. Its `knownCostUsd` is optional and its `hasUnpricedComponents` flag must stay true when a pending or unknown component exists.

- [ ] **Step 5: Implement serialized, failure-isolated storage**

Use this public constructor and methods:

```ts
export class UsageHistoryStore {
  constructor(
    initial: unknown,
    persist: (state: UsageHistoryState) => Promise<void>,
    onError: (error: unknown) => void
  );
  snapshot(): UsageHistoryState;
  recordProviderUsage(event: ProviderUsageEvent): Promise<void>;
  upsert(entry: UsageHistoryEntry): Promise<void>;
  replaceAll(entries: UsageHistoryEntry[], lastVapiSyncAt?: string): Promise<void>;
  clear(): Promise<void>;
}
```

Each mutating method must append work to one internal promise queue, deduplicate before applying the 500-entry cap, update in-memory state, persist one cloned state, catch persistence errors through `onError`, and resolve rather than reject.

- [ ] **Step 6: Run the focused tests and commit**

Run: `node --test tests/usage-history.test.mjs`

Expected: PASS.

```powershell
git add src/usageHistory.ts src/modelRoutes.ts src/settings.ts tests/usage-history.test.mjs
git commit -m "feat(history): add private usage ledger"
```

---

### Task 3: Provider telemetry and action grouping

**Files:**
- Create: `src/usageTelemetry.ts`
- Create: `tests/llm-usage.test.mjs`
- Modify: `src/llm.ts:15-197`
- Modify: `src/daytraceIntegration.ts:34-307`
- Modify: `src/askChat.ts:48-93`
- Modify: `src/runner.ts:57-212`
- Modify: `src/goalModals.ts:138-146`
- Modify: `src/habitDesignerModal.ts:190-198`
- Modify: `src/interviewModal.ts:134-194`
- Modify: `src/projectAIModals.ts:149-271`
- Modify: `src/view.ts:492-512`
- Test: `tests/daytrace-integration.test.mjs`

**Interfaces:**
- Consumes: `ProviderUsageEvent`, `createInteractionId`, and existing `callLLM` callers.
- Produces: global plugin-lifecycle telemetry registration plus `LLMCallContext` on individual calls.

- [ ] **Step 1: Write failing response-extraction and grouping tests**

In `tests/llm-usage.test.mjs`, bundle `src/llm.ts` with an Obsidian `requestUrl` stub. Configure a recorder, return one OpenAI fixture with `prompt_tokens_details.cached_tokens` and `completion_tokens_details.reasoning_tokens`, and assert the emitted event contains only provider/model/status/request ID/action/interaction ID/token metadata. Add an Anthropic fixture with `input_tokens`, `cache_read_input_tokens`, `output_tokens`, and `id`. Add a 401 fixture and assert one `failed` event without tokens or cost is emitted before the original error is rethrown. Exercise `testConnection` with a usage-bearing five-token response and assert action `Test connection` is recorded.

Add a DayTrace test that injects a recorder context, returns two provider completions under one run, and asserts both events use the same `interactionId` and action `Activity`.

- [ ] **Step 2: Run the focused telemetry tests and verify they fail**

Run: `node --test tests/llm-usage.test.mjs tests/daytrace-integration.test.mjs`

Expected: FAIL because telemetry registration and `LLMCallContext` do not exist.

- [ ] **Step 3: Add a failure-isolated telemetry bridge**

Implement `src/usageTelemetry.ts` with this API:

```ts
import type { ProviderUsageEvent } from "./usageHistory";

export type UsageEventSink = (event: ProviderUsageEvent) => void | Promise<void>;
let sink: UsageEventSink | undefined;

export function configureUsageEventSink(next?: UsageEventSink): void {
  sink = next;
}

export async function emitUsageEvent(event: ProviderUsageEvent): Promise<void> {
  try {
    await sink?.(event);
  } catch {
    // Usage telemetry must never fail the user's AI action.
  }
}
```

- [ ] **Step 4: Instrument `callLLM` without changing its text return contract**

Define `LLMCallContext` and extend `LLMOverride` with it:

```ts
export interface LLMCallContext {
  action?: string;
  interactionId?: string;
}

export interface LLMOverride {
  model?: string;
  effort?: "default" | "off" | "low" | "high";
  usage?: LLMCallContext;
}
```

Have private OpenAI/Anthropic functions return `{ text, providerRequestId, usage }` internally. Normalize Anthropic `inputTokens` to `input_tokens + cache_read_input_tokens`; keep `cachedInputTokens` separately. `callLLM` emits `completed` after validating non-empty text and emits `failed` with provider/model/action/interaction metadata in its catch path before rethrowing. Default omitted labels to `AI request` and generate an interaction ID once per call. Apply the same allowlisted extraction to `testConnection`, using action `Test connection`; a failed connection test records provider/model/status only and still returns its existing user-facing result.

- [ ] **Step 5: Label all existing call sites and group multi-call actions**

Use these exact labels:

```ts
// runner.ts
usage: { action: command.label }

// askChat.ts — create once before pass 1 and reuse for both passes
const interactionId = createInteractionId();
usage: { action: "Ask", interactionId }

// project/goal/habit modals
usage: { action: "Project AI" }

// interviewModal.ts — one ID for questions and final synthesis
usage: { action: "Interview", interactionId: this.interactionId }
```

After editing, run `rg -n "callLLM\(" src -g "*.ts"` and inspect every non-definition result. Every caller must either provide `usage.action` or intentionally exercise the `AI request` fallback in a test.

- [ ] **Step 6: Instrument direct DayTrace calls**

Extend `GenerateDaytraceOptions` with `usage?: { action: string; interactionId: string }`, pass it to `createDaytraceSummaryProvider`, and emit one normalized event for every provider completion. In `view.ts`, create one interaction ID before `generateDaytraceActivity` and pass `{ action: "Activity", interactionId }`. Emit a failed event only when provider and model are known; do not emit events for local ActivityWatch HTTP calls.

- [ ] **Step 7: Run the focused tests and commit**

Run: `node --test tests/llm-usage.test.mjs tests/daytrace-integration.test.mjs tests/voice-call.test.mjs`

Expected: PASS.

```powershell
git add src/usageTelemetry.ts src/llm.ts src/daytraceIntegration.ts src/askChat.ts src/runner.ts src/goalModals.ts src/habitDesignerModal.ts src/interviewModal.ts src/projectAIModals.ts src/view.ts tests/llm-usage.test.mjs tests/daytrace-integration.test.mjs
git commit -m "feat(history): record provider usage"
```

---

### Task 4: Vapi call lifecycle and exact reconciliation

**Files:**
- Create: `src/vapiUsage.ts`
- Create: `tests/vapi-usage.test.mjs`
- Modify: `src/voiceInterviewModal.ts:33-387`
- Modify: `tests/voice-call.test.mjs`

**Interfaces:**
- Consumes: `UsageHistoryStore`, `VoiceCallMode`, `vapi.start()`'s returned `Call.id`, and the SDK `call-start-success` event's `callId`.
- Produces: `createPendingVapiEntry`, `completePendingVapiEntry`, `reconcileVapiUsage`, and one shared interaction ID across the Vapi and synthesis components.

- [ ] **Step 1: Write failing parser, reconciliation, retry, and mobile tests**

Create `tests/vapi-usage.test.mjs` and test these fixtures:

```js
const completedCall = {
  id: "call-1",
  assistantId: "assistant-1",
  createdAt: "2026-09-13T18:47:30.000Z",
  startedAt: "2026-09-13T18:47:30.000Z",
  endedAt: "2026-09-13T18:49:13.000Z",
  status: "ended",
  cost: 0.1619,
  costBreakdown: {
    transport: 0.0020,
    stt: 0.0172,
    llm: 0.0154,
    tts: 0.0416,
    vapi: 0.0857,
  },
  messages: [{ role: "user", message: "private transcript" }],
};
```

Assert exact mapping to transport/transcription/model/voice/platform, duration 103 seconds, omission of `messages`, idempotence by call ID, pending preservation when cost is absent, three-request maximum concurrency, all-or-nothing state on a failed request, and one successful 30-day backfill whose URL contains `assistantId=assistant-1`, an ISO-8601 `createdAtGe` value, and `limit=1000`.

Test `readVapiPrivateKey({ VAPI_PRIVATE_KEY: " secret " }) === "secret"` and `readVapiPrivateKey(undefined) === undefined`; assert the missing-key result makes zero requests and explains desktop restart/mobile reconciliation without exposing a key.

- [ ] **Step 2: Run the Vapi tests and verify they fail**

Run: `node --test tests/vapi-usage.test.mjs`

Expected: FAIL because `src/vapiUsage.ts` does not exist.

- [ ] **Step 3: Implement allowlisted Vapi mapping and transactional reconciliation**

Use this public API:

```ts
export interface VapiReconcileOptions {
  assistantId: string;
  privateKey?: string;
  now?: Date;
  request?: typeof requestUrl;
}

export interface VapiReconcileResult {
  state: UsageHistoryState;
  status: "updated" | "missing-key" | "mobile" | "failed";
  message: string;
  imported: number;
  reconciled: number;
}

export function readVapiPrivateKey(
  env: Record<string, string | undefined> | undefined
): string | undefined;

export function createPendingVapiEntry(input: {
  callId: string;
  interactionId: string;
  action: "Capture call" | "Review call";
  occurredAt: string;
}): UsageHistoryEntry;

export function completePendingVapiEntry(input: {
  entry: UsageHistoryEntry;
  status: "completed" | "failed" | "cancelled";
  durationSeconds?: number;
}): UsageHistoryEntry;

export async function reconcileVapiUsage(
  state: UsageHistoryState,
  options: VapiReconcileOptions
): Promise<VapiReconcileResult>;
```

Use `requestUrl` with the private key in the Bearer authorization header, a three-worker queue for known pending IDs, and `URLSearchParams` for the backfill query. Build all updates in a detached array and return the original state on any authentication/network failure. Set `lastVapiSyncAt` only after the whole refresh succeeds. Preserve the local action and interaction ID when a call ID matches; imported calls use action `Voice call` and interaction ID `vapi:<call-id>`. Never include `messages`, `artifact`, `analysis`, or the raw call object in an entry or error message.

- [ ] **Step 4: Track calls in `VoiceCallModal` and share their interaction ID**

Add these fields:

```ts
private readonly interactionId = createInteractionId();
private callId?: string;
private callStartedAt?: number;
private localCallFinished = false;
```

Register `call-start-success` and also inspect the object returned from `await vapi.start(assistant, { variableValues: variables })`; pass either discovered ID through one idempotent `trackStartedCall(callId)` method. That method inserts a pending `vapi-call` entry with action `Capture call` or `Review call`. On `call-end` and explicit End call, update local duration/status once. On close before normal completion, mark the known entry `cancelled` while leaving accuracy pending for later server reconciliation.

Pass the same `interactionId` into draft synthesis:

```ts
usage: {
  action: this.options.mode === "capture" ? "Capture call" : "Review call",
  interactionId: this.interactionId,
}
```

- [ ] **Step 5: Run focused voice/Vapi tests and commit**

Run: `node --test tests/vapi-usage.test.mjs tests/voice-call.test.mjs tests/mobile-voice-bundle.test.mjs`

Expected: PASS.

```powershell
git add src/vapiUsage.ts src/voiceInterviewModal.ts tests/vapi-usage.test.mjs tests/voice-call.test.mjs
git commit -m "feat(history): reconcile Vapi call costs"
```

---

### Task 5: Plugin lifecycle and Settings → History UI

**Files:**
- Create: `src/usageHistorySettings.ts`
- Create: `tests/usage-history-settings.test.mjs`
- Modify: `main.ts:1-49`
- Modify: `src/settings.ts:1-230`
- Modify: `styles.css:1062-1125`
- Modify: `tests/settings-version.test.mjs:8-31`

**Interfaces:**
- Consumes: `UsageHistoryStore`, `reconcileVapiUsage`, grouped interactions, summary windows, plugin `saveData`, and the existing error log.
- Produces: plugin-owned `usageHistory`, `refreshExactUsageCosts()`, `clearUsageHistory()`, and the collapsed History section above Troubleshooting and Logs.

- [ ] **Step 1: Write failing plugin-store and Settings rendering tests**

Add a settings-order assertion:

```js
const menus = topLevel.slice(0, -1).map((element) => element.children[0]?.textContent);
assert.deepEqual(menus.slice(-3), ["History", "Troubleshooting", "Logs"]);
```

Create `tests/usage-history-settings.test.mjs` with an Obsidian DOM stub and a plugin fixture containing one exact Vapi component plus one estimated synthesis component under the same interaction. Assert Today/7 days/30 days totals, `Capture call`, provider/model, duration, approximation marker, component breakdown, token details, `Refresh exact costs`, and `Clear history` are rendered. Invoke clear, assert the confirmation modal opens, invoke its confirm callback, and assert `usageHistory.clear()` runs once.

- [ ] **Step 2: Run the focused UI tests and verify they fail**

Run: `node --test tests/settings-version.test.mjs tests/usage-history-settings.test.mjs`

Expected: FAIL because the History section and renderer do not exist.

- [ ] **Step 3: Own and configure history in the plugin lifecycle**

Add to `SecondBrainSettings`:

```ts
usageHistory?: UsageHistoryState;
```

Add to `SecondBrainPlugin`:

```ts
usageHistory!: UsageHistoryStore;

async refreshExactUsageCosts(): Promise<VapiReconcileResult>;
async clearUsageHistory(): Promise<void>;
```

After `loadSettings`, instantiate the store with `this.settings.usageHistory`, a persist callback that assigns a cloned state and calls `saveSettings`, and `errorLog.push("usage-history", error)`. Register `configureUsageEventSink(event => this.usageHistory.recordProviderUsage(event))`; clear that sink in `onunload`.

`refreshExactUsageCosts` must guard with one in-flight promise, return a mobile status without reading an environment variable when `Platform.isDesktopApp` is false, read the desktop environment with `readVapiPrivateKey(typeof process === "undefined" ? undefined : process.env)`, reconcile a snapshot, and replace the store only when the result is `updated`.

- [ ] **Step 4: Render the complete History experience**

Implement `renderUsageHistory(containerEl, plugin)` and `ClearUsageHistoryModal` in `src/usageHistorySettings.ts`. Render three total cards, the `Exact` / `Estimated` / `Pending` legend, newest 50 grouped rows as `<details>`, breakdown values, token fields, and status copy. Monetary formatting rules:

```ts
export function formatUsageCost(
  knownCostUsd: number | undefined,
  accuracy: UsageAccuracy,
  hasUnpricedComponents: boolean
): string {
  if (knownCostUsd === undefined) return accuracy === "pending" ? "Pending" : "Unknown";
  const amount = knownCostUsd < 0.01 ? `$${knownCostUsd.toFixed(4)}` : `$${knownCostUsd.toFixed(2)}`;
  return hasUnpricedComponents ? `${amount} + pending` : accuracy === "exact" ? amount : `≈${amount}`;
}
```

Change `collapsible` to return its `HTMLDetailsElement`. Insert History immediately before Troubleshooting. On its first open per settings-tab instance, render the current snapshot and quietly call `refreshExactUsageCosts`; update only the History body and status when the promise settles. The explicit refresh button always retries. The mobile message must say exact Vapi charges appear after desktop reconciliation; the desktop missing-key message must say to define `VAPI_PRIVATE_KEY` and fully restart Obsidian.

- [ ] **Step 5: Add responsive History styles**

Add selectors for `.second-brain-history-totals`, `.second-brain-history-total`, `.second-brain-history-legend`, `.second-brain-history-row`, `.second-brain-history-head`, `.second-brain-history-accuracy`, `.second-brain-history-breakdown`, `.second-brain-history-actions`, and `.second-brain-history-status`. Use a three-column total grid on desktop, a single column below 600px, existing Obsidian color variables, 44px minimum button height on mobile, and wrapping row headers so costs never overflow the phone width.

- [ ] **Step 6: Run focused tests and commit**

Run: `node --test tests/settings-version.test.mjs tests/usage-history-settings.test.mjs tests/usage-history.test.mjs tests/vapi-usage.test.mjs`

Expected: PASS.

```powershell
git add main.ts src/settings.ts src/usageHistorySettings.ts styles.css tests/settings-version.test.mjs tests/usage-history-settings.test.mjs
git commit -m "feat(settings): show AI cost history"
```

---

### Task 6: Full verification, managed-assistant update, documentation, and release

**Files:**
- Modify: `README.md:1-90`
- Modify: `manifest.json:4`
- Modify: `package.json:3`
- Modify: `package-lock.json` root/package version fields
- Verify: every source and test file changed in Tasks 1-5

**Interfaces:**
- Consumes: the completed feature and repository release workflow.
- Produces: the updated managed Vapi assistant, version `0.18.0`, pushed source, matching tag, downloadable release assets, and local-vault installation.

- [ ] **Step 1: Run the full redaction and call-site audit**

Run:

```powershell
rg -n "VAPI_PRIVATE_KEY|apiKey|transcript|prompt|generatedText" src/usageHistory.ts src/vapiUsage.ts src/usageHistorySettings.ts
rg -n "callLLM\(" src -g "*.ts"
git diff --check
```

Expected: the private key appears only in the environment-reader identifier/copy; history mappers contain explicit rejected-key tests but no persisted content fields; every `callLLM` caller has an intentional action label or the tested fallback; `git diff --check` exits 0.

- [ ] **Step 2: Run the complete automated suite and production build**

Run:

```powershell
npm test
npm run build
```

Expected: all tests pass and TypeScript/esbuild exit 0.

- [ ] **Step 3: Update the real managed Vapi assistant and verify its safe configuration**

Run without printing the key:

```powershell
$env:VAPI_PRIVATE_KEY = [Environment]::GetEnvironmentVariable('VAPI_PRIVATE_KEY', 'User')
if ([string]::IsNullOrWhiteSpace($env:VAPI_PRIVATE_KEY)) { throw 'User-level VAPI_PRIVATE_KEY is unavailable' }
node scripts/provision-vapi-assistant.mjs
Remove-Item Env:VAPI_PRIVATE_KEY
```

Expected: the script reports `updated`, assistant ID `c4061ebd-5e6b-4a0f-a9da-8e9197a24386`, model `gpt-4.1`, and voice `Elliot`; it never prints the private key.

- [ ] **Step 4: Document History accuracy and key handling**

Update README's daily loop and Voice setup to explain: History is metadata-only; Vapi becomes exact after desktop reconciliation; OpenAI/Anthropic dollar figures are token-based estimates; mobile shows pending Vapi charges until desktop sync; the public Vapi key remains in plugin settings; `VAPI_PRIVATE_KEY` remains a desktop environment variable and requires a full Obsidian restart after creation.

- [ ] **Step 5: Bump all package versions to 0.18.0 and add the release log**

Run:

```powershell
npm version 0.18.0 --no-git-tag-version
```

Set `manifest.json` version to `0.18.0`. Add a README release-log entry naming conversational follow-ups, 12,000-character Capture context, Settings History, exact Vapi reconciliation, provider estimates, Activity coverage, and mobile pending behavior.

- [ ] **Step 6: Re-run full verification after version/docs changes**

Run:

```powershell
npm test
npm run build
git diff --check
git status --short
```

Expected: all tests and build pass; only intended feature, test, documentation, and version files are modified; generated `main.js` remains ignored.

- [ ] **Step 7: Commit and push the completed release source**

```powershell
git add README.md manifest.json package.json package-lock.json
git commit -m "chore(release): prepare v0.18.0"
git push origin master
```

Verify:

```powershell
git fetch origin
git rev-parse HEAD
git rev-parse origin/master
git status --short
```

Expected: local HEAD equals `origin/master` and the worktree is clean.

- [ ] **Step 8: Tag and verify the GitHub release**

```powershell
git tag -a v0.18.0 -m "v0.18.0"
git push origin v0.18.0
$releaseRun = gh run list --workflow release.yml --branch v0.18.0 --limit 1 --json databaseId --jq '.[0].databaseId'
if ([string]::IsNullOrWhiteSpace($releaseRun)) { throw 'Release workflow run was not found' }
gh run watch $releaseRun --exit-status
gh release view v0.18.0 --json tagName,isDraft,isPrerelease,assets,url
```

Expected: the release workflow succeeds; the release is neither draft nor prerelease; assets are exactly `main.js`, `manifest.json`, and `styles.css`.

- [ ] **Step 9: Install exact release assets into the local vault without touching `data.json`**

Use an explicit temporary directory and explicit plugin destination:

```powershell
$releaseAssets = Join-Path ([System.IO.Path]::GetTempPath()) 'second-brain-v0.18.0-assets'
$pluginTarget = 'C:\Users\joaom\Documents\BASE\.obsidian\plugins\obsidian-second-brain'
if (Test-Path -LiteralPath $releaseAssets) { Remove-Item -LiteralPath $releaseAssets -Recurse -Force }
New-Item -ItemType Directory -Path $releaseAssets | Out-Null
gh release download v0.18.0 --dir $releaseAssets --pattern 'main.js' --pattern 'manifest.json' --pattern 'styles.css'
Copy-Item -LiteralPath (Join-Path $releaseAssets 'main.js') -Destination (Join-Path $pluginTarget 'main.js') -Force
Copy-Item -LiteralPath (Join-Path $releaseAssets 'manifest.json') -Destination (Join-Path $pluginTarget 'manifest.json') -Force
Copy-Item -LiteralPath (Join-Path $releaseAssets 'styles.css') -Destination (Join-Path $pluginTarget 'styles.css') -Force
```

Before removal, resolve `$releaseAssets` and verify it is under `[System.IO.Path]::GetTempPath()`. Compare SHA-256 hashes for all three downloaded and installed files, assert installed `manifest.json` is `0.18.0`, and confirm `$pluginTarget\data.json` still exists and was not copied or overwritten.

- [ ] **Step 10: Report the release and one manual verification path**

Report the commit, tag, release URL, successful test count, build result, assistant update, and local install. Ask the user to fully reload desktop Obsidian, open Settings → Second Brain → History, expand it once, and verify that the existing call backfills as exact while a new phone call first appears pending and later becomes exact after desktop refresh.
