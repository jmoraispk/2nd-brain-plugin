import { ItemView, WorkspaceLeaf, Notice, Modal, App } from "obsidian";
import SecondBrainPlugin from "../main";
import { appendCapture } from "./capture";
import { runCommand } from "./runner";
import { BUILT_IN_COMMANDS } from "./commands";
import { Command } from "./types";

export const VIEW_TYPE_SECOND_BRAIN = "second-brain-view";

export class SecondBrainView extends ItemView {
  plugin: SecondBrainPlugin;

  constructor(leaf: WorkspaceLeaf, plugin: SecondBrainPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() {
    return VIEW_TYPE_SECOND_BRAIN;
  }
  getDisplayText() {
    return "Second Brain";
  }
  getIcon() {
    return "brain";
  }

  async onOpen() {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass("second-brain-container");

    const buttonRow = container.createDiv({ cls: "second-brain-buttons" });

    // Capture stays a hardcoded primary button — it's the only one that takes
    // direct user input rather than transforming existing notes.
    const captureBtn = buttonRow.createEl("button", {
      text: "Capture",
      cls: "second-brain-button second-brain-button-primary",
    });
    captureBtn.addEventListener("click", () => {
      new CaptureModal(this.app, this.plugin).open();
    });

    // Render one button per command (built-in for v0.1.0).
    for (const command of BUILT_IN_COMMANDS) {
      const btn = buttonRow.createEl("button", {
        text: command.label,
        cls: "second-brain-button",
      });
      btn.addEventListener("click", () => this.runCommandHandler(btn, command));
    }
  }

  async runCommandHandler(btn: HTMLButtonElement, command: Command) {
    const originalLabel = command.label;
    btn.setText("Working…");
    btn.setAttr("disabled", "true");
    try {
      const file = await runCommand(this.app, this.plugin.settings, command);
      new Notice(`${command.label}: wrote ${file.path}`);
      await this.app.workspace.getLeaf(false).openFile(file);
    } catch (err) {
      new Notice(`${command.label} failed: ${(err as Error).message}`);
      console.error(err);
    } finally {
      btn.setText(originalLabel);
      btn.removeAttribute("disabled");
    }
  }

  async onClose() {}
}

class CaptureModal extends Modal {
  plugin: SecondBrainPlugin;
  textarea!: HTMLTextAreaElement;

  constructor(app: App, plugin: SecondBrainPlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Capture" });

    this.textarea = contentEl.createEl("textarea", {
      cls: "second-brain-modal-textarea",
      attr: { placeholder: "What's on your mind?" },
    });
    this.textarea.focus();

    const actions = contentEl.createDiv({ cls: "second-brain-modal-actions" });

    const saveBtn = actions.createEl("button", {
      text: "Save",
      cls: "second-brain-modal-save",
    });
    saveBtn.addEventListener("click", () => this.saveAndClose());

    const cancelBtn = actions.createEl("button", {
      text: "Cancel",
      cls: "second-brain-modal-cancel",
    });
    cancelBtn.addEventListener("click", () => this.close());

    this.textarea.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        this.saveAndClose();
      }
    });
  }

  async saveAndClose() {
    const content = this.textarea.value.trim();
    if (!content) {
      this.close();
      return;
    }
    try {
      const path = await appendCapture(
        this.app,
        this.plugin.settings,
        content
      );
      new Notice(`Captured → ${path}`);
    } catch (err) {
      new Notice(`Capture failed: ${(err as Error).message}`);
      console.error(err);
    }
    this.close();
  }

  onClose() {
    this.contentEl.empty();
  }
}
