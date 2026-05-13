import { App, TFile } from "obsidian";
import { Command, CommandInput } from "./types";
import { SecondBrainSettings } from "./settings";
import { callLLM } from "./llm";
import {
  resolveDailyLogPath,
  applyDatePlaceholders,
  todayISO,
  yesterdayISO,
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
  };
  const label = input.label ?? labelDefaults[input.kind];

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
