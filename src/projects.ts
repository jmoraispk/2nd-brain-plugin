/**
 * Projects (v0.8.5). One file per project at `1. 🎯 Projects/<name>.md`.
 *
 * PARA's "Projects" tier — bounded outcomes with an end. Habits link to a
 * parent project via their `linked-goal:` frontmatter; projects link to a
 * Wheel-of-Life area via their own `area:` field. Result: every habit can
 * trace up to a project, and every project to an area of life.
 *
 * Schema is intentionally lighter than habits — the LogLife boost dimensions
 * (Why / Plan / Environment / Recover) live on the habits that *implement*
 * the project, not on the project itself.
 */

import { App, TFile, TFolder } from "obsidian";

export const PROJECTS_FOLDER = "1. 🎯 Projects";

export type ProjectStatus = "active" | "paused" | "done" | "archived";

export interface Project {
  id: string;
  file: TFile;
  name: string;
  area?: string;
  status: ProjectStatus;
  created?: string;
  targetDate?: string;
  /** v0.9: when true, the project's Active TODOs surface on the main Dashboard. */
  pinned: boolean;
}

/** The nine Wheel-of-Life sub-areas — also surfaced in the New Project modal. */
export const WHEEL_AREAS: Array<{ macro: string; sub: string; path: string }> = [
  { macro: "Health", sub: "Body",   path: "2. 🌳 Areas/Health/Body" },
  { macro: "Health", sub: "Mind",   path: "2. 🌳 Areas/Health/Mind" },
  { macro: "Health", sub: "Soul",   path: "2. 🌳 Areas/Health/Soul" },
  { macro: "Relationships", sub: "Romance", path: "2. 🌳 Areas/Relationships/Romance" },
  { macro: "Relationships", sub: "Family",  path: "2. 🌳 Areas/Relationships/Family" },
  { macro: "Relationships", sub: "Friends", path: "2. 🌳 Areas/Relationships/Friends" },
  { macro: "Work", sub: "Mission", path: "2. 🌳 Areas/Work/Mission" },
  { macro: "Work", sub: "Money",   path: "2. 🌳 Areas/Work/Money" },
  { macro: "Work", sub: "Growth",  path: "2. 🌳 Areas/Work/Growth" },
];

/**
 * Each entry under `1. 🎯 Projects/` is one project:
 *   - A top-level `<name>.md` file → that's the project.
 *   - A folder `<name>/` → look for a folder note (`<name>/<name>.md`);
 *     if absent, fall back to the first `.md` in the folder. Children of
 *     the folder are *not* separate projects, they're supporting files.
 *
 * This lets a project grow from one file → a whole folder when it accrues
 * notes, attachments, sub-plans, etc., without becoming several projects.
 */
export async function loadProjects(app: App): Promise<Project[]> {
  const root = app.vault.getAbstractFileByPath(PROJECTS_FOLDER);
  if (!(root instanceof TFolder)) return [];
  const projects: Project[] = [];
  for (const child of root.children) {
    if (child instanceof TFile && child.name.endsWith(".md")) {
      projects.push(await parseProject(app, child));
    } else if (child instanceof TFolder) {
      const folderNoteName = `${child.name}.md`;
      let main: TFile | undefined;
      for (const c of child.children) {
        if (c instanceof TFile && c.name === folderNoteName) {
          main = c;
          break;
        }
      }
      if (!main) {
        for (const c of child.children) {
          if (c instanceof TFile && c.name.endsWith(".md")) {
            main = c;
            break;
          }
        }
      }
      if (main) projects.push(await parseProject(app, main));
    }
  }
  return projects;
}

/** Normalize a `"[[…]]"` or bare path string to just the inner path. */
export function normalizeAreaPath(area: string | undefined): string | undefined {
  if (!area) return undefined;
  const inner = area.replace(/^\[\[/, "").replace(/\]\]$/, "").trim();
  return inner.length > 0 ? inner : undefined;
}

async function parseProject(app: App, file: TFile): Promise<Project> {
  const raw = await app.vault.read(file);
  const fm = parseFrontmatter(raw);
  const pinnedRaw = scalar(fm?.["pinned"]);
  return {
    id: file.basename,
    file,
    name: extractH1(raw) ?? file.basename,
    area: scalar(fm?.["area"]),
    status: ((fm?.["status"] as string) ?? "active") as ProjectStatus,
    created: scalar(fm?.["created"]),
    targetDate: scalar(fm?.["target-date"]),
    pinned: pinnedRaw === "true" || pinnedRaw === "yes",
  };
}

function scalar(v: unknown): string | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  return s.length > 0 ? s : undefined;
}

function extractH1(raw: string): string | undefined {
  const body = raw.startsWith("---")
    ? (() => {
        const end = raw.indexOf("\n---", 3);
        return end < 0 ? raw : raw.slice(end + 4).replace(/^\s*\n/, "");
      })()
    : raw;
  const m = body.match(/^#\s+(.+?)\s*$/m);
  return m ? m[1].trim() : undefined;
}

function parseFrontmatter(raw: string): Record<string, unknown> | null {
  if (!raw.startsWith("---")) return null;
  const end = raw.indexOf("\n---", 3);
  if (end < 0) return null;
  const block = raw.slice(raw.indexOf("\n") + 1, end);
  const out: Record<string, unknown> = {};
  for (const line of block.split(/\r?\n/)) {
    const m = line.match(/^([a-zA-Z][\w-]*):\s*(.*)$/);
    if (m) out[m[1]] = parseScalar(m[2].trim());
  }
  return out;
}

function parseScalar(raw: string): unknown {
  if (
    (raw.startsWith('"') && raw.endsWith('"')) ||
    (raw.startsWith("'") && raw.endsWith("'"))
  ) {
    return raw.slice(1, -1);
  }
  return raw;
}

/**
 * Build the markdown body for a fresh project file. Frontmatter has the
 * area + status + created date; body has the SMART-style scaffolding
 * the user fills in.
 */
export function projectFileBody(name: string, areaPath: string | null): string {
  const today = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
      2,
      "0"
    )}-${String(d.getDate()).padStart(2, "0")}`;
  })();
  const areaLine = areaPath ? `area: "[[${areaPath}]]"` : "area:";
  // v0.9 schema: five canonical sections that AI may also edit (Current state
  // / Active TODOs / History). Why + Done criteria stay user-only.
  return [
    "---",
    areaLine,
    "status: active",
    `created: ${today}`,
    "target-date:",
    "pinned: false",
    "---",
    "",
    `# ${name}`,
    "",
    "## Why",
    "",
    "## Done criteria",
    "_Pass/fail-able definition of done._",
    "",
    "## Current state",
    "",
    "## Active TODOs",
    "- [ ] ",
    "",
    "## History",
    "",
  ].join("\n");
}

/**
 * Create a project file with the given name + (optional) area. Returns the
 * created TFile. Throws if a file at the same name already exists.
 */
export async function createProject(
  app: App,
  name: string,
  areaPath: string | null
): Promise<TFile> {
  if (!app.vault.getAbstractFileByPath(PROJECTS_FOLDER)) {
    await app.vault.createFolder(PROJECTS_FOLDER);
  }
  const safeName = name.replace(/[\\/:*?"<>|]/g, "").trim();
  if (!safeName) throw new Error("Project name is empty.");
  const path = `${PROJECTS_FOLDER}/${safeName}.md`;
  if (app.vault.getAbstractFileByPath(path)) {
    throw new Error(`A project named "${safeName}" already exists.`);
  }
  return await app.vault.create(path, projectFileBody(safeName, areaPath));
}
