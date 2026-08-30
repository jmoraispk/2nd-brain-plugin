/**
 * Review metadata frontmatter (v0.7.2+).
 *
 * Every AI-generated output file is prepended with a small YAML frontmatter
 * block recording how it was generated: plugin version, command id, provider,
 * model, timestamp, and a per-input fingerprint (path + size + SHA-1).
 *
 * When the user re-runs a command, the runner reads this block, compares it
 * to the current fingerprint, and short-circuits (no LLM call) if everything
 * matches. Drift is reported back so the UI can show *what* changed.
 */

import { App, TFile } from "obsidian";

export interface InputFingerprint {
  path: string;
  size: number;
  sha1: string;
}

export interface ReviewMetadata {
  sbVersion: string;
  command: string;
  provider: string;
  model: string;
  promptSha1?: string;
  generatedAt: string;
  inputs: InputFingerprint[];
}

export type CurrentFingerprint = Omit<ReviewMetadata, "generatedAt">;

/** Hex SHA-1 of a UTF-8 string using SubtleCrypto (browser-native). */
export async function sha1Hex(content: string): Promise<string> {
  const buf = new TextEncoder().encode(content);
  const hash = await crypto.subtle.digest("SHA-1", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Build a frontmatter block (with leading + trailing `---` lines). */
export function buildFrontmatter(meta: ReviewMetadata): string {
  const lines: string[] = ["---"];
  lines.push("sb-generated: true");
  lines.push(`sb-version: ${meta.sbVersion}`);
  lines.push(`sb-command: ${meta.command}`);
  lines.push(`sb-provider: ${meta.provider}`);
  lines.push(`sb-model: ${meta.model}`);
  if (meta.promptSha1) lines.push(`sb-prompt-sha1: ${meta.promptSha1}`);
  lines.push(`sb-generated-at: ${meta.generatedAt}`);
  if (meta.inputs.length === 0) {
    lines.push("sb-inputs: []");
  } else {
    lines.push("sb-inputs:");
    for (const inp of meta.inputs) {
      lines.push(`  - path: ${yamlString(inp.path)}`);
      lines.push(`    size: ${inp.size}`);
      lines.push(`    sha1: ${inp.sha1}`);
    }
  }
  lines.push("---");
  return lines.join("\n");
}

/** Read an existing AI file and parse out the SB metadata block. */
export async function readReviewMetadata(
  app: App,
  file: TFile
): Promise<ReviewMetadata | null> {
  const content = await app.vault.read(file);
  return parseReviewMetadata(content);
}

/**
 * Parse the SB frontmatter from a file's full content. Returns null if there
 * is no leading `---` block or the block doesn't include `sb-generated: true`
 * (i.e. the file is a legacy / hand-authored output).
 *
 * This is a small bespoke parser tailored to the shape we write — we don't
 * pull in a YAML dep just for this.
 */
export function parseReviewMetadata(content: string): ReviewMetadata | null {
  if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) {
    return null;
  }
  const after = content.indexOf("\n---", 3);
  if (after < 0) return null;
  const block = content.slice(content.indexOf("\n") + 1, after);
  if (!/^sb-generated:\s*true\s*$/m.test(block)) return null;

  const lines = block.split(/\r?\n/);
  const out: Partial<ReviewMetadata> & { inputs: InputFingerprint[] } = {
    inputs: [],
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const ver = line.match(/^sb-version:\s*(.+?)\s*$/);
    if (ver) {
      out.sbVersion = ver[1];
      continue;
    }
    const cmd = line.match(/^sb-command:\s*(.+?)\s*$/);
    if (cmd) {
      out.command = cmd[1];
      continue;
    }
    const prov = line.match(/^sb-provider:\s*(.+?)\s*$/);
    if (prov) {
      out.provider = prov[1];
      continue;
    }
    const mod = line.match(/^sb-model:\s*(.+?)\s*$/);
    if (mod) {
      out.model = mod[1];
      continue;
    }
    const prompt = line.match(/^sb-prompt-sha1:\s*([0-9a-f]+)\s*$/);
    if (prompt) {
      out.promptSha1 = prompt[1];
      continue;
    }
    const gen = line.match(/^sb-generated-at:\s*(.+?)\s*$/);
    if (gen) {
      out.generatedAt = gen[1];
      continue;
    }
    if (/^sb-inputs:\s*$/.test(line)) {
      // Walk indented entries: each input is exactly 3 lines (path/size/sha1).
      while (i + 1 < lines.length && /^\s{2,4}- path:/.test(lines[i + 1])) {
        const pathLine = lines[++i];
        const sizeLine = lines[++i] ?? "";
        const sha1Line = lines[++i] ?? "";
        const pathMatch = pathLine.match(/^\s{2,4}- path:\s*(.+?)\s*$/);
        const sizeMatch = sizeLine.match(/^\s{4,6}size:\s*(\d+)\s*$/);
        const sha1Match = sha1Line.match(/^\s{4,6}sha1:\s*([0-9a-f]+)\s*$/);
        if (pathMatch && sizeMatch && sha1Match) {
          out.inputs.push({
            path: unquoteYamlString(pathMatch[1]),
            size: parseInt(sizeMatch[1], 10),
            sha1: sha1Match[1],
          });
        }
      }
    }
  }

  if (!out.sbVersion || !out.command || !out.provider || !out.model) {
    return null;
  }
  return out as ReviewMetadata;
}

/** True if every fingerprint field matches (modulo generatedAt). */
export function metadataMatches(
  existing: ReviewMetadata,
  current: CurrentFingerprint
): boolean {
  if (existing.command !== current.command) return false;
  if (existing.provider !== current.provider) return false;
  if (existing.model !== current.model) return false;
  if (existing.promptSha1 !== current.promptSha1) return false;
  // Bumping plugin version invalidates the cache so prompt edits take effect.
  if (existing.sbVersion !== current.sbVersion) return false;
  if (existing.inputs.length !== current.inputs.length) return false;
  for (let i = 0; i < existing.inputs.length; i++) {
    const a = existing.inputs[i];
    const b = current.inputs[i];
    if (a.path !== b.path) return false;
    if (a.size !== b.size) return false;
    if (a.sha1 !== b.sha1) return false;
  }
  return true;
}

/** Human-readable list of what differs between existing and current. */
export function describeDrift(
  existing: ReviewMetadata,
  current: CurrentFingerprint
): string[] {
  const out: string[] = [];
  if (existing.command !== current.command)
    out.push(`command: ${existing.command} → ${current.command}`);
  if (existing.provider !== current.provider)
    out.push(`provider: ${existing.provider} → ${current.provider}`);
  if (existing.model !== current.model)
    out.push(`model: ${existing.model} → ${current.model}`);
  if (existing.promptSha1 !== current.promptSha1) out.push("prompt changed");
  if (existing.sbVersion !== current.sbVersion)
    out.push(`plugin: v${existing.sbVersion} → v${current.sbVersion}`);

  const existingPaths = new Set(existing.inputs.map((x) => x.path));
  const currentPaths = new Set(current.inputs.map((x) => x.path));
  for (const p of currentPaths) if (!existingPaths.has(p)) out.push(`+ ${p}`);
  for (const p of existingPaths) if (!currentPaths.has(p)) out.push(`− ${p}`);
  for (const a of existing.inputs) {
    const b = current.inputs.find((x) => x.path === a.path);
    if (b && b.sha1 !== a.sha1) {
      const delta = b.size - a.size;
      const sizeNote =
        delta === 0
          ? "edited"
          : `${delta > 0 ? "+" : ""}${delta} bytes`;
      out.push(`${a.path.split("/").pop()} (${sizeNote})`);
    }
  }
  return out;
}

/** Strip the SB frontmatter block from a file's body. Used when we re-render. */
export function stripSBFrontmatter(content: string): string {
  if (!content.startsWith("---")) return content;
  const after = content.indexOf("\n---", 3);
  if (after < 0) return content;
  const block = content.slice(0, after + 4);
  if (!/sb-generated:\s*true/.test(block)) return content;
  // Drop block + the single newline that follows it (if any).
  let rest = content.slice(after + 4);
  if (rest.startsWith("\n")) rest = rest.slice(1);
  return rest;
}

/** Quote a YAML string only when it contains characters that need quoting. */
function yamlString(s: string): string {
  if (/^[\w/\-.{} ]+$/.test(s) && !s.includes(": ")) return s;
  return `"${s.replace(/"/g, '\\"')}"`;
}

function unquoteYamlString(s: string): string {
  if (s.startsWith('"') && s.endsWith('"')) {
    return s.slice(1, -1).replace(/\\"/g, '"');
  }
  return s;
}
