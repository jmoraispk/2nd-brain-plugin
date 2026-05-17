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
import { applyDatePlaceholders, todayISO, toISO } from "./paths";

export type GoalsSubtab = "habits" | "projects" | "areas" | "stats" | "streaks";

export interface GoalsTabState {
  subtab: GoalsSubtab;
}

export function defaultGoalsTabState(): GoalsTabState {
  return { subtab: "habits" };
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
  const subtabs: Array<{ id: GoalsSubtab; label: string }> = [
    { id: "habits", label: "Habits" },
    { id: "projects", label: "Projects" },
    { id: "areas", label: "Areas" },
    { id: "stats", label: "Stats" },
    { id: "streaks", label: "Streaks" },
  ];
  for (const t of subtabs) {
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
    renderAreas(body, plugin);
  } else if (state.subtab === "stats") {
    const habits = await loadHabits(plugin.app);
    await renderStats(body, plugin, habits);
  } else {
    const habits = await loadHabits(plugin.app);
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

function renderAreas(body: HTMLElement, plugin: SecondBrainPlugin) {
  const sec = body.createDiv({ cls: "second-brain-section second-brain-wheel-section" });
  sec.createEl("h3", { text: "Wheel of Life" });
  sec.createEl("p", {
    cls: "second-brain-muted",
    text: "Click slice to open the folder.",
  });

  // Legend above the wheel.
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
    row.createSpan({
      text: ` ${macro} — ${slices.map((s) => s.sub).join(" · ")}`,
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

    // Label at the slice midpoint.
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
