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
} from "./paths";

interface InputContent {
  label: string;
  sourcePath: string;
  content: string;
}

export async function runCommand(
  app: App,
  settings: SecondBrainSettings,
  command: Command
): Promise<TFile> {
  const inputs: InputContent[] = [];
  for (const spec of command.inputs) {
    inputs.push(await readInput(app, settings, spec));
  }

  const today = todayISO();
  const userMsg = [
    `Today's date: ${today}`,
    "",
    ...inputs.map(
      (i) => `## ${i.label} — _from ${i.sourcePath}_\n\n${i.content}`
    ),
  ].join("\n\n");

  const result = await callLLM(settings, command.systemPrompt, userMsg);

  const outputPath = resolveOutputPath(command.outputPath, settings);
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
  input: CommandInput
): Promise<InputContent> {
  const labelDefaults: Record<CommandInput["kind"], string> = {
    "today-log": "Today's log",
    "yesterday-log": "Yesterday's log",
    "today-review": "Today's review",
    "yesterday-review": "Yesterday's review",
    "this-week-logs": "This week's daily logs",
  };
  const label = input.label ?? labelDefaults[input.kind];

  // Multi-file input: this-week-logs concatenates daily logs Mon→today.
  if (input.kind === "this-week-logs") {
    const dates = thisWeekDatesThroughAnchor(todayISO());
    const sections: string[] = [];
    const paths: string[] = [];
    for (const date of dates) {
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
      throw new Error("No daily logs found for this week so far.");
    }
    return {
      label,
      sourcePath: `${paths.length} daily file(s) this week`,
      content: sections.join("\n\n---\n\n"),
    };
  }

  let path: string;
  switch (input.kind) {
    case "today-log":
      path = await resolveDailyLogPath(app, settings, todayISO());
      break;
    case "yesterday-log":
      path = await resolveDailyLogPath(app, settings, yesterdayISO());
      break;
    case "today-review":
      path = applyDatePlaceholders(settings.reviewsPathTemplate, todayISO());
      break;
    case "yesterday-review":
      path = applyDatePlaceholders(
        settings.reviewsPathTemplate,
        yesterdayISO()
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
  settings: SecondBrainSettings
): string {
  // Inline {REVIEWS_TEMPLATE} first, then resolve date placeholders.
  const inlined = template.replace(
    "{REVIEWS_TEMPLATE}",
    settings.reviewsPathTemplate
  );
  return applyDatePlaceholders(inlined);
}

async function ensureFolderExists(app: App, filePath: string) {
  const parts = filePath.split("/");
  parts.pop();
  const folderPath = parts.join("/");
  if (!folderPath) return;
  if (app.vault.getAbstractFileByPath(folderPath)) return;
  await app.vault.createFolder(folderPath);
}
