import { TFile, TFolder } from "obsidian";
import SecondBrainPlugin from "../main";
import {
  resolveDailyLogPath,
  applyDatePlaceholders,
  todayISO,
  toISO,
  pad2,
  isoWeek,
  anchorForInputKind,
  periodLabel,
} from "./paths";
import { loadProjects } from "./projects";
import { loadPendingProposals, Proposal } from "./proposals";

export interface PendingReview {
  commandId: string;
  label: string;
  /** Resolved output path — needed for the skip button to write a marker there. */
  outputPath: string;
  /** Optional anchor override for per-day daily reviews; undefined for "last-X" commands. */
  anchorOverride?: string;
}

/**
 * For each "last X" period type (week, month, quarter, year), check whether
 * the canonical review file for the most recent past period already exists.
 * Return one entry per period type that's still unreviewed.
 *
 * We deliberately only look one period back (last week, last month, etc.) —
 * not further. Users said they want to be nudged about the most recent
 * missing review, not nagged about old ones they intentionally skipped.
 */
export function computePendingReviews(plugin: SecondBrainPlugin): PendingReview[] {
  const checks: Array<{
    commandId: string;
    inputKind: string;
    pathTemplate: string;
  }> = [
    {
      commandId: "review-last-week",
      inputKind: "last-week-logs",
      pathTemplate: "🤖 AI/Reviews/Weekly/{ISO_YEAR}-W{WW}.md",
    },
    {
      commandId: "review-last-month",
      inputKind: "last-month-logs",
      pathTemplate: "🤖 AI/Reviews/Monthly/{YYYY-MM}.md",
    },
    {
      commandId: "review-last-quarter",
      inputKind: "last-quarter-logs",
      pathTemplate: "🤖 AI/Reviews/Quarterly/{YYYY}-Q{Q}.md",
    },
    {
      commandId: "review-last-year",
      inputKind: "last-year-logs",
      pathTemplate: "🤖 AI/Reviews/Yearly/{YYYY}.md",
    },
  ];

  const pending: PendingReview[] = [];
  for (const c of checks) {
    const anchor = anchorForInputKind(c.inputKind);
    const path = applyDatePlaceholders(c.pathTemplate, anchor);
    const existing = plugin.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) continue;
    pending.push({
      commandId: c.commandId,
      label: periodLabel(c.inputKind),
      outputPath: path,
    });
  }
  return pending;
}

/**
 * Surface daily reviews missing for the last `daysBack` days. Only days that
 * have an actual daily log (some captures) qualify — days with no log produce
 * no banner row, since there's nothing to review.
 */
export async function computePendingDailies(
  plugin: SecondBrainPlugin,
  daysBack = 7
): Promise<PendingReview[]> {
  const pending: PendingReview[] = [];
  const today = new Date();
  for (let i = 1; i <= daysBack; i++) {
    const d = new Date(today.valueOf());
    d.setDate(d.getDate() - i);
    const date = toISO(d);

    // Already reviewed? Check both the current templated path AND walk the
    // daily-reviews folder recursively for a matching <date>.md anywhere
    // (catches files at legacy flat paths from before the v0.6.4 nest migration).
    if (dailyReviewExistsAnywhere(plugin, date)) continue;

    // Did the user even capture that day? If not, don't nag.
    const logPath = await resolveDailyLogPath(plugin.app, plugin.settings, date);
    const logFile = plugin.app.vault.getAbstractFileByPath(logPath);
    if (!(logFile instanceof TFile)) continue;

    pending.push({
      commandId: "todays-review",
      anchorOverride: date,
      outputPath: applyDatePlaceholders(
        plugin.settings.reviewsPathTemplate,
        date
      ),
      label: formatDailyLabel(date),
    });
  }
  return pending;
}

/**
 * Return true if a daily review for `date` exists anywhere under
 * `🤖 AI/Reviews/Daily/` — at the current template path, at a legacy flat
 * path, or in any nested year/quarter/week folder. Closes the v0.6.4
 * regression where pre-migration files were flagged as pending.
 */
function dailyReviewExistsAnywhere(
  plugin: SecondBrainPlugin,
  date: string
): boolean {
  const templatePath = applyDatePlaceholders(
    plugin.settings.reviewsPathTemplate,
    date
  );
  if (plugin.app.vault.getAbstractFileByPath(templatePath)) return true;

  const root = plugin.app.vault.getAbstractFileByPath("🤖 AI/Reviews/Daily");
  if (!(root instanceof TFolder)) return false;
  return walkForFilename(root, `${date}.md`);
}

function walkForFilename(folder: TFolder, target: string): boolean {
  for (const c of folder.children) {
    if (c instanceof TFile && c.name === target) return true;
    if (c instanceof TFolder && walkForFilename(c, target)) return true;
  }
  return false;
}

function formatDailyLabel(date: string): string {
  const d = new Date(date + "T00:00:00");
  const wk = d.toLocaleDateString("en-US", { weekday: "short" });
  const mo = d.toLocaleDateString("en-US", { month: "short" });
  return `Daily ${wk} ${mo} ${d.getDate()}`;
}

/**
 * Write a "Skipped" marker at the target path so the existence check treats
 * the review as done. User can unskip by deleting the file in Obsidian.
 */
export async function skipReview(
  plugin: SecondBrainPlugin,
  outputPath: string
): Promise<void> {
  const parts = outputPath.split("/");
  parts.pop();
  const folder = parts.join("/");
  if (folder && !plugin.app.vault.getAbstractFileByPath(folder)) {
    await plugin.app.vault.createFolder(folder);
  }
  const content = `---\nskipped: true\nskippedOn: ${todayISO()}\n---\n\n_Skipped — delete this file to bring back the pending-review prompt._\n`;
  await plugin.app.vault.create(outputPath, content);
}

/**
 * Render the dashboard sections into `parent`. Heuristic-only, no LLM
 * calls — all data comes from local vault reads. Re-rendering is cheap.
 *
 * Order: displayed-day section first (with ◀ ▶ navigation, capped at
 * yesterday → today), then pending reviews, then context.
 */
export interface DashboardCallbacks {
  onAction: (id: "capture" | "this-review") => void;
  onChangeDate: (newDate: string) => void;
  onRunCommand: (commandId: string, anchorOverride?: string) => void;
  onRefresh: () => void;
  togglePendingCollapsed: () => void;
  onAcceptProposal: (date: string, proposalId: string) => Promise<void>;
  onDeleteProposal: (date: string, proposalId: string) => Promise<void>;
}

export async function renderDashboard(
  parent: HTMLElement,
  plugin: SecondBrainPlugin,
  displayedDate: string,
  pendingCollapsed: boolean,
  cb: DashboardCallbacks
): Promise<void> {
  const body = parent.createDiv({ cls: "second-brain-dashboard" });
  await renderDayHeader(body, plugin, displayedDate, cb.onAction, cb.onChangeDate);
  // Review reminders moved to the Review tab in v0.9.1. Home is action-only:
  // day header + TODO proposals + pinned TODOs.
  await renderPendingProposalsSection(body, plugin, cb);
  await renderPinnedTodosSection(body, plugin);
  // `pendingCollapsed` / togglePendingCollapsed are still threaded through for
  // the Review tab, which now hosts the pending-reviews banner.
  void pendingCollapsed;
}

export async function renderPendingReviewsBanner(
  parent: HTMLElement,
  plugin: SecondBrainPlugin,
  onRunCommand: (commandId: string, anchorOverride?: string) => void,
  onRefresh: () => void,
  collapsed: boolean,
  toggleCollapsed: () => void
) {
  const dailies = await computePendingDailies(plugin, 7);
  const periods = computePendingReviews(plugin);
  const all = [...dailies, ...periods];
  if (all.length === 0) return;

  const banner = parent.createDiv({ cls: "second-brain-banner" });
  const arrow = collapsed ? "▶" : "▼";
  // Use a div (not a button) so Obsidian's default button chrome doesn't
  // paint a nested rectangle inside the banner.
  const toggle = banner.createDiv({
    cls: "second-brain-banner-toggle",
    text: `${arrow} ⏰ Reviews pending (${all.length})`,
  });
  toggle.addEventListener("click", () => toggleCollapsed());

  if (collapsed) return;

  const list = banner.createEl("ul", { cls: "second-brain-banner-list" });
  for (const p of all) {
    const li = list.createEl("li");
    li.createSpan({ text: p.label });

    const actions = li.createDiv({ cls: "second-brain-banner-actions" });
    const runBtn = actions.createEl("button", {
      text: "Run",
      cls: "second-brain-banner-run",
    });
    runBtn.addEventListener("click", () =>
      onRunCommand(p.commandId, p.anchorOverride)
    );

    const skipBtn = actions.createEl("button", {
      text: "✕",
      cls: "second-brain-banner-skip",
      attr: { title: "Skip — write a marker so this row disappears" },
    });
    skipBtn.addEventListener("click", async () => {
      try {
        await skipReview(plugin, p.outputPath);
        onRefresh();
      } catch (err) {
        console.error(err);
      }
    });
  }
}

// ── Day header ────────────────────────────────────────────────────────────
// Dashboard surfaces the captures + review for the *displayed* day. Arrows
// step one day at a time and are capped at yesterday ↔ today — we don't
// support multi-day backfilling by design. Capture writes to the displayed
// day; "This Review" runs the daily review for the displayed day.

async function renderDayHeader(
  parent: HTMLElement,
  plugin: SecondBrainPlugin,
  displayedDate: string,
  onAction: (id: "capture" | "this-review") => void,
  onChangeDate: (newDate: string) => void
) {
  const sec = parent.createDiv({ cls: "second-brain-section" });

  const today = todayISO();
  const yesterday = (() => {
    const d = new Date(today + "T00:00:00");
    d.setDate(d.getDate() - 1);
    return toISO(d);
  })();

  const headerRow = sec.createDiv({ cls: "second-brain-day-header" });

  // Left arrow goes back arbitrarily far. Right arrow caps at today (no
  // future). User originally wanted "today or day before" only; loosened in
  // v0.8.2 after they hit the wall trying to backfill captures from a few
  // days ago.
  const left = headerRow.createEl("button", {
    text: "◀",
    cls: "second-brain-iconbtn second-brain-day-arrow",
    attr: { title: "Previous day" },
  });
  left.addEventListener("click", () => {
    const d = new Date(displayedDate + "T00:00:00");
    d.setDate(d.getDate() - 1);
    onChangeDate(toISO(d));
  });

  const d = new Date(displayedDate + "T00:00:00");
  const wkday = d.toLocaleDateString("en-US", { weekday: "short" });
  const month = d.toLocaleDateString("en-US", { month: "short" });
  const relLabel =
    displayedDate === today
      ? "Today"
      : displayedDate === yesterday
      ? "Yesterday"
      : `${wkday} ${month} ${d.getDate()}`;
  headerRow.createEl("h3", {
    text: `${relLabel} — ${wkday} ${month} ${d.getDate()}, W${pad2(isoWeek(d))}`,
    cls: "second-brain-day-title",
  });

  const right = headerRow.createEl("button", {
    text: "▶",
    cls: "second-brain-iconbtn second-brain-day-arrow",
    attr: { title: "Next day" },
  });
  // Cap: cannot navigate past today.
  if (displayedDate >= today) {
    right.setAttribute("disabled", "true");
  } else {
    right.addEventListener("click", () => {
      const d = new Date(displayedDate + "T00:00:00");
      d.setDate(d.getDate() + 1);
      onChangeDate(toISO(d));
    });
  }

  const logPath = await resolveDailyLogPath(
    plugin.app,
    plugin.settings,
    displayedDate
  );
  const logFile = plugin.app.vault.getAbstractFileByPath(logPath);
  if (logFile instanceof TFile) {
    const content = await plugin.app.vault.read(logFile);
    const stamps = [...content.matchAll(/^\[(\d{2}:\d{2})\]/gm)];
    const count = stamps.length;
    const last = stamps.at(-1)?.[1];
    sec.createEl("div", {
      text: `📥 ${count} capture${count === 1 ? "" : "s"}${
        last ? `, last @ ${last}` : ""
      }`,
    });
  } else {
    sec.createEl("div", { text: "📥 No captures yet" });
  }

  const reviewPath = applyDatePlaceholders(
    plugin.settings.reviewsPathTemplate,
    displayedDate
  );
  const reviewFile = plugin.app.vault.getAbstractFileByPath(reviewPath);
  if (reviewFile instanceof TFile) {
    const row = sec.createEl("div");
    row.appendText("🤖 Review ready — ");
    const link = row.createEl("a", { text: "open", cls: "second-brain-link" });
    link.addEventListener("click", () =>
      plugin.app.workspace.getLeaf(false).openFile(reviewFile)
    );
  } else {
    sec.createEl("div", { text: "🤖 No review yet" });
  }

  const actions = sec.createDiv({ cls: "second-brain-quickactions" });
  const captureBtn = actions.createEl("button", {
    text: "Capture",
    cls: "second-brain-button second-brain-button-primary",
  });
  captureBtn.addEventListener("click", () => onAction("capture"));

  // Summarize ↔ View Summary toggle. The summary is "fresh" when the review
  // file exists and the daily log hasn't been touched since it was generated
  // (cheap mtime heuristic — no hashing on render). Fresh → "View Summary"
  // (opens the file, no LLM call). Stale / missing → "Summarize" (runs).
  const summaryFresh =
    reviewFile instanceof TFile &&
    (!(logFile instanceof TFile) ||
      logFile.stat.mtime <= reviewFile.stat.mtime);

  const reviewBtn = actions.createEl("button", {
    text: summaryFresh ? "View Summary" : "Summarize",
    cls: "second-brain-button",
  });
  reviewBtn.addEventListener("click", () => {
    if (summaryFresh && reviewFile instanceof TFile) {
      plugin.app.workspace.getLeaf(false).openFile(reviewFile);
    } else {
      onAction("this-review");
    }
  });
}

// ── Pending AI proposals (v0.9) ──────────────────────────────────────────
// Surfaces TODOs the daily review extracted but the user hasn't acted on.
// Each row: text + (project link or "no project") + Accept / Delete buttons.

async function renderPendingProposalsSection(
  parent: HTMLElement,
  plugin: SecondBrainPlugin,
  cb: DashboardCallbacks
) {
  const proposals = await loadPendingProposals(plugin.app);

  const sec = parent.createDiv({ cls: "second-brain-section" });
  sec.createEl("h3", { text: `⏰ Pending AI proposals (${proposals.length})` });

  if (proposals.length === 0) {
    sec.createEl("div", {
      cls: "second-brain-muted",
      text: "Nothing waiting. The daily review extracts new ones from your captures.",
    });
    return;
  }

  const list = sec.createEl("ul", { cls: "second-brain-banner-list" });
  for (const p of proposals) {
    const li = list.createEl("li");
    const left = li.createDiv({ cls: "second-brain-proposal-text" });
    left.createSpan({ text: p.text });
    if (p.projectPath) {
      const projName = p.projectPath
        .replace(/^1\. 🎯 Projects\//, "")
        .replace(/\.md$/, "");
      const target = left.createEl("a", {
        text: ` → ${projName}`,
        cls: "second-brain-proposal-target",
      });
      target.addEventListener("click", () => {
        plugin.app.workspace.openLinkText(p.projectPath!, "", false);
      });
    } else {
      left.createSpan({
        text: " — no project",
        cls: "second-brain-proposal-noproject",
      });
    }
    if (p.capturedAt) {
      left.createSpan({
        text: ` · ${p.capturedAt}`,
        cls: "second-brain-thread-meta",
      });
    }

    const actions = li.createDiv({ cls: "second-brain-banner-actions" });

    const acceptBtn = actions.createEl("button", {
      text: "✓",
      cls: "second-brain-banner-run",
      attr: {
        title: p.projectPath
          ? `Append to ${p.projectPath}'s Active TODOs`
          : "Mark accepted (no project to write to)",
      },
    });
    acceptBtn.addEventListener("click", async () => {
      await cb.onAcceptProposal(p.date, p.id);
    });

    const deleteBtn = actions.createEl("button", {
      text: "✕",
      cls: "second-brain-banner-skip",
      attr: { title: "Dismiss this proposal" },
    });
    deleteBtn.addEventListener("click", async () => {
      await cb.onDeleteProposal(p.date, p.id);
    });
  }
}

// ── Pinned TODOs (v0.9) ──────────────────────────────────────────────────
// Reads each project file with `pinned: true` and surfaces its
// `## Active TODOs` checkboxes here so the user can see what's on their
// plate without leaving the Dashboard. Click a TODO → opens the project.

async function renderPinnedTodosSection(
  parent: HTMLElement,
  plugin: SecondBrainPlugin
) {
  const projects = await loadProjects(plugin.app);
  const pinned = projects.filter((p) => p.pinned && p.status === "active");

  const sec = parent.createDiv({ cls: "second-brain-section" });
  sec.createEl("h3", { text: `📌 Pinned project TODOs` });

  if (pinned.length === 0) {
    sec.createEl("div", {
      cls: "second-brain-muted",
      text: 'Add `pinned: true` to a project\'s frontmatter to surface its TODOs here.',
    });
    return;
  }

  for (const p of pinned) {
    const content = await plugin.app.vault.read(p.file);
    const todos = extractActiveTodos(content);
    if (todos.length === 0) continue;
    const projSec = sec.createDiv({ cls: "second-brain-pinned-project" });
    const titleEl = projSec.createEl("div", {
      cls: "second-brain-pinned-project-title",
    });
    const link = titleEl.createEl("a", {
      text: p.name,
      cls: "second-brain-link",
    });
    link.addEventListener("click", () =>
      plugin.app.workspace.getLeaf(false).openFile(p.file)
    );
    const list = projSec.createEl("ul", { cls: "second-brain-list" });
    for (const t of todos) {
      const li = list.createEl("li");
      li.createSpan({ text: t });
    }
  }
}

function extractActiveTodos(content: string): string[] {
  const re = /^##\s+Active TODOs\s*$/m;
  const m = content.match(re);
  if (!m || m.index === undefined) return [];
  const start = m.index + m[0].length;
  const rest = content.slice(start);
  const next = rest.search(/^##\s+/m);
  const body = next < 0 ? rest : rest.slice(0, next);
  const todos: string[] = [];
  for (const line of body.split(/\r?\n/)) {
    const t = line.match(/^\s*-\s*\[\s\]\s+(.+?)\s*$/);
    if (t && t[1].trim()) todos.push(t[1].trim());
  }
  return todos;
}

