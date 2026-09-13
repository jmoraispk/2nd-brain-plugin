/**
 * In-plugin Vapi call for capture and review. The call is conversational;
 * after it ends, the plugin's configured LLM turns only the user's spoken
 * lines into an editable draft. Nothing is written to the vault here.
 */

import { App, Modal, Notice } from "obsidian";
import SecondBrainPlugin from "../main";
import { callLLM } from "./llm";
import { resolveRoute } from "./modelRoutes";
import { createInteractionId } from "./usageHistory";
import {
  buildVoiceSessionVariables,
  createVoiceCallCompletion,
  createVoiceDraftFinalizer,
  createVoiceStartCancellation,
  DEFAULT_CAPTURE_CALL_PROMPT,
  DEFAULT_REVIEW_CALL_PROMPT,
  DEFAULT_VOICE_TALKATIVENESS,
  getVoiceCapabilityProblem,
  prepareVoiceCallContext,
  VoiceContextSource,
  VoiceCallMode,
  VoiceTranscriptLine,
} from "./voiceCallSupport";

type Phase = "idle" | "connecting" | "live" | "processing" | "error";

// The SDK's emitted errors and transcript messages are not stable enough to
// type narrowly across Vapi releases.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyVapi = any;

export interface VoiceCallOptions {
  mode: VoiceCallMode;
  context: VoiceContextSource;
  existingDraft: string;
  targetDate: string;
  onDraft: (draft: string) => void | Promise<void>;
  onCancel?: () => void;
}

export class VoiceCallModal extends Modal {
  private readonly plugin: SecondBrainPlugin;
  private readonly interactionId = createInteractionId();
  private readonly options: VoiceCallOptions;
  private readonly finalizeDraft: (
    lines: VoiceTranscriptLine[]
  ) => Promise<boolean>;
  private readonly completion: ReturnType<typeof createVoiceCallCompletion>;
  private startCancellation?: ReturnType<typeof createVoiceStartCancellation>;

  private vapi: AnyVapi | null = null;
  private phase: Phase = "idle";
  private muted = false;
  private agentSpeaking = false;
  private lines: VoiceTranscriptLine[] = [];
  private errorMsg = "";
  private connectionStage = "";
  private discardOnClose = true;
  private closed = false;

  private statusEl!: HTMLElement;
  private transcriptEl!: HTMLElement;
  private muteBtn?: HTMLButtonElement;
  private endBtn?: HTMLButtonElement;

  constructor(app: App, plugin: SecondBrainPlugin, options: VoiceCallOptions) {
    super(app);
    this.plugin = plugin;
    this.options = options;
    this.completion = createVoiceCallCompletion(options.onCancel);
    this.modalEl.addClass("second-brain-capture-modal");
    this.modalEl.addClass("second-brain-voice-call-modal");
    this.finalizeDraft = createVoiceDraftFinalizer({
      mode: options.mode,
      existingDraft: options.existingDraft,
      synthesize: async (request) => {
        const route = resolveRoute(this.plugin.settings, "ask");
        return callLLM(
          this.plugin.settings,
          request.systemPrompt,
          request.userMessage,
          {
            model: route.model,
            effort: route.effort,
            usage: {
              action:
                options.mode === "capture" ? "Capture call" : "Review call",
              interactionId: this.interactionId,
            },
          }
        );
      },
      applyDraft: async (draft) => {
        if (this.closed || this.discardOnClose) return;
        await options.onDraft(draft);
      },
    });
  }

  onOpen() {
    this.closed = false;
    const { contentEl } = this;
    contentEl.empty();

    const label = this.options.mode === "capture" ? "Capture call" : "Review call";
    const header = contentEl.createDiv({ cls: "second-brain-capture-header" });
    header.createEl("h2", { text: label, cls: "second-brain-capture-title" });
    const close = header.createEl("button", {
      text: "✕",
      cls: "second-brain-capture-close",
      attr: { title: "Cancel call", "aria-label": "Cancel call" },
    });
    close.addEventListener("click", () => this.close());

    const key = this.plugin.settings.vapiPublicKey?.trim();
    const assistant = this.plugin.settings.vapiAssistantId?.trim();
    if (!key || !assistant) {
      contentEl.createEl("div", {
        cls: "second-brain-muted",
        text: "Set your Vapi public key and assistant ID in Settings → Voice (Vapi) first.",
      });
      return;
    }

    const capabilityProblem = getVoiceCapabilityProblem({
      mediaDevices: Boolean(navigator.mediaDevices),
      getUserMedia: typeof navigator.mediaDevices?.getUserMedia === "function",
      peerConnection: typeof globalThis.RTCPeerConnection === "function",
      webSocket: typeof globalThis.WebSocket === "function",
    });
    if (capabilityProblem) {
      this.showStartupProblem(capabilityProblem);
      return;
    }

    contentEl.createEl("div", {
      cls: "second-brain-muted",
      text:
        this.options.mode === "capture"
          ? "Talk it through. When the call ends, your words return to Capture as an editable draft."
          : "Talk through the summary. When the call ends, your words return to Your reflection as an editable draft.",
    });

    this.statusEl = contentEl.createDiv({ cls: "second-brain-voice-status" });
    this.transcriptEl = contentEl.createDiv({ cls: "second-brain-interview-transcript" });

    const actions = contentEl.createDiv({ cls: "second-brain-modal-actions" });
    this.muteBtn = actions.createEl("button", {
      text: "Mute",
      cls: "second-brain-modal-cancel",
    });
    this.muteBtn.addEventListener("click", () => this.toggleMute());
    this.endBtn = actions.createEl("button", {
      text: "End call",
      cls: "second-brain-modal-save",
    });
    this.endBtn.addEventListener("click", () => void this.endCall());

    this.renderStatus();
    void this.startCall(key, assistant);
  }

  private showStartupProblem(message: string) {
    this.phase = "error";
    this.errorMsg = message;
    if (this.statusEl) {
      this.renderStatus();
      return;
    }
    this.contentEl.createEl("div", {
      cls: "second-brain-voice-status",
      text: `Error: ${message}`,
    });
  }

  private renderStatus() {
    if (!this.statusEl) return;
    const status: Record<Phase, string> = {
      idle: "Ready",
      connecting: this.connectionStage
        ? `Connecting — ${this.connectionStage}…`
        : "Connecting…",
      live: this.agentSpeaking ? "Agent speaking…" : "Listening…",
      processing: "Creating your editable draft…",
      error: `Error: ${this.errorMsg}`,
    };
    this.statusEl.setText(status[this.phase]);
    this.statusEl.toggleClass("live", this.phase === "live");
  }

  private renderTranscript() {
    if (!this.transcriptEl) return;
    this.transcriptEl.empty();
    for (const line of this.lines) {
      this.transcriptEl.createDiv({
        cls:
          line.role === "assistant"
            ? "second-brain-interview-q"
            : "second-brain-interview-a",
        text: line.text,
      });
    }
    this.transcriptEl.scrollTop = this.transcriptEl.scrollHeight;
  }

  private async requestMicrophonePermission(): Promise<void> {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const track of stream.getTracks()) track.stop();
  }

  private async startCall(key: string, assistant: string) {
    this.phase = "connecting";
    this.renderStatus();
    try {
      // Microphone access starts before any vault reads so Obsidian Mobile
      // retains the user activation from the call-button tap.
      const context = await prepareVoiceCallContext(
        () => this.requestMicrophonePermission(),
        this.options.context
      );
      if (this.closed) return;

      const Vapi = (await import("@vapi-ai/web")).default;
      if (this.closed) return;
      const vapi: AnyVapi = new Vapi(key, undefined, {
        avoidEval: true,
        alwaysIncludeMicInPermissionPrompt: true,
      });
      this.vapi = vapi;
      this.startCancellation = createVoiceStartCancellation(
        () => vapi.stop(),
        (error) => this.plugin.errorLog.push("vapi:stop", error)
      );

      vapi.on("call-start-progress", (event: AnyVapi) => {
        if (this.closed) {
          void this.startCancellation?.onProgress();
          return;
        }
        if (this.phase !== "connecting") return;
        this.connectionStage = friendlyStage(event?.stage);
        this.renderStatus();
      });
      vapi.on("call-start-failed", (event: AnyVapi) => {
        if (this.closed) return;
        const detail =
          event?.error || `Call setup failed at ${event?.stage || "unknown stage"}`;
        this.handleError("vapi:start-failed", detail, event);
      });
      vapi.on("call-start", () => {
        if (this.closed) {
          void this.startCancellation?.onProgress();
          return;
        }
        this.phase = "live";
        this.connectionStage = "";
        this.renderStatus();
      });
      vapi.on("call-end", () => {
        if (this.closed || this.discardOnClose || this.phase === "processing") return;
        void this.finishDraft();
      });
      vapi.on("speech-start", () => {
        if (this.closed) return;
        this.agentSpeaking = true;
        this.renderStatus();
      });
      vapi.on("speech-end", () => {
        if (this.closed) return;
        this.agentSpeaking = false;
        this.renderStatus();
      });
      vapi.on("message", (message: AnyVapi) => {
        if (this.closed) return;
        if (
          message?.type !== "transcript" ||
          message.transcriptType !== "final" ||
          !message.transcript
        ) {
          return;
        }
        this.lines.push({
          role: message.role === "assistant" ? "assistant" : "user",
          text: String(message.transcript),
        });
        this.renderTranscript();
      });
      vapi.on("error", (error: AnyVapi) => {
        if (this.closed) return;
        this.handleError("vapi", voiceErrorMessage(error), error);
      });

      const settings = this.plugin.settings;
      const variables = buildVoiceSessionVariables({
        mode: this.options.mode,
        today: this.options.targetDate,
        context,
        currentDraft: this.options.existingDraft,
        talkativeness:
          settings.voiceTalkativeness ?? DEFAULT_VOICE_TALKATIVENESS,
        capturePrompt:
          settings.voiceCapturePrompt || DEFAULT_CAPTURE_CALL_PROMPT,
        reviewPrompt: settings.voiceReviewPrompt || DEFAULT_REVIEW_CALL_PROMPT,
      });
      this.discardOnClose = false;
      if (this.closed) return;
      await vapi.start(assistant, { variableValues: variables });
      // Closing while start() is creating the Daily call can make the first
      // stop a no-op. Stop again once startup settles so no headless call can
      // retain the microphone.
      if (this.closed) {
        await this.startCancellation?.onSettled();
      }
    } catch (error) {
      if (this.closed) {
        await this.startCancellation?.onSettled();
        return;
      }
      this.handleError("vapi:start", voiceErrorMessage(error), error);
      new Notice(
        `Couldn't start the call: ${voiceErrorMessage(error)}\nSee Settings → Logs.`,
        8000
      );
    }
  }

  private handleError(scope: string, message: string, error: unknown) {
    this.phase = "error";
    this.errorMsg = message;
    this.plugin.errorLog.push(scope, error);
    this.renderStatus();
  }

  private toggleMute() {
    if (!this.vapi || this.phase !== "live") return;
    this.muted = !this.muted;
    try {
      this.vapi.setMuted(this.muted);
    } catch {
      return;
    }
    this.muteBtn?.setText(this.muted ? "Unmute" : "Mute");
  }

  private async endCall() {
    if (this.phase === "processing") return;
    if (!this.vapi || (this.phase !== "live" && this.phase !== "connecting")) {
      this.close();
      return;
    }
    this.discardOnClose = false;
    this.phase = "processing";
    this.endBtn?.setAttribute("disabled", "true");
    this.renderStatus();
    try {
      await this.vapi.stop();
    } catch (error) {
      this.plugin.errorLog.push("vapi:stop", error);
    }
    await this.finishDraft();
  }

  private async finishDraft() {
    this.phase = "processing";
    this.endBtn?.setAttribute("disabled", "true");
    this.renderStatus();
    try {
      const applied = await this.finalizeDraft(this.lines);
      if (this.closed) return;
      if (!applied) {
        new Notice("Nothing was said — no draft created.");
      } else {
        this.completion.markApplied();
        new Notice("Voice draft ready — review it before saving.");
      }
      this.discardOnClose = true;
      this.close();
    } catch (error) {
      this.handleError("vapi:synth", voiceErrorMessage(error), error);
      this.endBtn?.removeAttribute("disabled");
      new Notice(
        `Couldn't create the draft: ${voiceErrorMessage(error)}\nSee Settings → Logs.`,
        8000
      );
    }
  }

  onClose() {
    this.closed = true;
    this.discardOnClose = true;
    this.startCancellation?.cancel();
    this.vapi = null;
    this.contentEl.empty();
    this.completion.cancel();
  }
}

function friendlyStage(stage: unknown): string {
  const labels: Record<string, string> = {
    "call-api-request": "starting call",
    "daily-call-object-creation": "preparing audio",
    "daily-call-join": "joining",
    "media-permission": "microphone permission",
  };
  const raw = typeof stage === "string" ? stage : "";
  return labels[raw] || raw.replace(/-/g, " ") || "starting";
}

function voiceErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const value = error as Record<string, unknown>;
    if (typeof value.message === "string") return value.message;
    if (typeof value.error === "string") return value.error;
  }
  return "Voice call failed";
}
