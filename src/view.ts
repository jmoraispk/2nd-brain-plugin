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
  resolveSelection,
  mapCommandToReviewState,
} from "./reviewTab";
import {
  renderThink,
  ThinkSubtab,
  ThinkTabState,
  defaultThinkTabState,
} from "./thinkTab";
import { TopicInputModal } from "./topicInputModal";

export const VIEW_TYPE_SECOND_BRAIN = "second-brain-view";

type ViewMode = "dashboard" | "review" | "think";

export class SecondBrainView extends ItemView {
  plugin: SecondBrainPlugin;
  mode: ViewMode = "dashboard";
  reviewState: ReviewTabState = defaultReviewTabState();
  thinkState: ThinkTabState = defaultThinkTabState();
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
          // No-render fast path: textarea writes flow here so focus stays put.
          setUserReview: (text) => {
            this.reviewState.userReview = text;
          },
          runSelection: (commandId, anchor) =>
            this.runReviewSelectionById(commandId, anchor),
          finish: () => this.finishReview(),
        },
        this
      );
    } else {
      renderThink(
        container,
        this.plugin,
        this.thinkState,
        {
          setSubtab: (t: ThinkSubtab) => {
            this.thinkState.subtab = t;
            this.render();
          },
          toggleExpanded: (commandId: string) => {
            if (this.thinkState.expandedCommandIds.has(commandId)) {
              this.thinkState.expandedCommandIds.delete(commandId);
            } else {
              this.thinkState.expandedCommandIds.add(commandId);
            }
            this.render();
          },
          onCommandSaved: () => this.render(),
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
   * Dashboard banner → Review tab. Switches mode, pre-fills the timeframe +
   * period picker, then auto-triggers the run so the AI summary renders
   * inline ready for the user's textbox.
   */
  private async forwardPendingToReview(
    commandId: string,
    anchorOverride?: string
  ) {
    const partial = mapCommandToReviewState(commandId, anchorOverride);
    if (!partial) {
      return this.runCommandById(commandId, anchorOverride);
    }
    this.reviewState = { ...defaultReviewTabState(), ...partial };
    this.mode = "review";
    await this.render();
    await this.runReviewSelectionById(commandId, anchorOverride);
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
   * Run a Review-tab selection by command id (the two-dropdown picker
   * resolves to a commandId + optional anchorOverride). Stores the result
   * file/content in reviewState so the inline markdown renders.
   */
  private async runReviewSelectionById(
    commandId: string,
    anchorOverride?: string
  ): Promise<void> {
    const cmd =
      getEffectiveCommands(this.plugin.settings).find(
        (c) => c.id === commandId
      ) ?? getBuiltInCommand(commandId);
    if (!cmd) {
      new Notice(`Command not found: ${commandId}`);
      return;
    }
    const progress = new Notice(`${cmd.label} running…`, 0);
    let dots = 0;
    const interval = window.setInterval(() => {
      dots = (dots + 1) % 4;
      progress.setMessage(`${cmd.label} running${".".repeat(dots)}`);
    }, 500);
    try {
      const file = await runCommand(
        this.app,
        this.plugin.settings,
        cmd,
        anchorOverride
      );
      const content = await this.app.vault.read(file);
      const display = content.replace(/\n## My review\b[\s\S]*$/m, "").trimEnd();
      this.reviewState.resultFile = file;
      this.reviewState.resultContent = display;
      this.reviewState.userReview = "";
      await this.render();
      new Notice(`${cmd.label}: wrote ${file.path}`);
    } catch (err) {
      new Notice(`${cmd.label} failed: ${(err as Error).message}`);
      console.error(err);
    } finally {
      window.clearInterval(interval);
      progress.hide();
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
    btn.setAttr("disabled", "true");

    // Sticky banner so the user has feedback for the whole call duration.
    const progress = new Notice(`${command.label} running…`, 0);

    // Animate dots in the button text so it's clearly "doing something."
    let dots = 0;
    btn.setText("Working");
    const interval = window.setInterval(() => {
      dots = (dots + 1) % 4;
      btn.setText("Working" + ".".repeat(dots));
    }, 500);

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
      window.clearInterval(interval);
      progress.hide();
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
