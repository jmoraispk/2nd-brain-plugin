import { App, Modal, Setting, Notice } from "obsidian";
import { Command, CommandInputKind } from "./types";

const INPUT_KINDS: { value: CommandInputKind; label: string }[] = [
  { value: "today-log", label: "Today's log" },
  { value: "yesterday-log", label: "Yesterday's log" },
  { value: "today-review", label: "Today's review" },
  { value: "yesterday-review", label: "Yesterday's review" },
  { value: "this-week-logs", label: "This week's logs (Mon–today)" },
];

/**
 * Modal for adding a new command or editing an existing one. Edits a deep
 * clone; `onSave` is called with the result only if the user clicks Save.
 */
export class CommandEditModal extends Modal {
  private readonly draft: Command;
  private readonly isExisting: boolean;
  private readonly onSave: (cmd: Command) => Promise<void> | void;

  constructor(
    app: App,
    command: Command,
    onSave: (cmd: Command) => Promise<void> | void
  ) {
    super(app);
    this.draft = JSON.parse(JSON.stringify(command));
    this.isExisting = command.label !== "New command";
    this.onSave = onSave;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", {
      text: this.isExisting ? `Edit: ${this.draft.label}` : "Add command",
    });

    new Setting(contentEl)
      .setName("Label")
      .setDesc("Button text in the plugin view.")
      .addText((t) =>
        t
          .setValue(this.draft.label)
          .onChange((v) => (this.draft.label = v))
      );

    new Setting(contentEl)
      .setName("Input")
      .setDesc("What content to feed the LLM.")
      .addDropdown((d) => {
        for (const k of INPUT_KINDS) d.addOption(k.value, k.label);
        d.setValue(this.draft.inputs[0]?.kind ?? "today-log");
        d.onChange((v) => {
          this.draft.inputs = [{ kind: v as CommandInputKind }];
        });
      });

    new Setting(contentEl)
      .setName("Output path")
      .setDesc(
        "Where the result is written. Placeholders: {YYYY-MM-DD}, {TOMORROW}, {YESTERDAY}, {ISO_YEAR}, {YYYY}, {YYYY-MM}, {MM}, {DD}, {Q}, {WW}. Output must be inside _AI/ (the hook in the framework enforces this for desktop Claude Code; in the plugin there's no enforcement — but you've already promised yourself that). {REVIEWS_TEMPLATE} expands to the daily review path template."
      )
      .addText((t) =>
        t
          .setValue(this.draft.outputPath)
          .onChange((v) => (this.draft.outputPath = v.trim()))
      );

    new Setting(contentEl)
      .setName("System prompt")
      .setDesc("Instructions sent to the LLM.")
      .addTextArea((t) => {
        t.setValue(this.draft.systemPrompt).onChange(
          (v) => (this.draft.systemPrompt = v)
        );
        t.inputEl.rows = 14;
        t.inputEl.style.width = "100%";
        t.inputEl.style.fontFamily = "var(--font-monospace)";
      });

    const actions = contentEl.createDiv({ cls: "second-brain-modal-actions" });

    const saveBtn = actions.createEl("button", {
      text: "Save",
      cls: "second-brain-modal-save",
    });
    saveBtn.addEventListener("click", () => this.attemptSave());

    const cancelBtn = actions.createEl("button", {
      text: "Cancel",
      cls: "second-brain-modal-cancel",
    });
    cancelBtn.addEventListener("click", () => this.close());
  }

  private async attemptSave() {
    const label = this.draft.label.trim();
    const outputPath = this.draft.outputPath.trim();
    const systemPrompt = this.draft.systemPrompt.trim();

    if (!label) {
      new Notice("Label is required.");
      return;
    }
    if (!outputPath) {
      new Notice("Output path is required.");
      return;
    }
    if (!systemPrompt) {
      new Notice("System prompt is required.");
      return;
    }
    this.draft.label = label;
    this.draft.outputPath = outputPath;
    this.draft.systemPrompt = systemPrompt;

    await this.onSave(this.draft);
    this.close();
  }

  onClose() {
    this.contentEl.empty();
  }
}
