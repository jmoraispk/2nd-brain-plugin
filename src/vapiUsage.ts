import { requestUrl } from "obsidian";
import type {
  UsageHistoryEntry,
  UsageHistoryState,
  VapiCostBreakdown,
} from "./usageHistory";
import { sanitizeUsageHistoryState } from "./usageHistory";

const VAPI_API_URL = "https://api.vapi.ai";
const VAPI_RECONCILE_CONCURRENCY = 3;
const VAPI_BACKFILL_DAYS = 30;

export interface VapiReconcileOptions {
  assistantId: string;
  privateKey?: string;
  now?: Date;
  request?: typeof requestUrl;
  isMobile?: boolean;
}

export interface VapiReconcileResult {
  state: UsageHistoryState;
  status: "updated" | "missing-key" | "mobile" | "failed";
  message: string;
  imported: number;
  reconciled: number;
}

export function readVapiPrivateKey(
  env: Record<string, string | undefined> | undefined
): string | undefined {
  const value = env?.VAPI_PRIVATE_KEY?.trim();
  return value || undefined;
}

export function createPendingVapiEntry(input: {
  callId: string;
  interactionId: string;
  action: "Capture call" | "Review call";
  occurredAt: string;
}): UsageHistoryEntry {
  const callId = input.callId.trim();
  return {
    id: `vapi:${callId}`,
    interactionId: input.interactionId.trim(),
    occurredAt: input.occurredAt,
    action: input.action,
    component: "vapi-call",
    provider: "vapi",
    status: "pending",
    accuracy: "pending",
    callId,
  };
}

export function completePendingVapiEntry(input: {
  entry: UsageHistoryEntry;
  status: "completed" | "failed" | "cancelled";
  durationSeconds?: number;
}): UsageHistoryEntry {
  const durationSeconds = nonNegativeNumber(input.durationSeconds);
  return {
    ...input.entry,
    status: input.status,
    accuracy: "pending",
    ...(durationSeconds === undefined ? {} : { durationSeconds }),
  };
}

export async function reconcileVapiUsage(
  state: UsageHistoryState,
  options: VapiReconcileOptions
): Promise<VapiReconcileResult> {
  if (options.isMobile) {
    return result(
      state,
      "mobile",
      "Exact Vapi charges appear after desktop reconciliation.",
      0,
      0
    );
  }

  const privateKey = options.privateKey?.trim();
  if (!privateKey) {
    return result(
      state,
      "missing-key",
      "Define VAPI_PRIVATE_KEY on desktop and fully restart Obsidian. Mobile calls remain pending until desktop reconciliation.",
      0,
      0
    );
  }

  const assistantId = options.assistantId.trim();
  if (!assistantId) {
    return result(
      state,
      "failed",
      "Set the Vapi assistant ID before refreshing exact costs.",
      0,
      0
    );
  }

  const requester = options.request ?? requestUrl;
  const now = validDate(options.now) ? options.now! : new Date();
  const originalCallIds = new Set(
    state.entries
      .map((entry) => entry.callId)
      .filter((callId): callId is string => Boolean(callId))
  );
  const pending = state.entries.filter(
    (entry) =>
      entry.component === "vapi-call" &&
      entry.accuracy === "pending" &&
      Boolean(entry.callId)
  );

  try {
    const pendingCalls = await mapWithConcurrency(
      pending,
      VAPI_RECONCILE_CONCURRENCY,
      async (entry) => ({
        entry,
        raw: await fetchVapiJson(
          requester,
          `${VAPI_API_URL}/call/${encodeURIComponent(entry.callId!)}`,
          privateKey
        ),
      })
    );

    let entries = state.entries.map((entry) => ({ ...entry }));
    let reconciled = 0;
    for (const item of pendingCalls) {
      const mapped = mapVapiCall(item.raw, item.entry);
      if (!mapped) continue;
      entries = upsertByCallId(entries, mapped);
      if (mapped.accuracy === "exact") reconciled += 1;
    }

    let imported = 0;
    if (!state.lastVapiSyncAt) {
      const backfillStart = new Date(
        now.getTime() - VAPI_BACKFILL_DAYS * 24 * 60 * 60 * 1000
      ).toISOString();
      const params = new URLSearchParams({
        assistantId,
        createdAtGe: backfillStart,
        limit: "1000",
      });
      const rawBackfill = await fetchVapiJson(
        requester,
        `${VAPI_API_URL}/call?${params.toString()}`,
        privateKey
      );
      if (!Array.isArray(rawBackfill)) throw new Error("invalid Vapi response");

      for (const rawCall of rawBackfill) {
        const callId = stringField(recordField(rawCall)?.id);
        if (!callId) continue;
        const existing = entries.find((entry) => entry.callId === callId);
        const mapped = mapVapiCall(rawCall, existing);
        if (!mapped) continue;
        entries = upsertByCallId(entries, mapped);
        if (!originalCallIds.has(callId)) imported += 1;
      }
    }

    const next = sanitizeUsageHistoryState({
      schemaVersion: 1,
      entries,
      lastVapiSyncAt: now.toISOString(),
    });
    return result(
      next,
      "updated",
      reconciliationMessage(imported, reconciled),
      imported,
      reconciled
    );
  } catch {
    return result(
      state,
      "failed",
      "Vapi cost refresh failed. Existing history was left unchanged.",
      0,
      0
    );
  }
}

function mapVapiCall(
  raw: unknown,
  existing?: UsageHistoryEntry
): UsageHistoryEntry | undefined {
  const call = recordField(raw);
  if (!call) return undefined;
  const callId = stringField(call.id);
  if (!callId) return undefined;
  const costUsd = nonNegativeNumber(call?.cost);
  if (costUsd === undefined) return existing;

  const occurredAt =
    existing?.occurredAt ??
    isoField(call?.createdAt) ??
    isoField(call?.startedAt);
  if (!occurredAt) return undefined;
  const durationSeconds = callDurationSeconds(call);
  const vapiBreakdown = mapVapiBreakdown(call?.costBreakdown);

  return {
    id: `vapi:${callId}`,
    interactionId: existing?.interactionId ?? `vapi:${callId}`,
    occurredAt,
    action: existing?.action ?? "Voice call",
    component: "vapi-call",
    provider: "vapi",
    status: "completed",
    accuracy: "exact",
    costUsd,
    ...(durationSeconds === undefined ? {} : { durationSeconds }),
    callId,
    ...(vapiBreakdown === undefined ? {} : { vapiBreakdown }),
  };
}

function mapVapiBreakdown(raw: unknown): VapiCostBreakdown | undefined {
  const value = recordField(raw);
  if (!value) return undefined;
  const mapped: VapiCostBreakdown = {};
  const fields = [
    ["transport", "transport"],
    ["stt", "transcription"],
    ["llm", "model"],
    ["tts", "voice"],
    ["vapi", "platform"],
  ] as const;
  for (const [source, target] of fields) {
    const cost = nonNegativeNumber(value[source]);
    if (cost !== undefined) mapped[target] = cost;
  }
  return Object.keys(mapped).length === 0 ? undefined : mapped;
}

function callDurationSeconds(
  call: Record<string, unknown>
): number | undefined {
  const startedAt = isoField(call.startedAt);
  const endedAt = isoField(call.endedAt);
  if (!startedAt || !endedAt) return undefined;
  const duration = (Date.parse(endedAt) - Date.parse(startedAt)) / 1000;
  return duration >= 0 ? duration : undefined;
}

async function fetchVapiJson(
  requester: typeof requestUrl,
  url: string,
  privateKey: string
): Promise<unknown> {
  const response = await requester({
    url,
    method: "GET",
    headers: { authorization: `Bearer ${privateKey}` },
    throw: false,
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error("Vapi request failed");
  }
  return response.json;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T) => Promise<R>
): Promise<R[]> {
  const output = new Array<R>(items.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await mapper(items[index]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker())
  );
  return output;
}

function upsertByCallId(
  entries: UsageHistoryEntry[],
  next: UsageHistoryEntry
): UsageHistoryEntry[] {
  return [
    ...entries.filter(
      (entry) => entry.id !== next.id && entry.callId !== next.callId
    ),
    next,
  ];
}

function result(
  state: UsageHistoryState,
  status: VapiReconcileResult["status"],
  message: string,
  imported: number,
  reconciled: number
): VapiReconcileResult {
  return { state, status, message, imported, reconciled };
}

function reconciliationMessage(imported: number, reconciled: number): string {
  if (imported === 0 && reconciled === 0) return "Exact Vapi costs are current.";
  return `Updated ${reconciled} pending call${reconciled === 1 ? "" : "s"} and imported ${imported}.`;
}

function validDate(value: Date | undefined): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function recordField(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isoField(value: unknown): string | undefined {
  const text = stringField(value);
  return text && Number.isFinite(Date.parse(text)) ? text : undefined;
}

function nonNegativeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}
