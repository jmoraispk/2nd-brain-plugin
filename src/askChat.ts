/**
 * "Ask" chat (v0.14) — talk to the vault. Two-pass, structure-aware so it
 * reads only what it needs:
 *   1. PLAN — a cheap call sees a *map* of the vault (zones + a bounded index
 *      of files, no contents) and picks the minimum set of files to read.
 *   2. ANSWER — the plugin reads only those files (capped), then the model
 *      answers with citations.
 * Read-only: it never writes. The map keeps token spend low and stops the
 * model from trawling the whole vault.
 */

import { App, TFile, TFolder } from "obsidian";
import SecondBrainPlugin from "../main";
import { callLLM } from "./llm";
import { resolveRoute } from "./modelRoutes";
import { loadHabits } from "./habits";
import { loadGoals } from "./goals";
import { loadProjects } from "./projects";
import { AREAS } from "./areas";
import { resolveDailyLogPath, todayISO, toISO } from "./paths";

const MAX_FILES = 8;
const MAX_TOTAL_CHARS = 60_000;
const MAX_FILE_CHARS = 12_000;

const PLAN_SYSTEM = `You route a question about the user's life to the FEWEST vault files needed to answer it. You are given a structured MAP of the vault (zones + an index of files; NOT their contents).

Pick only files whose contents you genuinely need (max ${MAX_FILES}). Use the zone guide to avoid reading needless things:
- Recent daily logs = what happened lately (raw captures).
- Reviews = synthesized summaries of periods (cheaper than reading every log).
- Habits / Goals / Projects = the structured definitions + progress.
Prefer a review over many raw logs when the question is about a period. Prefer a single habit/goal/project file when the question names one.

Return ONLY a fenced json block:
\`\`\`json
{ "files": ["exact/path/from/the/map.md", "..."] }
\`\`\`
Choose paths EXACTLY as written in the map. If the map's summary lines already answer it, return {"files": []}.`;

const ANSWER_SYSTEM = `You answer the user's question about their own life using ONLY the provided vault excerpts. Be concise and specific; quote where it helps. Cite the source file path in parentheses after a claim. If the excerpts don't contain the answer, say so plainly and suggest which review or log might help — do not invent.`;

export interface AskResult {
  answer: string;
  sources: string[];
}

export async function askVault(
  plugin: SecondBrainPlugin,
  question: string
): Promise<AskResult> {
  const { text: map, allowed } = await buildVaultMap(plugin);
  const route = resolveRoute(plugin.settings, "ask");

  // ── Pass 1: plan ──
  const planOut = await callLLM(
    plugin.settings,
    PLAN_SYSTEM,
    `Question: ${question}\n\n${map}`,
    { model: route.model, effort: route.effort }
  );
  const wanted = parsePlannedFiles(planOut).filter((p) => allowed.has(p)).slice(0, MAX_FILES);

  // ── Read the selected files (capped) ──
  const sources: string[] = [];
  const parts: string[] = [];
  let total = 0;
  for (const path of wanted) {
    const f = plugin.app.vault.getAbstractFileByPath(path);
    if (!(f instanceof TFile)) continue;
    let content = await plugin.app.vault.read(f);
    if (content.length > MAX_FILE_CHARS) {
      content = content.slice(0, MAX_FILE_CHARS) + "\n…(truncated)";
    }
    if (total + content.length > MAX_TOTAL_CHARS) break;
    total += content.length;
    sources.push(path);
    parts.push(`### ${path}\n\n${content}`);
  }

  // ── Pass 2: answer ──
  const context =
    parts.length > 0
      ? parts.join("\n\n---\n\n")
      : "(No files were read — answer from general knowledge of the vault structure, or say you need more.)";
  const answer = await callLLM(
    plugin.settings,
    ANSWER_SYSTEM,
    `Question: ${question}\n\n## Vault excerpts\n\n${context}`,
    { model: route.model, effort: route.effort }
  );

  return { answer, sources };
}

/** Build the vault map (zones + bounded file index) + the allow-set of paths. */
async function buildVaultMap(
  plugin: SecondBrainPlugin
): Promise<{ text: string; allowed: Set<string> }> {
  const app = plugin.app;
  const allowed = new Set<string>();
  const lines: string[] = [];

  lines.push("## Vault map");
  lines.push("");
  lines.push("### Zones");
  lines.push("- 🧑 Me/Logs — raw daily captures (stream of consciousness).");
  lines.push("- 🤖 AI/Reviews — AI summaries: Daily / Weekly / Monthly / Quarterly / Yearly.");
  lines.push("- 🧑 Me/Reviews — the user's own written reflections.");
  lines.push("- 🧑 Me/Habits, 🧑 Me/Goals, 1. 🎯 Projects — structured definitions + progress.");
  lines.push("- 2. 🌳 Areas — the fixed Wheel of Life (Health/Relationships/Work).");
  lines.push("");

  // Areas (static, no files needed).
  lines.push("### Areas");
  lines.push(AREAS.map((a) => `${a.macro}/${a.sub}`).join(" · "));
  lines.push("");

  // Habits / Goals / Projects — definitions (request to read for detail).
  const habits = (await loadHabits(app)).filter((h) => h.file);
  if (habits.length) {
    lines.push("### Habits (path — name)");
    for (const h of habits) {
      if (h.file) {
        allowed.add(h.file.path);
        lines.push(`- ${h.file.path} — ${h.name} [${h.kind}]`);
      }
    }
    lines.push("");
  }

  const goals = await loadGoals(app);
  if (goals.length) {
    lines.push("### Goals (path — name · status)");
    for (const g of goals) {
      allowed.add(g.file.path);
      lines.push(`- ${g.file.path} — ${g.name} · ${g.status}`);
    }
    lines.push("");
  }

  const projects = await loadProjects(app);
  if (projects.length) {
    lines.push("### Projects (path — name · status)");
    for (const p of projects) {
      allowed.add(p.file.path);
      lines.push(`- ${p.file.path} — ${p.name} · ${p.status}`);
    }
    lines.push("");
  }

  // Recent daily logs (last 30 days that exist).
  const recentLogs: string[] = [];
  const today = todayISO();
  for (let i = 0; i < 30; i++) {
    const d = new Date(today + "T00:00:00");
    d.setDate(d.getDate() - i);
    const iso = toISO(d);
    const path = await resolveDailyLogPath(app, plugin.settings, iso);
    if (app.vault.getAbstractFileByPath(path) instanceof TFile) {
      recentLogs.push(path);
      allowed.add(path);
    }
  }
  if (recentLogs.length) {
    lines.push(`### Recent daily logs (newest first, last ${recentLogs.length})`);
    for (const p of recentLogs) lines.push(`- ${p}`);
    lines.push("");
  }

  // Recent reviews (AI + user), by mtime.
  for (const [label, root] of [
    ["Recent AI reviews", "🤖 AI/Reviews"],
    ["Recent your-reviews", "🧑 Me/Reviews"],
  ] as const) {
    const folder = app.vault.getAbstractFileByPath(root);
    if (!(folder instanceof TFolder)) continue;
    const files: TFile[] = [];
    collectMd(folder, files);
    files.sort((a, b) => b.stat.mtime - a.stat.mtime);
    const top = files.slice(0, 12);
    if (top.length) {
      lines.push(`### ${label} (newest first)`);
      for (const f of top) {
        allowed.add(f.path);
        lines.push(`- ${f.path}`);
      }
      lines.push("");
    }
  }

  return { text: lines.join("\n"), allowed };
}

function collectMd(folder: TFolder, out: TFile[]) {
  for (const c of folder.children) {
    if (c instanceof TFolder) collectMd(c, out);
    else if (c instanceof TFile && c.name.endsWith(".md")) out.push(c);
  }
}

/** Pull the files[] array out of the planner's JSON-ish response. */
function parsePlannedFiles(out: string): string[] {
  // Try a fenced json block first, then any {...} with a files array.
  const fence = out.match(/```json\s*\n([\s\S]*?)```/);
  const candidate = fence ? fence[1] : out;
  try {
    const obj = JSON.parse(candidate.trim());
    if (Array.isArray(obj?.files)) return obj.files.map((s: unknown) => String(s));
  } catch {
    /* fall through */
  }
  // Fallback: extract quoted paths after "files".
  const m = candidate.match(/"files"\s*:\s*\[([\s\S]*?)\]/);
  if (m) {
    return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  }
  return [];
}
