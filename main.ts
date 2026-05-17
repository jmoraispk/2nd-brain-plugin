import { Plugin, WorkspaceLeaf } from "obsidian";
import { SecondBrainView, VIEW_TYPE_SECOND_BRAIN } from "./src/view";
import {
  SecondBrainSettingTab,
  DEFAULT_SETTINGS,
  SecondBrainSettings,
} from "./src/settings";
import { BUILT_IN_COMMANDS } from "./src/commands";
import { ErrorLog } from "./src/errorLog";

export default class SecondBrainPlugin extends Plugin {
  settings: SecondBrainSettings;
  errorLog = new ErrorLog();

  async onload() {
    await this.loadSettings();
    await this.migrateSettings();
    await this.bootstrapVaultFolders();

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

    // v0.5.1: AI-writable zone renamed from `_AI/` to `🤖 AI/`.
    // Migrate the reviews-path template and any custom commands.
    if (this.settings.reviewsPathTemplate.startsWith("_AI/")) {
      this.settings.reviewsPathTemplate =
        "🤖 AI/" + this.settings.reviewsPathTemplate.slice("_AI/".length);
      changed = true;
    }

    // v0.6.4: nest daily reviews under year/quarter/week to mirror the Logs
    // structure. Flat default → nested default.
    const FLAT_REVIEWS = "🤖 AI/Reviews/Daily/{YYYY-MM-DD}.md";
    const NESTED_REVIEWS =
      "🤖 AI/Reviews/Daily/{ISO_YEAR}/Q{Q}/W{WW}/{YYYY-MM-DD}.md";
    if (this.settings.reviewsPathTemplate === FLAT_REVIEWS) {
      this.settings.reviewsPathTemplate = NESTED_REVIEWS;
      changed = true;
    }

    // v0.6.6 / v0.6.7: human stream (Logs + Reviews) grouped under `🧑 Me/`.
    // (v0.6.6 used `0. 🧑 Me/`; v0.6.7 dropped the `0. ` prefix.) Migrate any
    // plugin paths that still point at the older locations.
    const ME_NEW = "🧑 Me/Logs";
    const candidates: Array<{ from: string; to: string }> = [
      { from: "Logs", to: ME_NEW },
      { from: "0. 🧑 Me/Logs", to: ME_NEW },
    ];
    for (const c of candidates) {
      if (this.settings.logsFolder === c.from) {
        this.settings.logsFolder = c.to;
        changed = true;
      }
      const prefixOld = `${c.from}/`;
      const prefixNew = `${c.to}/`;
      if (this.settings.dailyLogPathTemplate.startsWith(prefixOld)) {
        this.settings.dailyLogPathTemplate =
          prefixNew +
          this.settings.dailyLogPathTemplate.slice(prefixOld.length);
        changed = true;
      }
    }
    if (Array.isArray(this.settings.customCommands)) {
      for (const c of this.settings.customCommands) {
        if (typeof c.outputPath === "string" && c.outputPath.startsWith("_AI/")) {
          c.outputPath = "🤖 AI/" + c.outputPath.slice("_AI/".length);
          changed = true;
        }
      }
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

  /**
   * Idempotent bootstrap of the canonical vault structure (v0.8+).
   *
   * Wheel of Life — Health / Body·Mind·Soul, Relationships / Romance·Family·Friends,
   * Work / Mission·Money·Growth — created if missing. Each leaf gets a tiny
   * README so Obsidian shows it as a real folder. We never touch existing
   * files; we never delete; we only fill in the empty slots.
   *
   * Also creates the Habits and Goals folders (v0.8) and the People folder
   * under 🧑 Me/ (entities, not areas).
   */
  private async bootstrapVaultFolders() {
    const wheel: Record<string, string[]> = {
      "Health": ["Body", "Mind", "Soul"],
      "Relationships": ["Romance", "Family", "Friends"],
      "Work": ["Mission", "Money", "Growth"],
    };
    const areasRoot = "2. 🌳 Areas";

    for (const [macro, subs] of Object.entries(wheel)) {
      const macroPath = `${areasRoot}/${macro}`;
      await this.ensureFolder(macroPath);
      for (const sub of subs) {
        await this.ensureFolder(`${macroPath}/${sub}`);
      }
    }

    await this.ensureFolder("🧑 Me/Habits");
    await this.ensureFolder("🧑 Me/Goals");
    await this.ensureFolder("🧑 Me/People");
  }

  private async ensureFolder(path: string) {
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing) return;
    try {
      await this.app.vault.createFolder(path);
    } catch {
      // Race with Obsidian's vault scan; harmless.
    }
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
