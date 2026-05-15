import { Notice, TFile, TFolder, App } from "obsidian";
import SecondBrainPlugin from "../main";
import {
  YEAR_QUESTIONS,
  DECADE_QUESTIONS,
  KepanoQuestion,
  filenameForQuestion,
  questionOfWeek,
  questionOfMonth,
  QS_YEAR_FOLDER,
  QS_DECADE_FOLDER,
} from "./questions";

export type QsKind = "year" | "decade";

export interface QsTabState {
  kind: QsKind;
  draftAnswer: string;
}

export function defaultQsTabState(): QsTabState {
  return { kind: "year", draftAnswer: "" };
}

export interface QsTabCallbacks {
  setKind: (kind: QsKind) => void;
  setDraftAnswer: (text: string) => void;
  onAnswerSaved: () => void;
}

export async function renderQs(
  parent: HTMLElement,
  plugin: SecondBrainPlugin,
  state: QsTabState,
  cb: QsTabCallbacks
): Promise<void> {
  const body = parent.createDiv({ cls: "second-brain-tab-body" });

  // Ensure all 80 question files + index files exist on first visit.
  await ensureQuestionFiles(plugin);

  // Year / Decade sub-tab bar.
  const subtabs = body.createDiv({ cls: "second-brain-subtabs" });
  for (const k of ["year", "decade"] as QsKind[]) {
    const el = subtabs.createEl("button", {
      text: k === "year" ? "Year" : "Decade",
      cls: `second-brain-subtab${state.kind === k ? " active" : ""}`,
    });
    el.addEventListener("click", () => cb.setKind(k));
  }

  // Current question + answer textarea.
  const today = new Date();
  const q = state.kind === "year" ? questionOfWeek(today) : questionOfMonth(today);
  const periodLabel = state.kind === "year"
    ? `Week ${pad2(isoWeekNumber(today))} of ${isoYearNumber(today)}`
    : `${today.toLocaleDateString("en-US", { month: "long", year: "numeric" })}`;

  const qSec = body.createDiv({ cls: "second-brain-section" });
  qSec.createEl("div", {
    cls: "second-brain-muted",
    text: `This ${state.kind === "year" ? "week's yearly" : "month's decade"} question — ${periodLabel}`,
  });
  qSec.createEl("div", {
    cls: "second-brain-qs-question",
    text: `Q${q.n} — ${q.question}`,
  });

  const ta = qSec.createEl("textarea", {
    cls: "second-brain-review-textarea",
    attr: { placeholder: "Your answer…", rows: "6" },
  });
  ta.value = state.draftAnswer;
  ta.addEventListener("input", () => cb.setDraftAnswer(ta.value));

  const saveBtn = qSec.createEl("button", {
    text: "Save answer",
    cls: "second-brain-button second-brain-button-primary",
  });
  saveBtn.addEventListener("click", async () => {
    const text = state.draftAnswer.trim();
    if (!text) {
      new Notice("Type an answer first.");
      return;
    }
    await appendAnswer(plugin, q, state.kind, text);
    cb.setDraftAnswer("");
    cb.onAnswerSaved();
    new Notice(`Saved to ${filenameForQuestion(q)} — see ${state.kind === "year" ? "Qs-Year" : "Qs-Decade"} index for status.`);
  });

  // Index link + browse list.
  const browseSec = body.createDiv({ cls: "second-brain-section" });
  browseSec.createEl("h3", { text: "Browse all 40" });

  const folder = state.kind === "year" ? QS_YEAR_FOLDER : QS_DECADE_FOLDER;
  const indexPath = `${folder}/00-index.md`;
  const indexFile = plugin.app.vault.getAbstractFileByPath(indexPath);
  if (indexFile instanceof TFile) {
    const link = browseSec.createEl("a", {
      text: "📄 Open full index (auto-updates on every save)",
      cls: "second-brain-link",
    });
    link.addEventListener("click", () =>
      plugin.app.workspace.getLeaf(false).openFile(indexFile)
    );
  }

  // Compact list of all 40 with status emoji.
  const questions = state.kind === "year" ? YEAR_QUESTIONS : DECADE_QUESTIONS;
  const list = browseSec.createEl("ul", { cls: "second-brain-list" });
  for (const qq of questions) {
    const path = `${folder}/${filenameForQuestion(qq)}`;
    const file = plugin.app.vault.getAbstractFileByPath(path);
    let status = "🆕";
    if (file instanceof TFile) {
      const content = await plugin.app.vault.read(file);
      status = readStatus(content);
    }
    const li = list.createEl("li");
    const a = li.createEl("a", {
      text: `${status}  Q${qq.n} · ${qq.slug}`,
      cls: "second-brain-link",
    });
    a.addEventListener("click", async () => {
      const f = plugin.app.vault.getAbstractFileByPath(path);
      if (f instanceof TFile) await plugin.app.workspace.getLeaf(false).openFile(f);
    });
  }
}

// ── file management ──────────────────────────────────────────────────────

async function ensureFolder(app: App, folderPath: string) {
  if (app.vault.getAbstractFileByPath(folderPath)) return;
  await app.vault.createFolder(folderPath);
}

function emptyQContent(q: KepanoQuestion, kind: QsKind): string {
  return `---
n: ${q.n}
slug: ${q.slug}
type: ${kind}
status: 🆕
last-touched:
total-answers: 0
total-words: 0
---

# Q${q.n} — ${q.question}

_Status emojis: 🆕 new · 🟡 in progress · 🟢 answered · 🔴 revisit. Edit the frontmatter above to change._
`;
}

async function ensureQuestionFiles(plugin: SecondBrainPlugin) {
  let created = 0;
  for (const [folder, questions, kind] of [
    [QS_YEAR_FOLDER, YEAR_QUESTIONS, "year"] as const,
    [QS_DECADE_FOLDER, DECADE_QUESTIONS, "decade"] as const,
  ]) {
    await ensureFolder(plugin.app, folder);
    for (const q of questions) {
      const path = `${folder}/${filenameForQuestion(q)}`;
      if (!plugin.app.vault.getAbstractFileByPath(path)) {
        await plugin.app.vault.create(path, emptyQContent(q, kind));
        created++;
      }
    }
    // Always (re-)generate the index — cheap, keeps it fresh.
    await regenerateIndex(plugin, kind);
  }
  if (created > 0) {
    new Notice(`Pre-created ${created} Kepano question file(s).`);
  }
}

async function appendAnswer(
  plugin: SecondBrainPlugin,
  q: KepanoQuestion,
  kind: QsKind,
  answer: string
): Promise<void> {
  const folder = kind === "year" ? QS_YEAR_FOLDER : QS_DECADE_FOLDER;
  const path = `${folder}/${filenameForQuestion(q)}`;
  const file = plugin.app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) {
    throw new Error(`Question file missing: ${path}`);
  }

  const today = new Date();
  const dateStr = `${today.getFullYear()}-${pad2(today.getMonth() + 1)}-${pad2(today.getDate())}`;
  const period =
    kind === "year"
      ? `${isoYearNumber(today)} W${pad2(isoWeekNumber(today))}`
      : `${today.getFullYear()}-${pad2(today.getMonth() + 1)}`;
  const session = `\n### ${period} · ${dateStr}\n\n${answer.trim()}\n`;

  const current = await plugin.app.vault.read(file);
  const parsed = parseFrontmatter(current);

  // Bump status to "in progress" the first time the user touches the file;
  // never downgrade if it's already 🟢 / 🔴.
  if (parsed.fm.status === "🆕" || !parsed.fm.status) {
    parsed.fm.status = "🟡";
  }
  parsed.fm["last-touched"] = dateStr;
  const newBody = parsed.body.replace(/\s*$/, "") + "\n" + session;
  parsed.fm["total-answers"] = String(
    parseInt(String(parsed.fm["total-answers"] || "0"), 10) + 1
  );
  parsed.fm["total-words"] = String(countWords(newBody));

  const next = serializeFrontmatter(parsed.fm) + newBody;
  await plugin.app.vault.modify(file, next);

  await regenerateIndex(plugin, kind);
}

async function regenerateIndex(plugin: SecondBrainPlugin, kind: QsKind) {
  const folder = kind === "year" ? QS_YEAR_FOLDER : QS_DECADE_FOLDER;
  const questions = kind === "year" ? YEAR_QUESTIONS : DECADE_QUESTIONS;
  const indexPath = `${folder}/00-index.md`;

  const counts: Record<string, number> = { "🆕": 0, "🟡": 0, "🟢": 0, "🔴": 0 };
  const rows: string[] = [];
  for (const q of questions) {
    const path = `${folder}/${filenameForQuestion(q)}`;
    const file = plugin.app.vault.getAbstractFileByPath(path);
    let status = "🆕";
    let answers = "0";
    let words = "0";
    let lastTouched = "";
    if (file instanceof TFile) {
      const content = await plugin.app.vault.read(file);
      const parsed = parseFrontmatter(content);
      status = (parsed.fm.status as string) || "🆕";
      answers = String(parsed.fm["total-answers"] || "0");
      words = String(parsed.fm["total-words"] || "0");
      lastTouched = String(parsed.fm["last-touched"] || "");
    }
    counts[status] = (counts[status] || 0) + 1;
    const fnameNoExt = filenameForQuestion(q).replace(/\.md$/, "");
    rows.push(
      `| ${q.n} | [[${fnameNoExt}\\|${q.slug}]] | ${status} | ${answers} | ${words} | ${lastTouched} |`
    );
  }

  const summary = `🆕 ${counts["🆕"] ?? 0} · 🟡 ${counts["🟡"] ?? 0} · 🟢 ${counts["🟢"] ?? 0} · 🔴 ${counts["🔴"] ?? 0}`;

  const title = kind === "year" ? "Yearly Questions" : "Decade Questions";
  const content = `# ${title} — Index

_Auto-updated by the plugin on every save. Edit the per-question files directly — not this index._

**Status snapshot:** ${summary}

| # | Slug | Status | Answers | Words | Last touched |
|---|---|---|---|---|---|
${rows.join("\n")}

_Status emojis: 🆕 new · 🟡 in progress · 🟢 answered · 🔴 needs revisit. Toggle them in each question file's frontmatter._
`;

  const existing = plugin.app.vault.getAbstractFileByPath(indexPath);
  if (existing instanceof TFile) {
    await plugin.app.vault.modify(existing, content);
  } else {
    await plugin.app.vault.create(indexPath, content);
  }
}

// ── helpers ──────────────────────────────────────────────────────────────

function readStatus(content: string): string {
  const m = content.match(/^status:\s*(\S+)/m);
  return m?.[1] ?? "🆕";
}

interface Parsed {
  fm: Record<string, string>;
  body: string;
}

function parseFrontmatter(content: string): Parsed {
  const m = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) return { fm: {}, body: content };
  const fm: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([^:]+):\s*(.*)$/);
    if (kv) fm[kv[1].trim()] = kv[2].trim();
  }
  return { fm, body: m[2] };
}

function serializeFrontmatter(fm: Record<string, string>): string {
  const lines = ["---"];
  for (const k of Object.keys(fm)) {
    lines.push(`${k}: ${fm[k]}`);
  }
  lines.push("---", "");
  return lines.join("\n");
}

function countWords(s: string): number {
  // Strip ATX headings, code fences, and frontmatter-ish lines before counting.
  const stripped = s.replace(/^#+\s.*$/gm, "").replace(/```[\s\S]*?```/g, "");
  const matches = stripped.match(/\S+/g);
  return matches ? matches.length : 0;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function isoWeekNumber(d: Date): number {
  const t = new Date(d.valueOf());
  const dayNr = (d.getDay() + 6) % 7;
  t.setDate(t.getDate() - dayNr + 3);
  const firstThursday = t.valueOf();
  t.setMonth(0, 1);
  if (t.getDay() !== 4) {
    t.setMonth(0, 1 + ((4 - t.getDay()) + 7) % 7);
  }
  return 1 + Math.ceil((firstThursday - t.valueOf()) / 604800000);
}

function isoYearNumber(d: Date): number {
  const t = new Date(d.valueOf());
  const dayNr = (d.getDay() + 6) % 7;
  t.setDate(t.getDate() - dayNr + 3);
  return t.getFullYear();
}
