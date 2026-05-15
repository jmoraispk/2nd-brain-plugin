import { ItemView, WorkspaceLeaf, Notice, Modal, App, TFile } from "obsidian";
import SecondBrainPlugin from "../main";
import { appendCapture } from "./capture";
import { runCommand } from "./runner";
import { getEffectiveCommands, getBuiltInCommand } from "./commands";
import { Command } from "./types";
import { renderDashboard } from "./dashboard";
import {
  renderReview,
  appendUserReview,
  defaultReviewTabState,
  ReviewTabState,
  SelectionOption,
  SELECTION_OPTIONS,
  mapCommandToReviewSelection,
} from "./reviewTab";
import { renderThink, ThinkSubtab } from "./thinkTab";
import { TopicInputModal } from "./topicInputModal";

export const VIEW_TYPE_SECOND_BRAIN = "second-brain-view";

type ViewMode = "dashboard" | "review" | "think";

export class SecondBrainView extends ItemView {
  plugin: SecondBrainPlugin;
  mode: ViewMode = "dashboard";
  reviewState: ReviewTabState = defaultReviewTabState();
  thinkSubtab: ThinkSubtab = "S";
  pendingReviewsCollapsed: boolean = true;

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
    await this.render();
  }

  async onClose() {}

  async render() {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("second-brain-container");

    this.renderTopBar(container);

    if (this.mode === "dashboard") {
      await renderDashboard(
        container,
        this.plugin,
        (id) => this.handleQuickAction(id),
        (commandId, anchorOverride) =>
          this.forwardPendingToReview(commandId, anchorOverride),
        () => this.render(),
        this.pendingReviewsCollapsed,
        () => {
          this.pendingReviewsCollapsed = !this.pendingReviewsCollapsed;
          this.render();
        }
      );
    } else if (this.mode === "review") {
      renderReview(
        container,
        this.plugin,
        this.reviewState,
        {
          setState: (changes) => {
            Object.assign(this.reviewState, changes);
            this.render();
          },
          runSelection: (option, anchor) =>
            this.runReviewSelection(option, anchor),
          finish: () => this.finishReview(),
        },
        this
      );
    } else {
      renderThink(
        container,
        this.plugin,
        this.thinkSubtab,
        {
          setSubtab: (t) => {
            this.thinkSubtab = t;
            this.render();
          },
        },
        (commandId) => this.runCommandById(commandId)
      );
    }
  }

  private renderTopBar(container: HTMLElement) {
    const topbar = container.createDiv({ cls: "second-brain-topbar" });

    const tabs = topbar.createDiv({ cls: "second-brain-tabs" });
    for (const tab of [
      { mode: "dashboard" as ViewMode, label: "Dashboard" },
      { mode: "review" as ViewMode, label: "Review" },
      { mode: "think" as ViewMode, label: "Think" },
    ]) {
      const el = tabs.createEl("button", {
        text: tab.label,
        cls: `second-brain-tab${this.mode === tab.mode ? " active" : ""}`,
      });
      el.addEventListener("click", () => {
        if (this.mode !== tab.mode) {
          this.mode = tab.mode;
          this.render();
        }
      });
    }

    const right = topbar.createDiv({ cls: "second-brain-topbar-right" });

    const refreshBtn = right.createEl("button", {
      text: "↻",
      cls: "second-brain-iconbtn",
      attr: { title: "Refresh" },
    });
    refreshBtn.addEventListener("click", () => this.render());

    const settingsBtn = right.createEl("button", {
      text: "⚙",
      cls: "second-brain-iconbtn",
      attr: { title: "Settings" },
    });
    settingsBtn.addEventListener("click", () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const setting = (this.app as any).setting;
      if (setting) {
        setting.open();
        setting.openTabById?.(this.plugin.manifest.id);
      }
    });
  }

  private async handleQuickAction(id: "capture" | "todays-review") {
    if (id === "capture") {
      new CaptureModal(this.app, this.plugin).open();
      return;
    }
    await this.runCommandById("todays-review");
  }

  /**
   * Dashboard banner → Review tab. Switches mode, pre-fills the picker, then
   * auto-triggers the run so the AI summary renders inline ready for the
   * user's textbox.
   */
  private async forwardPendingToReview(
    commandId: string,
    anchorOverride?: string
  ) {
    const sel = mapCommandToReviewSelection(commandId, anchorOverride);
    if (!sel) {
      // Not a review command (shouldn't happen for banner) — fall back.
      return this.runCommandById(commandId, anchorOverride);
    }
    this.reviewState = {
      ...defaultReviewTabState(),
      selectionId: sel.selectionId,
      specificDate: sel.specificDate,
    };
    this.mode = "review";
    await this.render();
    const opt = SELECTION_OPTIONS.find((o) => o.id === sel.selectionId);
    if (opt) await this.runReviewSelection(opt, anchorOverride);
  }

  private async runCommandById(
    commandId: string,
    anchorOverride?: string,
    topicInput?: string
  ) {
    const cmd =
      getEffectiveCommands(this.plugin.settings).find(
        (c) => c.id === commandId
      ) ?? getBuiltInCommand(commandId);
    if (!cmd) {
      new Notice(`Command not found: ${commandId}`);
      return;
    }
    if (cmd.topicPromptText && !topicInput) {
      new TopicInputModal(this.app, cmd.topicPromptText, (topic) => {
        this.runCommandById(commandId, anchorOverride, topic);
      }).open();
      return;
    }
    const ghost = document.createElement("button");
    await this.runCommandHandler(ghost, cmd, anchorOverride, topicInput);
    if (this.mode === "dashboard") await this.render();
  }

  /**
   * Run a Review-tab selection and store the resulting file content in
   * `reviewState` so the markdown can be rendered inline (and the user can
   * write their own reflection below).
   */
  private async runReviewSelection(
    option: SelectionOption,
    anchorOverride?: string
  ): Promise<void> {
    const cmd =
      getEffectiveCommands(this.plugin.settings).find(
        (c) => c.id === option.commandId
      ) ?? getBuiltInCommand(option.commandId);
    if (!cmd) {
      new Notice(`Command not found: ${option.commandId}`);
      return;
    }
    try {
      const file = await runCommand(
        this.app,
        this.plugin.settings,
        cmd,
        anchorOverride
      );
      const content = await this.app.vault.read(file);
      // Strip an existing "## My review" section from inline display so we
      // don't double-render the user's prior reflection above the textarea.
      const display = content.replace(/\n## My review\b[\s\S]*$/m, "").trimEnd();
      this.reviewState.resultFile = file;
      this.reviewState.resultContent = display;
      this.reviewState.userReview = "";
      await this.render();
      new Notice(`${cmd.label}: wrote ${file.path}`);
    } catch (err) {
      new Notice(`${cmd.label} failed: ${(err as Error).message}`);
      console.error(err);
    }
  }

  private async finishReview(): Promise<void> {
    const { resultFile, userReview } = this.reviewState;
    if (!resultFile) {
      new Notice("No review to finish — run one first.");
      return;
    }
    if (!userReview.trim()) {
      new Notice("Write your reflection first, or just open the file directly.");
      return;
    }
    try {
      await appendUserReview(this.app, resultFile, userReview);
      await this.app.workspace.getLeaf(false).openFile(resultFile);
      new Notice(`Saved your review to ${resultFile.path}`);
      // Reset state so the picker is fresh next time.
      this.reviewState = defaultReviewTabState();
      await this.render();
    } catch (err) {
      new Notice(`Finish failed: ${(err as Error).message}`);
      console.error(err);
    }
  }

  async runCommandHandler(
    btn: HTMLButtonElement,
    command: Command,
    anchorOverride?: string,
    topicInput?: string
  ) {
    const originalLabel = btn.textContent;
    btn.setText("Working…");
    btn.setAttr("disabled", "true");
    try {
      const file = await runCommand(
        this.app,
        this.plugin.settings,
        command,
        anchorOverride,
        topicInput
      );
      new Notice(`${command.label}: wrote ${file.path}`);
      await this.app.workspace.getLeaf(false).openFile(file);
    } catch (err) {
      new Notice(`${command.label} failed: ${(err as Error).message}`);
      console.error(err);
    } finally {
      if (originalLabel !== null) btn.setText(originalLabel);
      btn.removeAttribute("disabled");
    }
  }
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
      const path = await appendCapture(this.app, this.plugin.settings, content);
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
