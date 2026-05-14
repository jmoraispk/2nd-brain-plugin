import SecondBrainPlugin from "../main";
import { BUILT_IN_COMMANDS } from "./commands";

/**
 * Render the Think tab: tools of thought (placeholder until v0.5.1) plus the
 * user's custom commands.
 *
 * "Custom" here means: a command in settings.customCommands whose id does NOT
 * match any built-in. Overrides of built-ins still appear in their semantic
 * tab (Review or Dashboard).
 */
export function renderThink(
  parent: HTMLElement,
  plugin: SecondBrainPlugin,
  onRunCommand: (commandId: string) => void
): void {
  const body = parent.createDiv({ cls: "second-brain-tab-body" });

  // Tools of thought — coming-soon placeholder.
  const tot = body.createDiv({ cls: "second-brain-section" });
  tot.createEl("h3", { text: "Tools of thought" });
  tot.createEl("div", {
    cls: "second-brain-muted",
    text: "Coming in v0.5.1: Contradict, Drift, Trace, Challenge. These need full-vault scanning plus a runtime topic input — building the plumbing first, then wiring the four built-ins.",
  });

  // Custom commands.
  const custom = body.createDiv({ cls: "second-brain-section" });
  custom.createEl("h3", { text: "Your custom commands" });

  const builtinIds = new Set(BUILT_IN_COMMANDS.map((c) => c.id));
  const customs = (plugin.settings.customCommands ?? []).filter(
    (c) => !builtinIds.has(c.id)
  );

  if (customs.length === 0) {
    custom.createEl("div", {
      cls: "second-brain-muted",
      text: "No custom commands yet. Add one in Settings → Second Brain → Commands.",
    });
    return;
  }

  for (const cmd of customs) {
    const btn = custom.createEl("button", {
      text: cmd.label,
      cls: "second-brain-button",
    });
    btn.addEventListener("click", () => onRunCommand(cmd.id));
  }
}
