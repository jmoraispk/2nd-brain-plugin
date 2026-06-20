/**
 * Voice interview (v0.15, Path 2) — a real spoken conversation with the
 * agent via Vapi's web SDK (WebRTC + mic). The plugin starts a call to your
 * configured assistant, injects today's log as a Vapi variable, streams the
 * live transcript, and on hang-up synthesizes an enriched capture into the
 * day's log. No server, no Twilio — mic is local, transcript arrives via SDK
 * events. Desktop (Electron) first; mobile webview mic may not be available.
 */

import { App, Modal, Notice, TFile } from "obsidian";
import Vapi from "@vapi-ai/web";
import SecondBrainPlugin from "../main";
import { callLLM } from "./llm";
import { resolveRoute } from "./modelRoutes";
import { appendCapture } from "./capture";
import { resolveDailyLogPath, todayISO } from "./paths";

const SYNTH_SYSTEM = `From this voice interview about the user's day, write a concise first-person journal capture in THEIR voice — 2–5 sentences or tight bullets covering what they shared. Faithful, no fluff, no advice. Output only the capture text.`;

type Phase = "idle" | "connecting" | "live" | "ended" | "saving" | "error";

interface Line {
  role: "user" | "assistant";
  text: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyVapi = any;

export class VoiceInterviewModal extends Modal {
  private readonly plugin: SecondBrainPlugin;
  private readonly targetDate?: string;
  private readonly onSaved?: () => void;

  private vapi: AnyVapi | null = null;
  private phase: Phase = "idle";
  private muted = false;
  private agentSpeaking = false;
  private lines: Line[] = [];
  private errorMsg = "";

  // Body sub-elements we update without a full re-render.
  private statusEl!: HTMLElement;
  private transcriptEl!: HTMLElement;
  private muteBtn?: HTMLButtonElement;

  constructor(app: App, plugin: SecondBrainPlugin, targetDate?: string, onSaved?: () => void) {
    super(app);
    this.plugin = plugin;
    this.targetDate = targetDate;
    this.onSaved = onSaved;
    this.modalEl.addClass("second-brain-capture-modal");
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    const header = contentEl.createDiv({ cls: "second-brain-capture-header" });
    header.createEl("h2", { text: "📞 Voice interview", cls: "second-brain-capture-title" });
    const close = header.createEl("button", {
      text: "✕",
      cls: "second-brain-capture-close",
      attr: { title: "Close" },
    });
    close.addEventListener("click", () => this.close());

    const key = this.plugin.settings.vapiPublicKey?.trim();
    const assistant = this.plugin.settings.vapiAssistantId?.trim();
    if (!key || !assistant) {
      contentEl.createEl("div", {
        cls: "second-brain-muted",
        text: "Set your Vapi public key + assistant id in Settings → Voice (Vapi) first.",
      });
      return;
    }

    contentEl.createEl("div", {
      cls: "second-brain-muted",
      text: "Talk naturally — the agent asks about your day. Hang up when done and it writes an enriched capture.",
    });

    this.statusEl = contentEl.createDiv({ cls: "second-brain-voice-status" });
    this.transcriptEl = contentEl.createDiv({ cls: "second-brain-interview-transcript" });

    const actions = contentEl.createDiv({ cls: "second-brain-modal-actions" });
    this.muteBtn = actions.createEl("button", { text: "Mute", cls: "second-brain-modal-cancel" });
    this.muteBtn.addEventListener("click", () => this.toggleMute());
    const end = actions.createEl("button", { text: "End & save", cls: "second-brain-modal-save" });
    end.addEventListener("click", () => this.endCall());

    this.renderStatus();
    void this.startCall(key, assistant);
  }

  private renderStatus() {
    if (!this.statusEl) return;
    const map: Record<Phase, string> = {
      idle: "…",
      connecting: "Connecting…",
      live: this.agentSpeaking ? "🗣️ Agent speaking…" : "🎧 Listening…",
      ended: "Call ended.",
      saving: "Writing your capture…",
      error: `Error: ${this.errorMsg}`,
    };
    this.statusEl.setText(map[this.phase]);
    this.statusEl.toggleClass("live", this.phase === "live");
  }

  private renderTranscript() {
    if (!this.transcriptEl) return;
    this.transcriptEl.empty();
    for (const l of this.lines) {
      this.transcriptEl.createDiv({
        cls: l.role === "assistant" ? "second-brain-interview-q" : "second-brain-interview-a",
        text: l.text,
      });
    }
    this.transcriptEl.scrollTop = this.transcriptEl.scrollHeight;
  }

  private async dayContext(): Promise<string> {
    const date = this.targetDate ?? todayISO();
    const path = await resolveDailyLogPath(this.plugin.app, this.plugin.settings, date);
    const f = this.plugin.app.vault.getAbstractFileByPath(path);
    const log = f instanceof TFile ? await this.plugin.app.vault.read(f) : "";
    return log.trim() || "(no captures yet today)";
  }

  private async startCall(key: string, assistant: string) {
    this.phase = "connecting";
    this.renderStatus();
    try {
      const dayLog = await this.dayContext();
      const vapi: AnyVapi = new Vapi(key);
      this.vapi = vapi;

      vapi.on("call-start", () => {
        this.phase = "live";
        this.renderStatus();
      });
      vapi.on("call-end", () => {
        if (this.phase !== "saving") {
          this.phase = "ended";
          this.renderStatus();
          void this.synthesizeAndSave();
        }
      });
      vapi.on("speech-start", () => {
        this.agentSpeaking = true;
        this.renderStatus();
      });
      vapi.on("speech-end", () => {
        this.agentSpeaking = false;
        this.renderStatus();
      });
      vapi.on("message", (m: AnyVapi) => {
        if (m?.type === "transcript" && m.transcriptType === "final" && m.transcript) {
          const role = m.role === "assistant" ? "assistant" : "user";
          this.lines.push({ role, text: String(m.transcript) });
          this.renderTranscript();
        }
      });
      vapi.on("error", (e: AnyVapi) => {
        this.phase = "error";
        this.errorMsg = (e?.message || e?.error || "voice error").toString();
        this.plugin.errorLog.push("vapi", e);
        this.renderStatus();
      });

      // Inject the day's context as a Vapi variable ({{dayLog}} in the
      // assistant prompt) + a date variable.
      await vapi.start(assistant, {
        variableValues: { dayLog, today: this.targetDate ?? todayISO() },
      });
    } catch (err) {
      this.phase = "error";
      this.errorMsg = (err as Error).message;
      this.plugin.errorLog.push("vapi:start", err);
      this.renderStatus();
      new Notice(
        `Couldn't start the call: ${(err as Error).message}\nSee Settings → Logs.`,
        8000
      );
    }
  }

  private toggleMute() {
    if (!this.vapi || this.phase !== "live") return;
    this.muted = !this.muted;
    try {
      this.vapi.setMuted(this.muted);
    } catch {
      /* ignore */
    }
    if (this.muteBtn) this.muteBtn.setText(this.muted ? "Unmute" : "Mute");
  }

  private endCall() {
    if (this.vapi && (this.phase === "live" || this.phase === "connecting")) {
      this.phase = "saving";
      this.renderStatus();
      try {
        this.vapi.stop();
      } catch {
        /* ignore */
      }
      void this.synthesizeAndSave();
    } else if (this.phase === "ended") {
      void this.synthesizeAndSave();
    } else {
      this.close();
    }
  }

  private async synthesizeAndSave() {
    if (this.phase === "saving" && this.lines.length === 0) {
      // nothing said
      new Notice("Nothing was said — no capture written.");
      this.close();
      return;
    }
    this.phase = "saving";
    this.renderStatus();
    try {
      const transcript = this.lines
        .map((l) => `${l.role === "assistant" ? "Agent" : "Me"}: ${l.text}`)
        .join("\n");
      const r = resolveRoute(this.plugin.settings, "ask");
      const entry = (
        await callLLM(this.plugin.settings, SYNTH_SYSTEM, `## Transcript\n${transcript}`, {
          model: r.model,
          effort: r.effort,
        })
      ).trim();
      const path = await appendCapture(
        this.plugin.app,
        this.plugin.settings,
        entry,
        this.targetDate
      );
      new Notice(`Captured your voice interview → ${path}`);
      this.onSaved?.();
      this.close();
    } catch (err) {
      this.phase = "error";
      this.errorMsg = (err as Error).message;
      this.plugin.errorLog.push("vapi:synth", err);
      this.renderStatus();
      new Notice(`Save failed: ${(err as Error).message}\nSee Settings → Logs.`, 8000);
    }
  }

  onClose() {
    try {
      this.vapi?.stop();
    } catch {
      /* ignore */
    }
    this.vapi = null;
    this.contentEl.empty();
  }
}
