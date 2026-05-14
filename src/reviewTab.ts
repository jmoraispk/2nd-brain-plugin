import { App, Modal, Notice, TFile, TFolder } from "obsidian";
import SecondBrainPlugin from "../main";
import { getEffectiveCommands } from "./commands";

/**
 * Render the Review tab: every review-flavoured command in one place, plus a
 * date picker for reviewing arbitrary past days, plus the recent-reviews list
 * that used to live on the Dashboard.
 */
export function renderReview(
  parent: HTMLElement,
  plugin: SecondBrainPlugin,
  onRunCommand: (commandId: string, anchorOverride?: string) => void
): void {
  const body = parent.createDiv({ cls: "second-brain-tab-body" });

  renderSection(body, "Daily", plugin, onRunCommand, [
    "todays-review",
    "plan-tomorrow",
  ]);

  renderSection(body, "Periodic", plugin, onRunCommand, [
    "weeks-review",
    "review-last-week",
    "review-last-month",
    "review-last-quarter",
    "review-last-year",
  ]);

  renderSpecificDaySection(body, plugin, onRunCommand);

  renderRecentReviewsSection(body, plugin);
}

function renderSection(
  body: HTMLElement,
  title: string,
  plugin: SecondBrainPlugin,
  onRunCommand: (commandId: string, anchorOverride?: string) => void,
  commandIds: string[]
) {
  const sec = body.createDiv({ cls: "second-brain-section" });
  sec.createEl("h3", { text: title });
  const effective = getEffectiveCommands(plugin.settings);
  for (const id of commandIds) {
    const cmd = effective.find((c) => c.id === id);
    if (!cmd) continue;
    const btn = sec.createEl("button", {
      text: cmd.label,
      cls: "second-brain-button",
    });
    btn.addEventListener("click", () => onRunCommand(id));
  }
}

function renderSpecificDaySection(
  body: HTMLElement,
  plugin: SecondBrainPlugin,
  onRunCommand: (commandId: string, anchorOverride?: string) => void
) {
  const sec = body.createDiv({ cls: "second-brain-section" });
  sec.createEl("h3", { text: "Review a specific day" });
  const btn = sec.createEl("button", {
    text: "Pick a day…",
    cls: "second-brain-button",
  });
  btn.addEventListener("click", () => {
    new SpecificDayModal(plugin.app, (date) =>
      onRunCommand("todays-review", date)
    ).open();
  });
}

function renderRecentReviewsSection(
  body: HTMLElement,
  plugin: SecondBrainPlugin
) {
  const sec = body.createDiv({ cls: "second-brain-section" });
  sec.createEl("h3", { text: "Recent reviews" });

  const groups: Array<{ folder: string; label: string; limit: number }> = [
    { folder: "_AI/Reviews/Daily", label: "Daily", limit: 5 },
    { folder: "_AI/Reviews/Weekly", label: "Weekly", limit: 3 },
    { folder: "_AI/Reviews/Monthly", label: "Monthly", limit: 2 },
    { folder: "_AI/Reviews/Quarterly", label: "Quarterly", limit: 1 },
    { folder: "_AI/Reviews/Yearly", label: "Yearly", limit: 1 },
  ];

  let any = false;
  const list = sec.createEl("ul", { cls: "second-brain-list" });
  for (const g of groups) {
    const files = filesIn(plugin, g.folder, g.limit);
    for (const f of files) {
      any = true;
      const li = list.createEl("li");
      const link = li.createEl("a", {
        text: `📄 ${g.label} ${f.basename}`,
        cls: "second-brain-link",
      });
      link.addEventListener("click", () =>
        plugin.app.workspace.getLeaf(false).openFile(f)
      );
    }
  }
  if (!any) {
    list.remove();
    sec.createEl("div", {
      cls: "second-brain-muted",
      text: "No reviews yet.",
    });
  }
}

function filesIn(
  plugin: SecondBrainPlugin,
  folderPath: string,
  limit: number
): TFile[] {
  const folder = plugin.app.vault.getAbstractFileByPath(folderPath);
  if (!(folder instanceof TFolder)) return [];
  return folder.children
    .filter((c): c is TFile => c instanceof TFile && c.name.endsWith(".md"))
    .sort((a, b) => b.stat.mtime - a.stat.mtime)
    .slice(0, limit);
}

class SpecificDayModal extends Modal {
  private onPick: (date: string) => void;

  constructor(app: App, onPick: (date: string) => void) {
    super(app);
    this.onPick = onPick;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Review a specific day" });
    contentEl.createEl("p", {
      cls: "second-brain-muted",
      text: "Pick a date in the last few weeks; the plugin reads that day's log and writes a daily review to _AI/Reviews/Daily/.",
    });

    const input = contentEl.createEl("input", {
      type: "date",
      cls: "second-brain-date-input",
    });
    // Default to yesterday — likely the most common "review a past day" target.
    const y = new Date();
    y.setDate(y.getDate() - 1);
    input.value = `${y.getFullYear()}-${pad2(y.getMonth() + 1)}-${pad2(
      y.getDate()
    )}`;
    input.focus();

    const actions = contentEl.createDiv({ cls: "second-brain-modal-actions" });
    const okBtn = actions.createEl("button", {
      text: "Run review",
      cls: "second-brain-modal-save",
    });
    okBtn.addEventListener("click", () => {
      const date = input.value;
      if (!date) {
        new Notice("Pick a date first.");
        return;
      }
      this.onPick(date);
      this.close();
    });
    const cancelBtn = actions.createEl("button", {
      text: "Cancel",
      cls: "second-brain-modal-cancel",
    });
    cancelBtn.addEventListener("click", () => this.close());
  }

  onClose() {
    this.contentEl.empty();
  }
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
