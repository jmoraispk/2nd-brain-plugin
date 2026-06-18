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
import { Project, loadProjects, PROJECTS_FOLDER, normalizeAreaPath } from "./projects";
import { ProjectCreateModal } from "./projectCreateModal";
import { applyDatePlaceholders, todayISO, toISO } from "./paths";

export type GoalsSubtab = "habits" | "projects" | "areas" | "stats";
export type StatsPeriod = "week" | "month" | "year";

export interface GoalsTabState {
  subtab: GoalsSubtab;
  /** Stats sub-tab — period granularity. */
  statsPeriod: StatsPeriod;
  /** Stats sub-tab — how many periods back from now (0 = current). */
  statsOffset: number;
  /** Stats sub-tab — which habit to drill into. undefined = "All habits". */
  statsHabitId?: string;
}

export function defaultGoalsTabState(): GoalsTabState {
  return { subtab: "habits", statsPeriod: "month", statsOffset: 0 };
}

export interface GoalsTabCallbacks {
  setSubtab: (t: GoalsSubtab) => void;
  onChanged: () => void;
  runCommand: (commandId: string) => void;
  setStatsPeriod: (p: StatsPeriod) => void;
  setStatsOffset: (n: number) => void;
  setStatsHabitId: (id: string | undefined) => void;
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
    { id: "projects", label: "List" },
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
  } else if (state.subtab === "areas") {
    const habits = await loadHabits(plugin.app);
    const projects = await loadProjects(plugin.app);
    renderAreas(body, plugin, habits, projects);
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

  // Secondary actions row, below the table — less visually loud than the
  // previous header-bar placement.
  const actions = sec.createDiv({ cls: "second-brain-secondary-actions" });

  const draftBtn = actions.createEl("button", {
    text: "✨ Draft Habit",
    cls: "second-brain-button",
    attr: {
      title:
        "AI drafts a new habit (or boosts an existing one) — Define / Why / Plan / Environment / Recover.",
    },
  });
  draftBtn.addEventListener("click", () => cb.runCommand("draft-habit"));

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
    for (const col of ["Project", "Area", "Status", "Created", "Target"]) {
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
      tr.createEl("td", { text: p.area ?? "—" });
      tr.createEl("td", { text: p.status });
      tr.createEl("td", { text: p.created ?? "—" });
      tr.createEl("td", { text: p.targetDate ?? "—" });
    }
  }

  // Secondary action row mirrors the Habits tab pattern.
  const actions = sec.createDiv({ cls: "second-brain-secondary-actions" });
  const newBtn = actions.createEl("button", {
    text: "+ New Project",
    cls: "second-brain-button second-brain-button-primary",
    attr: {
      title:
        "Create a project file under 1. 🎯 Projects/ with an area link and SMART scaffold (Why · Done criteria · Status · Next steps).",
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

function renderAreas(
  body: HTMLElement,
  plugin: SecondBrainPlugin,
  habits: Habit[],
  projects: Project[]
) {
  const sec = body.createDiv({ cls: "second-brain-section second-brain-wheel-section" });
  sec.createEl("h3", { text: "Wheel of Life" });
  sec.createEl("p", {
    cls: "second-brain-muted",
    text: "Click slice to open the folder. Numbers show habits + projects linked to each sub-area.",
  });

  // Count habits + projects per sub-area path so we can show connections.
  const countByArea = new Map<string, { habits: number; projects: number }>();
  for (const h of habits.filter((x) => x.status === "active")) {
    const a = normalizeAreaPath(h.area);
    if (!a) continue;
    const slot = countByArea.get(a) ?? { habits: 0, projects: 0 };
    slot.habits++;
    countByArea.set(a, slot);
  }
  for (const p of projects.filter((x) => x.status === "active")) {
    const a = normalizeAreaPath(p.area);
    if (!a) continue;
    const slot = countByArea.get(a) ?? { habits: 0, projects: 0 };
    slot.projects++;
    countByArea.set(a, slot);
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

    const path = document.createElementNS(svgNS, "path");
    path.setAttribute("d", arcPath(cx, cy, r, start, end));
    path.setAttribute("fill", `hsl(${slice.hue}, 55%, ${slice.lightness}%)`);
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
    let passed = 0;
    for (const h of active) {
      if (todayStatus.get(h.id) === "pass") passed++;
    }
    sec.createEl("div", {
      cls: "second-brain-stats-today-badge",
      text: `🎯 ${passed}/${active.length} habits today`,
      attr: { title: "Habits with explicit pass status in today's review" },
    });
  }

  // Numeric stats panel — only when a specific habit is selected.
  if (state.statsHabitId && visible.length === 1) {
    await renderNumericStatsFor(sec, plugin, visible[0]);
  }

  if (state.statsPeriod === "week") {
    await renderStatsWeek(sec, plugin, visible, state.statsOffset);
  } else if (state.statsPeriod === "year") {
    await renderStatsYear(sec, plugin, visible, state.statsOffset);
  } else {
    await renderStatsMonth(sec, plugin, visible, state.statsOffset);
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
  const allCells = await collectHabitStrip(plugin, habit.id, today, yearDays);
  const streak = await computeStreak(plugin, habit.id, today, yearDays);
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

function computeBestStreak(cells: HabitDayCell[]): number {
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
  offset: number
) {
  const days = 30;
  const endIso = (() => {
    const d = new Date(todayISO() + "T00:00:00");
    d.setDate(d.getDate() - offset * days);
    return toISO(d);
  })();
  for (const h of active) {
    const cells = await collectHabitStrip(plugin, h.id, endIso, days);
    const streak = await computeStreak(plugin, h.id, todayISO(), 365);
    const row = sec.createDiv({ cls: "second-brain-habit-strip-row" });
    row.createEl("div", { text: h.name, cls: "second-brain-habit-strip-label" });
    const grid = row.createDiv({ cls: "second-brain-habit-strip" });
    for (const cell of cells) {
      grid.createDiv({
        cls: `second-brain-habit-cell ${cellClass(cell.status)}`,
        attr: { title: `${cell.date} — ${cell.status}` },
      });
    }
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
  offset: number
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

  for (const h of active) {
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
        if (cellDate > today) {
          grid.createEl("div", { cls: "second-brain-habit-cell second-brain-habit-cell-future" });
          continue;
        }
        const status = await statusForHabitOnDate(plugin, h.id, iso);
        grid.createEl("div", {
          cls: `second-brain-habit-cell ${cellClass(status)}`,
          attr: { title: `${iso} — ${status}` },
        });
      }
    }
  }
}

async function statusForHabitOnDate(
  plugin: SecondBrainPlugin,
  habitId: string,
  iso: string
): Promise<"pass" | "uncertain" | "fail" | "missing"> {
  const path = applyDatePlaceholders(
    plugin.settings.reviewsPathTemplate,
    iso
  );
  const file = plugin.app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return "missing";
  const content = await plugin.app.vault.read(file);
  return parseHabitStatusFromReview(content, habitId) ?? "missing";
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
  offset: number
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

  for (const h of active) {
    const wrap = sec.createDiv({ cls: "second-brain-week-grid-wrap" });
    wrap.createEl("div", {
      text: h.name,
      cls: "second-brain-habit-strip-label second-brain-week-grid-title",
    });

    // Month-label row (columns).
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
        cell.setText(
          colDate.toLocaleDateString("en-US", { month: "short" })
        );
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
        if (cellDate > today) {
          grid.createEl("div", {
            cls: "second-brain-habit-cell second-brain-habit-cell-future",
          });
          continue;
        }
        const status = await statusForHabitOnDate(plugin, h.id, iso);
        grid.createEl("div", {
          cls: `second-brain-habit-cell ${cellClass(status)}`,
          attr: { title: `${iso} — ${status}` },
        });
      }
    }
  }
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
