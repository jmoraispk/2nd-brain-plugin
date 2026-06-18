/**
 * TODO proposal storage (v0.9). The daily review emits a fenced YAML block
 * listing proposed TODOs; the plugin extracts those proposals and writes them
 * to one file per day under `🤖 AI/Proposals/<date>.md`.
 *
 * Persistence model:
 *   - Each proposal is one entry in the YAML frontmatter `proposals:` array.
 *   - status: pending | accepted | deleted. Plugin updates the frontmatter
 *     when the user clicks Accept or Delete on the Dashboard. Re-running the
 *     daily review APPENDS new proposals (deduped against existing text);
 *     existing entries (accepted/deleted) are preserved as-is.
 *   - Stable id = a hash of the text + date so the same captured-action
 *     across re-runs collapses to one proposal.
 */

import { App, TFile } from "obsidian";
import { appendTodoToProject, completeTodoInProject } from "./projectMutate";

export const PROPOSALS_FOLDER = "🤖 AI/Proposals";

export type ProposalStatus = "pending" | "accepted" | "deleted";
/** add = new TODO to append; complete = an existing TODO the AI thinks is done. */
export type ProposalKind = "add" | "complete";

export interface Proposal {
  id: string;
  text: string;
  /** Vault path of the matched project file, or null if AI couldn't match. */
  projectPath: string | null;
  status: ProposalStatus;
  /** add (default) or complete an existing TODO. */
  kind: ProposalKind;
  /** [HH:MM] timestamp of the capture that triggered this proposal (optional). */
  capturedAt?: string;
}

export interface ProposalFile {
  date: string;       // YYYY-MM-DD
  proposals: Proposal[];
  file: TFile;
}

/** Path for the proposals file of a given date. */
export function proposalFilePath(dateIso: string): string {
  return `${PROPOSALS_FOLDER}/${dateIso}.md`;
}

/**
 * Parse an LLM-emitted fenced YAML block of the form:
 *
 *   ```yaml
 *   todos:
 *     - text: "Buy groceries"
 *       project: "1. 🎯 Projects/Errands.md"   # or null
 *       captured-at: "[14:22]"                  # optional
 *   ```
 *
 * Tolerant of multiple blocks; only the first one starting with `todos:` wins.
 */
export interface ExtractedTodo {
  text: string;
  projectPath: string | null;
  capturedAt?: string;
  kind: ProposalKind;
}

/** Parse both the `todos:` (new) and `updates:` (completed) YAML blocks. */
export function parseTodosBlock(reviewBody: string): ExtractedTodo[] {
  const out: ExtractedTodo[] = [];
  const blocks = reviewBody.matchAll(/```ya?ml\s*\n([\s\S]*?)```/g);
  for (const m of blocks) {
    const block = m[1];
    if (/^\s*todos:/m.test(block)) {
      out.push(...parseTodosYaml(block, "todos", "add"));
    }
    if (/^\s*updates:/m.test(block)) {
      out.push(...parseTodosYaml(block, "updates", "complete"));
    }
  }
  return out;
}

function parseTodosYaml(
  block: string,
  key: "todos" | "updates",
  kind: ProposalKind
): ExtractedTodo[] {
  const out: ExtractedTodo[] = [];
  const lines = block.split(/\r?\n/);
  let inTodos = false;
  let current: Partial<ExtractedTodo> | null = null;

  const flush = () => {
    if (current && current.text) {
      out.push({
        text: current.text,
        projectPath: current.projectPath ?? null,
        capturedAt: current.capturedAt,
        kind,
      });
    }
    current = null;
  };

  const emptyRe = new RegExp(`^${key}:\\s*\\[\\s*\\]\\s*$`);
  const startRe = new RegExp(`^${key}:\\s*$`);
  for (const line of lines) {
    if (emptyRe.test(line)) {
      inTodos = false;
      continue;
    }
    if (startRe.test(line)) {
      inTodos = true;
      continue;
    }
    // A different top-level key ends the current list.
    if (inTodos && /^[a-zA-Z][\w-]*:\s*$/.test(line) && !startRe.test(line)) {
      flush();
      inTodos = false;
      continue;
    }
    if (!inTodos) continue;
    if (line.trim() === "") continue;

    // New list item.
    const itemStart = line.match(/^\s*-\s+text:\s*(.+)$/);
    if (itemStart) {
      flush();
      current = { text: stripQuotes(itemStart[1].trim()) };
      continue;
    }
    // Continuation field for current item.
    const proj = line.match(/^\s+project:\s*(.+)$/);
    if (proj && current) {
      const v = proj[1].trim();
      current.projectPath = v === "null" || v === "" ? null : stripQuotes(v);
      continue;
    }
    const cap = line.match(/^\s+captured-at:\s*(.+)$/);
    if (cap && current) {
      current.capturedAt = stripQuotes(cap[1].trim());
      continue;
    }
  }
  flush();
  return out;
}

function stripQuotes(s: string): string {
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    return s.slice(1, -1);
  }
  if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) {
    return s.slice(1, -1);
  }
  return s;
}

/**
 * Stable proposal id from the date + text (collapses repeats across re-runs).
 * Browser-friendly SHA-1, truncated to keep ids short.
 */
async function makeProposalId(
  date: string,
  text: string,
  kind: ProposalKind
): Promise<string> {
  const buf = new TextEncoder().encode(
    `${date}|${kind}|${text.toLowerCase().trim()}`
  );
  const hash = await crypto.subtle.digest("SHA-1", buf);
  return Array.from(new Uint8Array(hash))
    .slice(0, 6)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Merge a list of newly-extracted TODOs into the existing proposals file for
 * `date` (creating it if missing). Existing entries are preserved; new
 * entries are appended; entries with the same id are NOT duplicated.
 */
export async function mergeExtractedTodos(
  app: App,
  date: string,
  extracted: ExtractedTodo[]
): Promise<{ added: number; total: number }> {
  await ensureFolder(app, PROPOSALS_FOLDER);

  const existing = await readProposalsFile(app, date);
  const knownIds = new Set(existing.map((p) => p.id));

  let added = 0;
  for (const e of extracted) {
    const id = await makeProposalId(date, e.text, e.kind);
    if (knownIds.has(id)) continue;
    existing.push({
      id,
      text: e.text,
      projectPath: e.projectPath,
      capturedAt: e.capturedAt,
      status: "pending",
      kind: e.kind,
    });
    knownIds.add(id);
    added++;
  }

  if (added > 0 || !app.vault.getAbstractFileByPath(proposalFilePath(date))) {
    await writeProposalsFile(app, date, existing);
  }
  return { added, total: existing.length };
}

/**
 * Read all proposals files under `🤖 AI/Proposals/`, return only PENDING
 * proposals across all dates, sorted newest-first.
 */
export async function loadPendingProposals(
  app: App
): Promise<Array<Proposal & { date: string }>> {
  const folder = app.vault.getAbstractFileByPath(PROPOSALS_FOLDER);
  if (!folder) return [];
  // @ts-ignore — TFolder type check via name property
  const children = (folder as any).children ?? [];
  const out: Array<Proposal & { date: string }> = [];
  for (const c of children) {
    if (!(c instanceof TFile) || !c.name.endsWith(".md")) continue;
    const date = c.basename;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const proposals = await readProposalsFile(app, date);
    for (const p of proposals) {
      if (p.status === "pending") out.push({ ...p, date });
    }
  }
  out.sort((a, b) => b.date.localeCompare(a.date));
  return out;
}

/** Read + parse a proposals file for the given date. Returns [] if missing. */
export async function readProposalsFile(
  app: App,
  date: string
): Promise<Proposal[]> {
  const f = app.vault.getAbstractFileByPath(proposalFilePath(date));
  if (!(f instanceof TFile)) return [];
  const raw = await f.vault.read(f);
  return parseProposalsFrontmatter(raw);
}

/**
 * Serialize the proposals list into the YAML frontmatter form and rewrite the
 * file. Body kept minimal — the YAML is the source of truth.
 */
async function writeProposalsFile(
  app: App,
  date: string,
  proposals: Proposal[]
): Promise<void> {
  const lines = ["---", "sb-proposals: true", `date: ${date}`, "proposals:"];
  for (const p of proposals) {
    lines.push(`  - id: ${p.id}`);
    lines.push(`    text: ${yamlString(p.text)}`);
    lines.push(
      `    project: ${p.projectPath === null ? "null" : yamlString(p.projectPath)}`
    );
    lines.push(`    status: ${p.status}`);
    lines.push(`    kind: ${p.kind}`);
    if (p.capturedAt) {
      lines.push(`    captured-at: ${yamlString(p.capturedAt)}`);
    }
  }
  lines.push("---");
  lines.push("");
  lines.push(`# TODO proposals — ${date}`);
  lines.push("");
  const counts = countByStatus(proposals);
  lines.push(
    `_${counts.pending} pending, ${counts.accepted} accepted, ${counts.deleted} deleted._ Use the Dashboard to act on the pending ones.`
  );
  const body = lines.join("\n");

  const path = proposalFilePath(date);
  const existing = app.vault.getAbstractFileByPath(path);
  if (existing instanceof TFile) {
    await app.vault.modify(existing, body);
  } else {
    await app.vault.create(path, body);
  }
}

function countByStatus(
  proposals: Proposal[]
): Record<ProposalStatus, number> {
  const out: Record<ProposalStatus, number> = {
    pending: 0,
    accepted: 0,
    deleted: 0,
  };
  for (const p of proposals) out[p.status]++;
  return out;
}

function parseProposalsFrontmatter(raw: string): Proposal[] {
  if (!raw.startsWith("---")) return [];
  const end = raw.indexOf("\n---", 3);
  if (end < 0) return [];
  const block = raw.slice(raw.indexOf("\n") + 1, end);
  if (!/^sb-proposals:\s*true/m.test(block)) return [];

  const lines = block.split(/\r?\n/);
  const proposals: Proposal[] = [];
  let cur: Partial<Proposal> | null = null;
  let inList = false;

  const push = () => {
    if (cur && cur.id && cur.text) {
      proposals.push({
        id: cur.id,
        text: cur.text,
        projectPath: cur.projectPath ?? null,
        status: (cur.status as ProposalStatus) ?? "pending",
        kind: (cur.kind as ProposalKind) ?? "add",
        capturedAt: cur.capturedAt,
      });
    }
    cur = null;
  };

  for (const line of lines) {
    if (/^proposals:\s*$/.test(line)) {
      inList = true;
      continue;
    }
    if (!inList) continue;
    const start = line.match(/^\s*-\s*id:\s*(\S+)\s*$/);
    if (start) {
      push();
      cur = { id: start[1] };
      continue;
    }
    if (!cur) continue;
    const m = line.match(/^\s+(text|project|status|kind|captured-at):\s*(.+)\s*$/);
    if (m) {
      const [, key, valRaw] = m;
      const val = stripQuotes(valRaw.trim());
      if (key === "text") cur.text = val;
      else if (key === "project") cur.projectPath = val === "null" || val === "" ? null : val;
      else if (key === "status") cur.status = val as ProposalStatus;
      else if (key === "kind") cur.kind = val as ProposalKind;
      else if (key === "captured-at") cur.capturedAt = val;
    }
  }
  push();
  return proposals;
}

function yamlString(s: string): string {
  // Quote when the string contains anything YAML might interpret.
  if (/^[\w./-]+$/.test(s)) return s;
  return `"${s.replace(/"/g, '\\"')}"`;
}

async function ensureFolder(app: App, path: string): Promise<void> {
  if (app.vault.getAbstractFileByPath(path)) return;
  try {
    await app.vault.createFolder(path);
  } catch {
    // Race; harmless.
  }
}

/**
 * Accept a pending proposal: append its text to the named project's
 * `## Active TODOs` section (creating the section if missing), then mark the
 * proposal as accepted in its proposals file. If no project is matched, the
 * proposal is just marked accepted (no destination — user can copy the text
 * manually if they want).
 */
export async function acceptProposal(
  app: App,
  date: string,
  proposalId: string
): Promise<void> {
  const all = await readProposalsFile(app, date);
  const idx = all.findIndex((p) => p.id === proposalId);
  if (idx < 0) throw new Error("Proposal not found");
  const p = all[idx];
  if (p.projectPath) {
    const file = app.vault.getAbstractFileByPath(p.projectPath);
    if (!(file instanceof TFile)) {
      throw new Error(`Target project missing: ${p.projectPath}`);
    }
    if (p.kind === "complete") {
      const ok = await completeTodoInProject(app, file, p.text, date);
      if (!ok) {
        // The TODO wasn't found in Active TODOs — log it to History anyway so
        // the completion isn't lost.
        await appendTodoToProject(app, file, p.text);
        await completeTodoInProject(app, file, p.text, date);
      }
    } else {
      await appendTodoToProject(app, file, p.text);
    }
  }
  all[idx] = { ...p, status: "accepted" };
  await writeProposalsFile(app, date, all);
}

/**
 * Manually add a TODO (v0.9.3 quick-capture). If a project is chosen, append
 * directly to its Active TODOs (the user authored it — no accept step needed).
 * If no project, store a pending proposal with projectPath = null so it
 * surfaces on the Dashboard for later assignment.
 */
export async function addManualTodo(
  app: App,
  date: string,
  text: string,
  projectPath: string | null
): Promise<void> {
  if (projectPath) {
    const file = app.vault.getAbstractFileByPath(projectPath);
    if (!(file instanceof TFile)) {
      throw new Error(`Project missing: ${projectPath}`);
    }
    await appendTodoToProject(app, file, text);
    return;
  }
  await ensureFolder(app, PROPOSALS_FOLDER);
  const all = await readProposalsFile(app, date);
  const id = await makeProposalId(date, text, "add");
  if (!all.some((p) => p.id === id)) {
    all.push({ id, text, projectPath: null, status: "pending", kind: "add" });
    await writeProposalsFile(app, date, all);
  }
}

/** Delete a pending proposal — just marks status, never touches projects. */
export async function deleteProposal(
  app: App,
  date: string,
  proposalId: string
): Promise<void> {
  const all = await readProposalsFile(app, date);
  const idx = all.findIndex((p) => p.id === proposalId);
  if (idx < 0) throw new Error("Proposal not found");
  all[idx] = { ...all[idx], status: "deleted" };
  await writeProposalsFile(app, date, all);
}
