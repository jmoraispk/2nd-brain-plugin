/**
 * Per-task model orchestration (v0.9.6).
 *
 * Every LLM-backed command belongs to a *task-group*. A route maps a
 * task-group → { model, effort }. Unassigned groups fall back to the
 * provider/model in settings (the "default model"). The runner resolves the
 * route by the command's task-group instead of always reading
 * settings.openaiModel.
 */

import { SecondBrainSettings } from "./settings";

export type ModelEffort = "default" | "off" | "low" | "high";

export type TaskGroupId =
  | "daily-summary"
  | "periodic-review"
  | "think-deep"
  | "think-light"
  | "project-ai"
  | "ask"
  | "utility";

export interface TaskGroup {
  id: TaskGroupId;
  label: string;
  desc: string;
  /** Rough token sizes for the cost hint (input / output). */
  typIn: number;
  typOut: number;
}

export const TASK_GROUPS: TaskGroup[] = [
  {
    id: "daily-summary",
    label: "Daily summary",
    desc: "The everyday digest from your captures.",
    typIn: 2500,
    typOut: 700,
  },
  {
    id: "periodic-review",
    label: "Periodic reviews",
    desc: "Weekly / monthly / quarterly / yearly syntheses.",
    typIn: 12000,
    typOut: 1000,
  },
  {
    id: "think-deep",
    label: "Think — deep",
    desc: "Whole-vault tools: Contradict, Drift, Trace, Challenge, Context, Leverage.",
    typIn: 60000,
    typOut: 1500,
  },
  {
    id: "think-light",
    label: "Think — light",
    desc: "Emerge, Connect, Focus, Snapshot, Triage.",
    typIn: 8000,
    typOut: 800,
  },
  {
    id: "project-ai",
    label: "Project AI",
    desc: "Describe-a-project + edit-via-AI + habit/goal designers.",
    typIn: 1500,
    typOut: 600,
  },
  {
    id: "ask",
    label: "Ask (chat)",
    desc: "Two-pass Q&A over the vault: a cheap planner picks files, then the answerer reads only those.",
    typIn: 14000,
    typOut: 700,
  },
  {
    id: "utility",
    label: "Backfill / Draft habit",
    desc: "Occasional whole-vault utilities.",
    typIn: 20000,
    typOut: 800,
  },
];

/** Map a command id to its task-group. */
export function taskGroupForCommand(commandId: string): TaskGroupId {
  if (commandId === "todays-review") return "daily-summary";
  if (commandId.startsWith("review-") || commandId === "weeks-review")
    return "periodic-review";
  if (
    [
      "think-contradict",
      "think-drift",
      "think-trace",
      "think-challenge",
      "think-context",
      "think-leverage",
    ].includes(commandId)
  )
    return "think-deep";
  if (commandId.startsWith("think-")) return "think-light";
  if (commandId === "backfill-habits" || commandId === "draft-habit")
    return "utility";
  return "daily-summary";
}

export interface ModelInfo {
  id: string;
  label: string;
  provider: "openai" | "anthropic";
  /** USD per 1M tokens. */
  inPrice: number;
  outPrice: number;
}

/** Structured catalog (prices mirror the dropdowns in settings.ts). */
export const MODEL_CATALOG: ModelInfo[] = [
  { id: "gpt-5.5", label: "gpt-5.5 — flagship", provider: "openai", inPrice: 5, outPrice: 30 },
  { id: "gpt-5.4", label: "gpt-5.4 — strong", provider: "openai", inPrice: 2.5, outPrice: 15 },
  { id: "gpt-5", label: "gpt-5 — balanced default", provider: "openai", inPrice: 1.25, outPrice: 10 },
  { id: "gpt-5-mini", label: "gpt-5-mini — cheap", provider: "openai", inPrice: 0.25, outPrice: 2 },
  { id: "gpt-4.1-nano", label: "gpt-4.1-nano — cheapest", provider: "openai", inPrice: 0.1, outPrice: 0.4 },
  { id: "claude-opus-4-7", label: "claude-opus-4-7 — flagship", provider: "anthropic", inPrice: 5, outPrice: 25 },
  { id: "claude-sonnet-4-6", label: "claude-sonnet-4-6 — balanced", provider: "anthropic", inPrice: 3, outPrice: 15 },
  { id: "claude-haiku-4-5", label: "claude-haiku-4-5 — cheap", provider: "anthropic", inPrice: 1, outPrice: 5 },
];

export function modelInfo(id: string): ModelInfo | undefined {
  return MODEL_CATALOG.find((m) => m.id === id);
}

/** Infer the provider from a model id (claude- → anthropic, else openai). */
export function providerForModel(id: string): "openai" | "anthropic" {
  if (id.startsWith("claude")) return "anthropic";
  return "openai";
}

export interface ResolvedRoute {
  model: string;
  effort: ModelEffort;
  provider: "openai" | "anthropic";
}

/** The default model from settings (the floor every unassigned group uses). */
export function defaultModel(settings: SecondBrainSettings): string {
  return settings.provider === "anthropic"
    ? settings.anthropicModel
    : settings.openaiModel;
}

/** Resolve the route for a task-group, falling back to the default model. */
export function resolveRoute(
  settings: SecondBrainSettings,
  group: TaskGroupId
): ResolvedRoute {
  const route = settings.modelRoutes?.[group];
  const model = route?.model || defaultModel(settings);
  const effort = route?.effort ?? "default";
  return { model, effort, provider: providerForModel(model) };
}

/** "$0.01/run" style hint for a (model, group) pair. */
export function costHint(modelId: string, group: TaskGroup): string {
  const info = modelInfo(modelId);
  if (!info) return "";
  const usd =
    (group.typIn * info.inPrice + group.typOut * info.outPrice) / 1_000_000;
  if (usd < 0.01) return "<$0.01/run";
  return `~$${usd.toFixed(2)}/run`;
}
