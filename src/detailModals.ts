/**
 * Per-entity detail views (v0.11.1). Depth lives here, off the main list
 * surfaces. Reuses the capture-modal chrome (top-anchored, X + title).
 *
 * - HabitDetailModal: Overview / Boost / Stats sub-tabs.
 * - GoalDetailModal: progress + records timeline + linked habits.
 */

import { App, Modal, Notice } from "obsidian";
import SecondBrainPlugin from "../main";
import { Habit, loadHabits } from "./habits";
import { Goal, goalProgress } from "./goals";
import { GoalRecordModal } from "./goalModals";
import { renderAreaChips } from "./areas";
import {
  habitStatusOn,
  collectHabitStrip,
  computeStreak,
  computeBestStreak,
  cellClass,
} from "./goalsTab";
import { refreshManualMarks } from "./habitManual";
import { todayISO } from "./paths";

type HabitDetailTab = "overview" | "boost" | "stats";

export class HabitDetailModal extends Modal {
  private readonly plugin: SecondBrainPlugin;
  private readonly habit: Habit;
  private tab: HabitDetailTab = "overview";

  constructor(app: App, plugin: SecondBrainPlugin, habit: Habit) {
    super(app);
    this.plugin = plugin;
    this.habit = habit;
    this.modalEl.addClass("second-brain-capture-modal");
  }

  onOpen() {
    void this.render();
  }

  private async render() {
    const { contentEl } = this;
    contentEl.empty();
    await refreshManualMarks(this.plugin.app);

    const header = contentEl.createDiv({ cls: "second-brain-capture-header" });
    header.createEl("h2", { text: this.habit.name, cls: "second-brain-capture-title" });
    const close = header.createEl("button", {
      text: "✕",
      cls: "second-brain-capture-close",
      attr: { title: "Close" },
    });
    close.addEventListener("click", () => this.close());

    const bar = contentEl.createDiv({ cls: "second-brain-subtabs" });
    for (const t of ["overview", "boost", "stats"] as HabitDetailTab[]) {
      const b = bar.createEl("button", {
        text: t[0].toUpperCase() + t.slice(1),
        cls: `second-brain-subtab${this.tab === t ? " active" : ""}`,
      });
      b.addEventListener("click", () => {
        this.tab = t;
        void this.render();
      });
    }

    if (this.tab === "overview") this.renderOverview(contentEl);
    else if (this.tab === "boost") this.renderBoost(contentEl);
    else await this.renderStats(contentEl);

    if (this.habit.file) {
      const open = contentEl.createEl("a", {
        text: "Open file ↗",
        cls: "second-brain-link",
      });
      const file = this.habit.file;
      open.addEventListener("click", () => {
        this.plugin.app.workspace.getLeaf(false).openFile(file);
        this.close();
      });
    }
  }

  private renderOverview(c: HTMLElement) {
    const h = this.habit;
    this.row(c, "Criterion", h.binaryCriterion);
    this.row(c, "Periodicity", h.periodicity);
    if (h.areas.length) {
      const r = c.createDiv({ cls: "second-brain-detail-row" });
      r.createSpan({ text: "Areas", cls: "second-brain-detail-key" });
      renderAreaChips(r.createSpan({ cls: "second-brain-detail-val" }), h.areas);
    }
    if (h.projects.length) this.row(c, "Projects", h.projects.map(short).join(", "));
    if (h.goals.length) this.row(c, "Goals", h.goals.map(short).join(", "));
    if (h.target) this.row(c, "Target", h.target);
    if (h.auto) this.row(c, "Type", `auto (${h.auto})`);
  }

  private renderBoost(c: HTMLElement) {
    const h = this.habit;
    const any =
      h.identity || h.why || h.cue || h.environment || h.reward || h.recovery ||
      (h.constraints && h.constraints.length) || h.evidence;
    if (!any) {
      c.createEl("div", {
        cls: "second-brain-muted",
        text: "No boost fields yet. Design the habit with the AI to fill in identity, cue, environment, reward, and recovery.",
      });
      return;
    }
    this.row(c, "🪞 Identity", h.identity);
    this.row(c, "🔥 Why", h.why);
    this.row(c, "⏰ Cue", h.cue);
    this.row(c, "🧰 Environment", h.environment);
    this.row(c, "🎉 Reward", h.reward);
    this.row(c, "🛟 Recovery", h.recovery);
    if (h.constraints && h.constraints.length)
      this.row(c, "🚧 Constraints", h.constraints.join("; "));
    this.row(c, "📌 Evidence", h.evidence);
  }

  private async renderStats(c: HTMLElement) {
    const today = todayISO();
    const cells = await collectHabitStrip(this.plugin, this.habit, today, 30);
    const streak = await computeStreak(this.plugin, this.habit, today, 365);
    const best = computeBestStreak(
      await collectHabitStrip(this.plugin, this.habit, today, 365)
    );
    const pass = cells.filter((x) => x.status === "pass").length;
    const evaluated = cells.filter((x) => x.status !== "missing").length;
    const rate = evaluated ? Math.round((pass / evaluated) * 100) : 0;

    const tiles = c.createDiv({ cls: "second-brain-stats-numeric" });
    this.tile(tiles, "🔥 Current", streak.current ? `${streak.current}d` : "—");
    this.tile(tiles, "🏆 Best", best ? `${best}d` : "—");
    this.tile(tiles, "✅ 30d", `${pass}`);
    this.tile(tiles, "📊 30d", evaluated ? `${rate}%` : "—");

    const strip = c.createDiv({ cls: "second-brain-habit-strip" });
    for (const cell of cells) {
      strip.createDiv({
        cls: `second-brain-habit-cell ${cellClass(cell.status)}`,
        attr: { title: `${cell.date} — ${cell.status}` },
      });
    }
  }

  private row(c: HTMLElement, key: string, val?: string) {
    if (!val) return;
    const r = c.createDiv({ cls: "second-brain-detail-row" });
    r.createSpan({ text: key, cls: "second-brain-detail-key" });
    r.createSpan({ text: val, cls: "second-brain-detail-val" });
  }

  private tile(parent: HTMLElement, label: string, value: string) {
    const t = parent.createDiv({ cls: "second-brain-stats-tile" });
    t.createEl("div", { cls: "second-brain-stats-tile-label", text: label });
    t.createEl("div", { cls: "second-brain-stats-tile-value", text: value });
  }

  onClose() {
    this.contentEl.empty();
  }
}

export class GoalDetailModal extends Modal {
  private readonly plugin: SecondBrainPlugin;
  private goal: Goal;
  private readonly reload: () => Promise<Goal | null>;

  constructor(
    app: App,
    plugin: SecondBrainPlugin,
    goal: Goal,
    reload: () => Promise<Goal | null>
  ) {
    super(app);
    this.plugin = plugin;
    this.goal = goal;
    this.reload = reload;
    this.modalEl.addClass("second-brain-capture-modal");
  }

  onOpen() {
    void this.render();
  }

  private async render() {
    const { contentEl } = this;
    contentEl.empty();
    const g = this.goal;

    const header = contentEl.createDiv({ cls: "second-brain-capture-header" });
    header.createEl("h2", { text: g.name, cls: "second-brain-capture-title" });
    const close = header.createEl("button", {
      text: "✕",
      cls: "second-brain-capture-close",
      attr: { title: "Close" },
    });
    close.addEventListener("click", () => this.close());

    if (g.successCriterion)
      contentEl.createEl("div", { cls: "second-brain-muted", text: g.successCriterion });

    // Progress bar
    const pct = Math.round(goalProgress(g) * 100);
    const bar = contentEl.createDiv({ cls: "second-brain-progress-bar" });
    bar.createDiv({ cls: "second-brain-progress-fill" }).style.width = `${pct}%`;
    const meta = contentEl.createDiv({ cls: "second-brain-muted" });
    const bits: string[] = [];
    if (g.target != null)
      bits.push(`${g.current ?? g.start ?? 0}/${g.target}${g.unit ? " " + g.unit : ""} (${pct}%)`);
    else if (g.milestonesTotal > 0)
      bits.push(`${g.milestonesDone}/${g.milestonesTotal} milestones (${pct}%)`);
    bits.push(`status: ${g.status}`);
    meta.setText(bits.join(" · "));

    // Linked habits ("showing up")
    const habits = (await loadHabits(this.plugin.app)).filter(
      (h) =>
        h.status === "active" &&
        (h.goals.includes(g.file.path) ||
          h.goals.includes(g.id) ||
          h.projects.some((p) => g.projects.includes(p)))
    );
    const linkSec = contentEl.createDiv({ cls: "second-brain-detail-section" });
    linkSec.createEl("div", { cls: "second-brain-detail-key", text: "Showing up" });
    if (habits.length === 0) {
      linkSec.createEl("div", {
        cls: "second-brain-muted",
        text: "No habits feed this goal yet. Add a `goals:` link on a habit, or share a project.",
      });
    } else {
      const today = todayISO();
      await refreshManualMarks(this.plugin.app);
      for (const h of habits) {
        let days = 0;
        for (let i = 0; i < 14; i++) {
          const d = new Date(today + "T00:00:00");
          d.setDate(d.getDate() - i);
          const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
          if ((await habitStatusOn(this.plugin, h, iso)) === "pass") days++;
        }
        const row = linkSec.createDiv({ cls: "second-brain-detail-row" });
        row.createSpan({ text: h.name, cls: "second-brain-detail-val" });
        row.createSpan({ text: `🔥 ${days}/14d`, cls: "second-brain-muted" });
      }
    }

    // Records timeline
    const recSec = contentEl.createDiv({ cls: "second-brain-detail-section" });
    const recHead = recSec.createDiv({ cls: "second-brain-detail-row" });
    recHead.createSpan({ text: "Records", cls: "second-brain-detail-key" });
    const add = recHead.createEl("button", {
      text: "+ Record",
      cls: "second-brain-row-edit",
    });
    add.addEventListener("click", () => {
      new GoalRecordModal(this.plugin.app, g, async () => {
        const fresh = await this.reload();
        if (fresh) {
          this.goal = fresh;
          void this.render();
        }
      }).open();
    });
    if (g.records.length === 0) {
      recSec.createEl("div", { cls: "second-brain-muted", text: "No records logged yet." });
    } else {
      const ul = recSec.createEl("ul", { cls: "second-brain-list" });
      for (const r of [...g.records].reverse()) {
        ul.createEl("li", { text: `${r.date} — ${r.text}` });
      }
    }

    const open = contentEl.createEl("a", { text: "Open file ↗", cls: "second-brain-link" });
    open.addEventListener("click", () => {
      this.plugin.app.workspace.getLeaf(false).openFile(g.file);
      this.close();
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}

function short(path: string): string {
  return path.replace(/^.*\//, "").replace(/\.md$/, "").replace(/^\[\[/, "").replace(/\]\]$/, "");
}
