import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadVoiceSupport() {
  const result = await build({
    entryPoints: [path.join(repoRoot, "src", "voiceCallSupport.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
  });
  const source = Buffer.from(result.outputFiles[0].contents).toString("base64");
  return import(`data:text/javascript;base64,${source}`);
}

test("capture sessions use the editable prompt and clamp talkativeness", async () => {
  const { buildVoiceSessionVariables } = await loadVoiceSupport();

  const variables = buildVoiceSessionVariables({
    mode: "capture",
    today: "2026-09-13",
    context: "Morning notes",
    currentDraft: "An opening thought",
    talkativeness: 99,
    capturePrompt: "Ask about concrete decisions.",
    reviewPrompt: "Unused review prompt.",
    userName: "João",
  });

  assert.equal(variables.mode, "capture");
  assert.match(variables.sessionInstructions, /Ask about concrete decisions/);
  assert.match(variables.sessionInstructions, /warm|caring/i);
  assert.equal(variables.userName, "João");
  assert.match(variables.firstMessage, /João/);
  assert.equal(variables.sessionContext, "Morning notes");
  assert.equal(variables.currentDraft, "An opening thought");
  assert.equal(variables.talkativeness, "10");
  assert.match(variables.talkativenessGuidance, /active/i);
  assert.match(variables.firstMessage, /capture/i);
});

test("review sessions use the review prompt and a balanced default", async () => {
  const {
    DEFAULT_VOICE_TALKATIVENESS,
    buildVoiceSessionVariables,
  } = await loadVoiceSupport();

  const variables = buildVoiceSessionVariables({
    mode: "review",
    today: "2026-09-13",
    context: "## Key progress\n- Shipped the release",
    currentDraft: "",
    talkativeness: Number.NaN,
    capturePrompt: "Unused capture prompt.",
    reviewPrompt: "Ask what I learned.",
  });

  assert.equal(DEFAULT_VOICE_TALKATIVENESS, 5);
  assert.equal(variables.mode, "review");
  assert.match(variables.sessionInstructions, /Ask what I learned/);
  assert.equal(variables.talkativeness, "5");
  assert.match(variables.talkativenessGuidance, /balanced/i);
  assert.match(variables.firstMessage, /review/i);
});

test("default voice prompts follow specific threads instead of a checklist", async () => {
  const {
    DEFAULT_CAPTURE_CALL_PROMPT,
    DEFAULT_REVIEW_CALL_PROMPT,
  } = await loadVoiceSupport();

  for (const prompt of [DEFAULT_CAPTURE_CALL_PROMPT, DEFAULT_REVIEW_CALL_PROMPT]) {
    assert.match(prompt, /specific or emotionally important phrase/i);
    assert.match(prompt, /one direct question at a time/i);
    assert.match(prompt, /two or three turns/i);
    assert.match(prompt, /concrete event, example, decision, or consequence/i);
    assert.match(prompt, /briefly reflect your interpretation/i);
    assert.match(prompt, /generic praise/i);
    assert.match(prompt, /therapy language/i);
    assert.match(prompt, /unsolicited advice/i);
  }
});

test("capture context keeps the draft and newest log text within 12,000 characters", async () => {
  const { buildVoiceSessionVariables, MAX_CAPTURE_CONTEXT_CHARS } =
    await loadVoiceSupport();
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
  assert.ok(
    variables.sessionContext.startsWith("[Older capture context omitted]")
  );
  assert.ok(variables.sessionContext.endsWith("R".repeat(8_000)));
  assert.ok(
    variables.currentDraft.length + variables.sessionContext.length <= 12_000
  );
});

test("review calls bound oversized drafts while preserving the current review", async () => {
  const { buildVoiceSessionVariables } = await loadVoiceSupport();
  const context = "review context ".repeat(1_000);
  const draft = "reflection draft ".repeat(200);

  const variables = buildVoiceSessionVariables({
    mode: "review",
    today: "2026-09-13",
    context,
    currentDraft: draft,
    talkativeness: 5,
  });

  assert.ok(variables.sessionContext.startsWith("review context"));
  assert.ok(variables.sessionContext.length + variables.currentDraft.length <= 12_000);
});

test("an oversized capture draft retains recent draft text and saved memory", async () => {
  const { buildVoiceSessionVariables, MAX_CAPTURE_CONTEXT_CHARS } =
    await loadVoiceSupport();
  const draft = "old".repeat(5_000) + "NEWEST-DRAFT-TEXT";

  const variables = buildVoiceSessionVariables({
    mode: "capture",
    today: "2026-09-13",
    context: "Dated voice memory about the launch",
    currentDraft: draft,
    talkativeness: 5,
  });

  assert.ok(variables.currentDraft.startsWith("[Older draft text omitted]"));
  assert.ok(variables.currentDraft.endsWith("NEWEST-DRAFT-TEXT"));
  assert.equal(variables.sessionContext, "Dated voice memory about the launch");
  assert.ok(
    variables.currentDraft.length + variables.sessionContext.length <=
      MAX_CAPTURE_CONTEXT_CHARS
  );
});

test("an empty name uses a generic greeting and repeated transcript blocks preserve every turn", async () => {
  const { buildVoiceSessionVariables, buildVoiceTranscriptDraft } = await loadVoiceSupport();
  const variables = buildVoiceSessionVariables({mode:"capture",today:"2026-10-04",context:"",currentDraft:"",talkativeness:5,userName:""});
  assert.equal(variables.userName, "(name not provided)");
  assert.doesNotMatch(variables.firstMessage, /João|undefined/);
  const lines = [{role:"assistant",text:"What happened?"},{role:"user",text:"Well, um, I shipped it!\nThen I went home."}];
  const first = buildVoiceTranscriptDraft(lines, "Typed opening", "", "2026-10-04");
  const second = buildVoiceTranscriptDraft([{role:"user",text:"I also tested it."}], first, "", "2026-10-04");
  assert.match(second, /\*\*User said:\*\*\n> Well, um, I shipped it!\n> Then I went home\./);
  assert.equal(second.match(/## Call transcript/g).length,2);
});

test("transcripts retain both speakers, exact words and existing draft", async () => {
  const { buildVoiceTranscriptDraft } = await loadVoiceSupport();

  const draft = buildVoiceTranscriptDraft(
    [
      { role: "assistant", text: "You doubled your exercise this week." },
      { role: "user", text: "I learned that afternoon walks clear my head." },
      { role: "assistant", text: "You should schedule one every day." },
      { role: "user", text: "I also want to remember Friday's launch." },
    ],
    "Sleep felt more consistent.", "João", "2026-10-04"
  );

  assert.ok(draft.startsWith("Sleep felt more consistent."));
  assert.match(draft, /Call transcript — 2026-10-04/);
  assert.match(draft, /call between me and my AI agent/);
  assert.match(draft, /\*\*João said:\*\*\n> I learned that afternoon walks clear my head\./);
  assert.ok(draft.indexOf("doubled your exercise") < draft.indexOf("afternoon walks"));
  assert.ok(draft.indexOf("afternoon walks") < draft.indexOf("schedule one every day"));
  assert.match(draft, /Friday's launch/);
});

test("an agent-only call leaves the existing draft untouched", async () => {
  const { buildVoiceTranscriptDraft } = await loadVoiceSupport();

  assert.equal(
    buildVoiceTranscriptDraft(
      [{ role: "assistant", text: "What is on your mind?" }],
      "Unsaved text", "", "2026-10-04"
    ),
    null
  );
});

test("ending twice applies one editable draft and performs no implicit save", async () => {
  const { createVoiceDraftFinalizer } = await loadVoiceSupport();
  const appliedDrafts = [];
  const finalizer = createVoiceDraftFinalizer({
    existingDraft: "",
    userName: "João",
    date: "2026-10-04",
    applyDraft: async (draft) => {
      appliedDrafts.push(draft);
    },
  });
  const lines = [{ role: "user", text: "The launch went well" }];

  const [first, second] = await Promise.all([finalizer(lines), finalizer(lines)]);

  assert.equal(first, true);
  assert.equal(second, true);
  assert.equal(appliedDrafts.length, 1);
  assert.match(appliedDrafts[0], /\*\*João said:\*\*\n> The launch went well/);
});

test("voice capability checks report the first missing browser primitive", async () => {
  const { getVoiceCapabilityProblem } = await loadVoiceSupport();
  const ready = {
    mediaDevices: true,
    getUserMedia: true,
    peerConnection: true,
    webSocket: true,
  };

  assert.equal(getVoiceCapabilityProblem(ready), null);
  assert.match(
    getVoiceCapabilityProblem({ ...ready, getUserMedia: false }),
    /microphone/i
  );
  assert.match(
    getVoiceCapabilityProblem({ ...ready, peerConnection: false }),
    /WebRTC/i
  );
});

test("microphone permission begins before asynchronous context loading", async () => {
  const { prepareVoiceCallContext } = await loadVoiceSupport();
  const events = [];

  const prepared = await prepareVoiceCallContext(
    async () => {
      events.push("permission-start");
      await Promise.resolve();
      events.push("permission-finished");
    },
    async () => {
      events.push("context-start");
      return "today's captures";
    }
  );

  assert.equal(prepared, "today's captures");
  assert.deepEqual(events, [
    "permission-start",
    "permission-finished",
    "context-start",
  ]);
});

test("cancelling restores once, while an applied draft suppresses restore", async () => {
  const { createVoiceCallCompletion } = await loadVoiceSupport();
  let restores = 0;
  const cancelled = createVoiceCallCompletion(() => {
    restores += 1;
  });

  assert.equal(cancelled.cancel(), true);
  assert.equal(cancelled.cancel(), false);
  assert.equal(restores, 1);

  const completed = createVoiceCallCompletion(() => {
    restores += 1;
  });
  completed.markApplied();
  assert.equal(completed.cancel(), false);
  assert.equal(restores, 1);
});

test("cancelled startup retries teardown on progress and after settlement", async () => {
  const { createVoiceStartCancellation } = await loadVoiceSupport();
  let stops = 0;
  const failures = [];
  const cancellation = createVoiceStartCancellation(
    async () => {
      stops += 1;
      if (stops === 1) throw new Error("call object not ready");
    },
    (error) => failures.push(error.message)
  );

  cancellation.cancel();
  await Promise.resolve();
  await cancellation.onProgress();
  await cancellation.onSettled();

  assert.equal(cancellation.isCancelled(), true);
  assert.equal(stops, 3);
  assert.deepEqual(failures, ["call object not ready"]);
});

test("the voice modal tracks either Vapi call ID and shares its interaction", async () => {
  const source = await readFile(
    path.join(repoRoot, "src", "voiceInterviewModal.ts"),
    "utf8"
  );

  assert.match(source, /vapi\.on\("call-start-success"/);
  assert.match(source, /trackStartedCall\(event\?\.callId\)/);
  assert.match(source, /trackStartedCall\(startedCall\?\.id\)/);
  assert.match(source, /createPendingVapiEntry/);
  assert.match(source, /finishTrackedCall\("completed"\)/);
  assert.match(source, /finishTrackedCall\("cancelled"\)/);
  assert.match(source, /interactionId: this\.interactionId/);
});
