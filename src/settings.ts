import { App, PluginSettingTab, Setting } from "obsidian";
import SecondBrainPlugin from "../main";

export interface SecondBrainSettings {
  anthropicApiKey: string;
  model: string;
  logsFolder: string;
  dailyLogPathTemplate: string;
  reviewsPathTemplate: string;
  reviewPromptOverride: string;
}

export const DEFAULT_SETTINGS: SecondBrainSettings = {
  anthropicApiKey: "",
  model: "claude-opus-4-7",
  logsFolder: "Logs",
  dailyLogPathTemplate: "Logs/{YYYY-MM-DD}.md",
  reviewsPathTemplate: "_AI/Reviews/Daily/{YYYY-MM-DD}.md",
  reviewPromptOverride: "",
};

export class SecondBrainSettingTab extends PluginSettingTab {
  plugin: SecondBrainPlugin;

  constructor(app: App, plugin: SecondBrainPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Anthropic API key")
      .setDesc(
        "Required. Stored in this plugin's data.json — sent only to api.anthropic.com."
      )
      .addText((text) =>
        text
          .setPlaceholder("sk-ant-...")
          .setValue(this.plugin.settings.anthropicApiKey)
          .onChange(async (v) => {
            this.plugin.settings.anthropicApiKey = v.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl).setName("Model").addText((text) =>
      text.setValue(this.plugin.settings.model).onChange(async (v) => {
        this.plugin.settings.model = v.trim();
        await this.plugin.saveSettings();
      })
    );

    new Setting(containerEl)
      .setName("Logs folder")
      .setDesc(
        "Folder under which daily logs live. The plugin searches recursively for <today>.md inside this folder."
      )
      .addText((text) =>
        text.setValue(this.plugin.settings.logsFolder).onChange(async (v) => {
          this.plugin.settings.logsFolder = v.trim();
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Daily log path template")
      .setDesc(
        "Used when today's file doesn't exist yet. Placeholders: {YYYY-MM-DD}, {WEEK_NUM_2DIGIT}."
      )
      .addText((text) =>
        text
          .setValue(this.plugin.settings.dailyLogPathTemplate)
          .onChange(async (v) => {
            this.plugin.settings.dailyLogPathTemplate = v.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Reviews path template")
      .setDesc("Placeholder: {YYYY-MM-DD}.")
      .addText((text) =>
        text
          .setValue(this.plugin.settings.reviewsPathTemplate)
          .onChange(async (v) => {
            this.plugin.settings.reviewsPathTemplate = v.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Review prompt (advanced)")
      .setDesc(
        "Optional. Override the built-in review prompt. Leave empty to use the default."
      )
      .addTextArea((text) =>
        text
          .setValue(this.plugin.settings.reviewPromptOverride)
          .onChange(async (v) => {
            this.plugin.settings.reviewPromptOverride = v;
            await this.plugin.saveSettings();
          })
      );
  }
}
