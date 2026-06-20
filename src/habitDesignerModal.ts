/**
 * AI habit-designer (v0.10) — the keystone of the habit system.
 *
 * You say "I want to exercise more"; the AI applies the habit-design canon
 * (Atomic Habits / Tiny Habits / implementation intentions) and the LogLife
 * 5-pillar boost to turn the wish into a crisp, anchored, identity-linked
 * habit — written to `🧑 Me/Habits/<id>.md` with the full anatomy.
 *
 * Autonomy (SDT): the AI supports the USER's own habit and reasons. It does
 * not invent new habits the user didn't ask for, and it does not moralize.
 *
 * "Speech" = phone OS dictation into the textarea, like every capture surface.
 */

import { App, Modal, Notice, TFile } from "obsidian";
import SecondBrainPlugin from "../main";
import { callLLM } from "./llm";
import { resolveRoute } from "./modelRoutes";
import { createHabitFromDesigner } from "./habits";
import { WHEEL_AREAS, loadProjects } from "./projects";
import { loadGoals } from "./goals";

const DESIGNER_SYSTEM = `You are a habit DESIGNER. Turn the user's rough description of a habit they want into a habit that actually sticks, using established habit science:

- Atomic Habits (James Clear): identity-based habits; make it obvious/attractive/easy/satisfying; the 2-minute rule (scale the minimum until starting is trivial); never miss twice.
- Tiny Habits (BJ Fogg): design for ability (make it tiny), anchor to an existing routine, celebrate immediately.
- Implementation intentions (Gollwitzer): a concrete when/where/after-what cue roughly doubles follow-through.
- Goodhart's law: protect any numeric target with a constraint / minimum dose / evidence so it can't be gamed.

AUTONOMY RULE: this is the USER's habit and the user's reasons. Do NOT invent a different habit, stack on extra habits, or moralize. Clarify and strengthen what they asked for. If they gave a reason, use their words.

Return EXACTLY this shape and nothing else:

NAME: <a short, concrete habit name, 2-5 words>

\`\`\`fields
kind: <do | quit | mood | weight — "quit" to STOP/abstain (smoking, drinking, doomscrolling); "mood" to log a 1–5 daily mood; "weight" to log body weight; else "do">
periodicity: <daily | weekdays | weekly | monthly>
schedule-days: <only if they named specific days, e.g. "Mon, Wed, Fri"; omit otherwise>
per-week: <only if they said "N days a week", e.g. 3; omit otherwise>
binary-criterion: <the MINIMUM that counts as done today — tiny, unambiguous, pass/fail in 3 seconds. For a quit habit, this is the abstinence ("no cigarettes today").>
target: <optional aspirational amount, e.g. "30 minutes"; omit the line if not applicable>
identity: <the kind of person this habit makes them — one line>
why: <their specific personal reason; use their words if given>
cue: <when/where/after-what — a concrete implementation intention. For a quit habit, the cue is the high-risk trigger to plan around.>
environment: <one friction-lowering tweak to set up in advance>
constraints: <anti-gaming rules separated by semicolons; omit if none>
evidence: <what proves it happened — an artifact, a log mention, or a #tag>
reward: <an immediate small celebration>
recovery: <the smaller re-entry if a day is missed / relapse plan (never miss twice)>
\`\`\`

# <name>

## Why this habit
<1-2 sentences in the user's voice>

## How it's built to stick
A short bullet list explaining the cue, the minimum dose, the environment tweak, the reward, and the recovery — so the user understands the design.

## Open question
<ONE question that, if answered, would sharpen the habit further — e.g. "what time are you realistically most likely to do this?">

Rules:
- Keep the minimum genuinely tiny (5 minutes, one set, one page).
- Be concrete. "Exercise" is a wish; "≥5 min of intentional movement after morning coffee" is a habit.
- Output only the NAME line, the \`fields\` block, and the three H2 sections.`;

export class HabitDesignerModal extends Modal {
  private readonly plugin: SecondBrainPlugin;
  private readonly onCreated: (file: TFile) => void;
  private readonly seed?: string;
  private textarea!: HTMLTextAreaElement;
  private areaSelect!: HTMLSelectElement;
  private projectSelect!: HTMLSelectElement;
  private goalSelect!: HTMLSelectElement;

  constructor(
    app: App,
    plugin: SecondBrainPlugin,
    onCreated: (file: TFile) => void,
    seed?: string
  ) {
    super(app);
    this.plugin = plugin;
    this.onCreated = onCreated;
    this.seed = seed;
    this.modalEl.addClass("second-brain-capture-modal");
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    const header = contentEl.createDiv({ cls: "second-brain-capture-header" });
    header.createEl("h2", {
      text: "Design a habit",
      cls: "second-brain-capture-title",
    });
    const close = header.createEl("button", {
      text: "✕",
      cls: "second-brain-capture-close",
      attr: { title: "Close" },
    });
    close.addEventListener("click", () => this.close());

    contentEl.createEl("div", {
      cls: "second-brain-muted",
      text: "Say what you want to build (and why, if you know). The AI makes it tiny, anchors it to a cue, and writes the full habit — so it actually sticks.",
    });

    this.textarea = contentEl.createEl("textarea", {
      cls: "second-brain-modal-textarea",
      attr: {
        placeholder:
          "e.g. I want to exercise more — mornings ideally, I keep skipping it when work gets busy",
      },
    });
    if (this.seed) this.textarea.value = this.seed;
    this.textarea.focus();

    const areaRow = contentEl.createDiv({ cls: "second-brain-capture-project-row" });
    areaRow.createEl("label", { text: "Area", cls: "second-brain-picker-label" });
    this.areaSelect = areaRow.createEl("select", { cls: "second-brain-select" });
    const none = this.areaSelect.createEl("option", { text: "— none —" });
    none.value = "";
    let macro = "";
    for (const a of WHEEL_AREAS) {
      if (a.macro !== macro) {
        const sep = this.areaSelect.createEl("option", { text: `— ${a.macro} —` });
        sep.value = "";
        sep.setAttribute("disabled", "true");
        macro = a.macro;
      }
      const opt = this.areaSelect.createEl("option", { text: `  ${a.sub}` });
      opt.value = a.path;
    }

    const projRow = contentEl.createDiv({ cls: "second-brain-capture-project-row" });
    projRow.createEl("label", { text: "Project", cls: "second-brain-picker-label" });
    this.projectSelect = projRow.createEl("select", { cls: "second-brain-select" });
    const pnone = this.projectSelect.createEl("option", { text: "— none —" });
    pnone.value = "";

    // Goal picker — link the habit to a goal it serves (the "showing up" feed).
    const goalRow = contentEl.createDiv({ cls: "second-brain-capture-project-row" });
    goalRow.createEl("label", { text: "Goal", cls: "second-brain-picker-label" });
    this.goalSelect = goalRow.createEl("select", { cls: "second-brain-select" });
    this.goalSelect.createEl("option", { text: "— none —" }).value = "";

    void this.loadOptions();

    const actions = contentEl.createDiv({ cls: "second-brain-modal-actions" });
    const go = actions.createEl("button", {
      text: "Design & create",
      cls: "second-brain-modal-save",
    });
    go.addEventListener("click", () => this.submit(go));
    const cancel = actions.createEl("button", {
      text: "Cancel",
      cls: "second-brain-modal-cancel",
    });
    cancel.addEventListener("click", () => this.close());
  }

  private async loadOptions() {
    try {
      const projects = (await loadProjects(this.app)).filter(
        (p) => p.status === "active"
      );
      for (const p of projects) {
        this.projectSelect.createEl("option", { text: p.name }).value = p.file.path;
      }
      const goals = (await loadGoals(this.app)).filter((g) => g.status !== "dropped");
      for (const g of goals) {
        this.goalSelect.createEl("option", { text: g.name }).value = g.file.path;
      }
    } catch (err) {
      this.plugin.errorLog.push("habitDesigner:loadOptions", err);
    }
  }

  private async submit(btn: HTMLButtonElement) {
    const desc = this.textarea.value.trim();
    if (!desc) {
      new Notice("Describe the habit you want first.");
      return;
    }
    btn.setAttribute("disabled", "true");
    btn.setText("Designing…");
    try {
      const route = resolveRoute(this.plugin.settings, "project-ai");
      const out = await callLLM(this.plugin.settings, DESIGNER_SYSTEM, desc, {
        model: route.model,
        effort: route.effort,
      });
      const { name, fields, body } = parseDesignerOutput(out);
      const areaPaths = this.areaSelect.value ? [this.areaSelect.value] : [];
      const projectPaths = this.projectSelect.value ? [this.projectSelect.value] : [];
      const goalPaths = this.goalSelect.value ? [this.goalSelect.value] : [];
      const file = await createHabitFromDesigner(
        this.app,
        name || "New habit",
        areaPaths,
        projectPaths,
        fields,
        body,
        goalPaths
      );
      this.onCreated(file);
      this.close();
      new Notice(`Designed habit: ${file.path}`);
    } catch (err) {
      this.plugin.errorLog.push("habitDesigner", err);
      new Notice(
        `Design failed: ${(err as Error).message}\nSee Settings → Logs for details.`,
        8000
      );
      btn.removeAttribute("disabled");
      btn.setText("Design & create");
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}

/** Parse the designer's NAME + ```fields``` block + markdown body. */
function parseDesignerOutput(out: string): {
  name: string;
  fields: Map<string, string>;
  body: string;
} {
  const lines = out.split(/\r?\n/);
  let name = "";
  for (const l of lines) {
    const m = l.match(/^NAME:\s*(.+?)\s*$/);
    if (m) {
      name = m[1].replace(/^["']|["']$/g, "").trim();
      break;
    }
  }

  const fields = new Map<string, string>();
  const fenceMatch = out.match(/```(?:fields|ya?ml)?\s*\n([\s\S]*?)```/);
  if (fenceMatch) {
    for (const line of fenceMatch[1].split(/\r?\n/)) {
      const m = line.match(/^([a-zA-Z][\w-]*):\s*(.+?)\s*$/);
      if (m) {
        const v = m[2].replace(/^["']|["']$/g, "").trim();
        if (v && v.toLowerCase() !== "n/a" && v !== "<omit>") {
          fields.set(m[1].toLowerCase(), v);
        }
      }
    }
  }

  // Body = everything from the first markdown H2 onward (the human-readable part).
  const h2 = out.search(/^##\s+/m);
  const body = h2 >= 0 ? out.slice(h2).trimEnd() : "";
  return { name, fields, body };
}
