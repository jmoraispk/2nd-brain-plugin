import { App, TFile } from "obsidian";
import { Command, CommandInput } from "./types";
import { SecondBrainSettings } from "./settings";
import { callLLM } from "./llm";
import {
  resolveDailyLogPath,
  applyDatePlaceholders,
  todayISO,
  yesterdayISO,
  thisWeekDatesThroughAnchor,
  lastWeekDates,
  lastMonthDates,
  lastQuarterDates,
  lastYearDates,
  anchorForInputKind,
} from "./paths";

interface InputContent {
  label: string;
  sourcePath: string;
  content: string;
}

export async function runCommand(
  app: App,
  settings: SecondBrainSettings,
  command: Command,
  anchorOverride?: string
): Promise<TFile> {
  const today = todayISO();
  // Output path anchors on the first input's canonical date so e.g. a
  // "last-week-logs" command writes to last week's Weekly file, not this week's.
  // An explicit override (e.g. the dashboard banner asking for a specific past
  // day's review) takes precedence.
  const anchor =
    anchorOverride ??
    (command.inputs.length > 0
      ? anchorForInputKind(command.inputs[0].kind)
      : today);

  const inputs: InputContent[] = [];
  for (const spec of command.inputs) {
    inputs.push(await readInput(app, settings, spec, anchor));
  }
  const userMsg = [
    `Today's date: ${today}`,
    `Period anchor: ${anchor}`,
    "",
    ...inputs.map(
      (i) => `## ${i.label} — _from ${i.sourcePath}_\n\n${i.content}`
    ),
  ].join("\n\n");

  const result = await callLLM(settings, command.systemPrompt, userMsg);

  const outputPath = resolveOutputPath(command.outputPath, settings, anchor);
  await ensureFolderExists(app, outputPath);

  const existing = app.vault.getAbstractFileByPath(outputPath);
  if (existing instanceof TFile) {
    await app.vault.modify(existing, result);
    return existing;
  } else {
    return await app.vault.create(outputPath, result);
  }
}

async function readInput(
  app: App,
  settings: SecondBrainSettings,
  input: CommandInput,
  anchor: string
): Promise<InputContent> {
  const labelDefaults: Record<CommandInput["kind"], string> = {
    "today-log": "Today's log",
    "yesterday-log": "Yesterday's log",
    "today-review": "Today's review",
    "yesterday-review": "Yesterday's review",
    "this-week-logs": "This week's daily logs",
    "last-week-logs": "Last week's daily logs",
    "last-month-logs": "Last month's daily logs",
    "last-quarter-logs": "Last quarter's daily logs",
    "last-year-logs": "Last year's daily logs",
  };
  const label = input.label ?? labelDefaults[input.kind];

  // Multi-file inputs concatenate daily logs across a date range.
  const multiDayDates =
    input.kind === "this-week-logs"
      ? thisWeekDatesThroughAnchor(todayISO())
      : input.kind === "last-week-logs"
      ? lastWeekDates()
      : input.kind === "last-month-logs"
      ? lastMonthDates()
      : input.kind === "last-quarter-logs"
      ? lastQuarterDates()
      : input.kind === "last-year-logs"
      ? lastYearDates()
      : null;

  if (multiDayDates) {
    const sections: string[] = [];
    const paths: string[] = [];
    for (const date of multiDayDates) {
      const p = await resolveDailyLogPath(app, settings, date);
      const f = app.vault.getAbstractFileByPath(p);
      if (f instanceof TFile) {
        const c = await app.vault.read(f);
        if (c.trim()) {
          sections.push(`### ${date}\n\n${c}`);
          paths.push(p);
        }
      }
    }
    if (sections.length === 0) {
      throw new Error(`No daily logs found for ${input.kind}.`);
    }
    return {
      label,
      sourcePath: `${paths.length} daily file(s)`,
      content: sections.join("\n\n---\n\n"),
    };
  }

  // For single-day inputs, resolve relative to the anchor (which is "today"
  // for normal runs but may be overridden for, e.g., reviewing a past day from
  // the dashboard banner).
  const dayBefore = (iso: string) => {
    const d = new Date(iso + "T00:00:00");
    d.setDate(d.getDate() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
      2,
      "0"
    )}-${String(d.getDate()).padStart(2, "0")}`;
  };

  let path: string;
  switch (input.kind) {
    case "today-log":
      path = await resolveDailyLogPath(app, settings, anchor);
      break;
    case "yesterday-log":
      path = await resolveDailyLogPath(app, settings, dayBefore(anchor));
      break;
    case "today-review":
      path = applyDatePlaceholders(settings.reviewsPathTemplate, anchor);
      break;
    case "yesterday-review":
      path = applyDatePlaceholders(
        settings.reviewsPathTemplate,
        dayBefore(anchor)
      );
      break;
    default:
      throw new Error(`Unknown input kind: ${(input as CommandInput).kind}`);
  }

  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) {
    throw new Error(`Input not found: ${path} (kind: ${input.kind})`);
  }

  const content = await app.vault.read(file);
  if (!content.trim()) {
    throw new Error(`Input is empty: ${path}`);
  }

  return { label, sourcePath: path, content };
}

function resolveOutputPath(
  template: string,
  settings: SecondBrainSettings,
  anchor: string
): string {
  // Inline {REVIEWS_TEMPLATE} first, then resolve date placeholders against the anchor.
  const inlined = template.replace(
    "{REVIEWS_TEMPLATE}",
    settings.reviewsPathTemplate
  );
  return applyDatePlaceholders(inlined, anchor);
}

async function ensureFolderExists(app: App, filePath: string) {
  const parts = filePath.split("/");
  parts.pop();
  const folderPath = parts.join("/");
  if (!folderPath) return;
  if (app.vault.getAbstractFileByPath(folderPath)) return;
  await app.vault.createFolder(folderPath);
}
