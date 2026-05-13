import { App, TFile, TFolder } from "obsidian";
import { SecondBrainSettings } from "./settings";

export function todayISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function todayHHMM(): string {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

/**
 * Resolve the vault-relative path to today's daily log.
 * Strategy:
 *   1. If a file named `<date>.md` already exists anywhere under the logs folder, return that exact path.
 *   2. Otherwise, derive a path from `settings.dailyLogPathTemplate`.
 */
export async function resolveDailyLogPath(
  app: App,
  settings: SecondBrainSettings,
  date: string
): Promise<string> {
  const existing = findExistingDailyFile(app, settings, date);
  if (existing) return existing;

  let path = settings.dailyLogPathTemplate.replace("{YYYY-MM-DD}", date);
  const d = new Date(date + "T00:00:00");
  if (path.includes("{WEEK_NUM_2DIGIT}")) {
    path = path.replace(
      "{WEEK_NUM_2DIGIT}",
      String(isoWeek(d)).padStart(2, "0")
    );
  }
  return path;
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
