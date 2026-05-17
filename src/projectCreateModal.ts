import { App, Modal, Notice, TFile } from "obsidian";
import { createProject, WHEEL_AREAS } from "./projects";

/**
 * "+ New Project" modal. Inherits the capture-modal chrome (anchored near
 * the top of the screen, X + title row, no 3-line headers).
 *
 * Single form: project name + area picker (the 9 Wheel-of-Life sub-areas,
 * plus a "— none —" option). On save, creates a project file with a SMART
 * scaffold and opens it for editing.
 */
export class ProjectCreateModal extends Modal {
  private readonly onCreated: (file: TFile) => void;
  private nameInput!: HTMLInputElement;
  private areaSelect!: HTMLSelectElement;

  constructor(app: App, onCreated: (file: TFile) => void) {
    super(app);
    this.onCreated = onCreated;
    this.modalEl.addClass("second-brain-capture-modal");
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    const header = contentEl.createDiv({ cls: "second-brain-capture-header" });
    header.createEl("h2", {
      text: "New Project",
      cls: "second-brain-capture-title",
    });
    const closeBtn = header.createEl("button", {
      text: "✕",
      cls: "second-brain-capture-close",
      attr: { title: "Close" },
    });
    closeBtn.addEventListener("click", () => this.close());

    contentEl.createEl("div", {
      cls: "second-brain-muted",
      text: "Bounded outcome with an end. Pick which area of life it serves — habits attached to it inherit that context.",
    });

    // Name input
    const nameRow = contentEl.createDiv({ cls: "second-brain-form-row" });
    nameRow.createEl("label", {
      text: "Name",
      cls: "second-brain-picker-label",
    });
    this.nameInput = nameRow.createEl("input", {
      attr: {
        type: "text",
        placeholder: "e.g. Ship plugin v1.0",
      },
      cls: "second-brain-text-input",
    });
    this.nameInput.focus();

    // Area picker
    const areaRow = contentEl.createDiv({ cls: "second-brain-form-row" });
    areaRow.createEl("label", {
      text: "Area",
      cls: "second-brain-picker-label",
    });
    this.areaSelect = areaRow.createEl("select", {
      cls: "second-brain-select",
    });
    const noneOpt = this.areaSelect.createEl("option", { text: "— none —" });
    noneOpt.value = "";
    let currentMacro = "";
    for (const a of WHEEL_AREAS) {
      if (a.macro !== currentMacro) {
        // Group label as a disabled option for clarity.
        const sep = this.areaSelect.createEl("option", {
          text: `— ${a.macro} —`,
        });
        sep.value = "";
        sep.setAttribute("disabled", "true");
        currentMacro = a.macro;
      }
      const opt = this.areaSelect.createEl("option", {
        text: `  ${a.sub}`,
      });
      opt.value = a.path;
    }

    const actions = contentEl.createDiv({ cls: "second-brain-modal-actions" });

    const saveBtn = actions.createEl("button", {
      text: "Create",
      cls: "second-brain-modal-save",
    });
    saveBtn.addEventListener("click", () => this.submit());

    const cancelBtn = actions.createEl("button", {
      text: "Cancel",
      cls: "second-brain-modal-cancel",
    });
    cancelBtn.addEventListener("click", () => this.close());

    this.nameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.submit();
      }
    });
  }

  private async submit() {
    const name = this.nameInput.value.trim();
    if (!name) {
      new Notice("Type a project name first.");
      return;
    }
    const areaPath = this.areaSelect.value || null;
    try {
      const file = await createProject(this.app, name, areaPath);
      this.onCreated(file);
      this.close();
      new Notice(`Created project: ${file.path}`);
    } catch (err) {
      new Notice(`Create failed: ${(err as Error).message}`);
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}
