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
import { parseAreaList } from "./areas";

export const HABITS_FOLDER = "🧑 Me/Habits";

/**
 * Built-in auto-habits shipped for everyone (v0.9.2). They have no backing
 * file and are evaluated deterministically from vault state. Prepended to the
 * user's own habits everywhere habits are listed.
 */
export function builtInAutoHabits(): Habit[] {
  return [
    {
      id: "capture",
      file: null,
      name: "Daily capture",
      areas: [],
      projects: [],
      goals: [],
      periodicity: "daily",
      binaryCriterion: "Captured at least once today",
      status: "active",
      kind: "do",
      auto: "capture",
    },
    {
      id: "review",
      file: null,
      name: "Weekly review",
      areas: [],
      projects: [],
      goals: [],
      periodicity: "weekly",
      binaryCriterion: "Reviewed at least once this week",
      status: "active",
      kind: "do",
      auto: "review",
    },
  ];
}

export type Periodicity = "daily" | "weekdays" | "weekly" | "monthly";
export type HabitStatus = "active" | "paused" | "archived";

export interface Habit {
  id: string;
  /** Auto-habits (capture / review) are synthetic and have no backing file. */
  file: TFile | null;
  name: string;
  linkedGoal?: string;
  /** @deprecated single area — kept for back-compat reads. Use `areas`. */
  area?: string;
  /** Flat list of area paths this habit touches (v0.9.2). */
  areas: string[];
  /** Flat list of project paths (v0.9.2). */
  projects: string[];
  /** Flat list of goal paths this habit serves (v0.11). One habit, many goals. */
  goals: string[];
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
  // ── Habit anatomy (v0.10) — the adherence-by-design fields ──
  /** The identity this habit reinforces ("a person who moves every day"). */
  identity?: string;
  /** Implementation intention — when/where/after-what (the trigger). */
  cue?: string;
  /** Optional aspirational target ("30 minutes"). The min dose is binaryCriterion. */
  target?: string;
  /** Anti-gaming rules ("no phone", "timer must ring"). */
  constraints?: string[];
  /** What proves it happened (artifact / log mention / #tag). */
  evidence?: string;
  /** The immediate celebration that wires the habit. */
  reward?: string;
  // ── v0.12: quit habits + flexible scheduling ──
  /** "do" (positive, default) or "quit" (negative — a running abstinence clock). */
  kind: "do" | "quit";
  /** For quit habits: ISO datetime the abstinence started (reset on relapse). */
  quitStart?: string;
  /** Specific weekdays this habit is scheduled (0=Sun..6=Sat). Empty = every day. */
  scheduleDays?: number[];
  /** "N days per week" target (informational; shown in detail/target). */
  perWeek?: number;
  /**
   * Auto-habits compute their status deterministically from vault state
   * rather than from the LLM's "## Today's habits status" section.
   *   - "capture": pass on day D if D's daily log has ≥1 capture.
   *   - "review":  pass for the ISO week containing D if any review exists
   *     in that week.
   */
  auto?: "capture" | "review";
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
  const habits: Habit[] = [...builtInAutoHabits()];
  const root = app.vault.getAbstractFileByPath(HABITS_FOLDER);
  if (root instanceof TFolder) {
    const files: TFile[] = [];
    collectMarkdown(root, files);
    for (const f of files) {
      const h = await parseHabit(app, f);
      if (h) habits.push(h);
    }
  }
  return habits;
}

export async function loadActiveHabits(app: App): Promise<Habit[]> {
  // Auto-habits are excluded from the LLM evaluation context (they're computed
  // deterministically), so only return file-backed habits here.
  return (await loadHabits(app)).filter(
    (h) => h.status === "active" && !h.auto
  );
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

  // Flat-tag areas/projects (v0.9.2). Accept new `areas:`/`projects:` lists
  // and the legacy single `area:` scalar, merged.
  const areas = parseAreaList(fm["areas"]);
  const legacyArea = scalar(fm["area"]);
  if (legacyArea) {
    const norm = parseAreaList(legacyArea);
    for (const a of norm) if (!areas.includes(a)) areas.push(a);
  }
  const projects = parseAreaList(fm["projects"]);
  const legacyGoal = scalar(fm["linked-goal"]);
  if (legacyGoal) {
    for (const p of parseAreaList(legacyGoal)) {
      if (!projects.includes(p)) projects.push(p);
    }
  }
  const goals = parseAreaList(fm["goals"]);

  const habit: Habit = {
    id: file.basename,
    file,
    name: extractH1(raw) ?? file.basename,
    periodicity,
    binaryCriterion: binary,
    status,
    linkedGoal: legacyGoal,
    area: legacyArea,
    areas,
    projects,
    goals,
    why: scalar(fm["why"]),
    environment: scalar(fm["environment"]),
    recovery: scalar(fm["recovery"]),
    identity: scalar(fm["identity"]),
    cue: scalar(fm["cue"]),
    target: scalar(fm["target"]),
    evidence: scalar(fm["evidence"]),
    reward: scalar(fm["reward"]),
    constraints: parseStringList(fm["constraints"]),
    kind:
      scalar(fm["kind"]) === "quit" ||
      (scalar(fm["goal-type"]) ?? "").toLowerCase() === "negative"
        ? "quit"
        : "do",
    quitStart: scalar(fm["quit-start"]),
    scheduleDays: parseWeekdays(fm["schedule-days"]),
    perWeek: numeric(fm["per-week"]),
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

const DOW: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};

/** Parse weekday names ("Mon, Wed, Fri" or a list) into [0..6]. undefined = every day. */
function parseWeekdays(v: unknown): number[] | undefined {
  const list = parseStringList(v);
  if (!list) return undefined;
  const out: number[] = [];
  for (const s of list) {
    const n = DOW[s.slice(0, 3).toLowerCase()];
    if (n != null && !out.includes(n)) out.push(n);
  }
  return out.length ? out.sort() : undefined;
}

/** True if the habit is scheduled on the given ISO date (every day if no schedule). */
export function isScheduledOn(habit: Habit, iso: string): boolean {
  if (!habit.scheduleDays || habit.scheduleDays.length === 0) {
    if (habit.periodicity === "weekdays") {
      const d = new Date(iso + "T00:00:00").getDay();
      return d >= 1 && d <= 5;
    }
    return true;
  }
  return habit.scheduleDays.includes(new Date(iso + "T00:00:00").getDay());
}

/** Human elapsed time since an ISO datetime → "Xd Yh Zm". */
export function elapsedSince(iso: string): string {
  const start = new Date(iso).valueOf();
  if (!Number.isFinite(start)) return "—";
  let s = Math.max(0, Math.floor((Date.now() - start) / 1000));
  const d = Math.floor(s / 86400);
  s -= d * 86400;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  return `${d}d ${h}h ${m}m`;
}

/** Set/reset a quit habit's start datetime in its frontmatter. */
export async function setQuitStart(
  app: App,
  file: TFile,
  isoDateTime: string
): Promise<void> {
  let content = await app.vault.read(file);
  if (!content.startsWith("---")) {
    content = `---\nkind: quit\nquit-start: ${isoDateTime}\n---\n\n` + content;
    await app.vault.modify(file, content);
    return;
  }
  const end = content.indexOf("\n---", 3);
  if (end < 0) return;
  const head = content.slice(0, end);
  if (/^quit-start:/m.test(head)) {
    content = head.replace(/^quit-start:.*$/m, `quit-start: ${isoDateTime}`) + content.slice(end);
  } else {
    content = content.slice(0, end) + `\nquit-start: ${isoDateTime}` + content.slice(end);
  }
  await app.vault.modify(file, content);
}

/** Parse a frontmatter value into a string list (array, or ;/, separated). */
function parseStringList(v: unknown): string[] | undefined {
  if (v == null) return undefined;
  if (Array.isArray(v)) {
    const out = v.map((x) => String(x).trim()).filter(Boolean);
    return out.length ? out : undefined;
  }
  const s = String(v).trim();
  if (!s) return undefined;
  if (s.startsWith("[") && s.endsWith("]")) {
    const out = s
      .slice(1, -1)
      .split(",")
      .map((x) => x.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
    return out.length ? out : undefined;
  }
  const out = s.split(/[;,]/).map((x) => x.trim()).filter(Boolean);
  return out.length ? out : undefined;
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
/**
 * Create a habit file from the AI habit-designer (v0.10). `fields` is the
 * parsed anatomy (key → value); `areaPaths`/`projectPaths` come from the
 * modal's pickers. Disambiguates the filename. Returns the created TFile.
 */
export async function createHabitFromDesigner(
  app: App,
  name: string,
  areaPaths: string[],
  projectPaths: string[],
  fields: Map<string, string>,
  body: string,
  goalPaths: string[] = []
): Promise<TFile> {
  if (!app.vault.getAbstractFileByPath(HABITS_FOLDER)) {
    await app.vault.createFolder(HABITS_FOLDER);
  }
  const safe = (name || "New habit").replace(/[\\/:*?"<>|]/g, "").trim();
  let path = `${HABITS_FOLDER}/${safe}.md`;
  let n = 2;
  while (app.vault.getAbstractFileByPath(path)) {
    path = `${HABITS_FOLDER}/${safe} (${n}).md`;
    n++;
  }

  const q = (s: string) =>
    /^[\w .,/%-]+$/.test(s) && !s.includes(": ") ? s : `"${s.replace(/"/g, '\\"')}"`;
  const fm: string[] = ["---"];
  fm.push(
    areaPaths.length ? `areas: [${areaPaths.map((p) => `"[[${p}]]"`).join(", ")}]` : "areas: []"
  );
  fm.push(
    projectPaths.length
      ? `projects: [${projectPaths.map((p) => `"[[${p}]]"`).join(", ")}]`
      : "projects: []"
  );
  if (goalPaths.length) {
    fm.push(`goals: [${goalPaths.map((p) => `"[[${p}]]"`).join(", ")}]`);
  }
  fm.push(`periodicity: ${fields.get("periodicity") || "daily"}`);
  const bc = fields.get("binary-criterion") || fields.get("minimum") || "";
  if (bc) fm.push(`binary-criterion: ${q(bc)}`);
  for (const key of [
    "identity",
    "why",
    "cue",
    "target",
    "environment",
    "evidence",
    "reward",
    "recovery",
  ]) {
    const v = fields.get(key);
    if (v) fm.push(`${key}: ${q(v)}`);
  }
  const cons = fields.get("constraints");
  if (cons) {
    const items = cons.split(/[;]/).map((s) => s.trim()).filter(Boolean);
    if (items.length) fm.push(`constraints: [${items.map((s) => q(s)).join(", ")}]`);
  }
  // v0.12: quit habits + flexible scheduling.
  const kind = (fields.get("kind") || "do").toLowerCase() === "quit" ? "quit" : "do";
  if (kind === "quit") {
    fm.push("kind: quit");
    fm.push(`quit-start: ${fields.get("quit-start") || new Date().toISOString()}`);
  }
  const sched = fields.get("schedule-days");
  if (sched) fm.push(`schedule-days: [${sched.split(/[;,]/).map((s) => s.trim()).filter(Boolean).join(", ")}]`);
  const perWeek = fields.get("per-week");
  if (perWeek && Number.isFinite(Number(perWeek))) fm.push(`per-week: ${Number(perWeek)}`);
  fm.push("status: active");
  fm.push("---");
  fm.push("");
  fm.push(`# ${safe}`);
  fm.push("");
  fm.push(body.trim());
  fm.push("");

  return await app.vault.create(path, fm.join("\n"));
}

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
