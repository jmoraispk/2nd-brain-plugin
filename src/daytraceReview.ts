import { App, TFile } from "obsidian";
import { applyDatePlaceholders } from "./paths";

export const DAYTRACE_SUMMARY_PATH =
  "🤖 AI/Activity/Daytrace/Summaries/{ISO_YEAR}/Q{Q}/W{WW}/{YYYY-MM-DD}.md";

const WORKSTREAM_HEADER =
  "| Project / workstream | Apparent achievements | Work and topics |";

export interface DaytraceReviewSource {
  date: string;
  path: string;
  content: string;
  table?: string;
}

/** Read one saved AI Activity summary, when present. */
export async function loadDaytraceReviewSource(
  app: App,
  date: string
): Promise<DaytraceReviewSource | undefined> {
  const path = applyDatePlaceholders(DAYTRACE_SUMMARY_PATH, date);
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return undefined;
  const content = await app.vault.read(file);
  if (!content.trim() || hasUnavailableStatus(content)) return undefined;
  return {
    date,
    path,
    content,
    table: extractDaytraceWorkstreamTable(content),
  };
}

function hasUnavailableStatus(markdown: string): boolean {
  return /^---\r?\n[\s\S]*?^daytrace-status:\s*unavailable\s*$[\s\S]*?^---\s*$/m.test(
    markdown
  );
}

/** Extract the generated workstream table without rewriting any table line. */
export function extractDaytraceWorkstreamTable(
  markdown: string
): string | undefined {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === WORKSTREAM_HEADER);
  if (start < 0 || !isDivider(lines[start + 1])) return undefined;
  let end = start + 2;
  while (end < lines.length && lines[end].trim().startsWith("|")) end += 1;
  return lines.slice(start, end).join("\n");
}

/** Build the exact, deterministic Activity section appended to a Review. */
export function renderDaytraceReviewAppendix(
  sources: DaytraceReviewSource[]
): string {
  const sections = sources
    .filter((source) => source.table)
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((source) => `### ${source.date}\n\n${source.table}`);
  return sections.length > 0 ? `## Activity\n\n${sections.join("\n\n")}` : "";
}

function isDivider(line: string | undefined): boolean {
  if (!line) return false;
  const cells = line.trim().split("|").slice(1, -1);
  return cells.length === 3 && cells.every((cell) => /^\s*:?-{3,}:?\s*$/.test(cell));
}
