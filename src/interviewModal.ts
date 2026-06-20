/**
 * "Interview me" (v0.14.2, Path 1 of the voice-call plan). The agent asks
 * one question at a time about your day; you answer (type or phone-dictate);
 * at the end it synthesizes the exchange into an enriched capture appended to
 * the day's log. A text+dictation stand-in for a real voice call (Path 2/3).
 *
 * Autonomy: it interviews to draw out what mattered — it doesn't advise or
 * moralize. The final capture is in the user's own words.
 */

import { App, Modal, Notice } from "obsidian";
import SecondBrainPlugin from "../main";
import { callLLM } from "./llm";
import { resolveRoute } from "./modelRoutes";
import { appendCapture } from "./capture";
import { resolveDailyLogPath, todayISO } from "./paths";
import { TFile } from "obsidian";

const MAX_QUESTIONS = 6;

const INTERVIEWER_SYSTEM = `You are interviewing the user to enrich today's journal capture. Ask exactly ONE short, specific, warm question at a time that draws out what actually mattered — what happened, what they felt, what they learned, what's unresolved, what they're carrying into tomorrow. Build on their previous answers; don't repeat. Don't advise, coach, or moralize — just draw them out.

You're given the day's log so far and the interview transcript. Reply with ONLY the next question. When you've gathered enough (or after ~5 questions), reply with exactly: DONE`;

const SYNTH_SYSTEM = `From this interview about the user's day, write a concise first-person journal capture in THEIR voice — 2–5 sentences or tight bullets covering what they shared. Faithful, no fluff, no advice. Output only the capture text (no preamble, no heading).`;

interface Turn {
  q: string;
  a?: string;
}

export class InterviewModal extends Modal {
  private readonly plugin: SecondBrainPlugin;
  private readonly targetDate?: string;
  private readonly onSaved?: () => void;
  private turns: Turn[] = [];
  private busy = false;
  private finished = false;
  private answerEl!: HTMLTextAreaElement;

  constructor(app: App, plugin: SecondBrainPlugin, targetDate?: string, onSaved?: () => void) {
    super(app);
    this.plugin = plugin;
    this.targetDate = targetDate;
    this.onSaved = onSaved;
    this.modalEl.addClass("second-brain-capture-modal");
  }

  onOpen() {
    void this.render(true);
  }

  private async render(kickoff = false) {
    const { contentEl } = this;
    contentEl.empty();

    const header = contentEl.createDiv({ cls: "second-brain-capture-header" });
    header.createEl("h2", { text: "🎙️ Interview", cls: "second-brain-capture-title" });
    const close = header.createEl("button", {
      text: "✕",
      cls: "second-brain-capture-close",
      attr: { title: "Close" },
    });
    close.addEventListener("click", () => this.close());

    contentEl.createEl("div", {
      cls: "second-brain-muted",
      text: "Answer out loud (dictate) or type. The agent asks; at the end it writes an enriched capture into today's log.",
    });

    // Transcript so far.
    const tr = contentEl.createDiv({ cls: "second-brain-interview-transcript" });
    for (const t of this.turns) {
      tr.createDiv({ cls: "second-brain-interview-q", text: t.q });
      if (t.a) tr.createDiv({ cls: "second-brain-interview-a", text: t.a });
    }

    if (kickoff && this.turns.length === 0) {
      tr.createDiv({ cls: "second-brain-muted", text: "Thinking of a first question…" });
      await this.nextQuestion();
      return;
    }

    if (this.finished) {
      contentEl.createEl("div", {
        cls: "second-brain-muted",
        text: this.busy ? "Writing your capture…" : "Done.",
      });
      return;
    }

    // Answer box for the current (last) question.
    this.answerEl = contentEl.createEl("textarea", {
      cls: "second-brain-modal-textarea",
      attr: { placeholder: "Your answer…", rows: "3" },
    });
    if (!this.busy) this.answerEl.focus();

    const actions = contentEl.createDiv({ cls: "second-brain-modal-actions" });
    const next = actions.createEl("button", {
      text: this.busy ? "…" : "Next question",
      cls: "second-brain-modal-save",
    });
    if (this.busy) next.setAttribute("disabled", "true");
    next.addEventListener("click", () => void this.submitAnswer());

    const finish = actions.createEl("button", {
      text: "Finish & save",
      cls: "second-brain-modal-cancel",
    });
    finish.addEventListener("click", () => void this.finish());
  }

  private route() {
    return resolveRoute(this.plugin.settings, "ask");
  }

  private async dayContext(): Promise<string> {
    const date = this.targetDate ?? todayISO();
    const path = await resolveDailyLogPath(this.plugin.app, this.plugin.settings, date);
    const f = this.plugin.app.vault.getAbstractFileByPath(path);
    const log = f instanceof TFile ? await this.plugin.app.vault.read(f) : "";
    return log.trim() || "(no captures yet today)";
  }

  private transcriptText(): string {
    return this.turns
      .map((t) => `Q: ${t.q}${t.a ? `\nA: ${t.a}` : ""}`)
      .join("\n\n");
  }

  private async nextQuestion() {
    this.busy = true;
    try {
      const r = this.route();
      const msg = `## Today's log\n${await this.dayContext()}\n\n## Interview so far\n${this.transcriptText() || "(none yet)"}\n\nAsk the next single question, or reply DONE.`;
      const out = (await callLLM(this.plugin.settings, INTERVIEWER_SYSTEM, msg, {
        model: r.model,
        effort: r.effort,
      })).trim();
      this.busy = false;
      if (/^done\b/i.test(out) || this.turns.length >= MAX_QUESTIONS) {
        await this.finish();
        return;
      }
      this.turns.push({ q: out.replace(/^DONE\s*/i, "").trim() || "Anything else worth noting?" });
      await this.render();
    } catch (err) {
      this.busy = false;
      this.plugin.errorLog.push("interview:question", err);
      new Notice(`Interview failed: ${(err as Error).message}\nSee Settings → Logs.`, 8000);
      await this.render();
    }
  }

  private async submitAnswer() {
    const a = this.answerEl?.value.trim();
    if (!a) {
      new Notice("Type or dictate an answer first (or Finish & save).");
      return;
    }
    const last = this.turns[this.turns.length - 1];
    if (last) last.a = a;
    await this.render(); // show the answer immediately
    await this.nextQuestion();
  }

  private async finish() {
    // Capture any unsent answer from the box first.
    const pending = this.answerEl?.value.trim();
    if (pending) {
      const last = this.turns[this.turns.length - 1];
      if (last && !last.a) last.a = pending;
    }
    const answered = this.turns.filter((t) => t.a);
    if (answered.length === 0) {
      new Notice("Nothing to save yet — answer at least one question.");
      return;
    }
    this.finished = true;
    this.busy = true;
    await this.render();
    try {
      const r = this.route();
      const entry = (await callLLM(
        this.plugin.settings,
        SYNTH_SYSTEM,
        `## Interview\n${this.transcriptText()}`,
        { model: r.model, effort: r.effort }
      )).trim();
      const path = await appendCapture(
        this.plugin.app,
        this.plugin.settings,
        entry,
        this.targetDate
      );
      new Notice(`Captured your interview → ${path}`);
      this.onSaved?.();
      this.close();
    } catch (err) {
      this.busy = false;
      this.plugin.errorLog.push("interview:synth", err);
      new Notice(`Save failed: ${(err as Error).message}\nSee Settings → Logs.`, 8000);
      await this.render();
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}
