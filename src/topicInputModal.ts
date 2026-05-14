import { App, Modal, Notice } from "obsidian";

/**
 * Generic single-textarea modal used by commands that need a runtime topic
 * (Trace, Challenge, and future ones). The prompt text is the command's
 * `topicPromptText`. Submitting calls `onSubmit(topic)`; cancelling does nothing.
 */
export class TopicInputModal extends Modal {
  private readonly promptText: string;
  private readonly onSubmit: (topic: string) => void;
  private textarea!: HTMLTextAreaElement;

  constructor(app: App, promptText: string, onSubmit: (topic: string) => void) {
    super(app);
    this.promptText = promptText;
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: this.promptText });
    contentEl.createEl("p", {
      cls: "second-brain-muted",
      text: "Be specific. The topic will be sent alongside your vault content to scope the result.",
    });

    this.textarea = contentEl.createEl("textarea", {
      cls: "second-brain-modal-textarea",
      attr: { placeholder: "Type a topic, belief, or idea…" },
    });
    this.textarea.focus();

    const actions = contentEl.createDiv({ cls: "second-brain-modal-actions" });
    const okBtn = actions.createEl("button", {
      text: "Run",
      cls: "second-brain-modal-save",
    });
    okBtn.addEventListener("click", () => this.submit());

    const cancelBtn = actions.createEl("button", {
      text: "Cancel",
      cls: "second-brain-modal-cancel",
    });
    cancelBtn.addEventListener("click", () => this.close());

    this.textarea.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        this.submit();
      }
    });
  }

  private submit() {
    const topic = this.textarea.value.trim();
    if (!topic) {
      new Notice("Type a topic first.");
      return;
    }
    this.onSubmit(topic);
    this.close();
  }

  onClose() {
    this.contentEl.empty();
  }
}
