import { ItemView, WorkspaceLeaf, Notice, Modal, App } from "obsidian";
import SecondBrainPlugin from "../main";
import { appendCapture } from "./capture";
import { runCommand } from "./runner";
import { getEffectiveCommands, getBuiltInCommand } from "./commands";
import { Command } from "./types";
import { renderDashboard } from "./dashboard";
import { renderReview } from "./reviewTab";
import { renderThink } from "./thinkTab";

export const VIEW_TYPE_SECOND_BRAIN = "second-brain-view";

type ViewMode = "dashboard" | "review" | "think";

export class SecondBrainView extends ItemView {
  plugin: SecondBrainPlugin;
  mode: ViewMode = "dashboard";

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
          this.runCommandById(commandId, anchorOverride),
        () => this.render()
      );
    } else if (this.mode === "review") {
      renderReview(container, this.plugin, (commandId, anchorOverride) =>
        this.runCommandById(commandId, anchorOverride)
      );
    } else {
      renderThink(container, this.plugin, (commandId) =>
        this.runCommandById(commandId)
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

  private async runCommandById(commandId: string, anchorOverride?: string) {
    const cmd =
      getEffectiveCommands(this.plugin.settings).find(
        (c) => c.id === commandId
      ) ?? getBuiltInCommand(commandId);
    if (!cmd) {
      new Notice(`Command not found: ${commandId}`);
      return;
    }
    const ghost = document.createElement("button");
    await this.runCommandHandler(ghost, cmd, anchorOverride);
    if (this.mode === "dashboard") await this.render();
  }

  async runCommandHandler(
    btn: HTMLButtonElement,
    command: Command,
    anchorOverride?: string
  ) {
    const originalLabel = btn.textContent;
    btn.setText("Working…");
    btn.setAttr("disabled", "true");
    try {
      const file = await runCommand(
        this.app,
        this.plugin.settings,
        command,
        anchorOverride
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
