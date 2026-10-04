export type VoiceCallMode = "capture" | "review";

export interface VoiceTranscriptLine {
  role: "user" | "assistant";
  text: string;
  unfinished?: boolean;
}

export interface VoiceSessionInput {
  mode: VoiceCallMode;
  today: string;
  context: string;
  currentDraft: string;
  talkativeness: number;
  capturePrompt?: string;
  reviewPrompt?: string;
  userName?: string;
  targetDate?: string;
}

export interface VoiceCapabilities {
  mediaDevices: boolean;
  getUserMedia: boolean;
  peerConnection: boolean;
  webSocket: boolean;
}

export type VoiceContextSource = string | (() => Promise<string>);

export const DEFAULT_VOICE_TALKATIVENESS = 5;
export const MAX_CAPTURE_CONTEXT_CHARS = 12_000;

const CONTEXT_OMISSION = "[Older capture context omitted]\n";
const DRAFT_OMISSION = "[Older draft text omitted]\n";
const NO_ADDITIONAL_CONTEXT = "(no additional context)";

const ACTIVE_LISTENING_METHOD = `Build the next question from the most specific or emotionally important phrase in the user's last answer. Ask one direct question at a time. Follow a promising thread for two or three turns instead of moving through a checklist. When an answer is vague, ask for a concrete event, example, decision, or consequence. Every few turns, briefly reflect your interpretation and let the user correct it. Avoid generic praise, therapy language, canned "tell me more" prompts, unsolicited advice, and multi-part questions. Leave room for silence and interruption.`;

export const DEFAULT_CAPTURE_CALL_PROMPT = `Help the user develop and capture what is on their mind. ${ACTIVE_LISTENING_METHOD} Draw out facts, decisions, feelings, useful detail, and open loops when they naturally matter, without forcing every category. Prefer questions like "What actually happened?", "What made that matter today?", "What changed?", "What are you deciding?", and "What would you want future you to remember?" when they fit. Stay grounded in what the user says and never invent.`;

export const DEFAULT_REVIEW_CALL_PROMPT = `Help the user reflect on the factual review in the session context. ${ACTIVE_LISTENING_METHOD} Explore what mattered, what changed, what was learned, and what remains unresolved. Prefer questions like "What made that matter today?", "What changed?", and "What would you want future you to remember?" when they fit. Do not reread the summary, force its sections into a checklist, or invent conclusions.`;

export const VOICE_RELATIONSHIP_GUIDANCE = `Be warm, kind, and caring. Acknowledge a specific difficulty or meaningful effort before asking the next question. Show patient curiosity and use gentle wording; avoid sounding like an interrogation. Use the user's name naturally in the greeting and occasionally later, never every turn. If no name is provided, do not guess. Use dated memory to follow up on an existing thread when relevant, checking whether older plans still hold. Distinguish the user's facts from the agent's questions and suggestions. Avoid exaggerated praise and invented familiarity.`;

export function normalizeVoiceUserName(value?: string): string {
  const name = (value ?? "").replace(/[\r\n<>*_[\]{}]/g, "").trim().slice(0, 80);
  return /^(agent|assistant)$/i.test(name) ? "" : name;
}

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

export function boundCaptureVoiceContext(
  input: VoiceSessionInput
): { currentDraft: string; context: string } {
  const rawDraft = input.currentDraft.trim();
  const draft = rawDraft.length <= 4_000 ? rawDraft
    : DRAFT_OMISSION + rawDraft.slice(-(4_000 - DRAFT_OMISSION.length));
  const context = input.context.trim();
  if (input.mode === "review") {
    // The review is first in the context, so retain its beginning even when
    // the review or current reflection is unusually long.
    const currentDraft = draft;
    const budget = MAX_CAPTURE_CONTEXT_CHARS - currentDraft.length;
    const marker = "\n[Additional review context omitted]";
    return {
      currentDraft,
      context: context.length <= budget ? context : context.slice(0, budget - marker.length) + marker,
    };
  }

  const budget = MAX_CAPTURE_CONTEXT_CHARS - draft.length;
  if (!context) return { currentDraft: draft, context: NO_ADDITIONAL_CONTEXT };
  if (context.length <= budget) return { currentDraft: draft, context };
  if (budget <= CONTEXT_OMISSION.length) {
    return { currentDraft: draft, context: NO_ADDITIONAL_CONTEXT };
  }
  const keep = budget - CONTEXT_OMISSION.length;
  return {
    currentDraft: draft,
    context: CONTEXT_OMISSION + context.slice(-keep),
  };
}

export function buildVoiceSessionVariables(
  input: VoiceSessionInput
): Record<string, string> {
  const talkativeness = normalizeTalkativeness(input.talkativeness);
  const userName = normalizeVoiceUserName(input.userName);
  const bounded = boundCaptureVoiceContext(input);
  const sessionInstructions =
    (input.mode === "capture" ? input.capturePrompt : input.reviewPrompt)?.trim() ||
    (input.mode === "capture"
      ? DEFAULT_CAPTURE_CALL_PROMPT
      : DEFAULT_REVIEW_CALL_PROMPT);

  return {
    mode: input.mode,
    today: input.today,
    targetDate: input.targetDate ?? input.today,
    userName: userName || "(name not provided)",
    sessionInstructions: `${sessionInstructions}\n\n${VOICE_RELATIONSHIP_GUIDANCE}`,
    sessionContext: bounded.context || "(no context yet)",
    currentDraft: bounded.currentDraft || "(empty)",
    talkativeness: String(talkativeness),
    talkativenessGuidance: buildTalkativenessGuidance(talkativeness),
    firstMessage:
      input.mode === "capture"
        ? `${userName ? `Hi ${userName}. ` : "Hi. "}What's on your mind today? What would you like to capture?`
        : `${userName ? `Hi ${userName}. ` : "Hi. "}What stands out to you from this review?`,
  };
}

export function buildVoiceTranscriptDraft(
  lines: VoiceTranscriptLine[],
  existingDraft: string,
  userName: string,
  date: string
): string | null {
  if (!lines.some(line => line.role === "user" && line.text.trim())) return null;
  const name = normalizeVoiceUserName(userName) || "User";
  const conversation = lines
    .filter(line => (line.role === "user" || line.role === "assistant") && line.text.trim())
    .map(line => `**${line.role === "user" ? name : "Agent"} said:**\n${line.text.split(/\r?\n/).map(text => `> ${text}`).join("\n")}${line.unfinished ? "\n\n_This turn was still being transcribed when the call ended._" : ""}`)
    .join("\n\n");
  const transcript = `<!-- second-brain-call:start -->\n## Call transcript — ${date}\n\n_This is a call between me and my AI agent._\n\n${conversation}\n<!-- second-brain-call:end -->`;
  return existingDraft ? `${existingDraft}\n\n${transcript}` : transcript;
}

interface VoiceDraftFinalizerOptions {
  existingDraft: string;
  userName: string;
  date: string;
  applyDraft: (draft: string) => void | Promise<void>;
}

export function createVoiceDraftFinalizer(
  options: VoiceDraftFinalizerOptions
): (lines: VoiceTranscriptLine[]) => Promise<boolean> {
  let result: Promise<boolean> | undefined;
  return (lines) => {
    if (result) return result;
    result = (async () => {
      const draft = buildVoiceTranscriptDraft(
        lines,
        options.existingDraft,
        options.userName,
        options.date
      );
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
