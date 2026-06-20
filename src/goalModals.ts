/**
 * Goal create + record-logging modals (v0.11). Both reuse the capture-modal
 * chrome (top-anchored, X + title).
 */

import { App, Modal, Notice, TFile } from "obsidian";
import { WHEEL_AREAS, loadProjects } from "./projects";
import { createGoal, addGoalRecord, GoalMeasure, Goal } from "./goals";

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
