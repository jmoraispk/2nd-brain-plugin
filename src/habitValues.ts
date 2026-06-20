/**
 * Per-day habit values (v0.13). The numeric companion to manual marks
 * (`habitManual.ts`). Powers increment logging (6/8 cups), mood (1–5), and
 * body-weight tracking — anything where the day carries a NUMBER, not just
 * pass/fail.
 *
 * File: `🧑 Me/Habits/_values.md`, one line per entry:
 *   - 2026-06-20 | water | 6
 *
 * In-memory cache so per-cell stat lookups stay sync; call refreshHabitValues
 * once at render entry.
 */

import { App, TFile } from "obsidian";

export const HABIT_VALUES_PATH = "🧑 Me/Habits/_values.md";

let cache: Map<string, number> = new Map();

function key(date: string, habitId: string): string {
  return `${date} ${habitId}`;
}

export async function refreshHabitValues(app: App): Promise<void> {
  cache = new Map();
  const f = app.vault.getAbstractFileByPath(HABIT_VALUES_PATH);
  if (!(f instanceof TFile)) return;
  const raw = await app.vault.read(f);
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*-\s*(\d{4}-\d{2}-\d{2})\s*\|\s*([^|]+?)\s*\|\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (m) cache.set(key(m[1], m[2].trim()), parseFloat(m[3]));
  }
}

/** Sync lookup (refreshHabitValues must have run). */
export function valueFor(date: string, habitId: string): number | null {
  const v = cache.get(key(date, habitId));
  return v == null ? null : v;
}

/** Set (or clear, when value is null) a day's value; rewrites the file + cache. */
export async function setHabitValue(
  app: App,
  date: string,
  habitId: string,
  value: number | null
): Promise<void> {
  const f = app.vault.getAbstractFileByPath(HABIT_VALUES_PATH);
  const entries: Array<{ date: string; habitId: string; value: number }> = [];
  if (f instanceof TFile) {
    const raw = await app.vault.read(f);
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*-\s*(\d{4}-\d{2}-\d{2})\s*\|\s*([^|]+?)\s*\|\s*(-?\d+(?:\.\d+)?)\s*$/);
      if (m) entries.push({ date: m[1], habitId: m[2].trim(), value: parseFloat(m[3]) });
    }
  }
  const filtered = entries.filter((e) => !(e.date === date && e.habitId === habitId));
  if (value != null) filtered.push({ date, habitId, value });
  filtered.sort((a, b) =>
    a.date === b.date ? a.habitId.localeCompare(b.habitId) : a.date.localeCompare(b.date)
  );

  const body = [
    "---",
    "sb-habit-values: true",
    "---",
    "",
    "# Habit values",
    "",
    "_Per-day numeric logs (counts, mood, weight). Edited by tapping +/− or the inputs in the Habits tab._",
    "",
    ...filtered.map((e) => `- ${e.date} | ${e.habitId} | ${e.value}`),
    "",
  ].join("\n");

  if (f instanceof TFile) {
    await app.vault.modify(f, body);
  } else {
    const folder = HABIT_VALUES_PATH.split("/").slice(0, -1).join("/");
    if (folder && !app.vault.getAbstractFileByPath(folder)) {
      await app.vault.createFolder(folder);
    }
    await app.vault.create(HABIT_VALUES_PATH, body);
  }

  if (value != null) cache.set(key(date, habitId), value);
  else cache.delete(key(date, habitId));
}
