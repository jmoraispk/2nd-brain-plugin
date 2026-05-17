/**
 * Goals tab (v0.8+). Renders the user's habits as the primary content with
 * a stub for goals (a v0.9 surface). Three sub-tabs:
 *   - Goals — table of habits: name, area, periodicity, today's status, streak
 *   - Stats — periodicity-driven view (daily / weekly / monthly / yearly)
 *   - Streaks — per-habit longest / current
 *
 * Habit data is read from `🧑 Me/Habits/` (one file per habit). Today's
 * status comes from the latest daily review's body section "## Today's
 * habits status" — we don't recompute, we read what the LLM wrote.
 */

import { App, TFile, TFolder } from "obsidian";
import SecondBrainPlugin from "../main";
import { Habit, loadHabits, HABITS_FOLDER } from "./habits";
import { applyDatePlaceholders, todayISO, toISO } from "./paths";

export type GoalsSubtab = "goals" | "stats" | "streaks";

export interface GoalsTabState {
  subtab: GoalsSubtab;
}

export function defaultGoalsTabState(): GoalsTabState {
  return { subtab: "goals" };
}

export interface GoalsTabCallbacks {
  setSubtab: (t: GoalsSubtab) => void;
  onChanged: () => void;
  runCommand: (commandId: string) => void;
}

export async function renderGoals(
  parent: HTMLElement,
  plugin: SecondBrainPlugin,
  state: GoalsTabState,
  cb: GoalsTabCallbacks
): Promise<void> {
  const body = parent.createDiv({ cls: "second-brain-tab-body" });

  // Sub-tab bar
  const bar = body.createDiv({ cls: "second-brain-subtabs" });
  for (const t of ["goals", "stats", "streaks"] as GoalsSubtab[]) {
    const btn = bar.createEl("button", {
      text: t[0].toUpperCase() + t.slice(1),
      cls: `second-brain-subtab${state.subtab === t ? " active" : ""}`,
    });
    btn.addEventListener("click", () => cb.setSubtab(t));
  }

  const habits = await loadHabits(plugin.app);
  const todayStatus = await readTodayHabitStatus(plugin.app, plugin.settings.reviewsPathTemplate);

  if (state.subtab === "goals") {
    await renderHabitsList(body, plugin, habits, todayStatus, cb);
  } else if (state.subtab === "stats") {
    await renderStats(body, plugin, habits);
  } else {
    await renderStreaks(body, plugin, habits);
  }
}

// ── Habits list ─────────────────────────────────────────────────────────

async function renderHabitsList(
  body: HTMLElement,
  plugin: SecondBrainPlugin,
  habits: Habit[],
  todayStatus: Map<string, "pass" | "uncertain" | "fail">,
  cb: GoalsTabCallbacks
) {
  const sec = body.createDiv({ cls: "second-brain-section" });

  // Header row: heading on the left, Draft Habit button on the right.
  const headerRow = sec.createDiv({ cls: "second-brain-row" });
  headerRow.createEl("h3", { text: "Habits", cls: "second-brain-row-content" });
  const draftBtn = headerRow.createEl("button", {
    text: "✨ Draft Habit",
    cls: "second-brain-button second-brain-button-primary",
    attr: {
      title:
        "AI drafts a new habit (or boosts an existing one) using the LogLife framework: Define / Why / Plan / Environment / Recover.",
    },
  });
  draftBtn.addEventListener("click", () => cb.runCommand("draft-habit"));

  const active = habits.filter((h) => h.status === "active");

  if (active.length === 0) {
    const empty = sec.createDiv({ cls: "second-brain-muted" });
    empty.appendText("No habits yet. Click ✨ Draft Habit above, or create one manually at ");
    empty.createEl("code", { text: `${HABITS_FOLDER}/<id>.md` });
    empty.appendText(".");
    return;
  }

  const table = sec.createEl("table", { cls: "second-brain-habits-table" });
  const head = table.createEl("thead").createEl("tr");
  for (const col of ["Habit", "Area", "Periodicity", "Today", "Evidence"]) {
    head.createEl("th", { text: col });
  }
  const tbody = table.createEl("tbody");
  for (const h of active) {
    const tr = tbody.createEl("tr");
    const nameCell = tr.createEl("td");
    const link = nameCell.createEl("a", {
      text: h.name,
      cls: "second-brain-link",
    });
    link.addEventListener("click", () =>
      plugin.app.workspace.getLeaf(false).openFile(h.file)
    );
    tr.createEl("td", { text: h.area ?? "—" });
    tr.createEl("td", { text: h.periodicity });
    const statusCell = tr.createEl("td");
    const s = todayStatus.get(h.id);
    if (s === "pass") statusCell.setText("✅");
    else if (s === "fail") statusCell.setText("❌");
    else if (s === "uncertain") {
      statusCell.createSpan({
        text: "⚠️",
        cls: "second-brain-danger",
        attr: { title: "Uncertain — no evidence in today's log" },
      });
    } else statusCell.setText("—");
    tr.createEl("td", { text: h.binaryCriterion });
  }
}

// ── Stats: native 30-day heatmap per habit ──────────────────────────────

async function renderStats(
  body: HTMLElement,
  plugin: SecondBrainPlugin,
  habits: Habit[]
) {
  const sec = body.createDiv({ cls: "second-brain-section" });
  sec.createEl("h3", { text: "Stats — last 30 days" });

  const active = habits.filter((h) => h.status === "active");
  if (active.length === 0) {
    sec.createEl("div", {
      cls: "second-brain-muted",
      text: "No habits to chart yet.",
    });
    return;
  }

  const today = todayISO();
  const days = 30;
  for (const h of active) {
    const cells = await collectHabitStrip(plugin, h.id, today, days);
    const row = sec.createDiv({ cls: "second-brain-habit-strip-row" });
    row.createEl("div", { text: h.name, cls: "second-brain-habit-strip-label" });
    const grid = row.createDiv({ cls: "second-brain-habit-strip" });
    for (const cell of cells) {
      const sq = grid.createDiv({
        cls: `second-brain-habit-cell ${cellClass(cell.status)}`,
        attr: {
          title: `${cell.date} — ${cell.status}${
            cell.evidence ? `: ${cell.evidence}` : ""
          }`,
        },
      });
      sq.setText("");
    }
  }

  sec.createEl("p", {
    cls: "second-brain-muted",
    text: "Want yearly heatmaps inside any markdown note? Embed the data files at 🤖 AI/Habit-Data/<id>.md with the Heatmap Calendar plugin.",
  });
}

interface HabitDayCell {
  date: string;
  status: "pass" | "uncertain" | "fail" | "missing";
  evidence?: string;
}

async function collectHabitStrip(
  plugin: SecondBrainPlugin,
  habitId: string,
  today: string,
  days: number
): Promise<HabitDayCell[]> {
  const out: HabitDayCell[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today + "T00:00:00");
    d.setDate(d.getDate() - i);
    const dateStr = toISO(d);
    const path = applyDatePlaceholders(
      plugin.settings.reviewsPathTemplate,
      dateStr
    );
    const file = plugin.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      out.push({ date: dateStr, status: "missing" });
      continue;
    }
    const content = await plugin.app.vault.read(file);
    const status = parseHabitStatusFromReview(content, habitId);
    out.push({
      date: dateStr,
      status: status ?? "missing",
    });
  }
  return out;
}

function cellClass(s: HabitDayCell["status"]): string {
  switch (s) {
    case "pass":
      return "second-brain-habit-cell-pass";
    case "uncertain":
      return "second-brain-habit-cell-uncertain";
    case "fail":
      return "second-brain-habit-cell-fail";
    default:
      return "second-brain-habit-cell-missing";
  }
}

// ── Streaks ─────────────────────────────────────────────────────────────

async function renderStreaks(
  body: HTMLElement,
  plugin: SecondBrainPlugin,
  habits: Habit[]
) {
  const sec = body.createDiv({ cls: "second-brain-section" });
  sec.createEl("h3", { text: "Streaks" });

  const active = habits.filter((h) => h.status === "active");
  if (active.length === 0) {
    sec.createEl("div", {
      cls: "second-brain-muted",
      text: "No habits yet.",
    });
    return;
  }

  const today = todayISO();
  const table = sec.createEl("table", { cls: "second-brain-habits-table" });
  const head = table.createEl("thead").createEl("tr");
  for (const col of ["Habit", "Current streak", "Last evidence"]) {
    head.createEl("th", { text: col });
  }
  const tbody = table.createEl("tbody");
  for (const h of active) {
    const { current, lastEvidence } = await computeStreak(
      plugin,
      h.id,
      today,
      30
    );
    const tr = tbody.createEl("tr");
    tr.createEl("td", { text: h.name });
    tr.createEl("td", { text: current === 0 ? "—" : `${current} day${current === 1 ? "" : "s"}` });
    tr.createEl("td", { text: lastEvidence ?? "—" });
  }
}

/**
 * Walk backwards from `today` reading each day's review file, parse the
 * "## Today's habits status" section, and count consecutive "pass" days for
 * this habit. Uncertain counts as pass (optimistic default). A miss or
 * absence of review breaks the streak.
 */
async function computeStreak(
  plugin: SecondBrainPlugin,
  habitId: string,
  today: string,
  maxLookback: number
): Promise<{ current: number; lastEvidence?: string }> {
  let streak = 0;
  let lastEvidence: string | undefined;
  for (let i = 0; i < maxLookback; i++) {
    const d = new Date(today + "T00:00:00");
    d.setDate(d.getDate() - i);
    const dateStr = toISO(d);
    const path = applyDatePlaceholders(
      plugin.settings.reviewsPathTemplate,
      dateStr
    );
    const file = plugin.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      // No review yet today is OK (might still happen later) — only break
      // streak if we're past today.
      if (i === 0) continue;
      break;
    }
    const content = await plugin.app.vault.read(file);
    const status = parseHabitStatusFromReview(content, habitId);
    if (status === "fail") break;
    if (status === "pass" || status === "uncertain") {
      streak++;
      if (status === "pass" && !lastEvidence) lastEvidence = dateStr;
    } else {
      // Section missing or habit not listed — neutral, don't break.
      if (i === 0) continue;
      break;
    }
  }
  return { current: streak, lastEvidence };
}

/**
 * Read today's habit-status section from the most recent daily review.
 * Map<habitId, status>. Returns empty map if today's review hasn't been run.
 */
async function readTodayHabitStatus(
  app: App,
  reviewsPathTemplate: string
): Promise<Map<string, "pass" | "uncertain" | "fail">> {
  const path = applyDatePlaceholders(reviewsPathTemplate, todayISO());
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return new Map();
  const content = await app.vault.read(file);
  const out = new Map<string, "pass" | "uncertain" | "fail">();
  const section = extractSection(content, "Today's habits status");
  if (!section) return out;
  for (const line of section.split(/\r?\n/)) {
    const m = line.match(/^\s*-\s+(✅|⚠️|❌)\s+(\S+?)\s*[—-]/);
    if (m) {
      const status = m[1] === "✅" ? "pass" : m[1] === "❌" ? "fail" : "uncertain";
      out.set(m[2], status);
    }
  }
  return out;
}

function parseHabitStatusFromReview(
  content: string,
  habitId: string
): "pass" | "uncertain" | "fail" | null {
  const section = extractSection(content, "Today's habits status");
  if (!section) return null;
  const re = new RegExp(
    `^\\s*-\\s+(✅|⚠️|❌)\\s+${escapeRegex(habitId)}\\s*[—-]`,
    "m"
  );
  const m = section.match(re);
  if (!m) return null;
  return m[1] === "✅" ? "pass" : m[1] === "❌" ? "fail" : "uncertain";
}

function extractSection(content: string, header: string): string | null {
  const re = new RegExp(`^##\\s+${escapeRegex(header)}\\s*$`, "m");
  const m = content.match(re);
  if (!m || m.index === undefined) return null;
  const start = m.index + m[0].length;
  const nextHeader = content.slice(start).search(/^##\s+/m);
  return nextHeader < 0
    ? content.slice(start)
    : content.slice(start, start + nextHeader);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
