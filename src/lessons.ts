/**
 * Lessons ledger (v0.14.1). The AI distils durable lessons from your reviews
 * into a single growing, area-tagged file at `🤖 AI/Lessons/lessons.md`.
 * Append-only + deduped: re-running never re-adds a lesson you already have.
 *
 * Reviews are the input (they already contain "Lessons and observations"
 * sections) — far cheaper and higher-signal than re-reading every raw log.
 */

import { App, TFile, TFolder } from "obsidian";
import { SecondBrainSettings } from "./settings";
import { areaFor } from "./areas";

export const LESSONS_PATH = "🤖 AI/Lessons/lessons.md";

const MAX_REVIEW_CHARS = 50_000;

export interface ExtractedLesson {
  text: string;
  area?: string;
}

/** Concatenate recent review files (AI + user), newest first, capped. */
export async function buildLessonContext(app: App): Promise<string> {
  const files: TFile[] = [];
  for (const root of ["🤖 AI/Reviews", "🧑 Me/Reviews"]) {
    const f = app.vault.getAbstractFileByPath(root);
    if (f instanceof TFolder) collectMd(f, files);
  }
  files.sort((a, b) => b.stat.mtime - a.stat.mtime);

  const parts: string[] = [];
  let total = 0;
  for (const f of files) {
    const c = await app.vault.read(f);
    if (total + c.length > MAX_REVIEW_CHARS) break;
    total += c.length;
    parts.push(`### ${f.path}\n\n${c}`);
  }
  return parts.join("\n\n---\n\n");
}

/** Parse the LLM's `lessons:` YAML block into entries. */
export function parseLessonsBlock(body: string): ExtractedLesson[] {
  const blocks = body.matchAll(/```ya?ml\s*\n([\s\S]*?)```/g);
  for (const m of blocks) {
    const block = m[1];
    if (!/^\s*lessons:/m.test(block)) continue;
    return parseLessonsYaml(block);
  }
  return [];
}

function parseLessonsYaml(block: string): ExtractedLesson[] {
  const out: ExtractedLesson[] = [];
  const lines = block.split(/\r?\n/);
  let inList = false;
  let cur: Partial<ExtractedLesson> | null = null;
  const flush = () => {
    if (cur?.text) out.push({ text: cur.text, area: cur.area });
    cur = null;
  };
  for (const line of lines) {
    if (/^lessons:\s*\[\s*\]\s*$/.test(line)) return [];
    if (/^lessons:\s*$/.test(line)) {
      inList = true;
      continue;
    }
    if (!inList) continue;
    const item = line.match(/^\s*-\s+text:\s*(.+)$/);
    if (item) {
      flush();
      cur = { text: unquote(item[1].trim()) };
      continue;
    }
    const area = line.match(/^\s+area:\s*(.+)$/);
    if (area && cur) cur.area = unquote(area[1].trim()) || undefined;
  }
  flush();
  return out;
}

function unquote(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

/**
 * Merge extracted lessons into the ledger, deduped by normalized text.
 * New lessons get a date + (resolved) area label. Returns count added.
 */
export async function mergeLessons(
  app: App,
  date: string,
  extracted: ExtractedLesson[]
): Promise<number> {
  const folder = LESSONS_PATH.split("/").slice(0, -1).join("/");
  if (folder && !app.vault.getAbstractFileByPath(folder)) {
    await app.vault.createFolder(folder);
  }
  const existing = app.vault.getAbstractFileByPath(LESSONS_PATH);
  const raw = existing instanceof TFile ? await app.vault.read(existing) : "";
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const seen = new Set<string>();
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^-\s+.*?—\s*(.+?)\s*$/);
    if (m) seen.add(norm(m[1]));
  }

  const additions: string[] = [];
  for (const l of extracted) {
    const key = norm(l.text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const def = l.area ? areaFor(l.area) : undefined;
    const tag = def ? `${def.macro}/${def.sub}` : l.area || "—";
    additions.push(`- ${date} · ${tag} — ${l.text.trim()}`);
  }
  if (additions.length === 0 && existing instanceof TFile) return 0;

  let body: string;
  if (existing instanceof TFile) {
    body = raw.replace(/\s*$/, "") + "\n" + additions.join("\n") + "\n";
  } else {
    body = [
      "---",
      "sb-lessons: true",
      "---",
      "",
      "# Lessons",
      "",
      "_Durable lessons distilled from your reviews. Append-only; the AI adds new ones on each run._",
      "",
      ...additions,
      "",
    ].join("\n");
  }

  if (existing instanceof TFile) await app.vault.modify(existing, body);
  else await app.vault.create(LESSONS_PATH, body);
  return additions.length;
}

function collectMd(folder: TFolder, out: TFile[]) {
  for (const c of folder.children) {
    if (c instanceof TFolder) collectMd(c, out);
    else if (c instanceof TFile && c.name.endsWith(".md")) out.push(c);
  }
}

/** Inject recent-review context as the user message for the extract-lessons command. */
export async function lessonsUserMessage(
  app: App,
  _settings: SecondBrainSettings
): Promise<string> {
  const ctx = await buildLessonContext(app);
  return `## Recent reviews\n\n${ctx || "(no reviews yet)"}`;
}
