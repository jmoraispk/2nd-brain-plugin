import { ItemView, WorkspaceLeaf, Notice, Modal, App } from "obsidian";
import SecondBrainPlugin from "../main";
import { appendCapture } from "./capture";
import { generateDailyReview } from "./review";

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

    const captureBtn = buttonRow.createEl("button", {
      text: "Capture",
      cls: "second-brain-button second-brain-button-primary",
    });
    captureBtn.addEventListener("click", () => {
      new CaptureModal(this.app, this.plugin).open();
    });

    const reviewBtn = buttonRow.createEl("button", {
      text: "Today's Review",
      cls: "second-brain-button",
    });
    reviewBtn.addEventListener("click", async () => {
      reviewBtn.setText("Working…");
      reviewBtn.setAttr("disabled", "true");
      try {
        const file = await generateDailyReview(this.app, this.plugin.settings);
        new Notice(`Review written: ${file.path}`);
        await this.app.workspace.getLeaf(false).openFile(file);
      } catch (err) {
        new Notice(`Review failed: ${(err as Error).message}`);
        console.error(err);
      } finally {
        reviewBtn.setText("Today's Review");
        reviewBtn.removeAttribute("disabled");
      }
    });
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
