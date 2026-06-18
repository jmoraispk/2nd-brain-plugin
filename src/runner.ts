import { App, TFile } from "obsidian";
import { Command, CommandInput } from "./types";
import { SecondBrainSettings } from "./settings";
import { callLLM } from "./llm";
import { resolveRoute, taskGroupForCommand } from "./modelRoutes";
import {
  resolveDailyLogPath,
  applyDatePlaceholders,
  todayISO,
  thisWeekDatesThroughAnchor,
  lastWeekDates,
  lastMonthDates,
  lastQuarterDates,
  lastYearDates,
  thisMonthDatesThroughToday,
  thisQuarterDatesThroughToday,
  anchorWeekDates,
  anchorMonthDates,
  anchorQuarterDates,
  anchorYearDates,
  anchorForInputKind,
} from "./paths";
import { TFolder } from "obsidian";
import { questionOfWeek, questionOfMonth } from "./questions";
import {
  InputFingerprint,
  ReviewMetadata,
  buildFrontmatter,
  describeDrift,
  metadataMatches,
  parseReviewMetadata,
  sha1Hex,
} from "./reviewMeta";
import { buildHabitContextBlock, loadActiveHabits } from "./habits";
import { writeHabitDataFiles, mergeBackfillIntoData } from "./habitData";
import { loadProjects } from "./projects";
import { mergeExtractedTodos, parseTodosBlock } from "./proposals";

interface InputContent {
  label: string;
  sourcePath: string;
  content: string;
  /** Per-file fingerprints. For multi-file inputs, one entry per file read. */
  files: InputFingerprint[];
}

export type RunResult =
  | { kind: "fresh"; file: TFile; drift?: string[] }
  | { kind: "cache-hit"; file: TFile };

export async function runCommand(
  app: App,
  settings: SecondBrainSettings,
  command: Command,
  pluginVersion: string,
  anchorOverride?: string,
  topicInput?: string
): Promise<RunResult> {
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

  const outputPath = resolveOutputPath(command.outputPath, settings, anchor);

  // Cache check: if the target file already exists with matching fingerprint,
  // skip the LLM call entirely.
  const inputFingerprints = inputs.flatMap((i) => i.files);
  const currentFingerprint = {
    sbVersion: pluginVersion,
    command: command.id,
    provider: settings.provider,
    model:
      settings.provider === "anthropic"
        ? settings.anthropicModel
        : settings.openaiModel,
    inputs: inputFingerprints,
  };

  const existing = app.vault.getAbstractFileByPath(outputPath);
  let driftReasons: string[] | undefined;
  if (existing instanceof TFile) {
    const existingContent = await app.vault.read(existing);
    const existingMeta = parseReviewMetadata(existingContent);
    if (existingMeta && metadataMatches(existingMeta, currentFingerprint)) {
      return { kind: "cache-hit", file: existing };
    }
    if (existingMeta) {
      driftReasons = describeDrift(existingMeta, currentFingerprint);
    }
  }

  const userMsgParts = [
    `Today's date: ${today}`,
    `Period anchor: ${anchor}`,
  ];
  if (topicInput && topicInput.trim()) {
    userMsgParts.push("", `## Topic / focus\n\n${topicInput.trim()}`);
  }
  // Active habits — injected for the daily review (per-day inference) and
  // for the backfill command (one-shot retroactive evaluation across all
  // historical logs).
  if (command.id === "todays-review" || command.id === "backfill-habits") {
    const habits = await loadActiveHabits(app);
    const block = buildHabitContextBlock(habits);
    if (block) userMsgParts.push("", block);
  }

  // Active projects — injected for the daily review so the LLM can extract
  // new TODO proposals AND detect completions of existing TODOs. We include
  // each project's current Active TODOs so "updates" can match real items.
  if (command.id === "todays-review") {
    const projects = await loadProjects(app);
    const activeProjects = projects.filter((p) => p.status === "active");
    if (activeProjects.length > 0) {
      const lines = ["## Active projects (for TODO matching)", ""];
      for (const p of activeProjects) {
        lines.push(`### ${p.file.path}: ${p.name}`);
        const todos = extractActiveTodoLines(await app.vault.read(p.file));
        if (todos.length > 0) {
          lines.push("Active TODOs:");
          for (const t of todos) lines.push(`  - ${t}`);
        } else {
          lines.push("Active TODOs: (none)");
        }
        lines.push("");
      }
      userMsgParts.push("", lines.join("\n"));
    }
  }

  // Kepano reflection question for weekly + monthly reviews.
  if (command.kepanoQuestion) {
    const q =
      command.kepanoQuestion === "year"
        ? questionOfWeek()
        : questionOfMonth();
    const label =
      command.kepanoQuestion === "year"
        ? "This week's Kepano yearly question (for reflection)"
        : "This month's Kepano decade question (for reflection)";
    userMsgParts.push(
      "",
      `## ${label}\n\nQ${q.n} — ${q.question}\n\nWeave this question into the synthesis where the captures touch on it. If they don't, briefly note the question at the end as a prompt the user can consider.`
    );
  }
  userMsgParts.push(
    "",
    ...inputs.map(
      (i) => `## ${i.label} — _from ${i.sourcePath}_\n\n${i.content}`
    )
  );
  const userMsg = userMsgParts.join("\n\n");

  // Per-task model routing (v0.9.6): pick the model + effort for this
  // command's task-group, falling back to the default model.
  const route = resolveRoute(settings, taskGroupForCommand(command.id));
  const body = await callLLM(settings, command.systemPrompt, userMsg, {
    model: route.model,
    effort: route.effort,
  });

  const meta: ReviewMetadata = {
    ...currentFingerprint,
    generatedAt: new Date().toISOString(),
  };
  const result = buildFrontmatter(meta) + "\n\n" + body;

  await ensureFolderExists(app, outputPath);

  let outFile: TFile;
  if (existing instanceof TFile) {
    await app.vault.modify(existing, result);
    outFile = existing;
  } else {
    outFile = await app.vault.create(outputPath, result);
  }

  // Daily review → refresh per-habit heatmap data from today's review AND
  // extract any LLM-emitted TODO proposals into the proposals store.
  // Backfill → parse the LLM's YAML block and merge across historical dates.
  if (command.id === "todays-review") {
    try {
      const habits = await loadActiveHabits(app);
      await writeHabitDataFiles(app, settings.reviewsPathTemplate, habits);
    } catch (err) {
      console.error("habit-data write failed (non-fatal):", err);
    }
    try {
      const extracted = parseTodosBlock(body);
      if (extracted.length > 0) {
        await mergeExtractedTodos(app, anchor, extracted);
      }
    } catch (err) {
      console.error("proposal extraction failed (non-fatal):", err);
    }
  } else if (command.id === "backfill-habits") {
    try {
      const habits = await loadActiveHabits(app);
      const year = today.slice(0, 4);
      await mergeBackfillIntoData(app, habits, body, year);
    } catch (err) {
      console.error("habit-backfill merge failed (non-fatal):", err);
    }
  }

  return existing instanceof TFile
    ? { kind: "fresh", file: outFile, drift: driftReasons }
    : { kind: "fresh", file: outFile };
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
    "month-logs": "This month's daily logs (through today)",
    "quarter-logs": "This quarter's daily logs (through today)",
    "all-logs": "All daily logs in the vault",
    "anchor-week-logs": "Daily logs for the specified week (Mon–Sun)",
    "anchor-month-logs": "Daily logs for the specified month",
    "anchor-quarter-logs": "Daily logs for the specified quarter",
    "anchor-year-logs": "Daily logs for the specified year",
  };
  const label = input.label ?? labelDefaults[input.kind];

  // Multi-file inputs concatenate daily logs across a date range or the whole vault.
  let multiDayDates: string[] | null = null;
  switch (input.kind) {
    case "this-week-logs":
      multiDayDates = thisWeekDatesThroughAnchor(todayISO());
      break;
    case "last-week-logs":
      multiDayDates = lastWeekDates();
      break;
    case "last-month-logs":
      multiDayDates = lastMonthDates();
      break;
    case "last-quarter-logs":
      multiDayDates = lastQuarterDates();
      break;
    case "last-year-logs":
      multiDayDates = lastYearDates();
      break;
    case "month-logs":
      multiDayDates = thisMonthDatesThroughToday();
      break;
    case "quarter-logs":
      multiDayDates = thisQuarterDatesThroughToday();
      break;
    case "all-logs":
      multiDayDates = await collectAllDailyDates(app, settings);
      break;
    case "anchor-week-logs":
      multiDayDates = anchorWeekDates(anchor);
      break;
    case "anchor-month-logs":
      multiDayDates = anchorMonthDates(anchor);
      break;
    case "anchor-quarter-logs":
      multiDayDates = anchorQuarterDates(anchor);
      break;
    case "anchor-year-logs":
      multiDayDates = anchorYearDates(anchor);
      break;
  }

  if (multiDayDates) {
    const sections: string[] = [];
    const paths: string[] = [];
    const files: InputFingerprint[] = [];
    for (const date of multiDayDates) {
      const p = await resolveDailyLogPath(app, settings, date);
      const f = app.vault.getAbstractFileByPath(p);
      if (f instanceof TFile) {
        const c = await app.vault.read(f);
        if (c.trim()) {
          sections.push(`### ${date}\n\n${c}`);
          paths.push(p);
          files.push({
            path: p,
            size: new TextEncoder().encode(c).length,
            sha1: await sha1Hex(c),
          });
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
      files,
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

  return {
    label,
    sourcePath: path,
    content,
    files: [
      {
        path,
        size: new TextEncoder().encode(content).length,
        sha1: await sha1Hex(content),
      },
    ],
  };
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

/**
 * Walk the configured Logs folder and return every `YYYY-MM-DD.md` filename
 * (sans extension), sorted ascending. Used for the `all-logs` input kind.
 */
async function collectAllDailyDates(
  app: App,
  settings: SecondBrainSettings
): Promise<string[]> {
  const root = app.vault.getAbstractFileByPath(settings.logsFolder);
  if (!(root instanceof TFolder)) return [];
  const out: string[] = [];
  walkForDailyFilenames(root, out);
  out.sort();
  return out;
}

/** Pull the unchecked `- [ ] …` lines from a project's Active TODOs section. */
function extractActiveTodoLines(content: string): string[] {
  const m = content.match(/^##\s+Active TODOs\s*$/m);
  if (!m || m.index === undefined) return [];
  const start = m.index + m[0].length;
  const rest = content.slice(start);
  const next = rest.search(/^##\s+/m);
  const body = next < 0 ? rest : rest.slice(0, next);
  const out: string[] = [];
  for (const line of body.split(/\r?\n/)) {
    const t = line.match(/^\s*-\s*\[\s\]\s+(.+?)\s*$/);
    if (t && t[1].trim()) out.push(t[1].trim());
  }
  return out;
}

function walkForDailyFilenames(folder: TFolder, out: string[]) {
  for (const child of folder.children) {
    if (child instanceof TFolder) {
      walkForDailyFilenames(child, out);
    } else if (child instanceof TFile && /^\d{4}-\d{2}-\d{2}\.md$/.test(child.name)) {
      out.push(child.basename);
    }
  }
}
