export type VoiceCallMode = "capture" | "review";

export interface VoiceTranscriptLine {
  role: "user" | "assistant";
  text: string;
}

export interface VoiceSessionInput {
  mode: VoiceCallMode;
  today: string;
  context: string;
  currentDraft: string;
  talkativeness: number;
  capturePrompt?: string;
  reviewPrompt?: string;
}

export interface VoiceCapabilities {
  mediaDevices: boolean;
  getUserMedia: boolean;
  peerConnection: boolean;
  webSocket: boolean;
}

export type VoiceContextSource = string | (() => Promise<string>);

export const DEFAULT_VOICE_TALKATIVENESS = 5;

export const DEFAULT_CAPTURE_CALL_PROMPT = `Help the user develop and capture what is on their mind. Ask one focused follow-up at a time to draw out concrete events, decisions, facts, feelings, and next steps when relevant. Avoid inventing, advising, or steering. Keep the conversation natural and grounded in what the user actually says.`;

export const DEFAULT_REVIEW_CALL_PROMPT = `Help the user reflect on the factual review in the session context. Ask one focused follow-up at a time about key progress, main lessons, unique events, and important health facts. Focus on what the user noticed and wants to remember. Do not repeat the summary at length or invent conclusions.`;

const CAPTURE_DRAFT_SYSTEM = `Turn only the user's spoken statements into an editable first-person capture draft. Preserve concrete facts, names, decisions, emotions, and useful detail. You may merge in the existing user-written draft, but never add claims made only by the voice agent. Use short paragraphs or bullets when natural. No heading, preamble, advice, or commentary. Output only the draft.`;

const REVIEW_DRAFT_SYSTEM = `Turn only the user's spoken statements into an editable first-person reflection draft. Preserve their conclusions, lessons, reactions, uncertainties, and details in their voice. You may merge in the existing user-written reflection, but never add claims made only by the voice agent. Do not merely repeat the AI review. Use short paragraphs or bullets when natural. No heading, preamble, advice, or commentary. Output only the reflection draft.`;

export function normalizeTalkativeness(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_VOICE_TALKATIVENESS;
  return Math.min(10, Math.max(1, Math.round(value)));
}

export function buildTalkativenessGuidance(value: number): string {
  const level = normalizeTalkativeness(value);
  if (level <= 3) {
    return `Talkativeness ${level}/10: be quiet and concise. Usually respond with one short acknowledgment or one short follow-up question.`;
  }
  if (level <= 7) {
    return `Talkativeness ${level}/10: keep a balanced conversation. Briefly reflect what matters, then ask one focused follow-up question.`;
  }
  return `Talkativeness ${level}/10: be active and engaged. Offer fuller reflections and proactive follow-up questions, while still leaving room for the user to think.`;
}

export function buildVoiceSessionVariables(
  input: VoiceSessionInput
): Record<string, string> {
  const talkativeness = normalizeTalkativeness(input.talkativeness);
  const sessionInstructions =
    (input.mode === "capture" ? input.capturePrompt : input.reviewPrompt)?.trim() ||
    (input.mode === "capture"
      ? DEFAULT_CAPTURE_CALL_PROMPT
      : DEFAULT_REVIEW_CALL_PROMPT);

  return {
    mode: input.mode,
    today: input.today,
    sessionInstructions,
    sessionContext: input.context.trim() || "(no context yet)",
    currentDraft: input.currentDraft.trim() || "(empty)",
    talkativeness: String(talkativeness),
    talkativenessGuidance: buildTalkativenessGuidance(talkativeness),
    firstMessage:
      input.mode === "capture"
        ? "What would you like to capture?"
        : "What stands out to you from this review?",
  };
}

export function buildVoiceDraftRequest(
  mode: VoiceCallMode,
  lines: VoiceTranscriptLine[],
  existingDraft: string
): { systemPrompt: string; userMessage: string } | null {
  const spoken = lines
    .filter((line) => line.role === "user")
    .map((line) => line.text.trim())
    .filter(Boolean);
  if (spoken.length === 0) return null;

  return {
    systemPrompt:
      mode === "capture" ? CAPTURE_DRAFT_SYSTEM : REVIEW_DRAFT_SYSTEM,
    userMessage: [
      "## Existing user-written draft",
      existingDraft.trim() || "(empty)",
      "",
      "## User's spoken statements",
      ...spoken.map((text) => `- ${text}`),
    ].join("\n"),
  };
}

interface VoiceDraftFinalizerOptions {
  mode: VoiceCallMode;
  existingDraft: string;
  synthesize: (request: {
    systemPrompt: string;
    userMessage: string;
  }) => Promise<string>;
  applyDraft: (draft: string) => void | Promise<void>;
}

export function createVoiceDraftFinalizer(
  options: VoiceDraftFinalizerOptions
): (lines: VoiceTranscriptLine[]) => Promise<boolean> {
  let result: Promise<boolean> | undefined;
  return (lines) => {
    if (result) return result;
    result = (async () => {
      const request = buildVoiceDraftRequest(
        options.mode,
        lines,
        options.existingDraft
      );
      if (!request) return false;
      const draft = (await options.synthesize(request)).trim();
      if (!draft) return false;
      await options.applyDraft(draft);
      return true;
    })();
    return result;
  };
}

/**
 * Keep microphone access as the first asynchronous action after a call button
 * tap. Obsidian Mobile's webview may otherwise lose the user activation while
 * the vault context is being loaded.
 */
export async function prepareVoiceCallContext(
  requestMicrophonePermission: () => Promise<void>,
  context: VoiceContextSource
): Promise<string> {
  await requestMicrophonePermission();
  return typeof context === "function" ? context() : context;
}

export function createVoiceCallCompletion(onCancel?: () => void): {
  markApplied: () => void;
  cancel: () => boolean;
} {
  let settled = false;
  return {
    markApplied: () => {
      settled = true;
    },
    cancel: () => {
      if (settled) return false;
      settled = true;
      onCancel?.();
      return true;
    },
  };
}

export function createVoiceStartCancellation(
  stop: () => void | Promise<void>,
  onStopError: (error: unknown) => void
): {
  cancel: () => void;
  onProgress: () => Promise<void>;
  onSettled: () => Promise<void>;
  isCancelled: () => boolean;
} {
  let cancelled = false;
  const requestStop = async () => {
    if (!cancelled) return;
    try {
      await stop();
    } catch (error) {
      onStopError(error);
    }
  };

  return {
    cancel: () => {
      cancelled = true;
      void requestStop();
    },
    onProgress: requestStop,
    onSettled: requestStop,
    isCancelled: () => cancelled,
  };
}

export function getVoiceCapabilityProblem(
  capabilities: VoiceCapabilities
): string | null {
  if (!capabilities.mediaDevices || !capabilities.getUserMedia) {
    return "Microphone access is unavailable in this Obsidian environment.";
  }
  if (!capabilities.peerConnection) {
    return "WebRTC is unavailable in this Obsidian environment.";
  }
  if (!capabilities.webSocket) {
    return "WebSocket support is unavailable in this Obsidian environment.";
  }
  return null;
}
