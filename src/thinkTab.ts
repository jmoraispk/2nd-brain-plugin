import SecondBrainPlugin from "../main";
import { BUILT_IN_COMMANDS, getEffectiveCommands } from "./commands";
import { Command } from "./types";

/**
 * Render the Think tab as a list of cards. Each card has a tier badge, the
 * command label, a one-line description, and a Run button. Tier-S thinking
 * commands appear first; tier-A would be next (none yet); user custom
 * commands fall under "Your commands" at the bottom.
 */
export function renderThink(
  parent: HTMLElement,
  plugin: SecondBrainPlugin,
  onRunCommand: (commandId: string) => void
): void {
  const body = parent.createDiv({ cls: "second-brain-tab-body" });

  const effective = getEffectiveCommands(plugin.settings);
  const tiered = effective.filter((c) => c.tier);

  // Group by tier (S first).
  const tiers: Array<"S" | "A" | "B" | "C"> = ["S", "A", "B", "C"];
  for (const t of tiers) {
    const group = tiered.filter((c) => c.tier === t);
    if (group.length === 0) continue;
    const sec = body.createDiv({ cls: "second-brain-section" });
    sec.createEl("h3", { text: tierSectionTitle(t) });
    for (const cmd of group) renderCommandCard(sec, cmd, onRunCommand);
  }

  // Custom commands without a tier (truly user-added).
  const builtinIds = new Set(BUILT_IN_COMMANDS.map((c) => c.id));
  const customs = (plugin.settings.customCommands ?? []).filter(
    (c) => !builtinIds.has(c.id) && !c.tier
  );
  const customSec = body.createDiv({ cls: "second-brain-section" });
  customSec.createEl("h3", { text: "Your custom commands" });
  if (customs.length === 0) {
    customSec.createEl("div", {
      cls: "second-brain-muted",
      text: "No custom commands yet. Add one in Settings → Second Brain → Commands.",
    });
  } else {
    for (const cmd of customs) renderCommandCard(customSec, cmd, onRunCommand);
  }
}

function tierSectionTitle(t: "S" | "A" | "B" | "C"): string {
  switch (t) {
    case "S":
      return "Tier S — real tools of thought";
    case "A":
      return "Tier A — useful synthesizers";
    case "B":
      return "Tier B — workflow";
    case "C":
      return "Tier C — niche";
  }
}

function renderCommandCard(
  parent: HTMLElement,
  cmd: Command,
  onRunCommand: (commandId: string) => void
) {
  const card = parent.createDiv({ cls: "second-brain-card" });

  const header = card.createDiv({ cls: "second-brain-card-header" });
  if (cmd.tier) {
    header.createEl("span", {
      text: cmd.tier,
      cls: `second-brain-tier-badge tier-${cmd.tier}`,
    });
  }
  header.createEl("span", {
    text: cmd.label,
    cls: "second-brain-card-title",
  });

  if (cmd.description) {
    card.createEl("div", {
      text: cmd.description,
      cls: "second-brain-card-desc",
    });
  }

  if (cmd.topicPromptText) {
    card.createEl("div", {
      text: `Asks for a topic before running.`,
      cls: "second-brain-card-hint",
    });
  }

  const btn = card.createEl("button", {
    text: "Run",
    cls: "second-brain-card-run",
  });
  btn.addEventListener("click", () => onRunCommand(cmd.id));
}
