/**
 * Habits (v0.8+). One file per habit at `🧑 Me/Habits/<id>.md`.
 *
 * Schema is LogLife-aligned (jmoraispk/loglife): the habit itself plus the
 * five boost dimensions (Define / Why / Plan / Environment / Recover).
 *
 * The "Define" pillar is implicit — `binary-criterion` is the unambiguous
 * pass/fail definition. The other four live in the frontmatter as optional
 * fields that strengthen the habit.
 */

import { App, TFile, TFolder } from "obsidian";

export const HABITS_FOLDER = "🧑 Me/Habits";

export type Periodicity = "daily" | "weekdays" | "weekly" | "monthly";
export type HabitStatus = "active" | "paused" | "archived";

export interface Habit {
  id: string;
  file: TFile;
  name: string;
  linkedGoal?: string;
  area?: string;
  periodicity: Periodicity;
  binaryCriterion: string;
  quantitative?: {
    metric: string;
    min?: number;
    target?: number;
    cap?: number;
  };
  why?: string;
  plan?: { when?: string; where?: string; how?: string };
  environment?: string;
  recovery?: string;
  status: HabitStatus;
}

/** Inference result the AI returns per-habit in the daily review. */
export type HabitInferenceStatus = "pass" | "uncertain" | "fail";

export interface HabitInferenceLine {
  habitId: string;
  status: HabitInferenceStatus;
  evidence?: string;
  value?: number;
}

export async function loadHabits(app: App): Promise<Habit[]> {
  const root = app.vault.getAbstractFileByPath(HABITS_FOLDER);
  if (!(root instanceof TFolder)) return [];
  const files: TFile[] = [];
  collectMarkdown(root, files);
  const habits: Habit[] = [];
  for (const f of files) {
    const h = await parseHabit(app, f);
    if (h) habits.push(h);
  }
  return habits;
}

export async function loadActiveHabits(app: App): Promise<Habit[]> {
  return (await loadHabits(app)).filter((h) => h.status === "active");
}

function collectMarkdown(folder: TFolder, out: TFile[]) {
  for (const c of folder.children) {
    if (c instanceof TFolder) collectMarkdown(c, out);
    else if (c instanceof TFile && c.name.endsWith(".md")) out.push(c);
  }
}

async function parseHabit(app: App, file: TFile): Promise<Habit | null> {
  const raw = await app.vault.read(file);
  const fm = parseFrontmatter(raw);
  if (!fm) return null;

  const periodicity = (fm["periodicity"] ?? "daily") as Periodicity;
  const status = (fm["status"] ?? "active") as HabitStatus;
  const binary = (fm["binary-criterion"] ?? "").toString().trim();
  if (!binary) return null;

  const habit: Habit = {
    id: file.basename,
    file,
    name: extractH1(raw) ?? file.basename,
    periodicity,
    binaryCriterion: binary,
    status,
    linkedGoal: scalar(fm["linked-goal"]),
    area: scalar(fm["area"]),
    why: scalar(fm["why"]),
    environment: scalar(fm["environment"]),
    recovery: scalar(fm["recovery"]),
  };

  const plan = fm["plan"] as Record<string, unknown> | undefined;
  if (plan && typeof plan === "object") {
    habit.plan = {
      when: scalar(plan["when"]),
      where: scalar(plan["where"]),
      how: scalar(plan["how"]),
    };
  }
  const q = fm["quantitative"] as Record<string, unknown> | undefined;
  if (q && typeof q === "object" && q["metric"]) {
    habit.quantitative = {
      metric: String(q["metric"]),
      min: numeric(q["min"]),
      target: numeric(q["target"]),
      cap: numeric(q["cap"]),
    };
  }

  return habit;
}

function scalar(v: unknown): string | undefined {
  if (v == null) return undefined;
  // [[wikilink]] form — strip the brackets so we can rebuild them when needed.
  const s = String(v).trim();
  return s.length > 0 ? s : undefined;
}

function numeric(v: unknown): number | undefined {
  if (v == null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function extractH1(raw: string): string | undefined {
  const body = stripFrontmatterBlock(raw);
  const m = body.match(/^#\s+(.+?)\s*$/m);
  return m ? m[1].trim() : undefined;
}

function stripFrontmatterBlock(raw: string): string {
  if (!raw.startsWith("---")) return raw;
  const end = raw.indexOf("\n---", 3);
  if (end < 0) return raw;
  return raw.slice(end + 4).replace(/^\s*\n/, "");
}

/**
 * Tiny YAML frontmatter parser: scalars, nested single-level objects,
 * inline arrays. Enough for our schema; we don't pull in a YAML dep.
 */
function parseFrontmatter(raw: string): Record<string, unknown> | null {
  if (!raw.startsWith("---")) return null;
  const end = raw.indexOf("\n---", 3);
  if (end < 0) return null;
  const block = raw.slice(raw.indexOf("\n") + 1, end);
  const out: Record<string, unknown> = {};
  const lines = block.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const top = line.match(/^([a-zA-Z][\w-]*):\s*(.*)$/);
    if (!top) continue;
    const key = top[1];
    const rest = top[2].trim();

    if (rest === "") {
      // Nested object (next lines indented 2 spaces) OR empty value.
      const nested: Record<string, unknown> = {};
      let consumed = false;
      while (i + 1 < lines.length && /^\s{2,}/.test(lines[i + 1])) {
        i++;
        const sub = lines[i].match(/^\s{2,}([a-zA-Z][\w-]*):\s*(.*)$/);
        if (sub) {
          nested[sub[1]] = parseScalar(sub[2].trim());
          consumed = true;
        }
      }
      out[key] = consumed ? nested : "";
    } else {
      out[key] = parseScalar(rest);
    }
  }
  return out;
}

function parseScalar(raw: string): unknown {
  // Strip surrounding quotes.
  if (
    (raw.startsWith('"') && raw.endsWith('"')) ||
    (raw.startsWith("'") && raw.endsWith("'"))
  ) {
    return raw.slice(1, -1);
  }
  // Inline list.
  if (raw.startsWith("[") && raw.endsWith("]")) {
    return raw
      .slice(1, -1)
      .split(",")
      .map((s) => parseScalar(s.trim()));
  }
  return raw;
}

/**
 * Build the chunk of the user-message we feed to the daily-review LLM call.
 * Lists each active habit with its binary criterion (and quantitative hints
 * if present) so the LLM can decide pass / uncertain / fail per habit.
 *
 * The matching prompt instructions live in REVIEW_PROMPT.
 */
export function buildHabitContextBlock(habits: Habit[]): string {
  if (habits.length === 0) return "";
  const lines = ["## Active habits to evaluate", ""];
  for (const h of habits) {
    let row = `- ${h.id}: ${h.binaryCriterion}`;
    if (h.quantitative) {
      const q = h.quantitative;
      const bits: string[] = [`${q.metric}`];
      if (q.min != null) bits.push(`min ${q.min}`);
      if (q.target != null) bits.push(`target ${q.target}`);
      if (q.cap != null) bits.push(`cap ${q.cap}`);
      row += ` _(${bits.join(", ")})_`;
    }
    lines.push(row);
  }
  return lines.join("\n");
}
