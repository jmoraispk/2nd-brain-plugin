/**
 * Goal create + record-logging modals (v0.11). Both reuse the capture-modal
 * chrome (top-anchored, X + title).
 */

import { App, Modal, Notice, TFile } from "obsidian";
import SecondBrainPlugin from "../main";
import { WHEEL_AREAS, loadProjects } from "./projects";
import { createGoal, createGoalFromDesigner, addGoalRecord, GoalMeasure, Goal } from "./goals";
import { callLLM } from "./llm";
import { resolveRoute } from "./modelRoutes";

const GOAL_DESIGNER_SYSTEM = `You are a GOAL designer. Turn a spoken description into a well-formed, BOOSTED goal — one that's clear, measurable, and motivating. A goal is a desired OUTCOME or capability ("bench 200 lbs", "read 24 books this year"), NOT a recurring habit.

Apply goal-science best practice to make it as strong as possible:
- **Crisp & Goodhart-proof.** Make the success criterion unambiguous and pass/fail. Kill mushy wording ("get fit" → "bench 200 lbs for 1 rep"). If a number is gameable, add a constraint so it measures the real thing.
- **Identity + why.** Tie it to who the user is becoming and their own reason (use their words).
- **Ladder of milestones.** Break the path into ordered checkpoints, each a real sub-goal (135 → 155 → 185 → 200).
- **A tiny first step.** Name the very next concrete action — small enough to start today.
- **Autonomy.** It's the user's goal and reasons; sharpen, don't impose or moralize.

Return EXACTLY this shape and nothing else:

NAME: <a concise goal name, 2-6 words>

\`\`\`fields
success-criterion: <unambiguous, pass/fail definition of "achieved", Goodhart-proofed>
measure: <magnitude | count | binary>
target: <the numeric target if measurable; omit the line otherwise>
unit: <e.g. lbs, books, kg; omit if not applicable>
\`\`\`

# <name>

## Why
<identity + the user's specific reason, in their voice — what reaching this makes true about them>

## Milestones
- [ ] <ordered checkpoint 1>
- [ ] <checkpoint 2>
- [ ] <…toward the target>

## First step
<the smallest concrete action they can take now to get moving>

## Records

## Progress notes

## Open question
<ONE question that, if answered, sharpens the goal — e.g. "by when?" or "what's blocked you before?">

Rules:
- Be faithful to the description; don't invent scope.
- Milestones must be ordered and concrete.
- Output only the NAME line, the fields block, and the H2 sections above.`;

/** Talk-to-create a goal (v0.12.1) — mirrors the project/habit designers. */
export class GoalDesignerModal extends Modal {
  private readonly plugin: SecondBrainPlugin;
  private readonly onCreated: (file: TFile) => void;
  private textarea!: HTMLTextAreaElement;
  private areaSelect!: HTMLSelectElement;
  private projectSelect!: HTMLSelectElement;

  constructor(app: App, plugin: SecondBrainPlugin, onCreated: (file: TFile) => void) {
    super(app);
    this.plugin = plugin;
    this.onCreated = onCreated;
    this.modalEl.addClass("second-brain-capture-modal");
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    const header = contentEl.createDiv({ cls: "second-brain-capture-header" });
    header.createEl("h2", { text: "Describe a goal", cls: "second-brain-capture-title" });
    const close = header.createEl("button", {
      text: "✕",
      cls: "second-brain-capture-close",
      attr: { title: "Close" },
    });
    close.addEventListener("click", () => this.close());

    contentEl.createEl("div", {
      cls: "second-brain-muted",
      text: "Say the outcome you want (and a target if it's measurable). The AI structures it into a goal with milestones. Link a project to make it active.",
    });

    this.textarea = contentEl.createEl("textarea", {
      cls: "second-brain-modal-textarea",
      attr: { placeholder: "e.g. I want to bench 200 lbs — I'm at about 155 now" },
    });
    this.textarea.focus();

    const areaRow = contentEl.createDiv({ cls: "second-brain-capture-project-row" });
    areaRow.createEl("label", { text: "Area", cls: "second-brain-picker-label" });
    this.areaSelect = areaRow.createEl("select", { cls: "second-brain-select" });
    this.areaSelect.createEl("option", { text: "— none —" }).value = "";
    let macro = "";
    for (const a of WHEEL_AREAS) {
      if (a.macro !== macro) {
        const sep = this.areaSelect.createEl("option", { text: `— ${a.macro} —` });
        sep.value = "";
        sep.setAttribute("disabled", "true");
        macro = a.macro;
      }
      this.areaSelect.createEl("option", { text: `  ${a.sub}` }).value = a.path;
    }

    const projRow = contentEl.createDiv({ cls: "second-brain-capture-project-row" });
    projRow.createEl("label", { text: "Project", cls: "second-brain-picker-label" });
    this.projectSelect = projRow.createEl("select", { cls: "second-brain-select" });
    this.projectSelect.createEl("option", { text: "— none (someday) —" }).value = "";
    void this.loadProjects();

    const actions = contentEl.createDiv({ cls: "second-brain-modal-actions" });
    const go = actions.createEl("button", { text: "Structure & create", cls: "second-brain-modal-save" });
    go.addEventListener("click", () => this.submit(go));
    actions.createEl("button", { text: "Cancel", cls: "second-brain-modal-cancel" })
      .addEventListener("click", () => this.close());
  }

  private async loadProjects() {
    const projects = (await loadProjects(this.app)).filter((p) => p.status === "active");
    for (const p of projects) {
      this.projectSelect.createEl("option", { text: p.name }).value = p.file.path;
    }
  }

  private async submit(btn: HTMLButtonElement) {
    const desc = this.textarea.value.trim();
    if (!desc) {
      new Notice("Describe the goal first.");
      return;
    }
    btn.setAttribute("disabled", "true");
    btn.setText("Structuring…");
    try {
      const route = resolveRoute(this.plugin.settings, "project-ai");
      const out = await callLLM(this.plugin.settings, GOAL_DESIGNER_SYSTEM, desc, {
        model: route.model,
        effort: route.effort,
      });
      const { name, fields, body } = parseDesignerOutput(out);
      const file = await createGoalFromDesigner(
        this.app,
        name || "New goal",
        this.areaSelect.value ? [this.areaSelect.value] : [],
        this.projectSelect.value ? [this.projectSelect.value] : [],
        fields,
        body
      );
      this.onCreated(file);
      this.close();
      new Notice(`Created goal: ${file.path}`);
    } catch (err) {
      this.plugin.errorLog.push("goalDesigner", err);
      new Notice(
        `Create failed: ${(err as Error).message}\nSee Settings → Logs for details.`,
        8000
      );
      btn.removeAttribute("disabled");
      btn.setText("Structure & create");
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}

/** Parse NAME + ```fields``` + body from a designer LLM response. */
function parseDesignerOutput(out: string): {
  name: string;
  fields: Map<string, string>;
  body: string;
} {
  let name = "";
  for (const l of out.split(/\r?\n/)) {
    const m = l.match(/^NAME:\s*(.+?)\s*$/);
    if (m) {
      name = m[1].replace(/^["']|["']$/g, "").trim();
      break;
    }
  }
  const fields = new Map<string, string>();
  const fence = out.match(/```(?:fields|ya?ml)?\s*\n([\s\S]*?)```/);
  if (fence) {
    for (const line of fence[1].split(/\r?\n/)) {
      const m = line.match(/^([a-zA-Z][\w-]*):\s*(.+?)\s*$/);
      if (m) {
        const v = m[2].replace(/^["']|["']$/g, "").trim();
        if (v && v.toLowerCase() !== "n/a") fields.set(m[1].toLowerCase(), v);
      }
    }
  }
  const h2 = out.search(/^##\s+/m);
  const body = h2 >= 0 ? out.slice(h2).trimEnd() : "";
  return { name, fields, body };
}

export class GoalCreateModal extends Modal {
  private readonly onCreated: (file: TFile) => void;
  private nameInput!: HTMLInputElement;
  private areaSelect!: HTMLSelectElement;
  private projectSelect!: HTMLSelectElement;
  private criterionInput!: HTMLInputElement;
  private measureSelect!: HTMLSelectElement;
  private targetInput!: HTMLInputElement;
  private unitInput!: HTMLInputElement;

  constructor(app: App, onCreated: (file: TFile) => void) {
    super(app);
    this.onCreated = onCreated;
    this.modalEl.addClass("second-brain-capture-modal");
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    const header = contentEl.createDiv({ cls: "second-brain-capture-header" });
    header.createEl("h2", { text: "New Goal", cls: "second-brain-capture-title" });
    const close = header.createEl("button", {
      text: "✕",
      cls: "second-brain-capture-close",
      attr: { title: "Close" },
    });
    close.addEventListener("click", () => this.close());

    contentEl.createEl("div", {
      cls: "second-brain-muted",
      text: "A desired outcome. Link it to a project to make it active, or leave it standalone as a 'someday' goal.",
    });

    this.nameInput = this.field(contentEl, "Name", "e.g. Bench 200 lbs");
    this.nameInput.focus();

    // Area picker
    const areaRow = contentEl.createDiv({ cls: "second-brain-form-row" });
    areaRow.createEl("label", { text: "Area", cls: "second-brain-picker-label" });
    this.areaSelect = areaRow.createEl("select", { cls: "second-brain-select" });
    this.areaSelect.createEl("option", { text: "— none —" }).value = "";
    let macro = "";
    for (const a of WHEEL_AREAS) {
      if (a.macro !== macro) {
        const sep = this.areaSelect.createEl("option", { text: `— ${a.macro} —` });
        sep.value = "";
        sep.setAttribute("disabled", "true");
        macro = a.macro;
      }
      this.areaSelect.createEl("option", { text: `  ${a.sub}` }).value = a.path;
    }

    // Project picker (linking → active)
    const projRow = contentEl.createDiv({ cls: "second-brain-form-row" });
    projRow.createEl("label", { text: "Project", cls: "second-brain-picker-label" });
    this.projectSelect = projRow.createEl("select", { cls: "second-brain-select" });
    this.projectSelect.createEl("option", { text: "— none (someday) —" }).value = "";
    void this.loadProjects();

    this.criterionInput = this.field(contentEl, "Success", "e.g. 200 lbs for 1 rep");

    // Measure
    const mRow = contentEl.createDiv({ cls: "second-brain-form-row" });
    mRow.createEl("label", { text: "Measure", cls: "second-brain-picker-label" });
    this.measureSelect = mRow.createEl("select", { cls: "second-brain-select" });
    for (const m of ["magnitude", "count", "binary"] as GoalMeasure[]) {
      this.measureSelect.createEl("option", { text: m }).value = m;
    }

    this.targetInput = this.field(contentEl, "Target", "e.g. 200");
    this.targetInput.type = "number";
    this.unitInput = this.field(contentEl, "Unit", "e.g. lbs");

    const actions = contentEl.createDiv({ cls: "second-brain-modal-actions" });
    actions.createEl("button", { text: "Create", cls: "second-brain-modal-save" })
      .addEventListener("click", () => this.submit());
    actions.createEl("button", { text: "Cancel", cls: "second-brain-modal-cancel" })
      .addEventListener("click", () => this.close());
  }

  private field(parent: HTMLElement, label: string, ph: string): HTMLInputElement {
    const row = parent.createDiv({ cls: "second-brain-form-row" });
    row.createEl("label", { text: label, cls: "second-brain-picker-label" });
    return row.createEl("input", {
      cls: "second-brain-text-input",
      attr: { type: "text", placeholder: ph },
    });
  }

  private async loadProjects() {
    const projects = (await loadProjects(this.app)).filter((p) => p.status === "active");
    for (const p of projects) {
      this.projectSelect.createEl("option", { text: p.name }).value = p.file.path;
    }
  }

  private async submit() {
    const name = this.nameInput.value.trim();
    if (!name) {
      new Notice("Name the goal first.");
      return;
    }
    const targetVal = parseFloat(this.targetInput.value);
    try {
      const file = await createGoal(this.app, {
        name,
        areaPaths: this.areaSelect.value ? [this.areaSelect.value] : [],
        projectPaths: this.projectSelect.value ? [this.projectSelect.value] : [],
        successCriterion: this.criterionInput.value.trim() || undefined,
        measure: this.measureSelect.value as GoalMeasure,
        target: Number.isFinite(targetVal) ? targetVal : undefined,
        unit: this.unitInput.value.trim() || undefined,
      });
      this.onCreated(file);
      this.close();
      new Notice(`Created goal: ${file.path}`);
    } catch (err) {
      new Notice(`Create failed: ${(err as Error).message}`);
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}

/** Log a record / PR against a goal. */
export class GoalRecordModal extends Modal {
  private readonly goal: Goal;
  private readonly onSaved: () => void;
  private textInput!: HTMLInputElement;
  private valueInput!: HTMLInputElement;

  constructor(app: App, goal: Goal, onSaved: () => void) {
    super(app);
    this.goal = goal;
    this.onSaved = onSaved;
    this.modalEl.addClass("second-brain-capture-modal");
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    const header = contentEl.createDiv({ cls: "second-brain-capture-header" });
    header.createEl("h2", {
      text: `Record — ${this.goal.name}`,
      cls: "second-brain-capture-title",
    });
    contentEl_close(this, header);

    contentEl.createEl("div", {
      cls: "second-brain-muted",
      text: "Log a progress event or personal record. A value updates the goal's current progress.",
    });

    const tRow = contentEl.createDiv({ cls: "second-brain-form-row" });
    tRow.createEl("label", { text: "What", cls: "second-brain-picker-label" });
    this.textInput = tRow.createEl("input", {
      cls: "second-brain-text-input",
      attr: { type: "text", placeholder: "e.g. 1RM test — 185 lbs" },
    });
    this.textInput.focus();

    const vRow = contentEl.createDiv({ cls: "second-brain-form-row" });
    vRow.createEl("label", {
      text: `Value${this.goal.unit ? ` (${this.goal.unit})` : ""}`,
      cls: "second-brain-picker-label",
    });
    this.valueInput = vRow.createEl("input", {
      cls: "second-brain-text-input",
      attr: { type: "number", placeholder: "optional — updates current" },
    });

    const actions = contentEl.createDiv({ cls: "second-brain-modal-actions" });
    actions.createEl("button", { text: "Log it", cls: "second-brain-modal-save" })
      .addEventListener("click", () => this.submit());
    actions.createEl("button", { text: "Cancel", cls: "second-brain-modal-cancel" })
      .addEventListener("click", () => this.close());
  }

  private async submit() {
    const text = this.textInput.value.trim();
    if (!text) {
      new Notice("Describe the record first.");
      return;
    }
    const today = (() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    })();
    const v = parseFloat(this.valueInput.value);
    try {
      await addGoalRecord(this.app, this.goal.file, today, text, Number.isFinite(v) ? v : undefined);
      this.onSaved();
      this.close();
      new Notice("Record logged.");
    } catch (err) {
      new Notice(`Failed: ${(err as Error).message}`);
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}

function contentEl_close(modal: Modal, header: HTMLElement) {
  const close = header.createEl("button", {
    text: "✕",
    cls: "second-brain-capture-close",
    attr: { title: "Close" },
  });
  close.addEventListener("click", () => modal.close());
}
