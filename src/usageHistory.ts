import {
  MODEL_CATALOG,
  MODEL_PRICING_VERSION,
  ModelInfo,
} from "./modelRoutes";

export const USAGE_HISTORY_SCHEMA_VERSION = 1 as const;
export const MAX_USAGE_HISTORY_ENTRIES = 500;
export const MAX_VISIBLE_USAGE_INTERACTIONS = 50;

export type UsageProvider = "vapi" | "openai" | "anthropic";
export type UsageAccuracy = "exact" | "estimated" | "pending" | "unknown";
export type UsageStatus = "completed" | "failed" | "cancelled" | "pending";
export type UsageComponent = "vapi-call" | "llm-request";

export interface TokenUsage {
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
}

export interface VapiCostBreakdown {
  transport?: number;
  transcription?: number;
  model?: number;
  voice?: number;
  platform?: number;
}

export interface UsageHistoryEntry {
  id: string;
  interactionId: string;
  occurredAt: string;
  action: string;
  component: UsageComponent;
  provider: UsageProvider;
  model?: string;
  status: UsageStatus;
  accuracy: UsageAccuracy;
  costUsd?: number;
  durationSeconds?: number;
  callId?: string;
  usage?: TokenUsage;
  vapiBreakdown?: VapiCostBreakdown;
  pricingVersion?: string;
}

export interface UsageHistoryState {
  schemaVersion: typeof USAGE_HISTORY_SCHEMA_VERSION;
  entries: UsageHistoryEntry[];
  lastVapiSyncAt?: string;
}

export interface ProviderUsageEvent {
  provider: "openai" | "anthropic";
  model: string;
  status: "completed" | "failed";
  action?: string;
  interactionId?: string;
  providerRequestId?: string;
  occurredAt?: string;
  usage?: TokenUsage;
}

export interface UsageInteractionGroup {
  interactionId: string;
  occurredAt: string;
  action: string;
  entries: UsageHistoryEntry[];
  accuracy: UsageAccuracy;
  knownCostUsd?: number;
  hasUnpricedComponents: boolean;
  durationSeconds?: number;
}

export interface UsageWindowSummary {
  knownCostUsd: number;
  hasUnpricedComponents: boolean;
}

export interface UsageWindowSummaries {
  today: UsageWindowSummary;
  sevenDays: UsageWindowSummary;
  thirtyDays: UsageWindowSummary;
}

export function createInteractionId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `interaction-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2)}`;
}

export function createProviderUsageEntry(
  event: ProviderUsageEvent,
  fallbackOccurredAt = new Date().toISOString()
): UsageHistoryEntry {
  const occurredAt = validIso(event.occurredAt) ?? validIso(fallbackOccurredAt) ?? new Date().toISOString();
  const usage = sanitizeTokenUsage(event.usage);
  const pricing = resolvePricing(event.model, event.provider);
  const costUsd =
    event.status === "completed" && usage && pricing
      ? estimateTokenCost(usage, pricing)
      : undefined;
  const providerRequestId = nonEmptyString(event.providerRequestId);

  return {
    id: providerRequestId
      ? `${event.provider}:${providerRequestId}`
      : `${event.provider}:${createInteractionId()}`,
    interactionId:
      nonEmptyString(event.interactionId) ?? createInteractionId(),
    occurredAt,
    action: nonEmptyString(event.action) ?? "AI request",
    component: "llm-request",
    provider: event.provider,
    model: event.model,
    status: event.status,
    accuracy: costUsd === undefined ? "unknown" : "estimated",
    ...(costUsd === undefined ? {} : { costUsd }),
    ...(usage ? { usage } : {}),
    ...(pricing ? { pricingVersion: MODEL_PRICING_VERSION } : {}),
  };
}

export function sanitizeUsageHistoryState(raw: unknown): UsageHistoryState {
  const value = recordValue(raw);
  const entries = Array.isArray(value?.entries)
    ? value.entries
        .map(sanitizeUsageHistoryEntry)
        .filter((entry): entry is UsageHistoryEntry => entry !== undefined)
    : [];
  const state: UsageHistoryState = {
    schemaVersion: USAGE_HISTORY_SCHEMA_VERSION,
    entries: dedupeAndCap(entries),
  };
  const lastVapiSyncAt = validIso(value?.lastVapiSyncAt);
  if (lastVapiSyncAt) state.lastVapiSyncAt = lastVapiSyncAt;
  return state;
}

export function sanitizeUsageHistoryEntry(
  raw: unknown
): UsageHistoryEntry | undefined {
  const value = recordValue(raw);
  if (!value) return undefined;
  const id = nonEmptyString(value.id);
  const interactionId = nonEmptyString(value.interactionId);
  const occurredAt = validIso(value.occurredAt);
  const action = nonEmptyString(value.action);
  const component = enumValue(value.component, ["vapi-call", "llm-request"] as const);
  const provider = enumValue(value.provider, ["vapi", "openai", "anthropic"] as const);
  const status = enumValue(value.status, ["completed", "failed", "cancelled", "pending"] as const);
  const accuracy = enumValue(value.accuracy, ["exact", "estimated", "pending", "unknown"] as const);
  if (!id || !interactionId || !occurredAt || !action || !component || !provider || !status || !accuracy) {
    return undefined;
  }

  const model = nonEmptyString(value.model);
  const callId = nonEmptyString(value.callId);
  const pricingVersion = nonEmptyString(value.pricingVersion);
  const costUsd = nonNegativeNumber(value.costUsd);
  const durationSeconds = nonNegativeNumber(value.durationSeconds);
  const usage = sanitizeTokenUsage(value.usage);
  const vapiBreakdown = sanitizeVapiBreakdown(value.vapiBreakdown);

  return {
    id,
    interactionId,
    occurredAt,
    action,
    component,
    provider,
    status,
    accuracy,
    ...(model ? { model } : {}),
    ...(costUsd === undefined ? {} : { costUsd }),
    ...(durationSeconds === undefined ? {} : { durationSeconds }),
    ...(callId ? { callId } : {}),
    ...(usage ? { usage } : {}),
    ...(vapiBreakdown ? { vapiBreakdown } : {}),
    ...(pricingVersion ? { pricingVersion } : {}),
  };
}

export function groupUsageInteractions(
  entries: UsageHistoryEntry[]
): UsageInteractionGroup[] {
  const groups = new Map<string, UsageHistoryEntry[]>();
  for (const raw of entries) {
    const entry = sanitizeUsageHistoryEntry(raw);
    if (!entry) continue;
    const group = groups.get(entry.interactionId) ?? [];
    group.push(entry);
    groups.set(entry.interactionId, group);
  }

  return [...groups.entries()]
    .map(([interactionId, grouped]) => {
      grouped.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
      const knownCosts = grouped
        .map((entry) => entry.costUsd)
        .filter((cost): cost is number => cost !== undefined);
      const hasPending = grouped.some((entry) => entry.accuracy === "pending");
      const hasUnknown = grouped.some((entry) => entry.accuracy === "unknown");
      const hasEstimated = grouped.some((entry) => entry.accuracy === "estimated");
      const accuracy: UsageAccuracy = hasPending
        ? "pending"
        : hasUnknown
          ? "unknown"
          : hasEstimated
            ? "estimated"
            : "exact";
      const durationSeconds = grouped.reduce<number | undefined>(
        (duration, entry) =>
          entry.durationSeconds === undefined
            ? duration
            : Math.max(duration ?? 0, entry.durationSeconds),
        undefined
      );
      return {
        interactionId,
        occurredAt: grouped[0].occurredAt,
        action:
          grouped.find((entry) => entry.component === "vapi-call")?.action ??
          grouped[0].action,
        entries: grouped,
        accuracy,
        ...(knownCosts.length
          ? { knownCostUsd: knownCosts.reduce((sum, cost) => sum + cost, 0) }
          : {}),
        hasUnpricedComponents: grouped.some(
          (entry) =>
            entry.costUsd === undefined &&
            (entry.accuracy === "pending" || entry.accuracy === "unknown")
        ),
        ...(durationSeconds === undefined ? {} : { durationSeconds }),
      };
    })
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
}

export function summarizeUsageWindows(
  entries: UsageHistoryEntry[],
  now = new Date()
): UsageWindowSummaries {
  const todayStart = startOfLocalDay(now);
  const sevenStart = addLocalDays(todayStart, -6);
  const thirtyStart = addLocalDays(todayStart, -29);
  return {
    today: summarizeSince(entries, todayStart),
    sevenDays: summarizeSince(entries, sevenStart),
    thirtyDays: summarizeSince(entries, thirtyStart),
  };
}

export class UsageHistoryStore {
  private state: UsageHistoryState;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    initial: unknown,
    private readonly persist: (state: UsageHistoryState) => Promise<void>,
    private readonly onError: (error: unknown) => void
  ) {
    this.state = sanitizeUsageHistoryState(initial);
  }

  snapshot(): UsageHistoryState {
    return cloneState(this.state);
  }

  recordProviderUsage(event: ProviderUsageEvent): Promise<void> {
    return this.upsert(createProviderUsageEntry(event));
  }

  upsert(raw: UsageHistoryEntry): Promise<void> {
    return this.enqueue(async () => {
      const entry = sanitizeUsageHistoryEntry(raw);
      if (!entry) return;
      this.state.entries = upsertEntry(this.state.entries, entry);
      await this.persistCurrent();
    });
  }

  replaceAll(entries: UsageHistoryEntry[], lastVapiSyncAt?: string): Promise<void> {
    return this.enqueue(async () => {
      this.state = sanitizeUsageHistoryState({
        schemaVersion: USAGE_HISTORY_SCHEMA_VERSION,
        entries,
        ...(lastVapiSyncAt ? { lastVapiSyncAt } : {}),
      });
      await this.persistCurrent();
    });
  }

  clear(): Promise<void> {
    return this.enqueue(async () => {
      this.state = {
        schemaVersion: USAGE_HISTORY_SCHEMA_VERSION,
        entries: [],
      };
      await this.persistCurrent();
    });
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    this.queue = this.queue.then(operation, operation);
    return this.queue;
  }

  private async persistCurrent(): Promise<void> {
    try {
      await this.persist(this.snapshot());
    } catch (error) {
      try {
        this.onError(error);
      } catch {
        // Error reporting must not turn usage bookkeeping into a user failure.
      }
    }
  }
}

function resolvePricing(
  model: string,
  provider: "openai" | "anthropic"
): ModelInfo | undefined {
  return [...MODEL_CATALOG]
    .filter((candidate) => candidate.provider === provider)
    .sort((a, b) => b.id.length - a.id.length)
    .find(
      (candidate) =>
        model === candidate.id || model.startsWith(`${candidate.id}-`)
    );
}

function estimateTokenCost(usage: TokenUsage, pricing: ModelInfo): number {
  const input = usage.inputTokens ?? 0;
  const cached = Math.min(input, usage.cachedInputTokens ?? 0);
  const standard = input - cached;
  const output = usage.outputTokens ?? 0;
  return (
    standard * pricing.inPrice +
    cached * (pricing.cachedInPrice ?? pricing.inPrice) +
    output * pricing.outPrice
  ) / 1_000_000;
}

function sanitizeTokenUsage(raw: unknown): TokenUsage | undefined {
  const value = recordValue(raw);
  if (!value) return undefined;
  const usage: TokenUsage = {};
  const inputTokens = nonNegativeNumber(value.inputTokens);
  const cachedInputTokens = nonNegativeNumber(value.cachedInputTokens);
  const outputTokens = nonNegativeNumber(value.outputTokens);
  const reasoningTokens = nonNegativeNumber(value.reasoningTokens);
  if (inputTokens !== undefined) usage.inputTokens = inputTokens;
  if (cachedInputTokens !== undefined) usage.cachedInputTokens = cachedInputTokens;
  if (outputTokens !== undefined) usage.outputTokens = outputTokens;
  if (reasoningTokens !== undefined) usage.reasoningTokens = reasoningTokens;
  return Object.keys(usage).length ? usage : undefined;
}

function sanitizeVapiBreakdown(raw: unknown): VapiCostBreakdown | undefined {
  const value = recordValue(raw);
  if (!value) return undefined;
  const breakdown: VapiCostBreakdown = {};
  for (const field of [
    "transport",
    "transcription",
    "model",
    "voice",
    "platform",
  ] as const) {
    const cost = nonNegativeNumber(value[field]);
    if (cost !== undefined) breakdown[field] = cost;
  }
  return Object.keys(breakdown).length ? breakdown : undefined;
}

function dedupeAndCap(entries: UsageHistoryEntry[]): UsageHistoryEntry[] {
  let output: UsageHistoryEntry[] = [];
  for (const entry of entries) output = upsertEntry(output, entry);
  return output
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
    .slice(0, MAX_USAGE_HISTORY_ENTRIES);
}

function upsertEntry(
  entries: UsageHistoryEntry[],
  entry: UsageHistoryEntry
): UsageHistoryEntry[] {
  return [...entries.filter(
    (candidate) =>
      candidate.id !== entry.id &&
      (!entry.callId || candidate.callId !== entry.callId)
  ), entry]
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
    .slice(0, MAX_USAGE_HISTORY_ENTRIES);
}

function summarizeSince(
  entries: UsageHistoryEntry[],
  start: Date
): UsageWindowSummary {
  let knownCostUsd = 0;
  let hasUnpricedComponents = false;
  for (const raw of entries) {
    const entry = sanitizeUsageHistoryEntry(raw);
    if (!entry || new Date(entry.occurredAt) < start) continue;
    if (entry.costUsd !== undefined) knownCostUsd += entry.costUsd;
    if (
      entry.costUsd === undefined &&
      (entry.accuracy === "pending" || entry.accuracy === "unknown")
    ) {
      hasUnpricedComponents = true;
    }
  }
  return { knownCostUsd, hasUnpricedComponents };
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addLocalDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function cloneState(state: UsageHistoryState): UsageHistoryState {
  return JSON.parse(JSON.stringify(state)) as UsageHistoryState;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function validIso(value: unknown): string | undefined {
  const text = nonEmptyString(value);
  return text && Number.isFinite(Date.parse(text)) ? text : undefined;
}

function nonNegativeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function enumValue<const T extends readonly string[]>(
  value: unknown,
  allowed: T
): T[number] | undefined {
  return typeof value === "string" && allowed.includes(value)
    ? (value as T[number])
    : undefined;
}
