import { App, TFile, TFolder } from "obsidian";
import { SecondBrainSettings } from "./settings";

export function todayISO(): string {
  return toISO(new Date());
}

export function yesterdayISO(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return toISO(d);
}

export function tomorrowISO(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return toISO(d);
}

/**
 * Dates from the Monday of the ISO week containing `anchor` through (and including) `anchor`.
 * Used by the weekly review command to gather captures for the week so far.
 */
export function thisWeekDatesThroughAnchor(anchor: string = todayISO()): string[] {
  const d = new Date(anchor + "T00:00:00");
  const dayNr = (d.getDay() + 6) % 7; // Mon=0
  const out: string[] = [];
  for (let i = 0; i <= dayNr; i++) {
    const dt = new Date(d.valueOf());
    dt.setDate(dt.getDate() - dayNr + i);
    out.push(toISO(dt));
  }
  return out;
}

/** Mon–Sun of the ISO week BEFORE the one containing today. Returns 7 dates. */
export function lastWeekDates(): string[] {
  const today = new Date();
  const dayNr = (today.getDay() + 6) % 7; // Mon=0
  const lastWeekMon = new Date(today.valueOf());
  lastWeekMon.setDate(lastWeekMon.getDate() - dayNr - 7);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(lastWeekMon.valueOf());
    d.setDate(d.getDate() + i);
    return toISO(d);
  });
}

/** All calendar days of the month BEFORE the one containing today. */
export function lastMonthDates(): string[] {
  const today = new Date();
  const first = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const last = new Date(today.getFullYear(), today.getMonth(), 0); // day 0 = last day of previous month
  return datesInRange(first, last);
}

/** All calendar days of the quarter BEFORE the one containing today. */
export function lastQuarterDates(): string[] {
  const today = new Date();
  const q = Math.floor(today.getMonth() / 3); // 0..3 for current quarter
  const lastQYear = q === 0 ? today.getFullYear() - 1 : today.getFullYear();
  const lastQ = q === 0 ? 4 : q; // 1..4
  const startMonth = (lastQ - 1) * 3;
  const first = new Date(lastQYear, startMonth, 1);
  const last = new Date(lastQYear, startMonth + 3, 0);
  return datesInRange(first, last);
}

/** All calendar days of the year BEFORE the one containing today. */
export function lastYearDates(): string[] {
  const y = new Date().getFullYear() - 1;
  return datesInRange(new Date(y, 0, 1), new Date(y, 11, 31));
}

function datesInRange(from: Date, to: Date): string[] {
  const out: string[] = [];
  const d = new Date(from.valueOf());
  while (d <= to) {
    out.push(toISO(d));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

/** Canonical anchor date for an input kind — used by the runner to resolve output paths. */
export function anchorForInputKind(kind: string): string {
  const today = new Date();
  switch (kind) {
    case "today-log":
    case "today-review":
    case "this-week-logs":
      return toISO(today);
    case "yesterday-log":
    case "yesterday-review": {
      const d = new Date(today.valueOf());
      d.setDate(d.getDate() - 1);
      return toISO(d);
    }
    case "last-week-logs":
      return lastWeekDates()[0]; // Monday of last ISO week
    case "last-month-logs":
      return lastMonthDates()[0]; // 1st of last calendar month
    case "last-quarter-logs":
      return lastQuarterDates()[0]; // 1st of last calendar quarter
    case "last-year-logs":
      return lastYearDates()[0]; // Jan 1 of last year
    default:
      return toISO(today);
  }
}

/** Human-readable label for a period, used in dashboard banners. */
export function periodLabel(kind: string): string {
  switch (kind) {
    case "last-week-logs": {
      const ds = lastWeekDates();
      const first = new Date(ds[0] + "T00:00:00");
      const last = new Date(ds[6] + "T00:00:00");
      const fmt = (d: Date) =>
        d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      return `Week ${pad2(isoWeek(first))} (${fmt(first)}–${fmt(last)})`;
    }
    case "last-month-logs": {
      const d = new Date(lastMonthDates()[0] + "T00:00:00");
      return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    }
    case "last-quarter-logs": {
      const d = new Date(lastQuarterDates()[0] + "T00:00:00");
      const q = Math.floor(d.getMonth() / 3) + 1;
      return `Q${q} ${d.getFullYear()}`;
    }
    case "last-year-logs": {
      return String(new Date(lastYearDates()[0] + "T00:00:00").getFullYear());
    }
    default:
      return kind;
  }
}

export function todayHHMM(): string {
  const d = new Date();
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function toISO(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Apply all date placeholders, anchored on `today` (defaults to actual today).
 *
 * Placeholders:
 *   {YYYY-MM-DD}        the anchor date
 *   {TOMORROW}          anchor + 1 day
 *   {YESTERDAY}         anchor − 1 day
 *   {YYYY-MM}           anchor's calendar year-month
 *   {YYYY}              anchor's calendar year
 *   {MM}                anchor's calendar month, zero-padded
 *   {DD}                anchor's calendar day, zero-padded
 *   {ISO_YEAR}          ISO week year (differs from calendar year for some days in late Dec / early Jan)
 *   {WW}                ISO week, zero-padded
 *   {WEEK_NUM_2DIGIT}   alias for {WW} (kept for back-compat)
 *   {Q}                 quarter (1–4) of the week's Monday
 */
export function applyDatePlaceholders(
  template: string,
  today: string = todayISO()
): string {
  const d = new Date(today + "T00:00:00");
  const tomorrow = new Date(d.valueOf());
  tomorrow.setDate(tomorrow.getDate() + 1);
  const yesterday = new Date(d.valueOf());
  yesterday.setDate(yesterday.getDate() - 1);

  const ww = pad2(isoWeek(d));
  const isoY = isoYear(d);
  const q = quarterOfWeek(d);

  return template
    .replace(/\{YYYY-MM-DD\}/g, today)
    .replace(/\{TOMORROW\}/g, toISO(tomorrow))
    .replace(/\{YESTERDAY\}/g, toISO(yesterday))
    .replace(/\{YYYY-MM\}/g, today.slice(0, 7))
    .replace(/\{ISO_YEAR\}/g, String(isoY))
    .replace(/\{YYYY\}/g, String(d.getFullYear()))
    .replace(/\{MM\}/g, pad2(d.getMonth() + 1))
    .replace(/\{DD\}/g, pad2(d.getDate()))
    .replace(/\{Q\}/g, String(q))
    .replace(/\{WW\}/g, ww)
    .replace(/\{WEEK_NUM_2DIGIT\}/g, ww);
}

/**
 * Resolve the vault-relative path to a daily log for a given date.
 * Strategy:
 *   1. If a file named `<date>.md` already exists anywhere under settings.logsFolder, return that exact path.
 *      (Preserves older notes filed under the legacy Week_NN/ scheme.)
 *   2. Otherwise, derive a path from settings.dailyLogPathTemplate with placeholders applied.
 */
export async function resolveDailyLogPath(
  app: App,
  settings: SecondBrainSettings,
  date: string
): Promise<string> {
  const existing = findExistingDailyFile(app, settings, date);
  if (existing) return existing;
  return applyDatePlaceholders(settings.dailyLogPathTemplate, date);
}

function findExistingDailyFile(
  app: App,
  settings: SecondBrainSettings,
  date: string
): string | null {
  const root = app.vault.getAbstractFileByPath(settings.logsFolder);
  if (!(root instanceof TFolder)) return null;
  const target = `${date}.md`;
  const found = walkFolder(root, (f) => f.name === target);
  return found ? found.path : null;
}

function walkFolder(
  folder: TFolder,
  predicate: (file: TFile) => boolean
): TFile | null {
  for (const child of folder.children) {
    if (child instanceof TFile && predicate(child)) return child;
    if (child instanceof TFolder) {
      const sub = walkFolder(child, predicate);
      if (sub) return sub;
    }
  }
  return null;
}

/** ISO 8601 week number (Mon–Sun, week 1 contains first Thursday). */
export function isoWeek(d: Date): number {
  const target = new Date(d.valueOf());
  const dayNr = (d.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNr + 3);
  const firstThursday = target.valueOf();
  target.setMonth(0, 1);
  if (target.getDay() !== 4) {
    target.setMonth(0, 1 + ((4 - target.getDay()) + 7) % 7);
  }
  return 1 + Math.ceil((firstThursday - target.valueOf()) / 604800000);
}

/**
 * ISO week year — usually equals the calendar year, but for the last few
 * days of December and the first few days of January it can differ.
 * Example: 2024-12-30 is in ISO Week 1 of 2025.
 */
function isoYear(d: Date): number {
  const target = new Date(d.valueOf());
  const dayNr = (d.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNr + 3);
  return target.getFullYear();
}

/**
 * Quarter (1–4) of the ISO week containing date `d`, determined by the
 * week's Monday. Picks a single deterministic quarter for weeks that span
 * a Q-boundary (Q1↔Q2, Q2↔Q3, Q3↔Q4).
 */
function quarterOfWeek(d: Date): number {
  const dayNr = (d.getDay() + 6) % 7;
  const monday = new Date(d.valueOf());
  monday.setDate(monday.getDate() - dayNr);
  return Math.floor(monday.getMonth() / 3) + 1;
}
