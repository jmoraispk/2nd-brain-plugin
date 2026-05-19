/**
 * Project file mutations (v0.9). The plugin — not Claude Code — is the only
 * actor allowed to modify project files outside the user's hand-editing. The
 * write-scope guard hook in the framework repo stays strict (Claude Code can
 * only write to `🤖 AI/`); this module is how AI proposals end up *in* the
 * project file.
 *
 * Invariant: edits are confined to named-section walls. We never reformat
 * the file, never touch user-authored sections (`## Why`, `## Done criteria`,
 * the top-of-file heading, frontmatter), and never delete user content.
 *
 * The three sections AI may touch:
 *   - `## Active TODOs` (append-only)
 *   - `## History`       (append-only)
 *   - `## Current state` (overwrite-only on explicit user accept)
 */

import { App, TFile } from "obsidian";

/**
 * Append a single `- [ ] <text>` line to the `## Active TODOs` section of the
 * given project file. Idempotent in the sense that the *plugin* never appends
 * a duplicate line (case-insensitive text match within that section).
 *
 * If the section doesn't exist, it's created right before `## History` (or
 * appended at the end of file if History is also missing).
 */
export async function appendTodoToProject(
  app: App,
  projectFile: TFile,
  todoText: string
): Promise<void> {
  const trimmed = todoText.trim();
  if (!trimmed) throw new Error("Empty TODO text");

  const content = await app.vault.read(projectFile);
  const newContent = appendToSection(
    content,
    "Active TODOs",
    `- [ ] ${trimmed}`,
    { dedupeWithinSection: true, insertBeforeSection: "History" }
  );
  if (newContent === content) return; // already present
  await app.vault.modify(projectFile, newContent);
}

/**
 * Append a line to `## History`, dated. Used by the future
 * "completed-TODO-moves-to-History" feature. Idempotent on text match.
 */
export async function appendToProjectHistory(
  app: App,
  projectFile: TFile,
  text: string,
  date: string
): Promise<void> {
  const content = await app.vault.read(projectFile);
  const line = `- [x] ${date} — ${text.trim()}`;
  const newContent = appendToSection(content, "History", line, {
    dedupeWithinSection: true,
  });
  if (newContent === content) return;
  await app.vault.modify(projectFile, newContent);
}

interface AppendOptions {
  dedupeWithinSection?: boolean;
  /** If the target section doesn't exist, insert it before this section name. */
  insertBeforeSection?: string;
}

/**
 * Find a `## <heading>` section in markdown and append a new line just before
 * the next `## ` heading (or end of file). Defensive about missing sections.
 *
 * Returns the new file content (or the original, untouched, if the line is
 * already in the section and dedupe is on).
 */
export function appendToSection(
  content: string,
  heading: string,
  newLine: string,
  options: AppendOptions = {}
): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const headingRe = new RegExp(`^##\\s+${escaped}\\s*$`, "m");
  const match = content.match(headingRe);

  if (!match || match.index === undefined) {
    // Section missing — try to create it.
    return createSection(content, heading, newLine, options);
  }

  const headingEnd = match.index + match[0].length;
  // Find the next `## ` heading after this one — that bounds our section.
  const rest = content.slice(headingEnd);
  const nextHeadingMatch = rest.match(/^##\s+/m);
  const sectionEnd =
    nextHeadingMatch && nextHeadingMatch.index !== undefined
      ? headingEnd + nextHeadingMatch.index
      : content.length;

  const sectionBody = content.slice(headingEnd, sectionEnd);

  if (options.dedupeWithinSection) {
    // Compare against existing lines case-insensitively, normalizing the
    // checkbox + leading whitespace so `- [ ] foo` and `- [x] foo` are
    // considered the same task.
    const normalize = (s: string) =>
      s
        .toLowerCase()
        .replace(/^\s*-\s*\[[ x]\]\s*/, "")
        .replace(/\s+/g, " ")
        .trim();
    const target = normalize(newLine);
    for (const line of sectionBody.split(/\r?\n/)) {
      if (normalize(line) === target) return content; // already present
    }
  }

  // Insert the new line at the end of the section. Trim trailing whitespace
  // from the existing section, add a newline, then the new line, then any
  // trailing whitespace the rest of the file expects.
  const trimmedBody = sectionBody.replace(/\s+$/, "");
  const before = content.slice(0, headingEnd);
  const after = content.slice(sectionEnd);
  const sep = trimmedBody.length > 0 ? "\n" : "\n";
  const rebuilt = `${before}${trimmedBody}${sep}${newLine}\n\n${after.replace(/^\s*\n+/, "")}`;
  return rebuilt;
}

function createSection(
  content: string,
  heading: string,
  newLine: string,
  options: AppendOptions
): string {
  const block = `## ${heading}\n${newLine}\n\n`;

  if (options.insertBeforeSection) {
    const beforeEsc = options.insertBeforeSection.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&"
    );
    const beforeRe = new RegExp(`^##\\s+${beforeEsc}\\s*$`, "m");
    const m = content.match(beforeRe);
    if (m && m.index !== undefined) {
      return content.slice(0, m.index) + block + content.slice(m.index);
    }
  }
  // Fallback: append at end of file.
  return content.replace(/\s*$/, "") + `\n\n${block}`;
}
