/**
 * Goals (v0.11) — first-class outcomes, NOT collapsed into projects.
 *
 * A project bundles many goals; a goal can span projects; a habit can serve
 * many goals (training transfers). Goals live at `🧑 Me/Goals/<id>.md`.
 *
 * Progress is event-derived, from two signals:
 *   1. **Showing up** — adherence (active days from linked habits). Computed
 *      in the UI layer, not stored.
 *   2. **Records / milestones** — PRs logged in `## Records` (latest → current)
 *      and checkpoints ticked in `## Milestones`.
 * "Track events, derive progress" — we never store a fabricated % ; we store
 * the events and compute from them.
 */

import { App, TFile, TFolder } from "obsidian";
import { parseAreaList } from "./areas";

export const GOALS_FOLDER = "🧑 Me/Goals";

export type GoalStatus = "someday" | "active" | "achieved" | "dropped";
export type GoalMeasure = "binary" | "count" | "magnitude";

export interface GoalRecord {
  date: string;
  text: string;
  /** Parsed leading number, if any (a PR value). */
  value?: number;
}

export interface Goal {
  id: string;
  file: TFile;
  name: string;
  areas: string[];
  projects: string[];
  status: GoalStatus;
  successCriterion?: string;
  measure?: GoalMeasure;
  target?: number;
  current?: number;
  start?: number;
  unit?: string;
  milestonesDone: number;
  milestonesTotal: number;
  records: GoalRecord[];
}

export async function loadGoals(app: App): Promise<Goal[]> {
  const root = app.vault.getAbstractFileByPath(GOALS_FOLDER);
  if (!(root instanceof TFolder)) return [];
  const out: Goal[] = [];
  for (const c of root.children) {
    if (c instanceof TFile && c.name.endsWith(".md")) {
      out.push(await parseGoal(app, c));
    }
  }
  return out;
}

async function parseGoal(app: App, file: TFile): Promise<Goal> {
  const raw = await app.vault.read(file);
  const fm = parseFrontmatter(raw);
  const ms = checkboxCounts(raw, "Milestones");
  return {
    id: file.basename,
    file,
    name: extractH1(raw) ?? file.basename,
    areas: parseAreaList(fm["areas"] ?? fm["area"]),
    projects: parseAreaList(fm["projects"]),
    status: (scalar(fm["status"]) as GoalStatus) ?? "someday",
    successCriterion: scalar(fm["success-criterion"]),
    measure: scalar(fm["measure"]) as GoalMeasure | undefined,
    target: num(fm["target"]),
    current: num(fm["current"]),
    start: num(fm["start"]),
    unit: scalar(fm["unit"]),
    milestonesDone: ms.done,
    milestonesTotal: ms.total,
    records: parseRecords(raw),
  };
}

/** Progress 0..1: prefer record/target (with optional baseline), else milestones. */
export function goalProgress(goal: Goal): number {
  if (goal.target != null && goal.current != null) {
    const start = goal.start ?? 0;
    const span = goal.target - start;
    if (span !== 0) {
      return Math.max(0, Math.min(1, (goal.current - start) / span));
    }
  }
  if (goal.milestonesTotal > 0) return goal.milestonesDone / goal.milestonesTotal;
  return 0;
}

export async function createGoal(
  app: App,
  opts: {
    name: string;
    areaPaths: string[];
    projectPaths: string[];
    successCriterion?: string;
    measure?: GoalMeasure;
    target?: number;
    unit?: string;
    status?: GoalStatus;
  }
): Promise<TFile> {
  if (!app.vault.getAbstractFileByPath(GOALS_FOLDER)) {
    await app.vault.createFolder(GOALS_FOLDER);
  }
  const safe = opts.name.replace(/[\\/:*?"<>|]/g, "").trim() || "New goal";
  let path = `${GOALS_FOLDER}/${safe}.md`;
  let n = 2;
  while (app.vault.getAbstractFileByPath(path)) {
    path = `${GOALS_FOLDER}/${safe} (${n}).md`;
    n++;
  }
  const q = (s: string) =>
    /^[\w .,/%-]+$/.test(s) && !s.includes(": ") ? s : `"${s.replace(/"/g, '\\"')}"`;
  const fm: string[] = ["---"];
  fm.push(
    opts.areaPaths.length ? `areas: [${opts.areaPaths.map((p) => `"[[${p}]]"`).join(", ")}]` : "areas: []"
  );
  fm.push(
    opts.projectPaths.length
      ? `projects: [${opts.projectPaths.map((p) => `"[[${p}]]"`).join(", ")}]`
      : "projects: []"
  );
  fm.push(`status: ${opts.status ?? (opts.projectPaths.length ? "active" : "someday")}`);
  if (opts.successCriterion) fm.push(`success-criterion: ${q(opts.successCriterion)}`);
  if (opts.measure) fm.push(`measure: ${opts.measure}`);
  if (opts.target != null) fm.push(`target: ${opts.target}`);
  if (opts.unit) fm.push(`unit: ${q(opts.unit)}`);
  fm.push("---", "", `# ${safe}`, "", "## Why", "", "## Milestones", "- [ ] ", "", "## Records", "", "## Progress notes", "");
  return await app.vault.create(path, fm.join("\n"));
}

/**
 * Log a record (PR / progress event) — append to `## Records` and, if a
 * numeric value is given, update `current` in the frontmatter.
 */
export async function addGoalRecord(
  app: App,
  goalFile: TFile,
  date: string,
  text: string,
  value?: number
): Promise<void> {
  let content = await app.vault.read(goalFile);
  const line = `- ${date} — ${text.trim()}`;
  content = appendToSection(content, "Records", line);
  if (value != null && Number.isFinite(value)) {
    content = setFrontmatterNumber(content, "current", value);
  }
  await app.vault.modify(goalFile, content);
}

// ── parsing helpers ─────────────────────────────────────────────────────

function parseRecords(content: string): GoalRecord[] {
  const body = sectionBody(content, "Records");
  if (!body) return [];
  const out: GoalRecord[] = [];
  for (const line of body.split(/\r?\n/)) {
    const m = line.match(/^\s*-\s*(\d{4}-\d{2}-\d{2})\s*[—-]\s*(.+?)\s*$/);
    if (m) {
      const valM = m[2].match(/(\d+(?:\.\d+)?)/);
      out.push({
        date: m[1],
        text: m[2].trim(),
        value: valM ? parseFloat(valM[1]) : undefined,
      });
    }
  }
  return out;
}

function sectionBody(content: string, heading: string): string | null {
  const esc = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = content.match(new RegExp(`^##\\s+${esc}\\s*$`, "m"));
  if (!m || m.index === undefined) return null;
  const start = m.index + m[0].length;
  const rest = content.slice(start);
  const next = rest.search(/^##\s+/m);
  return next < 0 ? rest : rest.slice(0, next);
}

function checkboxCounts(content: string, heading: string): { done: number; total: number } {
  const body = sectionBody(content, heading);
  if (!body) return { done: 0, total: 0 };
  let done = 0;
  let total = 0;
  for (const line of body.split(/\r?\n/)) {
    const cb = line.match(/^\s*-\s*\[([ xX])\]/);
    if (cb) {
      total++;
      if (cb[1].toLowerCase() === "x") done++;
    }
  }
  return { done, total };
}

function appendToSection(content: string, heading: string, line: string): string {
  const esc = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = content.match(new RegExp(`^##\\s+${esc}\\s*$`, "m"));
  if (!m || m.index === undefined) {
    return content.replace(/\s*$/, "") + `\n\n## ${heading}\n${line}\n`;
  }
  const headingEnd = m.index + m[0].length;
  const rest = content.slice(headingEnd);
  const nextRel = rest.search(/^##\s+/m);
  const sectionEnd = nextRel < 0 ? content.length : headingEnd + nextRel;
  const body = content.slice(headingEnd, sectionEnd).replace(/\s+$/, "");
  return (
    content.slice(0, headingEnd) +
    `${body}\n${line}\n\n` +
    content.slice(sectionEnd).replace(/^\s*\n+/, "")
  );
}

function setFrontmatterNumber(content: string, key: string, value: number): string {
  if (!content.startsWith("---")) return content;
  const end = content.indexOf("\n---", 3);
  if (end < 0) return content;
  const head = content.slice(0, end);
  const re = new RegExp(`^(${key}:).*$`, "m");
  if (re.test(head)) {
    return head.replace(re, `$1 ${value}`) + content.slice(end);
  }
  // Insert before the closing --- of frontmatter.
  return content.slice(0, end) + `\n${key}: ${value}` + content.slice(end);
}

function scalar(v: unknown): string | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  return s.length ? s : undefined;
}

function num(v: unknown): number | undefined {
  if (v == null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function extractH1(raw: string): string | undefined {
  const body = raw.startsWith("---")
    ? (() => {
        const e = raw.indexOf("\n---", 3);
        return e < 0 ? raw : raw.slice(e + 4);
      })()
    : raw;
  const m = body.match(/^#\s+(.+?)\s*$/m);
  return m ? m[1].trim() : undefined;
}

function parseFrontmatter(raw: string): Record<string, unknown> {
  if (!raw.startsWith("---")) return {};
  const end = raw.indexOf("\n---", 3);
  if (end < 0) return {};
  const block = raw.slice(raw.indexOf("\n") + 1, end);
  const out: Record<string, unknown> = {};
  for (const line of block.split(/\r?\n/)) {
    const m = line.match(/^([a-zA-Z][\w-]*):\s*(.*)$/);
    if (m) {
      let v: string = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      out[m[1]] = v;
    }
  }
  return out;
}
