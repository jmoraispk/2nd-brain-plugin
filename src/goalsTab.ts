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
import { Project, loadProjects, PROJECTS_FOLDER } from "./projects";
import { ProjectCreateModal } from "./projectCreateModal";
import { ProjectTalkCreateModal, ProjectEditModal } from "./projectAIModals";
import { HabitDesignerModal } from "./habitDesignerModal";
import { Goal, loadGoals, goalProgress, GOALS_FOLDER } from "./goals";
import { GoalCreateModal, GoalRecordModal } from "./goalModals";
import { HabitDetailModal, GoalDetailModal } from "./detailModals";
import { renderAreaChips, areaFor } from "./areas";
import {
  refreshManualMarks,
  manualMarkFor,
  setManualMark,
} from "./habitManual";
import { applyDatePlaceholders, todayISO, toISO, resolveDailyLogPath } from "./paths";

export type GoalsSubtab = "habits" | "projects" | "goals" | "areas" | "stats";
export type StatsPeriod = "week" | "month" | "year";
/** How a habit's heatmap is measured (v0.9.8). */
export type StatsMeasure = "binary" | "count" | "magnitude";

export interface GoalsTabState {
  subtab: GoalsSubtab;
  /** Stats sub-tab — period granularity. */
  statsPeriod: StatsPeriod;
  /** Stats sub-tab — how many periods back from now (0 = current). */
  statsOffset: number;
  /** Stats sub-tab — which habit to drill into. undefined = "All habits". */
  statsHabitId?: string;
  /** Stats sub-tab — binary (did it) / count (how many) / magnitude (how much). */
  statsMeasure: StatsMeasure;
}

export function defaultGoalsTabState(): GoalsTabState {
  return {
    subtab: "habits",
    statsPeriod: "month",
    statsOffset: 0,
    statsMeasure: "binary",
  };
}

export interface GoalsTabCallbacks {
  setSubtab: (t: GoalsSubtab) => void;
  onChanged: () => void;
  runCommand: (commandId: string) => void;
  setStatsPeriod: (p: StatsPeriod) => void;
  setStatsOffset: (n: number) => void;
  setStatsHabitId: (id: string | undefined) => void;
  setStatsMeasure: (m: StatsMeasure) => void;
}

/**
 * Scope = which top-level tab is hosting this renderer (v0.9.1 split the old
 * "Life" tab into Habits + Projects). Each scope shows only its own subtabs.
 */
export type GoalsScope = "habits" | "projects";

const SUBTABS_BY_SCOPE: Record<
  GoalsScope,
  Array<{ id: GoalsSubtab; label: string }>
> = {
  habits: [
    { id: "habits", label: "List" },
    { id: "stats", label: "Stats" },
  ],
  projects: [
    { id: "projects", label: "Projects" },
    { id: "goals", label: "Goals" },
    { id: "areas", label: "Areas" },
  ],
};

export async function renderGoals(
  parent: HTMLElement,
  plugin: SecondBrainPlugin,
  state: GoalsTabState,
  cb: GoalsTabCallbacks,
  scope: GoalsScope
): Promise<void> {
  const body = parent.createDiv({ cls: "second-brain-tab-body" });

  // Load manual habit marks once per render so per-cell lookups stay sync.
  await refreshManualMarks(plugin.app);

  // Coerce the shared subtab into one valid for this scope (the two tabs
  // share GoalsTabState; clicking between them may leave a foreign subtab).
  const allowed = SUBTABS_BY_SCOPE[scope];
  if (!allowed.some((t) => t.id === state.subtab)) {
    state.subtab = allowed[0].id;
  }

  const bar = body.createDiv({ cls: "second-brain-subtabs" });
  for (const t of allowed) {
    const btn = bar.createEl("button", {
      text: t.label,
      cls: `second-brain-subtab${state.subtab === t.id ? " active" : ""}`,
    });
    btn.addEventListener("click", () => cb.setSubtab(t.id));
  }

  if (state.subtab === "habits") {
    const habits = await loadHabits(plugin.app);
    const todayStatus = await readTodayHabitStatus(
      plugin.app,
      plugin.settings.reviewsPathTemplate
    );
    await renderHabitsList(body, plugin, habits, todayStatus, cb);
  } else if (state.subtab === "projects") {
    const projects = await loadProjects(plugin.app);
    renderProjectsList(body, plugin, projects, cb);
  } else if (state.subtab === "goals") {
    const goals = await loadGoals(plugin.app);
    const habits = await loadHabits(plugin.app);
    await renderGoalsList(body, plugin, goals, habits, cb);
  } else if (state.subtab === "areas") {
    const habits = await loadHabits(plugin.app);
    const projects = await loadProjects(plugin.app);
    await renderAreas(body, plugin, habits, projects);
  } else {
    // "stats" (default fallback) — shows heatmap + streak per habit.
    const habits = await loadHabits(plugin.app);
    await renderStats(body, plugin, habits, state, cb);
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
  sec.createEl("h3", { text: "Habits" });

  const active = habits.filter((h) => h.status === "active");

  if (active.length === 0) {
    const empty = sec.createDiv({ cls: "second-brain-muted" });
    empty.appendText("No habits yet. Create one manually at ");
    empty.createEl("code", { text: `${HABITS_FOLDER}/<id>.md` });
    empty.appendText(" — or run Draft Habit below to have the AI write one for you.");
  } else {
    const table = sec.createEl("table", { cls: "second-brain-habits-table" });
    const head = table.createEl("thead").createEl("tr");
    for (const col of ["Habit", "Area", "Periodicity", "Today", "Evidence"]) {
      head.createEl("th", { text: col });
    }
    const tbody = table.createEl("tbody");
    for (const h of active) {
      const tr = tbody.createEl("tr");
      const nameCell = tr.createEl("td");
      if (h.file) {
        const link = nameCell.createEl("a", {
          text: h.name,
          cls: "second-brain-link",
        });
        // Click → detail view (Overview/Boost/Stats), not the raw file.
        link.addEventListener("click", () =>
          new HabitDetailModal(plugin.app, plugin, h).open()
        );
      } else {
        // Auto-habit — no backing file. Mark it so the user knows it's built-in.
        nameCell.createSpan({ text: h.name });
        nameCell.createSpan({
          text: " · auto",
          cls: "second-brain-thread-meta",
        });
      }

      const areaCell = tr.createEl("td");
      if (h.areas.length > 0) renderAreaChips(areaCell, h.areas);
      else areaCell.setText("—");

      tr.createEl("td", { text: h.periodicity });

      const statusCell = tr.createEl("td");
      const today = todayISO();
      const glyph = (st: string | undefined) =>
        st === "pass" ? "✅" : st === "fail" ? "❌" : st === "uncertain" ? "⚠️" : "—";

      if (h.auto) {
        // Auto-habits compute today's status deterministically — not tickable.
        statusCell.setText(glyph(await habitStatusOn(plugin, h, today)));
      } else {
        // File-backed: manual mark wins; cell is a tap-to-cycle control
        // (pass → fail → clear, where clear reverts to the AI/derived status).
        const manual = manualMarkFor(today, h.id);
        const effective = manual ?? todayStatus.get(h.id);
        const btn = statusCell.createEl("button", {
          text: glyph(effective),
          cls: `second-brain-tick${manual ? " manual" : ""}`,
          attr: {
            title: manual
              ? `Manually marked ${manual} — tap to change (pass → fail → clear)`
              : "Tap to mark today (pass → fail → clear)",
          },
        });
        btn.addEventListener("click", async () => {
          const next: "pass" | "fail" | null =
            manual === "pass" ? "fail" : manual === "fail" ? null : "pass";
          await setManualMark(plugin.app, today, h.id, next);
          cb.onChanged();
        });
      }

      tr.createEl("td", { text: h.binaryCriterion });
    }
  }

  // Secondary actions row, below the table — less visually loud than the
  // previous header-bar placement.
  const actions = sec.createDiv({ cls: "second-brain-secondary-actions" });

  // The AI habit-designer (v0.10) — the primary way to add a habit. Turns a
  // rough wish into a crisp, anchored, identity-linked habit that sticks.
  const designBtn = actions.createEl("button", {
    text: "✨ Design a habit",
    cls: "second-brain-button second-brain-button-primary",
    attr: {
      title:
        "Say what you want to build; the AI designs it (tiny minimum, a cue, environment, reward, recovery) and writes the habit.",
    },
  });
  designBtn.addEventListener("click", () => {
    new HabitDesignerModal(plugin.app, plugin, (file) => {
      cb.onChanged();
      plugin.app.workspace.getLeaf(false).openFile(file);
    }).open();
  });

  const backfillBtn = actions.createEl("button", {
    text: "📜 Backfill history",
    cls: "second-brain-button",
    attr: {
      title:
        "Scan past daily logs and evaluate each habit retroactively. Updates 🤖 AI/Habit-Data/ so streaks + heatmaps reflect real history. Costs one LLM call.",
    },
  });
  backfillBtn.addEventListener("click", () => cb.runCommand("backfill-habits"));
}

// ── Projects list ──────────────────────────────────────────────────────

function renderProjectsList(
  body: HTMLElement,
  plugin: SecondBrainPlugin,
  projects: Project[],
  cb: GoalsTabCallbacks
) {
  const sec = body.createDiv({ cls: "second-brain-section" });
  sec.createEl("h3", { text: "Projects" });

  const active = projects.filter((p) => p.status === "active");

  if (active.length === 0) {
    const empty = sec.createDiv({ cls: "second-brain-muted" });
    empty.appendText("No active projects yet. Create one with the button below, or drop a file into ");
    empty.createEl("code", { text: PROJECTS_FOLDER });
    empty.appendText(".");
  } else {
    const table = sec.createEl("table", { cls: "second-brain-habits-table" });
    const head = table.createEl("thead").createEl("tr");
    for (const col of ["Project", "Area", "Status", "Created", ""]) {
      head.createEl("th", { text: col });
    }
    const tbody = table.createEl("tbody");
    for (const p of active.sort((a, b) => a.name.localeCompare(b.name))) {
      const tr = tbody.createEl("tr");
      const nameCell = tr.createEl("td");
      const link = nameCell.createEl("a", {
        text: p.name,
        cls: "second-brain-link",
      });
      link.addEventListener("click", () =>
        plugin.app.workspace.getLeaf(false).openFile(p.file)
      );
      const areaCell = tr.createEl("td");
      if (p.areas.length > 0) renderAreaChips(areaCell, p.areas);
      else areaCell.setText("—");
      tr.createEl("td", { text: p.status });
      tr.createEl("td", { text: p.created ?? "—" });
      // Last column: "Edit via AI" — dictate a change, AI proposes a
      // section-bounded edit (v0.9.4).
      const editCell = tr.createEl("td");
      const editBtn = editCell.createEl("button", {
        text: "✏️ AI",
        cls: "second-brain-row-edit",
        attr: { title: "Edit this project by talking — AI proposes a section edit" },
      });
      editBtn.addEventListener("click", () => {
        new ProjectEditModal(plugin.app, plugin, p, () => cb.onChanged()).open();
      });
    }
  }

  // Progress box — milestone + TODO progress per active project.
  if (active.length > 0) {
    const prog = body.createDiv({ cls: "second-brain-section" });
    prog.createEl("h3", { text: "Progress" });
    for (const p of active.sort((a, b) => a.name.localeCompare(b.name))) {
      const row = prog.createDiv({ cls: "second-brain-progress-row" });
      row.createEl("div", {
        text: p.name,
        cls: "second-brain-progress-name",
      });
      const hasMs = p.milestonesTotal > 0;
      const ratio = hasMs ? p.milestonesDone / p.milestonesTotal : 0;
      const bar = row.createDiv({ cls: "second-brain-progress-bar" });
      const fill = bar.createDiv({ cls: "second-brain-progress-fill" });
      fill.style.width = `${Math.round(ratio * 100)}%`;
      row.createEl("div", {
        cls: "second-brain-progress-label",
        text: hasMs
          ? `${p.milestonesDone}/${p.milestonesTotal} milestones · ${p.openTodos} todo`
          : `${p.openTodos} open todo${p.openTodos === 1 ? "" : "s"}`,
      });
    }
  }

  // Secondary action row mirrors the Habits tab pattern.
  const actions = sec.createDiv({ cls: "second-brain-secondary-actions" });
  const talkBtn = actions.createEl("button", {
    text: "✨ Describe a project",
    cls: "second-brain-button second-brain-button-primary",
    attr: {
      title:
        "Talk freely about a project — AI structures it into the project format and creates the file.",
    },
  });
  talkBtn.addEventListener("click", () => {
    new ProjectTalkCreateModal(plugin.app, plugin, (file) => {
      cb.onChanged();
      plugin.app.workspace.getLeaf(false).openFile(file);
    }).open();
  });

  const newBtn = actions.createEl("button", {
    text: "+ New (blank)",
    cls: "second-brain-button",
    attr: {
      title:
        "Create a blank project file with the scaffold (Why · Done criteria · Current state · Active TODOs · History).",
    },
  });
  newBtn.addEventListener("click", () => {
    new ProjectCreateModal(plugin.app, (file) => {
      cb.onChanged();
      plugin.app.workspace.getLeaf(false).openFile(file);
    }).open();
  });

  // Optional: surface paused/done/archived projects collapsibly so they're
  // discoverable without cluttering the active list.
  const inactive = projects.filter((p) => p.status !== "active");
  if (inactive.length > 0) {
    const det = sec.createEl("details");
    det.createEl("summary", {
      text: `Other projects (${inactive.length})`,
      cls: "second-brain-muted",
    });
    const list = det.createEl("ul", { cls: "second-brain-list" });
    for (const p of inactive) {
      const li = list.createEl("li");
      const link = li.createEl("a", {
        text: `${p.name} — ${p.status}`,
        cls: "second-brain-link",
      });
      link.addEventListener("click", () =>
        plugin.app.workspace.getLeaf(false).openFile(p.file)
      );
    }
  }
}

// ── Goals list (v0.11) ──────────────────────────────────────────────────

async function renderGoalsList(
  body: HTMLElement,
  plugin: SecondBrainPlugin,
  goals: Goal[],
  habits: Habit[],
  cb: GoalsTabCallbacks
) {
  const active = goals.filter((g) => g.status === "active");
  const someday = goals.filter((g) => g.status === "someday");

  const sec = body.createDiv({ cls: "second-brain-section" });
  sec.createEl("h3", { text: "Goals" });

  if (goals.length === 0) {
    const empty = sec.createDiv({ cls: "second-brain-muted" });
    empty.appendText("No goals yet. Create one below, or drop a file into ");
    empty.createEl("code", { text: GOALS_FOLDER });
    empty.appendText(". Progress comes from showing up (linked-habit days) + records you log.");
  } else {
    if (active.length > 0) {
      sec.createEl("div", { cls: "second-brain-muted", text: "Active" });
      for (const g of active) await renderGoalRow(sec, plugin, g, habits, cb);
    }
    if (someday.length > 0) {
      const det = sec.createEl("details");
      det.createEl("summary", {
        text: `Someday (${someday.length})`,
        cls: "second-brain-muted",
      });
      for (const g of someday) await renderGoalRow(det, plugin, g, habits, cb);
    }
  }

  const actions = body.createDiv({ cls: "second-brain-secondary-actions" });
  const newBtn = actions.createEl("button", {
    text: "+ New Goal",
    cls: "second-brain-button second-brain-button-primary",
  });
  newBtn.addEventListener("click", () => {
    new GoalCreateModal(plugin.app, () => cb.onChanged()).open();
  });
}

async function renderGoalRow(
  parent: HTMLElement,
  plugin: SecondBrainPlugin,
  g: Goal,
  habits: Habit[],
  cb: GoalsTabCallbacks
) {
  const wrap = parent.createDiv({ cls: "second-brain-goal-row" });

  const top = wrap.createDiv({ cls: "second-brain-goal-top" });
  const link = top.createEl("a", { text: g.name, cls: "second-brain-link" });
  link.addEventListener("click", () =>
    new GoalDetailModal(plugin.app, plugin, g, async () => {
      const fresh = (await loadGoals(plugin.app)).find((x) => x.id === g.id);
      return fresh ?? null;
    }).open()
  );
  if (g.areas.length) renderAreaChips(top, g.areas);

  // Progress bar (records→target, else milestones).
  const pct = Math.round(goalProgress(g) * 100);
  const bar = wrap.createDiv({ cls: "second-brain-progress-bar" });
  bar.createDiv({ cls: "second-brain-progress-fill" }).style.width = `${pct}%`;

  // Adherence: pass-days (last 14) of habits linked to this goal — directly
  // (habit.goals) or via a shared project. "Showing up" is half of progress.
  const linked = habits.filter(
    (h) =>
      h.status === "active" &&
      (h.goals.includes(g.file.path) ||
        h.goals.includes(g.id) ||
        h.projects.some((p) => g.projects.includes(p)))
  );
  let activeDays = 0;
  if (linked.length) {
    const today = todayISO();
    for (let i = 0; i < 14; i++) {
      const d = new Date(today + "T00:00:00");
      d.setDate(d.getDate() - i);
      const iso = toISO(d);
      for (const h of linked) {
        if ((await habitStatusOn(plugin, h, iso)) === "pass") {
          activeDays++;
          break; // count the day once
        }
      }
    }
  }

  const meta = wrap.createDiv({ cls: "second-brain-goal-meta" });
  const bits: string[] = [];
  if (g.target != null) {
    bits.push(`${g.current ?? g.start ?? 0}/${g.target}${g.unit ? " " + g.unit : ""} (${pct}%)`);
  } else if (g.milestonesTotal > 0) {
    bits.push(`${g.milestonesDone}/${g.milestonesTotal} milestones (${pct}%)`);
  }
  if (linked.length) bits.push(`🔥 ${activeDays} active day${activeDays === 1 ? "" : "s"}/14`);
  if (g.records.length) bits.push(`${g.records.length} record${g.records.length === 1 ? "" : "s"}`);
  meta.createSpan({ text: bits.join(" · ") || "no progress yet", cls: "second-brain-muted" });

  const rec = meta.createEl("button", {
    text: "+ Record",
    cls: "second-brain-row-edit",
    attr: { title: "Log a progress event / personal record" },
  });
  rec.addEventListener("click", () => {
    new GoalRecordModal(plugin.app, g, () => cb.onChanged()).open();
  });
}

// ── Areas: the Wheel of Life (Ali Abdaal layout) ────────────────────────

interface WheelSlice {
  macro: string;
  sub: string;
  folder: string;
  hue: number; // base hue for the macro group
  lightness: number; // shade within the macro group
}

const WHEEL: WheelSlice[] = [
  // Health — greens (kept; user said "perfect")
  { macro: "Health", sub: "Body",   folder: "2. 🌳 Areas/Health/Body",   hue: 135, lightness: 28 },
  { macro: "Health", sub: "Mind",   folder: "2. 🌳 Areas/Health/Mind",   hue: 135, lightness: 40 },
  { macro: "Health", sub: "Soul",   folder: "2. 🌳 Areas/Health/Soul",   hue: 135, lightness: 52 },
  // Relationships — actual reds (not pink/orange)
  { macro: "Relationships", sub: "Romance", folder: "2. 🌳 Areas/Relationships/Romance", hue: 0, lightness: 32 },
  { macro: "Relationships", sub: "Family",  folder: "2. 🌳 Areas/Relationships/Family",  hue: 0, lightness: 42 },
  { macro: "Relationships", sub: "Friends", folder: "2. 🌳 Areas/Relationships/Friends", hue: 0, lightness: 52 },
  // Work — blues with wider spread
  { macro: "Work", sub: "Mission", folder: "2. 🌳 Areas/Work/Mission", hue: 215, lightness: 28 },
  { macro: "Work", sub: "Money",   folder: "2. 🌳 Areas/Work/Money",   hue: 215, lightness: 42 },
  { macro: "Work", sub: "Growth",  folder: "2. 🌳 Areas/Work/Growth",  hue: 215, lightness: 56 },
];

async function renderAreas(
  body: HTMLElement,
  plugin: SecondBrainPlugin,
  habits: Habit[],
  projects: Project[]
) {
  const sec = body.createDiv({ cls: "second-brain-section second-brain-wheel-section" });
  sec.createEl("h3", { text: "Wheel of Life" });
  sec.createEl("p", {
    cls: "second-brain-muted",
    text: "Click slice to open the folder. Brighter = more alive (activity in the last 14 days). Numbers show linked habits + projects.",
  });

  // Recent-activity score per area path (last 14 days): habit pass-days +
  // project History completions. Drives slice brightness + the Journey box.
  const activity = await computeAreaActivity(plugin, habits, projects);
  const maxScore = Math.max(1, ...[...activity.values()].map((a) => a.score));

  // Count habits + projects per sub-area path so we can show connections.
  // Flat-tag aware: an item in two areas counts in both (set membership).
  const countByArea = new Map<string, { habits: number; projects: number }>();
  for (const h of habits.filter((x) => x.status === "active")) {
    for (const a of h.areas) {
      const def = areaFor(a);
      if (!def) continue;
      const slot = countByArea.get(def.path) ?? { habits: 0, projects: 0 };
      slot.habits++;
      countByArea.set(def.path, slot);
    }
  }
  for (const p of projects.filter((x) => x.status === "active")) {
    for (const a of p.areas) {
      const def = areaFor(a);
      if (!def) continue;
      const slot = countByArea.get(def.path) ?? { habits: 0, projects: 0 };
      slot.projects++;
      countByArea.set(def.path, slot);
    }
  }

  // Legend above the wheel — now shows counts per sub-area.
  const legend = sec.createDiv({ cls: "second-brain-wheel-legend" });
  const macroGroups: Record<string, WheelSlice[]> = {};
  for (const s of WHEEL) {
    if (!macroGroups[s.macro]) macroGroups[s.macro] = [];
    macroGroups[s.macro].push(s);
  }
  for (const [macro, slices] of Object.entries(macroGroups)) {
    const row = legend.createDiv({ cls: "second-brain-wheel-legend-row" });
    const swatch = row.createSpan({ cls: "second-brain-wheel-legend-swatch" });
    swatch.style.backgroundColor = `hsl(${slices[1].hue}, 55%, ${slices[1].lightness}%)`;
    const subsWithCounts = slices.map((s) => {
      const c = countByArea.get(s.folder) ?? { habits: 0, projects: 0 };
      const total = c.habits + c.projects;
      return total > 0 ? `${s.sub} (${total})` : s.sub;
    });
    row.createSpan({
      text: ` ${macro} — ${subsWithCounts.join(" · ")}`,
    });
  }

  const wheel = sec.createDiv({ cls: "second-brain-wheel" });
  const svgNS = "http://www.w3.org/2000/svg";
  const size = 340;
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 8;
  const labelR = r * 0.65;

  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
  svg.setAttribute("width", "100%");
  svg.setAttribute("class", "second-brain-wheel-svg");

  // 9 slices × 40° each, starting at the top.
  const sliceDeg = 360 / WHEEL.length;
  for (let i = 0; i < WHEEL.length; i++) {
    const start = i * sliceDeg - 90;
    const end = (i + 1) * sliceDeg - 90;
    const slice = WHEEL[i];

    // Aliveness: scale the slice's fill opacity by recent activity. Faded =
    // dormant, bright = active. Floor at 0.28 so empty slices stay legible.
    const score = activity.get(slice.folder)?.score ?? 0;
    const alpha = (0.28 + 0.72 * Math.min(1, score / maxScore)).toFixed(2);

    const path = document.createElementNS(svgNS, "path");
    path.setAttribute("d", arcPath(cx, cy, r, start, end));
    path.setAttribute("fill", `hsla(${slice.hue}, 55%, ${slice.lightness}%, ${alpha})`);
    path.setAttribute("stroke", "var(--background-primary, #fff)");
    path.setAttribute("stroke-width", "1.5");
    path.setAttribute("class", "second-brain-wheel-slice");
    path.setAttribute("data-folder", slice.folder);
    path.addEventListener("click", () => {
      plugin.app.workspace.openLinkText(slice.folder, "", false);
    });
    const titleEl = document.createElementNS(svgNS, "title");
    titleEl.textContent = `${slice.macro} · ${slice.sub} → ${slice.folder}`;
    path.appendChild(titleEl);
    svg.appendChild(path);

    // Label at the slice midpoint, with a count badge below if the sub-area
    // has anything linked to it. The count = active habits + active projects.
    const midDeg = (start + end) / 2;
    const lx = cx + labelR * Math.cos((midDeg * Math.PI) / 180);
    const ly = cy + labelR * Math.sin((midDeg * Math.PI) / 180);
    const text = document.createElementNS(svgNS, "text");
    text.setAttribute("x", String(lx));
    text.setAttribute("y", String(ly));
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("dominant-baseline", "central");
    text.setAttribute("fill", "white");
    text.setAttribute("font-size", "13");
    text.setAttribute("font-weight", "600");
    text.setAttribute("pointer-events", "none");
    text.textContent = slice.sub;
    svg.appendChild(text);

    const counts = countByArea.get(slice.folder);
    const total = (counts?.habits ?? 0) + (counts?.projects ?? 0);
    if (total > 0) {
      const badge = document.createElementNS(svgNS, "text");
      badge.setAttribute("x", String(lx));
      badge.setAttribute("y", String(ly + 16));
      badge.setAttribute("text-anchor", "middle");
      badge.setAttribute("dominant-baseline", "central");
      badge.setAttribute("fill", "rgba(255,255,255,0.85)");
      badge.setAttribute("font-size", "11");
      badge.setAttribute("font-weight", "500");
      badge.setAttribute("pointer-events", "none");
      badge.textContent = `· ${total} ·`;
      svg.appendChild(badge);
    }
  }

  wheel.appendChild(svg);

  // ── Journey box: per sub-area, recent activity + how long since active ──
  const journey = sec.createDiv({ cls: "second-brain-section" });
  journey.createEl("h3", { text: "Journey" });
  const today = todayISO();
  for (const s of WHEEL) {
    const act = activity.get(s.folder);
    const counts = countByArea.get(s.folder);
    const linked = (counts?.habits ?? 0) + (counts?.projects ?? 0);
    let label: string;
    let cls: string;
    if (act && act.score > 0) {
      label = `active · ${act.score} this fortnight`;
      cls = "second-brain-journey-active";
    } else if (linked > 0) {
      const last = act?.lastDate
        ? `${daysBetween(act.lastDate, today)}d since activity`
        : "no recent activity";
      label = `quiet · ${last}`;
      cls = "second-brain-journey-quiet";
    } else {
      label = "empty — nothing linked yet";
      cls = "second-brain-journey-dormant";
    }
    const row = journey.createDiv({ cls: "second-brain-journey-row" });
    const dot = row.createSpan({ cls: `second-brain-journey-dot ${cls}` });
    dot.style.backgroundColor = `hsl(${s.hue}, 55%, 45%)`;
    row.createSpan({ text: `${s.macro} · ${s.sub}`, cls: "second-brain-journey-name" });
    row.createSpan({ text: label, cls: "second-brain-muted" });
  }
}

interface AreaActivity {
  score: number;
  lastDate?: string;
}

/**
 * Recent-activity score per area path over the last 14 days:
 *   + 1 per habit pass-day for habits linked to the area
 *   + 1 per project History completion (dated within 14d) for linked projects
 * Tracks the most recent activity date for the "quiet" label.
 */
async function computeAreaActivity(
  plugin: SecondBrainPlugin,
  habits: Habit[],
  projects: Project[]
): Promise<Map<string, AreaActivity>> {
  const out = new Map<string, AreaActivity>();
  const bump = (areaPath: string, date?: string) => {
    const def = areaFor(areaPath);
    if (!def) return;
    const a = out.get(def.path) ?? { score: 0 };
    a.score++;
    if (date && (!a.lastDate || date > a.lastDate)) a.lastDate = date;
    out.set(def.path, a);
  };

  const today = todayISO();
  const days: string[] = [];
  for (let i = 0; i < 14; i++) {
    const d = new Date(today + "T00:00:00");
    d.setDate(d.getDate() - i);
    days.push(toISO(d));
  }

  // Habit pass-days (file-backed habits carry areas; auto habits don't).
  for (const h of habits.filter((x) => x.status === "active" && x.areas.length)) {
    for (const iso of days) {
      const s = await habitStatusOn(plugin, h, iso);
      if (s === "pass") for (const a of h.areas) bump(a, iso);
    }
  }

  // Project History completions within the window.
  const cutoff = days[days.length - 1];
  for (const p of projects.filter((x) => x.status === "active" && x.areas.length)) {
    const content = await plugin.app.vault.read(p.file);
    const m = content.match(/^##\s+History\s*$/m);
    if (!m || m.index === undefined) continue;
    const body = content.slice(m.index + m[0].length);
    const nextRel = body.search(/^##\s+/m);
    const hist = nextRel < 0 ? body : body.slice(0, nextRel);
    for (const line of hist.split(/\r?\n/)) {
      const dm = line.match(/(\d{4}-\d{2}-\d{2})/);
      if (dm && dm[1] >= cutoff) for (const a of p.areas) bump(a, dm[1]);
    }
  }

  return out;
}

function daysBetween(fromIso: string, toIso: string): number {
  const a = new Date(fromIso + "T00:00:00").valueOf();
  const b = new Date(toIso + "T00:00:00").valueOf();
  return Math.max(0, Math.round((b - a) / 86400000));
}

/** SVG arc path from (cx,cy) center, radius r, start to end degrees. */
function arcPath(
  cx: number,
  cy: number,
  r: number,
  startDeg: number,
  endDeg: number
): string {
  const start = (startDeg * Math.PI) / 180;
  const end = (endDeg * Math.PI) / 180;
  const x1 = cx + r * Math.cos(start);
  const y1 = cy + r * Math.sin(start);
  const x2 = cx + r * Math.cos(end);
  const y2 = cy + r * Math.sin(end);
  const largeArc = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`;
}

// ── Stats: period-driven heatmap per habit ──────────────────────────────

async function renderStats(
  body: HTMLElement,
  plugin: SecondBrainPlugin,
  habits: Habit[],
  state: GoalsTabState,
  cb: GoalsTabCallbacks
) {
  const sec = body.createDiv({ cls: "second-brain-section" });
  const active = habits.filter((h) => h.status === "active");

  // ── Header: title + habit dropdown + period selector + arrows ────
  const headerRow = sec.createDiv({ cls: "second-brain-stats-header" });
  headerRow.createEl("h3", { text: "Stats", cls: "second-brain-stats-title" });

  // Habit dropdown — "All habits" (overview) or one habit (drill-in).
  const habitSelect = headerRow.createEl("select", { cls: "second-brain-select" });
  const allOpt = habitSelect.createEl("option", { text: "All habits" });
  allOpt.value = "";
  if (!state.statsHabitId) allOpt.selected = true;
  for (const h of active) {
    const opt = habitSelect.createEl("option", { text: h.name });
    opt.value = h.id;
    if (state.statsHabitId === h.id) opt.selected = true;
  }
  habitSelect.addEventListener("change", () => {
    cb.setStatsHabitId(habitSelect.value || undefined);
  });

  const select = headerRow.createEl("select", { cls: "second-brain-select" });
  for (const p of ["week", "month", "year"] as StatsPeriod[]) {
    const opt = select.createEl("option", { text: p[0].toUpperCase() + p.slice(1) });
    opt.value = p;
    if (p === state.statsPeriod) opt.selected = true;
  }
  select.addEventListener("change", () => {
    cb.setStatsPeriod(select.value as StatsPeriod);
  });

  // Measure selector — binary (did it) / count (how many) / magnitude.
  const measureSel = headerRow.createEl("select", { cls: "second-brain-select" });
  const measureLabels: Record<StatsMeasure, string> = {
    binary: "Did it",
    count: "How many",
    magnitude: "How much",
  };
  for (const m of ["binary", "count", "magnitude"] as StatsMeasure[]) {
    const opt = measureSel.createEl("option", { text: measureLabels[m] });
    opt.value = m;
    if (m === state.statsMeasure) opt.selected = true;
  }
  measureSel.addEventListener("change", () => {
    cb.setStatsMeasure(measureSel.value as StatsMeasure);
  });

  const nav = headerRow.createDiv({ cls: "second-brain-stats-nav" });
  const back = nav.createEl("button", {
    text: "◀",
    cls: "second-brain-iconbtn",
    attr: { title: `Previous ${state.statsPeriod}` },
  });
  back.addEventListener("click", () => cb.setStatsOffset(state.statsOffset + 1));

  nav.createEl("span", {
    cls: "second-brain-stats-period-label",
    text: periodLabel(state.statsPeriod, state.statsOffset),
  });

  const fwd = nav.createEl("button", {
    text: "▶",
    cls: "second-brain-iconbtn",
    attr: { title: `Next ${state.statsPeriod}` },
  });
  if (state.statsOffset <= 0) {
    fwd.setAttribute("disabled", "true");
  } else {
    fwd.addEventListener("click", () => cb.setStatsOffset(state.statsOffset - 1));
  }

  if (active.length === 0) {
    sec.createEl("div", {
      cls: "second-brain-muted",
      text: "No habits to chart yet.",
    });
    return;
  }

  // Filter visible habits based on dropdown.
  const visible = state.statsHabitId
    ? active.filter((h) => h.id === state.statsHabitId)
    : active;

  // Today's progress badge — only on "All habits" + current period.
  if (!state.statsHabitId && state.statsOffset === 0) {
    const todayStatus = await readTodayHabitStatus(
      plugin.app,
      plugin.settings.reviewsPathTemplate
    );
    const todayIso = todayISO();
    let passed = 0;
    for (const h of active) {
      const st = h.auto
        ? await habitStatusOn(plugin, h, todayIso)
        : manualMarkFor(todayIso, h.id) ?? todayStatus.get(h.id);
      if (st === "pass") passed++;
    }
    sec.createEl("div", {
      cls: "second-brain-stats-today-badge",
      text: `🎯 ${passed}/${active.length} habits today`,
      attr: { title: "Habits passing today (manual marks + AI + auto)" },
    });
  }

  // Numeric stats panel — only when a specific habit is selected.
  if (state.statsHabitId && visible.length === 1) {
    await renderNumericStatsFor(sec, plugin, visible[0]);
  }

  if (state.statsPeriod === "week") {
    await renderStatsWeek(sec, plugin, visible, state.statsOffset, state.statsMeasure);
  } else if (state.statsPeriod === "year") {
    await renderStatsYear(sec, plugin, visible, state.statsOffset, state.statsMeasure);
  } else {
    await renderStatsMonth(sec, plugin, visible, state.statsOffset, state.statsMeasure);
  }

  sec.createEl("p", {
    cls: "second-brain-muted",
    text: "Want yearly heatmaps inside any markdown note? Embed the data files at 🤖 AI/Habit-Data/<id>.md with the Heatmap Calendar plugin.",
  });
}

/**
 * Numeric stats panel — current streak, best streak ever, total pass count
 * in the rolling window, completion percentage in that window, and total
 * pass count all-time. Kept deliberately simple: four numbers and a percent.
 * Shown only when a single habit is selected from the dropdown.
 */
async function renderNumericStatsFor(
  sec: HTMLElement,
  plugin: SecondBrainPlugin,
  habit: Habit
) {
  const today = todayISO();
  const yearDays = 365;
  const allCells = await collectHabitStrip(plugin, habit, today, yearDays);
  const streak = await computeStreak(plugin, habit, today, yearDays);
  const best = computeBestStreak(allCells);
  const passCount = allCells.filter((c) => c.status === "pass").length;
  const evaluated = allCells.filter(
    (c) => c.status === "pass" || c.status === "uncertain" || c.status === "fail"
  ).length;
  const pct = evaluated === 0 ? 0 : Math.round((passCount / evaluated) * 100);

  const panel = sec.createDiv({ cls: "second-brain-stats-numeric" });
  numericTile(panel, "🔥 Current", streak.current === 0 ? "—" : `${streak.current}d`);
  numericTile(panel, "🏆 Best", best === 0 ? "—" : `${best}d`);
  numericTile(panel, "✅ Pass (1y)", `${passCount}`);
  numericTile(panel, "📊 Rate (1y)", evaluated === 0 ? "—" : `${pct}%`);
}

function numericTile(parent: HTMLElement, label: string, value: string) {
  const tile = parent.createDiv({ cls: "second-brain-stats-tile" });
  tile.createEl("div", { cls: "second-brain-stats-tile-label", text: label });
  tile.createEl("div", { cls: "second-brain-stats-tile-value", text: value });
}

export function computeBestStreak(cells: HabitDayCell[]): number {
  // Cells are oldest-first. A streak = consecutive run of pass OR uncertain.
  let best = 0;
  let cur = 0;
  for (const c of cells) {
    if (c.status === "pass" || c.status === "uncertain") {
      cur++;
      if (cur > best) best = cur;
    } else if (c.status === "fail") {
      cur = 0;
    }
    // "missing" doesn't break or grow the streak — neutral.
  }
  return best;
}

/**
 * Month view (default) — N-day linear strip ending at the period's last day.
 * Offset 0 = ending today; offset 1 = ending 30 days ago; etc.
 */
async function renderStatsMonth(
  sec: HTMLElement,
  plugin: SecondBrainPlugin,
  active: Habit[],
  offset: number,
  measure: StatsMeasure
) {
  const days = 30;
  const endIso = (() => {
    const d = new Date(todayISO() + "T00:00:00");
    d.setDate(d.getDate() - offset * days);
    return toISO(d);
  })();
  const dates: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(endIso + "T00:00:00");
    d.setDate(d.getDate() - i);
    dates.push(toISO(d));
  }
  for (const h of active) {
    const { map, max } = await computeCells(plugin, h, dates, measure);
    const streak = await computeStreak(plugin, h, todayISO(), 365);
    const row = sec.createDiv({ cls: "second-brain-habit-strip-row" });
    row.createEl("div", { text: h.name, cls: "second-brain-habit-strip-label" });
    const grid = row.createDiv({ cls: "second-brain-habit-strip" });
    for (const iso of dates) paintCell(grid, iso, map.get(iso), measure, max);
    row.createEl("div", {
      cls: "second-brain-habit-streak-badge",
      text: offset === 0 && streak.current > 0 ? `🔥 ${streak.current}` : "",
      attr: {
        title:
          streak.current === 0
            ? "No active streak"
            : `Current streak: ${streak.current} day${streak.current === 1 ? "" : "s"}`,
      },
    });
  }
}

/**
 * Week view — Loop Habit-style calendar grid. Rows are days of the week
 * (Sun → Sat), columns are weeks. 12 weeks per offset window. Each habit
 * gets its own grid. Patterns ("I never run on Mondays") jump out visually.
 */
async function renderStatsWeek(
  sec: HTMLElement,
  plugin: SecondBrainPlugin,
  active: Habit[],
  offset: number,
  measure: StatsMeasure
) {
  const weeksPerWindow = 12;
  // Anchor: most-recent Saturday on the right edge, offset back by `offset`
  // windows.
  const today = new Date(todayISO() + "T00:00:00");
  const todayDow = today.getDay(); // 0 = Sun .. 6 = Sat
  const daysToSat = (6 - todayDow + 7) % 7;
  const rightmostSat = new Date(today.valueOf());
  rightmostSat.setDate(today.getDate() + daysToSat - offset * weeksPerWindow * 7);
  const leftmostSun = new Date(rightmostSat.valueOf());
  leftmostSun.setDate(rightmostSat.getDate() - (weeksPerWindow * 7 - 1));

  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  // All dates in the window (value pre-pass).
  const allDates: string[] = [];
  for (let w = 0; w < weeksPerWindow; w++) {
    for (let dow = 0; dow < 7; dow++) {
      const d = new Date(leftmostSun.valueOf());
      d.setDate(d.getDate() + w * 7 + dow);
      allDates.push(toISO(d));
    }
  }

  for (const h of active) {
    const { map, max } = await computeCells(plugin, h, allDates, measure);
    const wrap = sec.createDiv({ cls: "second-brain-week-grid-wrap" });
    wrap.createEl("div", {
      text: h.name,
      cls: "second-brain-habit-strip-label second-brain-week-grid-title",
    });

    const grid = wrap.createDiv({ cls: "second-brain-week-grid" });

    // Header row of weekday labels.
    grid.createEl("div", { cls: "second-brain-week-cell-empty" });
    for (let w = 0; w < weeksPerWindow; w++) {
      grid.createEl("div", { cls: "second-brain-week-cell-empty" });
    }
    // 7 rows: one per day-of-week.
    for (let dow = 0; dow < 7; dow++) {
      grid.createEl("div", {
        cls: "second-brain-week-dow-label",
        text: dayNames[dow],
      });
      for (let w = 0; w < weeksPerWindow; w++) {
        const cellDate = new Date(leftmostSun.valueOf());
        cellDate.setDate(cellDate.getDate() + w * 7 + dow);
        const iso = toISO(cellDate);
        paintCell(grid, iso, map.get(iso), measure, max);
      }
    }
  }
}

type CellStatus = "pass" | "uncertain" | "fail" | "missing";

/**
 * Central per-date status that respects habit kind:
 *   - auto "capture" → did the day's log get a capture (deterministic)
 *   - auto "review" / weekly periodicity → evaluate the whole ISO week
 *   - daily file-backed → read the LLM's status from that day's review
 */
export async function habitStatusOn(
  plugin: SecondBrainPlugin,
  habit: Habit,
  iso: string
): Promise<CellStatus> {
  // Manual marks win over everything for file-backed habits (auto-habits are
  // deterministic from vault state and aren't hand-tickable).
  if (!habit.auto) {
    const mark = manualMarkFor(iso, habit.id);
    if (mark) return mark;
  }
  if (habit.auto === "capture") return captureStatusOnDate(plugin, iso);
  if (habit.auto === "review" || habit.periodicity === "weekly") {
    return weekStatusFor(plugin, habit, iso);
  }
  return statusForHabitOnDate(plugin, habit.id, iso);
}

/** Deterministic: pass if that day's daily log has ≥1 [HH:MM] capture. */
async function captureStatusOnDate(
  plugin: SecondBrainPlugin,
  iso: string
): Promise<CellStatus> {
  const path = await resolveDailyLogPath(plugin.app, plugin.settings, iso);
  const f = plugin.app.vault.getAbstractFileByPath(path);
  if (!(f instanceof TFile)) return "missing";
  const c = await plugin.app.vault.read(f);
  return /^\[\d{2}:\d{2}\]/m.test(c) ? "pass" : "missing";
}

/** Sunday-start week containing iso → 7 ISO date strings. */
function weekDatesOf(iso: string): string[] {
  const d = new Date(iso + "T00:00:00");
  const sun = new Date(d.valueOf());
  sun.setDate(d.getDate() - d.getDay());
  const out: string[] = [];
  for (let i = 0; i < 7; i++) {
    const x = new Date(sun.valueOf());
    x.setDate(sun.getDate() + i);
    out.push(toISO(x));
  }
  return out;
}

/**
 * Weekly status. For the "review" auto-habit: pass if any review (daily or
 * weekly) exists in the week. For a file-backed weekly habit: pass if any day
 * in the week passed; fail if a day failed and none passed; else missing.
 */
async function weekStatusFor(
  plugin: SecondBrainPlugin,
  habit: Habit,
  iso: string
): Promise<CellStatus> {
  const dates = weekDatesOf(iso);

  if (habit.auto === "review") {
    for (const dt of dates) {
      const p = applyDatePlaceholders(plugin.settings.reviewsPathTemplate, dt);
      if (plugin.app.vault.getAbstractFileByPath(p) instanceof TFile) {
        return "pass";
      }
    }
    // Weekly review file (Monday anchors the ISO week).
    const wp = applyDatePlaceholders(
      "🤖 AI/Reviews/Weekly/{ISO_YEAR}-W{WW}.md",
      dates[1] ?? iso
    );
    if (plugin.app.vault.getAbstractFileByPath(wp) instanceof TFile) {
      return "pass";
    }
    return "missing";
  }

  let sawFail = false;
  for (const dt of dates) {
    const s = manualMarkFor(dt, habit.id) ?? (await statusForHabitOnDate(plugin, habit.id, dt));
    if (s === "pass") return "pass";
    if (s === "fail") sawFail = true;
  }
  return sawFail ? "fail" : "missing";
}

async function statusForHabitOnDate(
  plugin: SecondBrainPlugin,
  habitId: string,
  iso: string
): Promise<CellStatus> {
  const path = applyDatePlaceholders(
    plugin.settings.reviewsPathTemplate,
    iso
  );
  const file = plugin.app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return "missing";
  const content = await plugin.app.vault.read(file);
  return parseHabitStatusFromReview(content, habitId) ?? "missing";
}

// ── Stat dimensions (v0.9.8): value extraction + intensity rendering ──────

interface ValuedCell {
  status: CellStatus;
  value: number;
  future: boolean;
}

/** # of [HH:MM] captures in a day's log (capture-habit count measure). */
async function captureCountOn(plugin: SecondBrainPlugin, iso: string): Promise<number> {
  const path = await resolveDailyLogPath(plugin.app, plugin.settings, iso);
  const f = plugin.app.vault.getAbstractFileByPath(path);
  if (!(f instanceof TFile)) return 0;
  const c = await plugin.app.vault.read(f);
  return (c.match(/^\[\d{2}:\d{2}\]/gm) ?? []).length;
}

/** Word count of a day's log (capture-habit magnitude = raw volume). */
async function captureWordsOn(plugin: SecondBrainPlugin, iso: string): Promise<number> {
  const path = await resolveDailyLogPath(plugin.app, plugin.settings, iso);
  const f = plugin.app.vault.getAbstractFileByPath(path);
  if (!(f instanceof TFile)) return 0;
  const c = await plugin.app.vault.read(f);
  const words = c.replace(/^\[\d{2}:\d{2}\]/gm, " ").trim().split(/\s+/).filter(Boolean);
  return words.length;
}

/** Parse the first number out of a habit's line in the day's review. */
async function magnitudeFromReview(
  plugin: SecondBrainPlugin,
  habitId: string,
  iso: string
): Promise<number | null> {
  const path = applyDatePlaceholders(plugin.settings.reviewsPathTemplate, iso);
  const file = plugin.app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return null;
  const content = await plugin.app.vault.read(file);
  const section = extractSection(content, "Today's habits status");
  if (!section) return null;
  const re = new RegExp(`^\\s*-\\s+(?:✅|⚠️|❌)\\s+${escapeRegex(habitId)}\\s*[—-].*$`, "m");
  const m = section.match(re);
  if (!m) return null;
  const num = m[0].match(/(\d+(?:\.\d+)?)/);
  return num ? parseFloat(num[1]) : null;
}

/** Status + numeric value for a habit on a date, under the chosen measure. */
async function habitValuedOn(
  plugin: SecondBrainPlugin,
  habit: Habit,
  iso: string,
  measure: StatsMeasure
): Promise<{ status: CellStatus; value: number }> {
  const status = await habitStatusOn(plugin, habit, iso);
  const passish = status === "pass" || status === "uncertain";

  if (measure === "binary") return { status, value: passish ? 1 : 0 };

  if (habit.auto === "capture") {
    const value =
      measure === "count"
        ? await captureCountOn(plugin, iso)
        : await captureWordsOn(plugin, iso);
    return { status, value };
  }

  // File-backed (and weekly/review auto) habits don't track sub-day instances.
  if (measure === "magnitude") {
    const mag = await magnitudeFromReview(plugin, habit.id, iso);
    return { status, value: mag ?? (passish ? 1 : 0) };
  }
  // count → degenerates to binary for non-capture habits.
  return { status, value: passish ? 1 : 0 };
}

/** Pre-compute status+value for a window of dates; also return the max value. */
async function computeCells(
  plugin: SecondBrainPlugin,
  habit: Habit,
  dates: string[],
  measure: StatsMeasure
): Promise<{ map: Map<string, ValuedCell>; max: number }> {
  const map = new Map<string, ValuedCell>();
  const today = new Date(todayISO() + "T00:00:00");
  let max = 0;
  for (const iso of dates) {
    const future = new Date(iso + "T00:00:00") > today;
    if (future) {
      map.set(iso, { status: "missing", value: 0, future: true });
      continue;
    }
    const { status, value } = await habitValuedOn(plugin, habit, iso, measure);
    if (value > max) max = value;
    map.set(iso, { status, value, future: false });
  }
  return { map, max };
}

/**
 * Build a cell div for the heatmap. Binary → status colors. Count/magnitude →
 * green intensity scaled to the window max (darker = more); zero/missing gray.
 */
function paintCell(
  grid: HTMLElement,
  iso: string,
  cell: ValuedCell | undefined,
  measure: StatsMeasure,
  max: number
): void {
  if (!cell || cell.future) {
    grid.createDiv({ cls: "second-brain-habit-cell second-brain-habit-cell-future" });
    return;
  }
  if (measure === "binary" || max <= 0) {
    grid.createDiv({
      cls: `second-brain-habit-cell ${cellClass(cell.status)}`,
      attr: { title: `${iso} — ${cell.status}` },
    });
    return;
  }
  if (cell.value <= 0) {
    grid.createDiv({
      cls: "second-brain-habit-cell second-brain-habit-cell-missing",
      attr: { title: `${iso} — 0` },
    });
    return;
  }
  const ratio = Math.min(1, cell.value / max);
  const el = grid.createDiv({
    cls: "second-brain-habit-cell",
    attr: { title: `${iso} — ${cell.value}` },
  });
  el.style.backgroundColor = `hsla(135, 55%, 42%, ${(0.25 + 0.75 * ratio).toFixed(2)})`;
}

function periodLabel(period: StatsPeriod, offset: number): string {
  if (offset === 0) {
    if (period === "week") return "Last 12 weeks";
    if (period === "month") return "Last 30 days";
    return "Last 52 weeks";
  }
  const back = offset;
  if (period === "week") return `${back * 12} weeks ago`;
  if (period === "month") return `${back * 30} days ago`;
  return `${back} year${back === 1 ? "" : "s"} ago`;
}

/**
 * Year view — GitHub-style 53-week × 7-day grid per habit. Days that haven't
 * passed yet render in the lightest shade; days that passed but weren't
 * logged render in a darker neutral; fulfilled days take the colored shade
 * (pass = green, uncertain = amber, fail = red). Patterns over a long arc
 * become visible: seasonality, plateaus, recoveries.
 */
async function renderStatsYear(
  sec: HTMLElement,
  plugin: SecondBrainPlugin,
  active: Habit[],
  offset: number,
  measure: StatsMeasure
) {
  const weeks = 52;
  const today = new Date(todayISO() + "T00:00:00");
  const todayDow = today.getDay();
  const daysToSat = (6 - todayDow + 7) % 7;
  const rightmostSat = new Date(today.valueOf());
  rightmostSat.setDate(today.getDate() + daysToSat - offset * weeks * 7);
  const leftmostSun = new Date(rightmostSat.valueOf());
  leftmostSun.setDate(rightmostSat.getDate() - (weeks * 7 - 1));

  // Month labels — show the month name above the first column where that
  // month begins, so the year strip is readable left-to-right.
  const dayNames = ["S", "M", "T", "W", "T", "F", "S"];

  // All dates in the window (for the value pre-pass).
  const allDates: string[] = [];
  for (let w = 0; w < weeks; w++) {
    for (let dow = 0; dow < 7; dow++) {
      const d = new Date(leftmostSun.valueOf());
      d.setDate(d.getDate() + w * 7 + dow);
      allDates.push(toISO(d));
    }
  }

  for (const h of active) {
    const { map, max } = await computeCells(plugin, h, allDates, measure);
    const wrap = sec.createDiv({ cls: "second-brain-week-grid-wrap" });
    wrap.createEl("div", {
      text: h.name,
      cls: "second-brain-habit-strip-label second-brain-week-grid-title",
    });

    const monthRow = wrap.createDiv({ cls: "second-brain-year-month-row" });
    monthRow.createEl("div", { cls: "second-brain-week-cell-empty" });
    let lastMonth = -1;
    for (let w = 0; w < weeks; w++) {
      const colDate = new Date(leftmostSun.valueOf());
      colDate.setDate(colDate.getDate() + w * 7);
      const m = colDate.getMonth();
      const cell = monthRow.createEl("div", {
        cls: "second-brain-year-month-label",
      });
      if (m !== lastMonth) {
        cell.setText(colDate.toLocaleDateString("en-US", { month: "short" }));
        lastMonth = m;
      }
    }

    const grid = wrap.createDiv({ cls: "second-brain-year-grid" });
    for (let dow = 0; dow < 7; dow++) {
      grid.createEl("div", {
        cls: "second-brain-week-dow-label",
        text: dayNames[dow],
      });
      for (let w = 0; w < weeks; w++) {
        const cellDate = new Date(leftmostSun.valueOf());
        cellDate.setDate(cellDate.getDate() + w * 7 + dow);
        const iso = toISO(cellDate);
        paintCell(grid, iso, map.get(iso), measure, max);
      }
    }
  }
}

export interface HabitDayCell {
  date: string;
  status: "pass" | "uncertain" | "fail" | "missing";
  evidence?: string;
}

export async function collectHabitStrip(
  plugin: SecondBrainPlugin,
  habit: Habit,
  today: string,
  days: number
): Promise<HabitDayCell[]> {
  const out: HabitDayCell[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today + "T00:00:00");
    d.setDate(d.getDate() - i);
    const dateStr = toISO(d);
    out.push({ date: dateStr, status: await habitStatusOn(plugin, habit, dateStr) });
  }
  return out;
}

export function cellClass(s: HabitDayCell["status"]): string {
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

/**
 * Walk backwards from `today` reading each day's review file, parse the
 * "## Today's habits status" section, and count consecutive "pass" days for
 * this habit. Uncertain counts as pass (optimistic default). A miss or
 * absence of review breaks the streak.
 */
export async function computeStreak(
  plugin: SecondBrainPlugin,
  habit: Habit,
  today: string,
  maxLookback: number
): Promise<{ current: number; lastEvidence?: string }> {
  let streak = 0;
  for (let i = 0; i < maxLookback; i++) {
    const d = new Date(today + "T00:00:00");
    d.setDate(d.getDate() - i);
    const dateStr = toISO(d);
    const status = await habitStatusOn(plugin, habit, dateStr);
    if (status === "fail") break;
    if (status === "pass" || status === "uncertain") {
      streak++;
    } else {
      // Missing today is OK (still might happen); past missing breaks.
      if (i === 0) continue;
      break;
    }
  }
  return { current: streak };
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
