# Usage History and Conversational Voice Design

Date: 2026-09-13

## Purpose

Add a private cost history to Second Brain and make Capture and Review calls ask warmer, more specific, Boardy-like questions. The history must distinguish exact provider charges from calculated estimates, work on phone and desktop, and never require a Vapi private key on the phone.

## Goals

- Show the cost of each Second Brain AI interaction in Settings → History.
- Group every voice interaction into the cost of the Vapi call plus the cost of the post-call draft synthesis.
- Use Vapi's exact per-call cost and component breakdown after desktop reconciliation.
- Use exact OpenAI token counts and a versioned price table to calculate a clearly labeled per-request estimate.
- Preserve only usage metadata, never prompts, transcripts, captures, reviews, or generated text.
- Improve both Capture and Review call prompts through active listening and contextual follow-up questions.
- Reduce avoidable Vapi input cost without changing the current voice or downgrading the conversational model.

## Non-goals

- Do not add a hosted backend in this version.
- Do not put the Vapi private key or an OpenAI Admin key in plugin settings, the vault, the bundle, logs, or mobile storage.
- Do not claim that a token-based OpenAI estimate is an exact invoiced charge.
- Do not copy Boardy's identity, voice, proprietary prompt, networking behavior, or branding.
- Do not store or expose call transcripts in History.
- Do not replace Vapi with a direct realtime stack in this version.

## User experience

Settings gains a collapsed **History** section above Troubleshooting and Logs.

At the top, History shows:

- cost recorded today;
- cost recorded over the last 7 days;
- cost recorded over the last 30 days;
- an accuracy legend: `Exact`, `Estimated`, and `Pending`.

Below the totals, up to 50 recent interactions are listed newest first. Each row shows:

- local date and time;
- action, such as Capture call, Review call, Review, Ask, or Project AI;
- provider and model;
- duration for voice interactions;
- combined cost;
- accuracy state.

A voice row expands to show Vapi transport, transcription, model, voice, and platform charges, followed by the separate draft-synthesis token estimate. A text AI row expands to show input, cached input, reasoning, and output tokens when the provider returns them.

The section includes **Refresh exact costs** and **Clear history** controls. Clearing requires a confirmation modal because the operation is destructive. Opening History on desktop also starts a quiet reconciliation attempt. Missing credentials or network failures appear as a small status message and never block the rest of Settings.

## Accuracy semantics

Every monetary value carries a source:

- `exact`: returned in USD by Vapi for a completed call;
- `estimated`: calculated from provider-reported tokens and a versioned pricing table;
- `pending`: the interaction is recorded but an exact Vapi result has not yet been reconciled;
- `unknown`: usage exists but the selected model has no price entry.

An interaction containing both exact and estimated components displays an approximation marker on its combined total. History must never silently add a pending or unknown amount as zero.

OpenAI Chat Completions responses provide exact token counts but not an authoritative per-request dollar charge. The organization Costs API is aggregated and requires an Admin key, so Admin-key reconciliation is intentionally excluded. The first version therefore reports OpenAI per-request costs as token-exact estimates and records the pricing-table version used for each calculation.

## Data model

History is stored with plugin data so it follows the same Obsidian configuration-sync behavior as the existing Second Brain settings.

```ts
interface UsageHistoryState {
  schemaVersion: 1;
  entries: UsageHistoryEntry[];
  lastVapiSyncAt?: string;
}

interface UsageHistoryEntry {
  id: string;
  interactionId: string;
  occurredAt: string;
  action: string;
  component: "vapi-call" | "llm-request";
  provider: "vapi" | "openai" | "anthropic";
  model?: string;
  status: "completed" | "failed" | "cancelled" | "pending";
  accuracy: "exact" | "estimated" | "pending" | "unknown";
  costUsd?: number;
  durationSeconds?: number;
  callId?: string;
  usage?: {
    inputTokens?: number;
    cachedInputTokens?: number;
    outputTokens?: number;
    reasoningTokens?: number;
  };
  vapiBreakdown?: {
    transport?: number;
    transcription?: number;
    model?: number;
    voice?: number;
    platform?: number;
  };
  pricingVersion?: string;
}
```

Entries are capped at 500. Insertion is deduplicated by entry ID and Vapi call ID. Persistence is serialized so simultaneous AI requests cannot overwrite each other's records. History-write failures go to the existing in-memory error log but never fail the user's AI request.

No content fields are permitted in this model. Tests enforce that provider responses are reduced to the allowed metadata before persistence.

## Interaction grouping

Each user action receives an `interactionId`.

- A normal Review or command usually creates one `llm-request` entry.
- Ask may create planner and answer entries under one interaction.
- A Capture or Review call creates a `vapi-call` entry and, after hang-up, a separate `llm-request` entry for draft synthesis under the same interaction.

Settings groups entries by `interactionId` and calculates the displayed total from available components. This prevents the Vapi-internal model charge from being confused with the plugin's separate post-call OpenAI request.

## OpenAI and Anthropic instrumentation

The shared `callLLM` path records usage after a successful provider response. Its optional call context gains an action label and interaction ID. Call sites provide specific labels; an unlabeled fallback remains available so no request is omitted.

For OpenAI, the recorder reads prompt, cached prompt, completion, and reasoning-token details returned by Chat Completions. Reasoning tokens remain part of output-token billing and are shown as a detail rather than added twice.

The existing model catalog becomes the single versioned source for standard, cached-input, and output rates. Unknown models retain their token counts with `accuracy: "unknown"`. Anthropic usage is captured through the same interface where its response supplies input and output tokens, although the requested first-class reconciliation remains OpenAI and Vapi.

## Vapi capture and reconciliation

The Web SDK exposes the new call ID during startup. VoiceCallModal records that ID, local start time, mode, and interaction ID immediately. On call end it records local duration and leaves the charge pending.

The Vapi public key cannot retrieve completed call costs. Exact reconciliation therefore runs only in desktop Obsidian and reads `VAPI_PRIVATE_KEY` from the inherited process environment. The value is used only as an Authorization header for Vapi's call endpoint and is never assigned to plugin settings or history.

Reconciliation performs two operations:

1. Fetch pending known call IDs and replace pending metadata with Vapi's exact `cost` and component breakdown.
2. On the first refresh, import completed calls for the configured assistant from the previous 30 days so the existing call is backfilled. Imported records contain cost metadata only.

The process is idempotent by call ID. It uses bounded concurrency and treats a not-yet-final call as pending. Authentication and network failures leave existing records untouched. On mobile, History explains that exact Vapi charges will appear after desktop reconciliation.

If desktop Obsidian was running before the environment variable was created, History explains that the desktop app must be fully restarted so it can inherit the variable.

## Conversational prompt changes

Both default voice prompts adopt an active-listening method while retaining their different purposes.

Shared behavior:

- Listen for the most specific or emotionally important phrase in the user's last answer and build the next question from it.
- Ask one direct question at a time.
- Follow a promising thread for two or three turns instead of moving through a checklist.
- When an answer is vague, ask for a concrete event, example, decision, or consequence.
- Every few turns, reflect the interpretation in one short sentence and let the user correct it.
- Prefer questions such as “What made that matter today?”, “What actually happened?”, “What changed?”, “What are you deciding?”, and “What would you want future you to remember?” when they fit naturally.
- Avoid generic praise, therapy language, canned “tell me more” prompts, advice that was not requested, and multiple questions in one response.
- Leave space for interruption and silence. Talkativeness 5 remains the default.

Capture calls draw out facts, decisions, feelings, useful detail, and open loops without forcing every category. Review calls use the generated factual summary as grounding, then explore what mattered, what changed, what was learned, and what remains unresolved without rereading the summary.

Existing custom prompts are preserved. Users on the built-in defaults receive the new behavior automatically, and **Reset to defaults** selects the new prompts.

The managed Vapi assistant's base prompt is updated through the existing provisioning script so its global behavior agrees with the editable mode prompts.

## Cost optimization

The current GPT-4.1 model and Elliot voice remain unchanged for the first iteration because question quality is the immediate priority and the first observed call's model charge was a small portion of its total cost.

Capture call context is capped at 12,000 characters, preserving the current draft and the most recent portion of today's log. An omission marker tells the model that older context was deliberately excluded. Review calls already receive the compact generated summary and need no additional truncation.

The assistant continues to have no tools and call recording remains disabled. Better, more focused questions should shorten calls without reducing conversational quality. History supplies the evidence needed before considering a cheaper model, voice, or a direct realtime stack.

## Error handling

- History recording cannot make Capture, Review, or any other AI action fail.
- Failed provider requests create a failure entry only when reliable request metadata exists; they never invent a dollar amount.
- A Vapi call that ends before final billing remains pending until reconciliation.
- Reconciliation preserves the last exact value if a later refresh fails.
- Invalid history records are skipped during rendering rather than breaking Settings.
- Clear history uses exact in-memory state replacement followed by one serialized save.

## Testing

Automated coverage will include:

- OpenAI and Anthropic usage extraction;
- cached-input and output-cost calculation without double-counting reasoning tokens;
- unknown-model behavior and pricing-version retention;
- history insertion, grouping, deduplication, retention cap, and serialized persistence;
- redaction tests proving prompts, transcripts, and generated text cannot enter persisted entries;
- Vapi pending-call capture, exact reconciliation, 30-day backfill, and retry behavior;
- mobile behavior when no private environment variable exists;
- Settings totals, accuracy labels, expansion, refresh, and clear confirmation;
- new Capture and Review default prompt behavior;
- managed-assistant configuration and mobile production bundling;
- the full existing test suite and production TypeScript build.

## Delivery

Implementation will increment the plugin version, update the README release log, commit and push to `origin/master`, create the matching version tag, verify the GitHub release workflow and assets, and install the exact release assets into the local vault without modifying `data.json` outside the plugin's normal migration and history-writing behavior.
