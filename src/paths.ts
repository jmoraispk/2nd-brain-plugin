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

export function todayHHMM(): string {
  const d = new Date();
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function toISO(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Apply all date placeholders in a template string, anchored on `today` (defaults to actual today).
 * Supports: {YYYY-MM-DD}, {TOMORROW}, {YESTERDAY}, {YYYY}, {MM}, {DD}, {WEEK_NUM_2DIGIT}.
 */
export function applyDatePlaceholders(template: string, today: string = todayISO()): string {
  const d = new Date(today + "T00:00:00");
  const tomorrow = new Date(d.valueOf());
  tomorrow.setDate(tomorrow.getDate() + 1);
  const yesterday = new Date(d.valueOf());
  yesterday.setDate(yesterday.getDate() - 1);

  return template
    .replace(/\{YYYY-MM-DD\}/g, today)
    .replace(/\{TOMORROW\}/g, toISO(tomorrow))
    .replace(/\{YESTERDAY\}/g, toISO(yesterday))
    .replace(/\{YYYY\}/g, String(d.getFullYear()))
    .replace(/\{MM\}/g, pad2(d.getMonth() + 1))
    .replace(/\{DD\}/g, pad2(d.getDate()))
    .replace(/\{WEEK_NUM_2DIGIT\}/g, pad2(isoWeek(d)));
}

/**
 * Resolve the vault-relative path to a daily log for a given date.
 * Strategy:
 *   1. If a file named `<date>.md` already exists anywhere under settings.logsFolder, return that exact path.
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

function isoWeek(d: Date): number {
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
