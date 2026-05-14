import { Plugin, WorkspaceLeaf } from "obsidian";
import { SecondBrainView, VIEW_TYPE_SECOND_BRAIN } from "./src/view";
import {
  SecondBrainSettingTab,
  DEFAULT_SETTINGS,
  SecondBrainSettings,
} from "./src/settings";
import { BUILT_IN_COMMANDS } from "./src/commands";

export default class SecondBrainPlugin extends Plugin {
  settings: SecondBrainSettings;

  async onload() {
    await this.loadSettings();
    await this.migrateSettings();

    this.registerView(
      VIEW_TYPE_SECOND_BRAIN,
      (leaf) => new SecondBrainView(leaf, this)
    );

    this.addRibbonIcon("brain", "Open Second Brain", () => {
      this.activateView();
    });

    this.addCommand({
      id: "open-second-brain",
      name: "Open Second Brain",
      callback: () => this.activateView(),
    });

    this.addSettingTab(new SecondBrainSettingTab(this.app, this));
  }

  async onunload() {}

  async loadSettings() {
    this.settings = Object.assign(
      {},
      DEFAULT_SETTINGS,
      await this.loadData()
    );
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  /**
   * Idempotent forward-migrations of saved settings between plugin versions.
   * Runs once per load after the data file is read.
   */
  private async migrateSettings() {
    let changed = false;

    // v0.0.x flat default → v0.1.2 Year/Q/Week default.
    const FLAT_DAILY = "Logs/{YYYY-MM-DD}.md";
    const STRUCTURED_DAILY = "Logs/{ISO_YEAR}/Q{Q}/W{WW}/{YYYY-MM-DD}.md";
    if (this.settings.dailyLogPathTemplate === FLAT_DAILY) {
      this.settings.dailyLogPathTemplate = STRUCTURED_DAILY;
      changed = true;
    }

    // v0.1.x reviewPromptOverride → v0.2.0 customCommands entry for "todays-review".
    const legacyOverride = this.settings.reviewPromptOverride?.trim();
    if (legacyOverride) {
      const builtin = BUILT_IN_COMMANDS.find((c) => c.id === "todays-review");
      const customs = this.settings.customCommands ?? [];
      const existing = customs.find((c) => c.id === "todays-review");
      if (existing) {
        existing.systemPrompt = legacyOverride;
      } else if (builtin) {
        customs.push({
          ...JSON.parse(JSON.stringify(builtin)),
          systemPrompt: legacyOverride,
        });
      }
      this.settings.customCommands = customs;
      this.settings.reviewPromptOverride = "";
      changed = true;
    }

    // Ensure customCommands is at least an empty array (older data files may omit it).
    if (!Array.isArray(this.settings.customCommands)) {
      this.settings.customCommands = [];
      changed = true;
    }

    if (changed) await this.saveSettings();
  }

  async activateView() {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = null;
    const leaves = workspace.getLeavesOfType(VIEW_TYPE_SECOND_BRAIN);

    if (leaves.length > 0) {
      leaf = leaves[0];
    } else {
      leaf = workspace.getLeaf("tab");
      await leaf.setViewState({ type: VIEW_TYPE_SECOND_BRAIN, active: true });
    }

    workspace.revealLeaf(leaf);
  }
}
