import { ItemView, WorkspaceLeaf, Notice, Modal, App, TFile } from "obsidian";
import SecondBrainPlugin from "../main";
import { appendCapture } from "./capture";
import { runCommand, RunResult } from "./runner";
import { getEffectiveCommands, getBuiltInCommand } from "./commands";
import { stripSBFrontmatter } from "./reviewMeta";
import {
  anchorForInputKind as anchorForInputKindLocal,
  applyDatePlaceholders as applyDatePlaceholdersLocal,
  todayISO as todayISOLocal,
} from "./paths";
import { Command } from "./types";
import { renderDashboard } from "./dashboard";
import {
  renderReview,
  writeUserReview,
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
import { renderGoals, GoalsTabState, defaultGoalsTabState } from "./goalsTab";
import { TopicInputModal } from "./topicInputModal";
import { LogsModal } from "./errorLog";
import { todayISO } from "./paths";

export const VIEW_TYPE_SECOND_BRAIN = "second-brain-view";

type ViewMode = "dashboard" | "review" | "life" | "think";

export class SecondBrainView extends ItemView {
  plugin: SecondBrainPlugin;
  mode: ViewMode = "dashboard";
  reviewState: ReviewTabState = defaultReviewTabState();
  thinkState: ThinkTabState = defaultThinkTabState();
  lifeState: GoalsTabState = defaultGoalsTabState();
  pendingReviewsCollapsed: boolean = true;
  /** Date the Dashboard's day-header is showing (capped at yesterday ↔ today). */
  displayedDate: string = todayISO();

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
        this.displayedDate,
        (id) => this.handleQuickAction(id),
        (newDate) => {
          this.displayedDate = newDate;
          this.render();
        },
        (commandId, anchorOverride) =>
          this.forwardPendingToReview(commandId, anchorOverride),
        () => this.render(),
        this.pendingReviewsCollapsed,
        () => {
          this.pendingReviewsCollapsed = !this.pendingReviewsCollapsed;
          this.render();
        }
      );
    } else if (this.mode === "life") {
      await renderGoals(container, this.plugin, this.lifeState, {
        setSubtab: (t) => {
          this.lifeState.subtab = t;
          this.render();
        },
        onChanged: () => this.render(),
        runCommand: (id) => this.runCommandById(id),
      });
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
          fileExists: (path) =>
            !!this.app.vault.getAbstractFileByPath(path),
          targetPathForSelection: (commandId, anchorOverride) => {
            const cmd =
              getEffectiveCommands(this.plugin.settings).find(
                (c) => c.id === commandId
              ) ?? getBuiltInCommand(commandId);
            if (!cmd) return null;
            // Inline {REVIEWS_TEMPLATE} like the runner does, then apply
            // anchor-aware placeholders.
            const inlined = cmd.outputPath.replace(
              "{REVIEWS_TEMPLATE}",
              this.plugin.settings.reviewsPathTemplate
            );
            const anchor =
              anchorOverride ??
              (cmd.inputs.length > 0
                ? anchorForInputKindLocal(cmd.inputs[0].kind)
                : todayISOLocal());
            return applyDatePlaceholdersLocal(inlined, anchor);
          },
        },
        this
      );
    } else {
      await renderThink(
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
          setQsKind: (k) => {
            this.thinkState.qs.kind = k;
            this.thinkState.qs.draftAnswer = "";
            this.render();
          },
          // No-render write so the textarea keeps focus while typing.
          setQsDraftAnswer: (text) => {
            this.thinkState.qs.draftAnswer = text;
          },
          onQsAnswerSaved: () => this.render(),
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
      { mode: "life" as ViewMode, label: "Life" },
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

    // 🐛 button surfaces the in-plugin error log so users can copy the
    // actual error message when something fails (instead of seeing a
    // disappearing Notice). Badge shows count when > 0.
    const logCount = this.plugin.errorLog.count();
    const logsBtn = right.createEl("button", {
      text: logCount > 0 ? `🐛 ${logCount}` : "🐛",
      cls: `second-brain-iconbtn${logCount > 0 ? " second-brain-iconbtn-alert" : ""}`,
      attr: { title: "View error log" },
    });
    logsBtn.addEventListener("click", () =>
      new LogsModal(this.app, this.plugin.errorLog).open()
    );

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

  /**
   * Dashboard quick actions. Both target the *displayed* date so that capture
   * and review work for yesterday when the user clicked the back arrow.
   */
  private async handleQuickAction(id: "capture" | "this-review") {
    if (id === "capture") {
      new CaptureModal(
        this.app,
        this.plugin,
        this.displayedDate,
        () => this.render()
      ).open();
      return;
    }
    const today = todayISO();
    // Today → no anchor override (canonical "today" path); else override.
    const anchor =
      this.displayedDate === today ? undefined : this.displayedDate;
    await this.runCommandById("todays-review", anchor);
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
    if (cmd.topicPromptText && topicInput === undefined) {
      new TopicInputModal(this.app, cmd.label, cmd.topicPromptText, (topic) => {
        // Pass empty string (not undefined) so we don't re-prompt forever
        // when the user submits with nothing — Draft Habit allows blank.
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
      const result = await runCommand(
        this.app,
        this.plugin.settings,
        cmd,
        this.plugin.manifest.version,
        anchorOverride
      );
      const content = await this.app.vault.read(result.file);
      const display = stripSBFrontmatter(content)
        .replace(/\n## My review\b[\s\S]*$/m, "")
        .trimEnd();
      this.reviewState.resultFile = result.file;
      this.reviewState.resultContent = display;
      this.reviewState.userReview = "";
      await this.render();
      this.notifyRunResult(cmd.label, result);
    } catch (err) {
      this.plugin.errorLog.push(`run:${cmd.id}`, err);
      new Notice(
        `${cmd.label} failed: ${(err as Error).message}\nOpen 🐛 in the topbar for details.`,
        8000
      );
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
      // Derive the period anchor from the AI file path so we can stamp it
      // on the user-review file frontmatter.
      const anchor =
        this.reviewState.specificDate ||
        this.deriveAnchorFromAIPath(resultFile.path);
      const today = (() => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
          2,
          "0"
        )}-${String(d.getDate()).padStart(2, "0")}`;
      })();
      const userFile = await writeUserReview(
        this.app,
        resultFile,
        userReview,
        anchor,
        today
      );
      await this.app.workspace.getLeaf(false).openFile(userFile);
      new Notice(`Saved your review to ${userFile.path}`);
      this.reviewState = defaultReviewTabState();
      await this.render();
    } catch (err) {
      this.plugin.errorLog.push("finishReview", err);
      new Notice(
        `Finish failed: ${(err as Error).message}\nOpen 🐛 in the topbar for details.`,
        8000
      );
    }
  }

  /**
   * Pull a YYYY-MM-DD substring out of the AI review path as a best-effort
   * anchor. Used for stamping user-review frontmatter when state.specificDate
   * isn't set (e.g. weekly/monthly reviews where the anchor is implicit).
   */
  private deriveAnchorFromAIPath(p: string): string {
    const m = p.match(/(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
    return new Date().toISOString().slice(0, 10);
  }

  /**
   * Shape the user-facing Notice based on whether the runner short-circuited
   * (cache-hit: inputs + model unchanged since last run) or actually called the
   * LLM. Drift reasons (when re-running an existing file) are shown so the
   * user understands *why* the cache missed.
   */
  private notifyRunResult(label: string, result: RunResult) {
    if (result.kind === "cache-hit") {
      new Notice(
        `${label}: ✅ inputs unchanged since last run — opened existing review`,
        5000
      );
      return;
    }
    if (result.drift && result.drift.length > 0) {
      const reason = result.drift.slice(0, 3).join(", ");
      const more =
        result.drift.length > 3 ? ` (+${result.drift.length - 3} more)` : "";
      new Notice(
        `${label}: 🔄 regenerated — ${reason}${more}`,
        7000
      );
      return;
    }
    new Notice(`${label}: wrote ${result.file.path}`);
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
      const result = await runCommand(
        this.app,
        this.plugin.settings,
        command,
        this.plugin.manifest.version,
        anchorOverride,
        topicInput
      );
      this.notifyRunResult(command.label, result);
      await this.app.workspace.getLeaf(false).openFile(result.file);
    } catch (err) {
      this.plugin.errorLog.push(`run:${command.id}`, err);
      new Notice(
        `${command.label} failed: ${(err as Error).message}\nOpen 🐛 in the topbar for details.`,
        8000
      );
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
  targetDate?: string;
  onSaved?: () => void;
  textarea!: HTMLTextAreaElement;

  constructor(
    app: App,
    plugin: SecondBrainPlugin,
    targetDate?: string,
    onSaved?: () => void
  ) {
    super(app);
    this.plugin = plugin;
    this.targetDate = targetDate;
    this.onSaved = onSaved;
    // Class hook so CSS can anchor this modal near the top of the screen
    // (default Obsidian modals are vertically centered, which lands behind
    // the on-screen keyboard on phone).
    this.modalEl.addClass("second-brain-capture-modal");
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    // Title + close button on the same row. Hide Obsidian's default
    // standalone close button (handled via CSS).
    const header = contentEl.createDiv({ cls: "second-brain-capture-header" });
    const today = todayISO();
    const titleText =
      !this.targetDate || this.targetDate === today
        ? "Capture"
        : `Capture — ${this.targetDate}`;
    header.createEl("h2", {
      text: titleText,
      cls: "second-brain-capture-title",
    });
    const closeBtn = header.createEl("button", {
      text: "✕",
      cls: "second-brain-capture-close",
      attr: { title: "Close" },
    });
    closeBtn.addEventListener("click", () => this.close());

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
        content,
        this.targetDate
      );
      new Notice(`Captured → ${path}`);
      this.onSaved?.();
    } catch (err) {
      this.plugin.errorLog.push("capture", err);
      new Notice(
        `Capture failed: ${(err as Error).message}\nOpen 🐛 in the topbar for details.`,
        8000
      );
    }
    this.close();
  }

  onClose() {
    this.contentEl.empty();
  }
}
