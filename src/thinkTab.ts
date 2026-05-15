import { Notice } from "obsidian";
import SecondBrainPlugin from "../main";
import { BUILT_IN_COMMANDS, getEffectiveCommands } from "./commands";
import { Command } from "./types";
import { CommandEditModal } from "./commandEditModal";

export type ThinkSubtab = "S" | "A" | "B" | "Custom";

export interface ThinkTabState {
  subtab: ThinkSubtab;
  /** Command ids whose prompt-preview pane is currently expanded. */
  expandedCommandIds: Set<string>;
}

export function defaultThinkTabState(): ThinkTabState {
  return { subtab: "S", expandedCommandIds: new Set() };
}

export interface ThinkTabCallbacks {
  setSubtab: (subtab: ThinkSubtab) => void;
  toggleExpanded: (commandId: string) => void;
  onCommandSaved: () => void;
}

/**
 * Render the Think tab. Four sub-tabs (Tier S / A / B / Custom) at the top;
 * thin one-row commands below. Clicking a row toggles a prompt-preview pane
 * underneath with an Edit button. Run button has its own click handler that
 * doesn't toggle the expansion.
 */
export function renderThink(
  parent: HTMLElement,
  plugin: SecondBrainPlugin,
  state: ThinkTabState,
  cb: ThinkTabCallbacks,
  onRunCommand: (commandId: string) => void
): void {
  const body = parent.createDiv({ cls: "second-brain-tab-body" });

  // Sub-tab bar — centered, "Tier X" labels.
  const subtabs = body.createDiv({ cls: "second-brain-subtabs" });
  const tabs: Array<{ id: ThinkSubtab; label: string; title: string }> = [
    { id: "S", label: "Tier S", title: "Real tools of thought" },
    { id: "A", label: "Tier A", title: "Useful synthesizers" },
    { id: "B", label: "Tier B", title: "Workflow utilities" },
    { id: "Custom", label: "Custom", title: "Your own commands" },
  ];
  for (const t of tabs) {
    const el = subtabs.createEl("button", {
      text: t.label,
      cls: `second-brain-subtab${state.subtab === t.id ? " active" : ""}`,
      attr: { title: t.title },
    });
    el.addEventListener("click", () => cb.setSubtab(t.id));
  }

  body.createEl("div", {
    cls: "second-brain-subtab-caption",
    text: subtabCaption(state.subtab),
  });

  const effective = getEffectiveCommands(plugin.settings);
  const builtinIds = new Set(BUILT_IN_COMMANDS.map((c) => c.id));

  // Filter by tab.
  const filtered = effective.filter((c) => {
    if (state.subtab === "Custom") {
      // Custom = ids NOT in built-ins.
      return !builtinIds.has(c.id);
    }
    return c.tier === state.subtab;
  });

  // Add-command button at the top of the Custom tab.
  if (state.subtab === "Custom") {
    const addBtn = body.createEl("button", {
      text: "+ Add command",
      cls: "second-brain-button second-brain-button-primary",
    });
    addBtn.addEventListener("click", () => {
      const stub: Command = {
        id: `custom-${Date.now().toString(36)}`,
        label: "New command",
        inputs: [{ kind: "today-log" }],
        outputPath: "🤖 AI/Thinking/Custom/{YYYY-MM-DD}.md",
        systemPrompt:
          "You will be given the input below. Summarize it faithfully in 5–10 bullets.",
      };
      new CommandEditModal(plugin.app, stub, async (created: Command) => {
        plugin.settings.customCommands.push(created);
        await plugin.saveSettings();
        cb.onCommandSaved();
      }).open();
    });
  }

  if (filtered.length === 0) {
    body.createEl("div", {
      cls: "second-brain-muted",
      text:
        state.subtab === "Custom"
          ? "No custom commands yet. Use + Add command above."
          : `No commands in this tier yet.`,
    });
    return;
  }

  const list = body.createDiv({ cls: "second-brain-row-list" });
  for (const cmd of filtered) {
    renderRow(
      list,
      plugin,
      cmd,
      state.expandedCommandIds.has(cmd.id),
      cb,
      onRunCommand
    );
  }
}

function subtabCaption(t: ThinkSubtab): string {
  switch (t) {
    case "S":
      return "Real tools of thought. Surface things you can't easily see yourself.";
    case "A":
      return "Useful synthesizers. Surfacing more than revelation.";
    case "B":
      return "Workflow utilities. Cheap, fast, no deep reflection.";
    case "Custom":
      return "Your own commands. Each one is a prompt + an input + an output path.";
  }
}

function renderRow(
  parent: HTMLElement,
  plugin: SecondBrainPlugin,
  cmd: Command,
  expanded: boolean,
  cb: ThinkTabCallbacks,
  onRunCommand: (commandId: string) => void
) {
  const wrapper = parent.createDiv({
    cls: `second-brain-row-wrapper${expanded ? " expanded" : ""}`,
  });

  const row = wrapper.createDiv({ cls: "second-brain-row second-brain-row-clickable" });
  row.addEventListener("click", () => cb.toggleExpanded(cmd.id));

  const isBuiltin = BUILT_IN_COMMANDS.some((b) => b.id === cmd.id);
  const hasOverride = plugin.settings.customCommands.some((c) => c.id === cmd.id);

  const content = row.createDiv({ cls: "second-brain-row-content" });
  const titleEl = content.createDiv({ cls: "second-brain-row-title" });
  titleEl.createSpan({ text: `${expanded ? "▼" : "▶"} `, cls: "second-brain-row-arrow" });
  titleEl.appendText(cmd.label);
  if (cmd.topicPromptText) {
    titleEl.createEl("span", {
      text: " · asks for topic",
      cls: "second-brain-row-hint",
    });
  }
  if (isBuiltin && hasOverride) {
    titleEl.createEl("span", {
      text: " ✏ edited",
      cls: "second-brain-row-badge",
    });
  }
  if (cmd.description) {
    content.createEl("div", {
      cls: "second-brain-row-desc",
      text: cmd.description,
    });
  }

  const runBtn = row.createEl("button", {
    text: "Run",
    cls: "second-brain-row-run",
  });
  runBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    onRunCommand(cmd.id);
  });

  if (expanded) {
    const previewWrap = wrapper.createDiv({ cls: "second-brain-row-preview" });

    const meta = previewWrap.createDiv({ cls: "second-brain-row-meta" });
    const inputs = cmd.inputs.map((i) => i.kind).join(", ");
    meta.createEl("div", {
      text: `Input: ${inputs}`,
      cls: "second-brain-row-meta-line",
    });
    meta.createEl("div", {
      text: `Output: ${cmd.outputPath}`,
      cls: "second-brain-row-meta-line",
    });

    previewWrap.createEl("div", {
      text: "Prompt",
      cls: "second-brain-row-prompt-label",
    });
    previewWrap.createEl("pre", {
      text: cmd.systemPrompt,
      cls: "second-brain-row-prompt",
    });

    if (isBuiltin) {
      previewWrap.createEl("div", {
        cls: "second-brain-row-meta-line",
        text: hasOverride
          ? "ⓘ You're working with your edited copy. Reset to revert to the shipped default."
          : "ⓘ Editing creates a custom copy. The built-in default stays untouched and is updated by plugin releases.",
      });
    }

    const actions = previewWrap.createDiv({ cls: "second-brain-row-preview-actions" });
    const editBtn = actions.createEl("button", {
      text: hasOverride ? "Edit my copy" : "Edit (creates a copy)",
      cls: "second-brain-row-edit",
    });
    editBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      new CommandEditModal(plugin.app, cmd, async (updated: Command) => {
        const customs = plugin.settings.customCommands;
        const idx = customs.findIndex((c) => c.id === updated.id);
        if (idx >= 0) customs[idx] = updated;
        else customs.push(updated);
        await plugin.saveSettings();
        new Notice(`Saved ${updated.label}.`);
        cb.onCommandSaved();
      }).open();
    });

    if (isBuiltin && hasOverride) {
      const resetBtn = actions.createEl("button", {
        text: "Reset to default",
        cls: "second-brain-row-edit",
      });
      resetBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        plugin.settings.customCommands = plugin.settings.customCommands.filter(
          (c) => c.id !== cmd.id
        );
        await plugin.saveSettings();
        new Notice(`Reset ${cmd.label} to the shipped default.`);
        cb.onCommandSaved();
      });
    }
  }
}
