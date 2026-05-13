import { App, PluginSettingTab, Setting } from "obsidian";
import SecondBrainPlugin from "../main";

export type LLMProvider = "anthropic" | "openai";

export interface SecondBrainSettings {
  provider: LLMProvider;
  anthropicApiKey: string;
  anthropicModel: string;
  openaiApiKey: string;
  openaiModel: string;
  logsFolder: string;
  dailyLogPathTemplate: string;
  reviewsPathTemplate: string;
  reviewPromptOverride: string;
}

export const DEFAULT_SETTINGS: SecondBrainSettings = {
  provider: "openai",
  anthropicApiKey: "",
  anthropicModel: "claude-opus-4-7",
  openaiApiKey: "",
  openaiModel: "gpt-4o",
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

    containerEl.createEl("h3", { text: "LLM provider" });

    new Setting(containerEl)
      .setName("Provider")
      .setDesc("Which LLM to use for reviews. Keys are stored per-provider so you can switch without re-pasting.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("openai", "OpenAI (GPT)")
          .addOption("anthropic", "Anthropic (Claude)")
          .setValue(this.plugin.settings.provider)
          .onChange(async (v) => {
            this.plugin.settings.provider = v as LLMProvider;
            await this.plugin.saveSettings();
            this.display();
          })
      );

    if (this.plugin.settings.provider === "openai") {
      new Setting(containerEl)
        .setName("OpenAI API key")
        .setDesc("Sent only to api.openai.com.")
        .addText((text) =>
          text
            .setPlaceholder("sk-...")
            .setValue(this.plugin.settings.openaiApiKey)
            .onChange(async (v) => {
              this.plugin.settings.openaiApiKey = v.trim();
              await this.plugin.saveSettings();
            })
        );

      new Setting(containerEl)
        .setName("OpenAI model")
        .setDesc("Any chat-completions model id (e.g. gpt-4o, gpt-4o-mini, gpt-4-turbo).")
        .addText((text) =>
          text.setValue(this.plugin.settings.openaiModel).onChange(async (v) => {
            this.plugin.settings.openaiModel = v.trim();
            await this.plugin.saveSettings();
          })
        );
    } else if (this.plugin.settings.provider === "anthropic") {
      new Setting(containerEl)
        .setName("Anthropic API key")
        .setDesc("Sent only to api.anthropic.com.")
        .addText((text) =>
          text
            .setPlaceholder("sk-ant-...")
            .setValue(this.plugin.settings.anthropicApiKey)
            .onChange(async (v) => {
              this.plugin.settings.anthropicApiKey = v.trim();
              await this.plugin.saveSettings();
            })
        );

      new Setting(containerEl)
        .setName("Anthropic model")
        .setDesc("e.g. claude-opus-4-7, claude-sonnet-4-6, claude-haiku-4-5.")
        .addText((text) =>
          text
            .setValue(this.plugin.settings.anthropicModel)
            .onChange(async (v) => {
              this.plugin.settings.anthropicModel = v.trim();
              await this.plugin.saveSettings();
            })
        );
    }

    containerEl.createEl("h3", { text: "Paths" });

    new Setting(containerEl)
      .setName("Logs folder")
      .setDesc(
        "Folder under which daily logs live. Recursively searched for <today>.md."
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
        "Used only when today's file doesn't exist yet. Placeholders: {YYYY-MM-DD}, {WEEK_NUM_2DIGIT}."
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

    containerEl.createEl("h3", { text: "Advanced" });

    new Setting(containerEl)
      .setName("Review prompt override")
      .setDesc(
        "Optional. Replace the built-in review prompt. Leave empty to use the default."
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
