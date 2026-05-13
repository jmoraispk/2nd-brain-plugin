import { Plugin, WorkspaceLeaf } from "obsidian";
import { SecondBrainView, VIEW_TYPE_SECOND_BRAIN } from "./src/view";
import {
  SecondBrainSettingTab,
  DEFAULT_SETTINGS,
  SecondBrainSettings,
} from "./src/settings";

export default class SecondBrainPlugin extends Plugin {
  settings: SecondBrainSettings;

  async onload() {
    await this.loadSettings();

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
