import { App, TFile, TFolder } from "obsidian";
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

export interface PendingReview {
  commandId: string;
  label: string;
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
      pathTemplate: "_AI/Reviews/Weekly/{ISO_YEAR}-W{WW}.md",
    },
    {
      commandId: "review-last-month",
      inputKind: "last-month-logs",
      pathTemplate: "_AI/Reviews/Monthly/{YYYY-MM}.md",
    },
    {
      commandId: "review-last-quarter",
      inputKind: "last-quarter-logs",
      pathTemplate: "_AI/Reviews/Quarterly/{YYYY}-Q{Q}.md",
    },
    {
      commandId: "review-last-year",
      inputKind: "last-year-logs",
      pathTemplate: "_AI/Reviews/Yearly/{YYYY}.md",
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
    });
  }
  return pending;
}

/**
 * Render the dashboard sections into `parent`. Heuristic-only, no LLM
 * calls — all data comes from local vault reads. Re-rendering is cheap.
 */
export async function renderDashboard(
  parent: HTMLElement,
  plugin: SecondBrainPlugin,
  onAction: (id: "capture" | "todays-review") => void,
  onRunCommand: (commandId: string) => void
): Promise<void> {
  const body = parent.createDiv({ cls: "second-brain-dashboard" });
  renderPendingReviewsBanner(body, plugin, onRunCommand);
  await renderTodaySection(body, plugin, onAction);
  await renderThreadsSection(body, plugin);
  renderProjectsSection(body, plugin);
  renderReviewsSection(body, plugin);
}

function renderPendingReviewsBanner(
  parent: HTMLElement,
  plugin: SecondBrainPlugin,
  onRunCommand: (commandId: string) => void
) {
  const pending = computePendingReviews(plugin);
  if (pending.length === 0) return;

  const banner = parent.createDiv({ cls: "second-brain-banner" });
  banner.createEl("div", {
    cls: "second-brain-banner-title",
    text: `⏰ Reviews pending (${pending.length})`,
  });

  const list = banner.createEl("ul", { cls: "second-brain-banner-list" });
  for (const p of pending) {
    const li = list.createEl("li");
    li.createSpan({ text: p.label });
    const btn = li.createEl("button", {
      text: "Run",
      cls: "second-brain-banner-run",
    });
    btn.addEventListener("click", () => onRunCommand(p.commandId));
  }
}

// ── Today section ────────────────────────────────────────────────────────

async function renderTodaySection(
  parent: HTMLElement,
  plugin: SecondBrainPlugin,
  onAction: (id: "capture" | "todays-review") => void
) {
  const sec = parent.createDiv({ cls: "second-brain-section" });

  const today = todayISO();
  const d = new Date(today + "T00:00:00");
  const wkday = d.toLocaleDateString("en-US", { weekday: "short" });
  const month = d.toLocaleDateString("en-US", { month: "short" });
  sec.createEl("h3", {
    text: `Today — ${wkday} ${month} ${d.getDate()}, W${pad2(isoWeek(d))}`,
  });

  const logPath = await resolveDailyLogPath(plugin.app, plugin.settings, today);
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
    sec.createEl("div", { text: "📥 No captures yet today" });
  }

  const reviewPath = applyDatePlaceholders(
    plugin.settings.reviewsPathTemplate,
    today
  );
  const reviewFile = plugin.app.vault.getAbstractFileByPath(reviewPath);
  if (reviewFile instanceof TFile) {
    const row = sec.createEl("div");
    row.appendText("🤖 Today's review ready — ");
    const link = row.createEl("a", { text: "open", cls: "second-brain-link" });
    link.addEventListener("click", () =>
      plugin.app.workspace.getLeaf(false).openFile(reviewFile)
    );
  } else {
    sec.createEl("div", { text: "🤖 No review yet today" });
  }

  const actions = sec.createDiv({ cls: "second-brain-quickactions" });
  const captureBtn = actions.createEl("button", {
    text: "Capture",
    cls: "second-brain-button second-brain-button-primary",
  });
  captureBtn.addEventListener("click", () => onAction("capture"));

  const reviewBtn = actions.createEl("button", {
    text: "Today's Review",
    cls: "second-brain-button",
  });
  reviewBtn.addEventListener("click", () => onAction("todays-review"));
}

// ── Threads in motion ────────────────────────────────────────────────────

interface Thread {
  target: string;
  occurrences: number;
  daysSinceLastSeen: number;
  drifting: boolean;
}

async function renderThreadsSection(
  parent: HTMLElement,
  plugin: SecondBrainPlugin
) {
  const sec = parent.createDiv({ cls: "second-brain-section" });
  sec.createEl("h3", { text: "Threads in motion (last 14 days)" });

  const threads = await computeThreads(plugin, 14, 3);

  if (threads.length === 0) {
    sec.createEl("div", {
      cls: "second-brain-muted",
      text: "No recurring wikilinks in recent captures. Use [[topic]] in your daily notes to surface threads here.",
    });
    return;
  }

  const list = sec.createEl("ul", { cls: "second-brain-list" });
  for (const t of threads.slice(0, 8)) {
    const li = list.createEl("li");
    const link = li.createEl("a", { text: t.target, cls: "second-brain-link" });
    link.addEventListener("click", () =>
      plugin.app.workspace.openLinkText(t.target, "", false)
    );
    const meta = li.createEl("span", { cls: "second-brain-thread-meta" });
    const lastLabel =
      t.daysSinceLastSeen === 0
        ? "today"
        : t.daysSinceLastSeen === 1
        ? "yesterday"
        : `${t.daysSinceLastSeen}d ago`;
    meta.setText(` · ${t.occurrences} days · last ${lastLabel}`);
    if (t.drifting) {
      li.createEl("span", {
        text: " ⚠️ drifting",
        cls: "second-brain-drift",
      });
    }
  }
}

async function computeThreads(
  plugin: SecondBrainPlugin,
  daysBack: number,
  minOccurrences: number
): Promise<Thread[]> {
  const today = new Date();
  const todayStr = toISO(today);
  const counts = new Map<string, Set<string>>();
  const lastSeen = new Map<string, string>();

  for (let i = 0; i < daysBack; i++) {
    const d = new Date(today.valueOf());
    d.setDate(d.getDate() - i);
    const dateStr = toISO(d);
    const path = await resolveDailyLogPath(
      plugin.app,
      plugin.settings,
      dateStr
    );
    const file = plugin.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) continue;
    const content = await plugin.app.vault.read(file);
    const seen = new Set<string>();
    for (const m of content.matchAll(/\[\[([^\]|#]+)/g)) {
      const target = m[1].trim();
      if (!target) continue;
      if (seen.has(target)) continue;
      seen.add(target);
      if (!counts.has(target)) counts.set(target, new Set());
      counts.get(target)!.add(dateStr);
      const prev = lastSeen.get(target);
      if (!prev || dateStr > prev) lastSeen.set(target, dateStr);
    }
  }

  const threads: Thread[] = [];
  for (const [target, dates] of counts) {
    if (dates.size < minOccurrences) continue;
    const ls = lastSeen.get(target)!;
    const days = Math.floor(
      (Date.parse(todayStr) - Date.parse(ls)) / 86400000
    );
    threads.push({
      target,
      occurrences: dates.size,
      daysSinceLastSeen: days,
      drifting: days > 5,
    });
  }
  threads.sort((a, b) => b.occurrences - a.occurrences);
  return threads;
}

// ── Projects ─────────────────────────────────────────────────────────────

function renderProjectsSection(parent: HTMLElement, plugin: SecondBrainPlugin) {
  const sec = parent.createDiv({ cls: "second-brain-section" });
  sec.createEl("h3", { text: "🎯 Projects" });

  const folder = findProjectsFolder(plugin.app);
  if (!folder) {
    sec.createEl("div", {
      cls: "second-brain-muted",
      text: "No projects folder found. Expected one of: '🎯 1. Projects/', '1. Projects/', 'Projects/'.",
    });
    return;
  }

  const items = folder.children.slice().sort((a, b) => a.name.localeCompare(b.name));
  if (items.length === 0) {
    sec.createEl("div", {
      cls: "second-brain-muted",
      text: "Projects folder is empty.",
    });
    return;
  }

  const list = sec.createEl("ul", { cls: "second-brain-list" });
  for (const child of items) {
    const li = list.createEl("li");
    const name = child instanceof TFile
      ? child.basename
      : child.name;
    const link = li.createEl("a", { text: name, cls: "second-brain-link" });
    link.addEventListener("click", () => {
      if (child instanceof TFile) {
        plugin.app.workspace.getLeaf(false).openFile(child);
      } else if (child instanceof TFolder) {
        plugin.app.workspace.openLinkText(child.path, "", false);
      }
    });
    if (child instanceof TFolder) {
      const n = countMarkdownFiles(child);
      li.createEl("span", {
        text: ` · ${n} files`,
        cls: "second-brain-thread-meta",
      });
    }
  }
}

function findProjectsFolder(app: App): TFolder | null {
  const candidates = ["🎯 1. Projects", "1. Projects", "Projects"];
  for (const name of candidates) {
    const f = app.vault.getAbstractFileByPath(name);
    if (f instanceof TFolder) return f;
  }
  return null;
}

function countMarkdownFiles(folder: TFolder): number {
  let n = 0;
  for (const c of folder.children) {
    if (c instanceof TFile && c.name.endsWith(".md")) n++;
    else if (c instanceof TFolder) n += countMarkdownFiles(c);
  }
  return n;
}

// ── Recent reviews ───────────────────────────────────────────────────────

function renderReviewsSection(parent: HTMLElement, plugin: SecondBrainPlugin) {
  const sec = parent.createDiv({ cls: "second-brain-section" });
  sec.createEl("h3", { text: "Recent reviews" });

  const dailies = getRecentReviewsIn(plugin, "_AI/Reviews/Daily", 3);
  const weeklies = getRecentReviewsIn(plugin, "_AI/Reviews/Weekly", 2);

  if (dailies.length + weeklies.length === 0) {
    sec.createEl("div", {
      cls: "second-brain-muted",
      text: "No reviews yet. Run Today's Review or Week's Review (in the Buttons tab) to create one.",
    });
    return;
  }

  const list = sec.createEl("ul", { cls: "second-brain-list" });
  for (const f of dailies) addReviewLink(list, plugin, f, "Daily");
  for (const f of weeklies) addReviewLink(list, plugin, f, "Weekly");
}

function getRecentReviewsIn(
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

function addReviewLink(
  list: HTMLElement,
  plugin: SecondBrainPlugin,
  file: TFile,
  label: string
) {
  const li = list.createEl("li");
  const link = li.createEl("a", {
    text: `📄 ${label} ${file.basename}`,
    cls: "second-brain-link",
  });
  link.addEventListener("click", () =>
    plugin.app.workspace.getLeaf(false).openFile(file)
  );
}
