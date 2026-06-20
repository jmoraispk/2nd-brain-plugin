import { App, PluginSettingTab, Setting, Notice } from "obsidian";
import SecondBrainPlugin from "../main";
import { Command } from "./types";
import { BUILT_IN_COMMANDS, getEffectiveCommands } from "./commands";
import { CommandEditModal } from "./commandEditModal";
import { testConnection } from "./llm";
import { LogsModal } from "./errorLog";
import {
  TASK_GROUPS,
  MODEL_CATALOG,
  costHint,
  defaultModel,
} from "./modelRoutes";

export type LLMProvider = "anthropic" | "openai";

/** Curated model lists per provider, ordered roughly quality-first.
 *  Prices as of May 2026 — flagship to cheap. */
const OPENAI_MODELS: Array<{ id: string; label: string }> = [
  { id: "gpt-5.5", label: "gpt-5.5 — flagship (April 2026) · $5/$30 per 1M, 1M ctx" },
  { id: "gpt-5.4", label: "gpt-5.4 — strong, ~50% cheaper than 5.5 · $2.50/$15 per 1M" },
  { id: "gpt-5", label: "gpt-5 — older flagship · $1.25/$10 per 1M" },
  { id: "gpt-5-mini", label: "gpt-5-mini — best value · $0.25/$2 per 1M" },
  { id: "gpt-4.1-nano", label: "gpt-4.1-nano — cheapest, simple tasks · $0.10/$0.40 per 1M" },
];

const ANTHROPIC_MODELS: Array<{ id: string; label: string }> = [
  { id: "claude-opus-4-7", label: "claude-opus-4-7 — flagship (April 2026) · $5/$25 per 1M, 1M ctx" },
  { id: "claude-sonnet-4-6", label: "claude-sonnet-4-6 — balanced default · $3/$15 per 1M, 1M ctx" },
  { id: "claude-haiku-4-5", label: "claude-haiku-4-5 — fast & cheap · $1/$5 per 1M, 200K ctx" },
];

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
  customCommands: Command[];
  /** v0.9.5 one-time flag: bumped the old gpt-5-mini default → gpt-5. */
  defaultModelBumped?: boolean;
  /** v0.15: Vapi voice — public key (client-safe) + assistant id. */
  vapiPublicKey?: string;
  vapiAssistantId?: string;
  /**
   * v0.9.6 per-task model routing. Key = task-group id; value = the model +
   * reasoning effort for that group. Unset groups fall back to the default
   * provider/model. `model: ""` also means "use default".
   */
  modelRoutes?: Record<string, { model: string; effort: "default" | "off" | "low" | "high" }>;
}

export const DEFAULT_SETTINGS: SecondBrainSettings = {
  provider: "openai",
  anthropicApiKey: "",
  anthropicModel: "claude-opus-4-7",
  openaiApiKey: "",
  openaiModel: "gpt-5",
  logsFolder: "🧑 Me/Logs",
  dailyLogPathTemplate: "🧑 Me/Logs/{ISO_YEAR}/Q{Q}/W{WW}/{YYYY-MM-DD}.md",
  reviewsPathTemplate: "🤖 AI/Reviews/Daily/{ISO_YEAR}/Q{Q}/W{WW}/{YYYY-MM-DD}.md",
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
    containerEl.addClass("second-brain-settings");

    this.collapsible(containerEl, "LLM provider", true, (body) =>
      this.renderProvider(body)
    );
    this.collapsible(containerEl, "Task routing", false, (body) =>
      this.renderTaskRouting(body)
    );
    this.collapsible(containerEl, "Paths", false, (body) =>
      this.renderPaths(body)
    );
    this.collapsible(containerEl, "Commands", false, (body) =>
      this.renderCommandsSection(body)
    );
    this.collapsible(containerEl, "Voice (Vapi)", false, (body) =>
      this.renderVoice(body)
    );
    this.collapsible(containerEl, "Troubleshooting", false, (body) =>
      this.renderTroubleshooting(body)
    );
    this.collapsible(containerEl, "Logs", false, (body) =>
      this.renderLogs(body)
    );
  }

  /**
   * Logs section — rarely needed. Lives at the bottom of Settings rather than
   * occupying a topbar slot. Surfaces the in-memory error log (cleared on
   * plugin reload) via a single button that opens the LogsModal.
   */
  private renderLogs(containerEl: HTMLElement) {
    const count = this.plugin.errorLog.count();
    containerEl.createEl("p", {
      cls: "second-brain-muted",
      text:
        count === 0
          ? "No errors logged this session. Errors that happen during command runs (review failed, capture failed, etc.) accumulate here so you can copy the actual message if you need to report a bug."
          : `${count} error${count === 1 ? "" : "s"} logged this session.`,
    });
    new Setting(containerEl)
      .setName("View error log")
      .setDesc("Opens a modal with the recent errors, expandable stacks, and Copy / Clear actions.")
      .addButton((btn) =>
        btn
          .setButtonText(count > 0 ? `Open (${count})` : "Open")
          .onClick(() => new LogsModal(this.app, this.plugin.errorLog).open())
      );
  }

  private collapsible(
    parent: HTMLElement,
    title: string,
    openByDefault: boolean,
    contentRenderer: (body: HTMLElement) => void
  ) {
    const det = parent.createEl("details", {
      cls: "second-brain-settings-section",
    });
    if (openByDefault) det.setAttribute("open", "");
    det.createEl("summary", {
      text: title,
      cls: "second-brain-settings-summary",
    });
    const body = det.createDiv({ cls: "second-brain-settings-body" });
    contentRenderer(body);
  }

  private renderProvider(containerEl: HTMLElement) {
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

      this.renderModelPicker(
        containerEl,
        "OpenAI model",
        "Recommendations balance quality vs cost. Mini tier is ~10× cheaper than flagship — fine for daily reviews; Tier-S Think commands benefit from the flagship.",
        OPENAI_MODELS,
        this.plugin.settings.openaiModel,
        async (v) => {
          this.plugin.settings.openaiModel = v;
          await this.plugin.saveSettings();
        }
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

      this.renderModelPicker(
        containerEl,
        "Anthropic model",
        "Recommendations balance quality vs cost. Haiku is fastest and cheapest; Opus is best at multi-step reasoning (Tier-S Think commands).",
        ANTHROPIC_MODELS,
        this.plugin.settings.anthropicModel,
        async (v) => {
          this.plugin.settings.anthropicModel = v;
          await this.plugin.saveSettings();
        }
      );
    }

    new Setting(containerEl)
      .setName("Test connection")
      .setDesc(
        "Makes a 5-token call to your provider to verify key, model id, and quota. Reports the provider's actual error verbatim on failure."
      )
      .addButton((btn) =>
        btn
          .setButtonText("Test")
          .setCta()
          .onClick(async () => {
            btn.setButtonText("Testing…").setDisabled(true);
            const result = await testConnection(this.plugin.settings);
            btn.setButtonText("Test").setDisabled(false);
            new Notice(
              `${result.ok ? "✅" : "❌"} ${result.message}`,
              result.ok ? 5000 : 10000
            );
          })
      );
  }

  /**
   * Curated dropdown + optional text input for "Custom...". If the saved
   * value matches a preset, only the dropdown shows. If it doesn't, the
   * dropdown sits on "Custom..." and a text field appears below preserving
   * whatever the user typed.
   */
  private renderModelPicker(
    containerEl: HTMLElement,
    name: string,
    desc: string,
    presets: Array<{ id: string; label: string }>,
    currentValue: string,
    onChange: (v: string) => Promise<void> | void
  ) {
    const isPresetMatch = presets.some((m) => m.id === currentValue);
    const CUSTOM = "__custom__";

    new Setting(containerEl)
      .setName(name)
      .setDesc(desc)
      .addDropdown((d) => {
        for (const m of presets) d.addOption(m.id, m.label);
        d.addOption(CUSTOM, "Custom — type a model id below");
        d.setValue(isPresetMatch ? currentValue : CUSTOM);
        d.onChange(async (v) => {
          if (v === CUSTOM) {
            // Keep the current value as a starting point in the text field;
            // re-rendering reveals the text input.
            this.display();
            return;
          }
          await onChange(v);
          this.display();
        });
      });

    if (!isPresetMatch) {
      new Setting(containerEl)
        .setName(`${name} (custom)`)
        .setDesc("Any model id supported by the provider's chat API.")
        .addText((t) =>
          t
            .setPlaceholder("e.g. gpt-4.1-mini, o1-mini")
            .setValue(currentValue)
            .onChange(async (v) => {
              await onChange(v.trim());
            })
        );
    }
  }

  /**
   * Per-task model routing (v0.9.6). One row per task-group: a model dropdown
   * (Default + the catalog) and a thinking-effort dropdown, with a live
   * cost-per-run hint. "Default" leaves the group on the provider/model in the
   * LLM provider section, so the zero-config case is "everything on default".
   */
  private renderTaskRouting(containerEl: HTMLElement) {
    const def = defaultModel(this.plugin.settings);
    containerEl.createEl("p", {
      cls: "second-brain-muted",
      text: `Every task runs on your default model (${def}) unless you route it elsewhere here. Set the deep "Think" tasks to a stronger model, keep the daily loop cheap — the cost-per-run hint shows the tradeoff.`,
    });

    const routes = this.plugin.settings.modelRoutes ?? {};

    for (const group of TASK_GROUPS) {
      const current = routes[group.id];
      const chosenModel = current?.model || "";
      const chosenEffort = current?.effort ?? "default";

      const setting = new Setting(containerEl)
        .setName(group.label)
        .setDesc(group.desc);

      // Model dropdown.
      setting.addDropdown((d) => {
        d.addOption("", `Default (${def})`);
        for (const m of MODEL_CATALOG) d.addOption(m.id, m.label);
        d.setValue(chosenModel);
        d.onChange(async (v) => {
          await this.setRoute(group.id, { model: v });
          this.display();
        });
      });

      // Effort dropdown.
      setting.addDropdown((d) => {
        d.addOption("default", "Think: default");
        d.addOption("off", "Think: off");
        d.addOption("low", "Think: low");
        d.addOption("high", "Think: high");
        d.setValue(chosenEffort);
        d.onChange(async (v) => {
          await this.setRoute(group.id, {
            effort: v as "default" | "off" | "low" | "high",
          });
        });
      });

      // Cost hint for the effective model.
      const effModel = chosenModel || def;
      const hint = costHint(effModel, group);
      if (hint) {
        setting.descEl.createEl("div", {
          cls: "second-brain-muted",
          text: `${effModel} · ${hint}`,
        });
      }
    }

    new Setting(containerEl)
      .setName("Reset routing")
      .setDesc("Clear all per-task assignments — everything back to the default model.")
      .addButton((btn) =>
        btn.setButtonText("Reset").onClick(async () => {
          this.plugin.settings.modelRoutes = {};
          await this.plugin.saveSettings();
          new Notice("Task routing reset to default model.");
          this.display();
        })
      );
  }

  private async setRoute(
    groupId: string,
    patch: { model?: string; effort?: "default" | "off" | "low" | "high" }
  ) {
    const routes = { ...(this.plugin.settings.modelRoutes ?? {}) };
    const existing = routes[groupId] ?? { model: "", effort: "default" as const };
    routes[groupId] = { ...existing, ...patch };
    // Drop the entry entirely if it's back to the default (no model, default effort).
    if (!routes[groupId].model && routes[groupId].effort === "default") {
      delete routes[groupId];
    }
    this.plugin.settings.modelRoutes = routes;
    await this.plugin.saveSettings();
  }

  private renderPaths(containerEl: HTMLElement) {
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
        "Where Capture writes today's file. Placeholders: {YYYY-MM-DD}, {ISO_YEAR}, {YYYY}, {YYYY-MM}, {MM}, {DD}, {Q}, {WW}, {TOMORROW}, {YESTERDAY}."
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
  }

  private renderCommandsSection(containerEl: HTMLElement) {
    containerEl.createEl("p", {
      cls: "second-brain-muted",
      text: "Buttons in the plugin view. Edit any built-in to change its prompt or output; reset reverts it. Add your own to extend the kit (provider-agnostic).",
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
            outputPath: "🤖 AI/Notes/{YYYY-MM-DD}-custom.md",
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

  private renderVoice(containerEl: HTMLElement) {
    containerEl.createEl("p", {
      cls: "second-brain-muted",
      text: "Voice interview via Vapi (vapi.ai). The public key only starts calls. Configure the agent's persona in the Vapi dashboard — add the interviewer prompt and a {{dayLog}} placeholder so the plugin can inject your day. Desktop-first; mic on mobile may not work.",
    });

    new Setting(containerEl)
      .setName("Vapi public key")
      .setDesc("Client-safe public key from vapi.ai.")
      .addText((t) =>
        t
          .setPlaceholder("xxxxxxxx-xxxx-…")
          .setValue(this.plugin.settings.vapiPublicKey ?? "")
          .onChange(async (v) => {
            this.plugin.settings.vapiPublicKey = v.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Vapi assistant id")
      .setDesc("The assistant to call (configure its prompt + voice in the Vapi dashboard).")
      .addText((t) =>
        t
          .setPlaceholder("xxxxxxxx-xxxx-…")
          .setValue(this.plugin.settings.vapiAssistantId ?? "")
          .onChange(async (v) => {
            this.plugin.settings.vapiAssistantId = v.trim();
            await this.plugin.saveSettings();
          })
      );
  }

  private renderTroubleshooting(containerEl: HTMLElement) {
    containerEl.createEl("p", {
      cls: "second-brain-muted",
      text: "Common errors and what to do. Use Test Connection in the LLM provider section first — it reports the provider's actual error verbatim.",
    });

    const items: Array<{ title: string; body: string }> = [
      {
        title: "insufficient_quota / 'You exceeded your current quota'",
        body: "You're out of OpenAI credits or your account has no billing set up. Add credits at platform.openai.com/account/billing. The plugin can't help past this — it's an account-level issue.",
      },
      {
        title: "invalid_api_key / 'Incorrect API key provided'",
        body: "Your key is wrong, expired, or revoked. Generate a fresh one at platform.openai.com/api-keys (or console.anthropic.com), then paste it above. Never paste keys into chat with the AI — they end up in logs.",
      },
      {
        title: "model_not_found / 'The model does not exist'",
        body: "The model id in the Model field isn't available to your account. Try 'gpt-4o' or 'gpt-4o-mini' (OpenAI) or 'claude-opus-4-7' / 'claude-sonnet-4-6' / 'claude-haiku-4-5' (Anthropic).",
      },
      {
        title: "rate_limit_exceeded",
        body: "Too many requests too fast OR a single request too large. Tier-S Think commands (Contradict, Drift, Trace, Challenge) send every daily log in your vault — that's a lot of tokens. Wait a minute and retry, or use a smaller-input command like Today's Review.",
      },
      {
        title: "Capture appears at top-level Logs/ instead of in Week folder",
        body: "Fixed in v0.5.2. The next capture you make will rename any legacy flat file into the structured path. If you still see flat files after capturing today, check Daily log path template above — it should be 'Logs/{ISO_YEAR}/Q{Q}/W{WW}/{YYYY-MM-DD}.md'.",
      },
      {
        title: "Review file not appearing",
        body: "Check Daily review path template above. Default is '🤖 AI/Reviews/Daily/{YYYY-MM-DD}.md'. If the path includes the old '_AI/' (without the robot emoji) the plugin auto-migrates on load — restart the plugin if needed.",
      },
      {
        title: "Tier-S Think command times out or returns 'No daily logs found'",
        body: "These commands need real vault depth. With fewer than ~3 months of daily logs, the signal is thin. Either capture more first, or use the period-bounded reviews (Last Week's / Last Month's) until you have more density.",
      },
    ];

    for (const it of items) {
      const det = containerEl.createEl("details", {
        cls: "second-brain-troubleshoot-item",
      });
      det.createEl("summary", { text: it.title });
      det.createEl("div", { text: it.body, cls: "second-brain-muted" });
    }
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
