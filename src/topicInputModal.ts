import { App, Modal } from "obsidian";

/**
 * Generic single-textarea modal used by commands that need a runtime topic
 * (Trace, Challenge, Draft Habit, etc.). Mirrors the Capture modal's chrome
 * exactly — anchored near the top of the screen so the on-screen keyboard
 * doesn't cover it, with a short title next to an inline X.
 *
 * The `promptText` is rendered as a muted single-line label *under* the
 * title — not as the title itself — so long instructions don't grow a
 * 3-line header.
 *
 * Empty submissions are allowed by design: commands like Draft Habit
 * explicitly support an empty topic ("propose one from my recent captures").
 * Commands that require a topic should validate inside their own handler.
 */
export class TopicInputModal extends Modal {
  private readonly title: string;
  private readonly promptText: string;
  private readonly onSubmit: (topic: string) => void;
  private textarea!: HTMLTextAreaElement;

  constructor(
    app: App,
    title: string,
    promptText: string,
    onSubmit: (topic: string) => void
  ) {
    super(app);
    this.title = title;
    this.promptText = promptText;
    this.onSubmit = onSubmit;
    // Reuse the capture-modal class so we inherit top-anchoring +
    // rounded corners + hidden default Obsidian close-X.
    this.modalEl.addClass("second-brain-capture-modal");
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    // Title row: short title + inline X, identical layout to Capture modal.
    const header = contentEl.createDiv({ cls: "second-brain-capture-header" });
    header.createEl("h2", {
      text: this.title,
      cls: "second-brain-capture-title",
    });
    const closeBtn = header.createEl("button", {
      text: "✕",
      cls: "second-brain-capture-close",
      attr: { title: "Close" },
    });
    closeBtn.addEventListener("click", () => this.close());

    // The actual prompt text goes here as a muted label — it can be long
    // without taking over the title bar.
    contentEl.createEl("div", {
      cls: "second-brain-muted",
      text: this.promptText,
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
    // Allow empty — caller's command system prompt handles the no-topic case.
    this.onSubmit(this.textarea.value.trim());
    this.close();
  }

  onClose() {
    this.contentEl.empty();
  }
}
