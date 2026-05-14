import { App, PluginSettingTab, Setting, Notice } from "obsidian";
import SecondBrainPlugin from "../main";
import { Command } from "./types";
import {
  BUILT_IN_COMMANDS,
  getEffectiveCommands,
} from "./commands";
import { CommandEditModal } from "./commandEditModal";

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
  /** @deprecated as of v0.2.0 — migrated into customCommands. Kept for read-time migration only. */
  reviewPromptOverride?: string;
  /** User-edited or user-added commands. Built-in commands sharing an id are overridden by entries here. */
  customCommands: Command[];
}

export const DEFAULT_SETTINGS: SecondBrainSettings = {
  provider: "openai",
  anthropicApiKey: "",
  anthropicModel: "claude-opus-4-7",
  openaiApiKey: "",
  openaiModel: "gpt-4o",
  logsFolder: "Logs",
  dailyLogPathTemplate: "Logs/{ISO_YEAR}/Q{Q}/W{WW}/{YYYY-MM-DD}.md",
  reviewsPathTemplate: "_AI/Reviews/Daily/{YYYY-MM-DD}.md",
  customCommands: [],
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
      .setDesc(
        "Which LLM to use for commands. Keys are stored per-provider so you can switch without re-pasting."
      )
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
          text
            .setValue(this.plugin.settings.openaiModel)
            .onChange(async (v) => {
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
        "Used only when today's file doesn't exist yet. Placeholders: {YYYY-MM-DD}, {ISO_YEAR}, {YYYY}, {YYYY-MM}, {MM}, {DD}, {Q}, {WW} (zero-padded ISO week), {TOMORROW}, {YESTERDAY}."
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
      .setName("Daily review path template")
      .setDesc(
        "Where Today's Review writes. Placeholder: {YYYY-MM-DD}. Available to commands via {REVIEWS_TEMPLATE}."
      )
      .addText((text) =>
        text
          .setValue(this.plugin.settings.reviewsPathTemplate)
          .onChange(async (v) => {
            this.plugin.settings.reviewsPathTemplate = v.trim();
            await this.plugin.saveSettings();
          })
      );

    this.renderCommandsSection(containerEl);
  }

  private renderCommandsSection(containerEl: HTMLElement) {
    containerEl.createEl("h3", { text: "Commands" });
    containerEl.createEl("p", {
      text: "Buttons in the plugin view. Edit any built-in to change its prompt or output; reset reverts it. Add your own to extend the kit (provider-agnostic — works with whichever LLM you've configured).",
    });

    const effective = getEffectiveCommands(this.plugin.settings);
    for (const cmd of effective) {
      const isBuiltin = BUILT_IN_COMMANDS.some((b) => b.id === cmd.id);
      const isOverridden = this.plugin.settings.customCommands.some(
        (c) => c.id === cmd.id
      );

      const inputSummary = cmd.inputs.map((i) => i.kind).join(", ");
      const setting = new Setting(containerEl)
        .setName(cmd.label)
        .setDesc(`Input: ${inputSummary}  ·  Output: ${cmd.outputPath}`);

      setting.addButton((btn) =>
        btn.setButtonText("Edit").onClick(() => {
          new CommandEditModal(this.app, cmd, async (updated: Command) => {
            await this.upsertCustomCommand(updated);
            this.display();
          }).open();
        })
      );

      if (isBuiltin && isOverridden) {
        setting.addButton((btn) =>
          btn.setButtonText("Reset").onClick(async () => {
            await this.removeCustomCommand(cmd.id);
            new Notice(`Reset "${cmd.label}" to its built-in default.`);
            this.display();
          })
        );
      } else if (!isBuiltin) {
        setting.addButton((btn) =>
          btn
            .setButtonText("Delete")
            .setWarning()
            .onClick(async () => {
              await this.removeCustomCommand(cmd.id);
              new Notice(`Deleted "${cmd.label}".`);
              this.display();
            })
        );
      }
    }

    new Setting(containerEl).addButton((btn) =>
      btn
        .setButtonText("+ Add command")
        .setCta()
        .onClick(() => {
          const stub: Command = {
            id: `custom-${Date.now().toString(36)}`,
            label: "New command",
            inputs: [{ kind: "today-log" }],
            outputPath: "_AI/Notes/{YYYY-MM-DD}-custom.md",
            systemPrompt:
              "You will be given the input below. Summarize it faithfully in 5–10 bullets.",
          };
          new CommandEditModal(this.app, stub, async (created: Command) => {
            await this.upsertCustomCommand(created);
            this.display();
          }).open();
        })
    );
  }

  private async upsertCustomCommand(updated: Command) {
    const customs = this.plugin.settings.customCommands;
    const idx = customs.findIndex((c) => c.id === updated.id);
    if (idx >= 0) customs[idx] = updated;
    else customs.push(updated);
    await this.plugin.saveSettings();
  }

  private async removeCustomCommand(id: string) {
    this.plugin.settings.customCommands =
      this.plugin.settings.customCommands.filter((c) => c.id !== id);
    await this.plugin.saveSettings();
  }
}
