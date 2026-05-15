import SecondBrainPlugin from "../main";
import { BUILT_IN_COMMANDS, getEffectiveCommands } from "./commands";
import { Command } from "./types";

export type ThinkSubtab = "S" | "A" | "B";

export interface ThinkTabCallbacks {
  setSubtab: (subtab: ThinkSubtab) => void;
}

/**
 * Render the Think tab. Sub-tabs for tier S / A / B at the top; thin one-row
 * cards below for the commands in the active tier. Run button is right-aligned
 * so commands stay short vertically.
 *
 * Custom commands without an explicit tier fall into B (the default
 * "personal" bucket) until tier-picking ships in the Add-command modal.
 */
export function renderThink(
  parent: HTMLElement,
  plugin: SecondBrainPlugin,
  subtab: ThinkSubtab,
  cb: ThinkTabCallbacks,
  onRunCommand: (commandId: string) => void
): void {
  const body = parent.createDiv({ cls: "second-brain-tab-body" });

  // Sub-tab bar.
  const subtabs = body.createDiv({ cls: "second-brain-subtabs" });
  for (const t of ["S", "A", "B"] as ThinkSubtab[]) {
    const el = subtabs.createEl("button", {
      text: t,
      cls: `second-brain-subtab${subtab === t ? " active" : ""}`,
      attr: { title: subtabTitle(t) },
    });
    el.addEventListener("click", () => cb.setSubtab(t));
  }

  // Header (small) describing the active tier.
  body.createEl("div", {
    cls: "second-brain-subtab-caption",
    text: subtabCaption(subtab),
  });

  // Filter commands to the active sub-tab.
  const effective = getEffectiveCommands(plugin.settings);
  const builtinIds = new Set(BUILT_IN_COMMANDS.map((c) => c.id));
  const inTier = effective.filter((c) => {
    if (subtab === "B") {
      // Tier B = explicit tier=B OR untiered custom commands.
      if (c.tier === "B") return true;
      const isCustom = !builtinIds.has(c.id);
      return isCustom && !c.tier;
    }
    return c.tier === subtab;
  });

  if (inTier.length === 0) {
    body.createEl("div", {
      cls: "second-brain-muted",
      text:
        subtab === "S"
          ? "No tier-S commands here yet."
          : subtab === "A"
          ? "No tier-A commands here yet."
          : "No tier-B commands yet. Add a custom command in Settings → Second Brain → Commands; it'll land here.",
    });
    return;
  }

  // Tight row list — overrides the parent .second-brain-tab-body 24px gap.
  const list = body.createDiv({ cls: "second-brain-row-list" });
  for (const cmd of inTier) renderThinRow(list, cmd, onRunCommand);
}

function subtabTitle(t: ThinkSubtab): string {
  switch (t) {
    case "S":
      return "Tier S — real tools of thought";
    case "A":
      return "Tier A — useful synthesizers";
    case "B":
      return "Tier B — personal / custom";
  }
}

function subtabCaption(t: ThinkSubtab): string {
  switch (t) {
    case "S":
      return "Real tools of thought. Surface things you can't easily see yourself.";
    case "A":
      return "Useful synthesizers. Surfacing more than revelation.";
    case "B":
      return "Personal commands and user-added customs.";
  }
}

function renderThinRow(
  parent: HTMLElement,
  cmd: Command,
  onRunCommand: (commandId: string) => void
) {
  const row = parent.createDiv({ cls: "second-brain-row" });

  const content = row.createDiv({ cls: "second-brain-row-content" });
  const title = content.createDiv({ cls: "second-brain-row-title" });
  title.appendText(cmd.label);
  if (cmd.topicPromptText) {
    title.createEl("span", {
      text: " · asks for topic",
      cls: "second-brain-row-hint",
    });
  }
  if (cmd.description) {
    content.createEl("div", {
      cls: "second-brain-row-desc",
      text: cmd.description,
    });
  }

  const btn = row.createEl("button", {
    text: "Run",
    cls: "second-brain-row-run",
  });
  btn.addEventListener("click", () => onRunCommand(cmd.id));
}
