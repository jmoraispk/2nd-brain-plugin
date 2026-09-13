import assert from "node:assert/strict";
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
  });

  assert.equal(variables.mode, "capture");
  assert.equal(variables.sessionInstructions, "Ask about concrete decisions.");
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
  assert.equal(variables.sessionInstructions, "Ask what I learned.");
  assert.equal(variables.talkativeness, "5");
  assert.match(variables.talkativenessGuidance, /balanced/i);
  assert.match(variables.firstMessage, /review/i);
});

test("draft synthesis includes user speech but excludes the agent", async () => {
  const { buildVoiceDraftRequest } = await loadVoiceSupport();

  const request = buildVoiceDraftRequest(
    "review",
    [
      { role: "assistant", text: "You doubled your exercise this week." },
      { role: "user", text: "I learned that afternoon walks clear my head." },
      { role: "assistant", text: "You should schedule one every day." },
      { role: "user", text: "I also want to remember Friday's launch." },
    ],
    "Sleep felt more consistent."
  );

  assert.ok(request);
  assert.match(request.systemPrompt, /reflection draft/i);
  assert.match(request.userMessage, /afternoon walks clear my head/i);
  assert.match(request.userMessage, /Friday's launch/i);
  assert.match(request.userMessage, /Sleep felt more consistent/i);
  assert.doesNotMatch(request.userMessage, /doubled your exercise/i);
  assert.doesNotMatch(request.userMessage, /schedule one every day/i);
});

test("draft synthesis returns nothing when the user said nothing", async () => {
  const { buildVoiceDraftRequest } = await loadVoiceSupport();

  assert.equal(
    buildVoiceDraftRequest(
      "capture",
      [{ role: "assistant", text: "What is on your mind?" }],
      ""
    ),
    null
  );
});

test("ending twice applies one editable draft and performs no implicit save", async () => {
  const { createVoiceDraftFinalizer } = await loadVoiceSupport();
  let synthesisCalls = 0;
  const appliedDrafts = [];
  const finalizer = createVoiceDraftFinalizer({
    mode: "capture",
    existingDraft: "",
    synthesize: async (request) => {
      synthesisCalls += 1;
      assert.match(request.userMessage, /The launch went well/);
      return "The launch went well.";
    },
    applyDraft: async (draft) => {
      appliedDrafts.push(draft);
    },
  });
  const lines = [{ role: "user", text: "The launch went well" }];

  const [first, second] = await Promise.all([finalizer(lines), finalizer(lines)]);

  assert.equal(first, true);
  assert.equal(second, true);
  assert.equal(synthesisCalls, 1);
  assert.deepEqual(appliedDrafts, ["The launch went well."]);
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
