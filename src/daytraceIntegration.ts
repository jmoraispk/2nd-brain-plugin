import {
  App,
  RequestUrlParam,
  RequestUrlResponse,
  TFile,
  requestUrl,
} from "obsidian";
import {
  ActivityWatchTransport,
  EpisodeBundle,
  JsonObject,
  ProviderRequest,
  ProviderResponse,
  ProgressCallback,
  SummaryProvider,
  SummaryProviderError,
  buildSummaryPlan,
  collectDay,
  renderDigestMarkdown,
  renderEpisodeJson,
  renderEpisodeMarkdown,
  summarizeBundleOrFallback,
} from "daytrace";
import { applyDatePlaceholders } from "./paths";
import { SecondBrainSettings } from "./settings";

export const DAYTRACE_EVIDENCE_PATH =
  "🧑 Me/Activity/Daytrace/Evidence/{ISO_YEAR}/Q{Q}/W{WW}/{YYYY-MM-DD}.json";
export const DAYTRACE_SUMMARY_PATH =
  "🤖 AI/Activity/Daytrace/Summaries/{ISO_YEAR}/Q{Q}/W{WW}/{YYYY-MM-DD}.md";

type Requester = (request: RequestUrlParam) => Promise<RequestUrlResponse>;

export interface GenerateDaytraceOptions {
  request?: Requester;
  timezoneName?: string;
  signal?: AbortSignal;
  onProgress?: ProgressCallback;
}

export interface DaytraceGeneration {
  captureMarkdown: string;
  evidenceFile: TFile;
  summaryFile?: TFile;
  fallbackCode?: string;
}

/** Preserve text already typed into Capture when activity is fetched. */
export function mergeCaptureDraft(current: string, fetched: string): string {
  const existing = current.trim();
  const activity = fetched.trim();
  if (!existing) return activity;
  if (!activity) return existing;
  return `${existing}\n\n${activity}`;
}

/** Adapt Obsidian's desktop-capable HTTP client to DayTrace's AW boundary. */
export function createActivityWatchTransport(
  requester: Requester = requestUrl
): ActivityWatchTransport {
  return {
    async request(input) {
      input.signal?.throwIfAborted();
      const base = input.server.endsWith("/") ? input.server : `${input.server}/`;
      const url = new URL(input.path, base);
      for (const [key, value] of Object.entries(input.query ?? {})) {
        url.searchParams.set(key, value);
      }
      const response = await requester({
        url: url.toString(),
        method: "GET",
        throw: false,
      });
      input.signal?.throwIfAborted();
      if (response.status < 200 || response.status >= 300) {
        throw new Error(`ActivityWatch returned HTTP ${response.status}`);
      }
      return response.json;
    },
  };
}

/** Adapt the plugin's configured provider to DayTrace's strict JSON contract. */
export function createDaytraceSummaryProvider(
  settings: SecondBrainSettings,
  requester: Requester = requestUrl
): SummaryProvider {
  const provider = settings.provider;
  const model =
    provider === "anthropic" ? settings.anthropicModel : settings.openaiModel;

  return {
    async complete(request, options = {}) {
      options.signal?.throwIfAborted();
      const response =
        provider === "anthropic"
          ? await completeAnthropic(
              settings,
              model,
              request,
              requester,
              options.signal
            )
          : await completeOpenAI(
              settings,
              model,
              request,
              requester,
              options.signal
            );
      options.signal?.throwIfAborted();
      return response;
    },
  };
}

/** Collect today, persist stable evidence, then produce the editable AI table. */
export async function generateDaytraceActivity(
  app: App,
  settings: SecondBrainSettings,
  day: string,
  options: GenerateDaytraceOptions = {}
): Promise<DaytraceGeneration> {
  const requester = options.request ?? requestUrl;
  const bundle = await collectDay({
    day,
    transport: createActivityWatchTransport(requester),
    ...(options.timezoneName === undefined
      ? {}
      : { timezoneName: options.timezoneName }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.onProgress === undefined
      ? {}
      : { onProgress: options.onProgress }),
  });

  const evidencePath = applyDatePlaceholders(DAYTRACE_EVIDENCE_PATH, day);
  options.signal?.throwIfAborted();
  const evidenceFile = await upsertVaultFile(
    app,
    evidencePath,
    renderEpisodeJson(bundle, { details: true, raw: true })
  );
  options.signal?.throwIfAborted();

  const plan = buildSummaryPlan(bundle);
  const outcome = await summarizeBundleOrFallback(
    bundle,
    createDaytraceSummaryProvider(settings, requester),
    plan,
    {
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      ...(options.onProgress === undefined
        ? {}
        : { onProgress: options.onProgress }),
    }
  );

  if (outcome.kind === "deterministic") {
    options.signal?.throwIfAborted();
    const summaryPath = applyDatePlaceholders(DAYTRACE_SUMMARY_PATH, day);
    const existingSummary = app.vault.getAbstractFileByPath(summaryPath);
    if (existingSummary instanceof TFile) {
      await app.vault.modify(
        existingSummary,
        [
          "---",
          "daytrace-status: unavailable",
          `daytrace-evidence: \"${evidencePath}\"`,
          `daytrace-failure: \"${outcome.failure.code}\"`,
          "---",
          "",
          `# DayTrace — ${day}`,
          "",
          "The latest deterministic evidence was saved, but an AI summary was not available for this run.",
          "",
        ].join("\n")
      );
    }
    options.signal?.throwIfAborted();
    return {
      captureMarkdown: renderEpisodeMarkdown(outcome.bundle),
      evidenceFile,
      fallbackCode: outcome.failure.code,
    };
  }

  const captureMarkdown = renderDigestMarkdown(
    bundle,
    outcome.digest,
    outcome.provenance
  );
  const summaryPath = applyDatePlaceholders(DAYTRACE_SUMMARY_PATH, day);
  options.signal?.throwIfAborted();
  const summaryFile = await upsertVaultFile(app, summaryPath, captureMarkdown);
  options.signal?.throwIfAborted();
  return { captureMarkdown, evidenceFile, summaryFile };
}

async function completeOpenAI(
  settings: SecondBrainSettings,
  model: string,
  request: ProviderRequest,
  requester: Requester,
  signal?: AbortSignal
): Promise<ProviderResponse> {
  if (!settings.openaiApiKey.trim()) throw new SummaryProviderError("authentication");
  const format = structuredFormat(request.responseFormat);
  const response = await requestProvider(requester, {
    url: "https://api.openai.com/v1/chat/completions",
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${settings.openaiApiKey}`,
    },
    body: JSON.stringify({
      model,
      store: false,
      messages: [
        { role: "system", content: request.instructions },
        { role: "user", content: JSON.stringify(request.payload) },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: format.name,
          strict: format.strict,
          schema: format.schema,
        },
      },
    }),
    throw: false,
  }, signal);
  ensureProviderSuccess(response.status);
  const text = response.json?.choices?.[0]?.message?.content;
  return {
    payload: parseProviderJson(text),
    provider: "openai",
    model,
    ...(numberValue(response.json?.usage?.prompt_tokens) === undefined
      ? {}
      : { inputTokens: numberValue(response.json?.usage?.prompt_tokens) }),
    ...(numberValue(response.json?.usage?.completion_tokens) === undefined
      ? {}
      : { outputTokens: numberValue(response.json?.usage?.completion_tokens) }),
    ...(stringValue(response.json?.id) === undefined
      ? {}
      : { responseId: stringValue(response.json?.id) }),
  };
}

async function completeAnthropic(
  settings: SecondBrainSettings,
  model: string,
  request: ProviderRequest,
  requester: Requester,
  signal?: AbortSignal
): Promise<ProviderResponse> {
  if (!settings.anthropicApiKey.trim())
    throw new SummaryProviderError("authentication");
  const format = structuredFormat(request.responseFormat);
  const response = await requestProvider(requester, {
    url: "https://api.anthropic.com/v1/messages",
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": settings.anthropicApiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system: request.instructions,
      messages: [{ role: "user", content: JSON.stringify(request.payload) }],
      output_config: {
        format: {
          type: "json_schema",
          schema: stripUnsupportedAnthropicConstraints(format.schema),
        },
      },
    }),
    throw: false,
  }, signal);
  ensureProviderSuccess(response.status);
  const blocks = Array.isArray(response.json?.content)
    ? response.json.content
    : [];
  const text = blocks.find(
    (block: unknown) =>
      typeof block === "object" &&
      block !== null &&
      (block as { type?: unknown }).type === "text"
  ) as { text?: unknown } | undefined;
  return {
    payload: parseProviderJson(text?.text),
    provider: "anthropic",
    model,
    ...(numberValue(response.json?.usage?.input_tokens) === undefined
      ? {}
      : { inputTokens: numberValue(response.json?.usage?.input_tokens) }),
    ...(numberValue(response.json?.usage?.output_tokens) === undefined
      ? {}
      : { outputTokens: numberValue(response.json?.usage?.output_tokens) }),
    ...(stringValue(response.json?.id) === undefined
      ? {}
      : { responseId: stringValue(response.json?.id) }),
  };
}

function structuredFormat(value: JsonObject): {
  name: string;
  strict: boolean;
  schema: JsonObject;
} {
  const name = stringValue(value.name);
  const schema = objectValue(value.schema);
  if (value.type !== "json_schema" || name === undefined || schema === undefined) {
    throw new SummaryProviderError("request");
  }
  return { name, strict: value.strict === true, schema };
}

/** Anthropic's raw Messages endpoint rejects validation-only size keywords. */
function stripUnsupportedAnthropicConstraints(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripUnsupportedAnthropicConstraints);
  if (typeof value !== "object" || value === null) return value;
  const unsupported = new Set([
    "maxLength",
    "minLength",
    "maximum",
    "minimum",
    "maxItems",
  ]);
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !unsupported.has(key))
      .map(([key, item]) => [key, stripUnsupportedAnthropicConstraints(item)])
  );
}

async function requestProvider(
  requester: Requester,
  request: RequestUrlParam,
  signal?: AbortSignal
): Promise<RequestUrlResponse> {
  signal?.throwIfAborted();
  try {
    const response = await requester(request);
    signal?.throwIfAborted();
    return response;
  } catch (error) {
    if (signal?.aborted) signal.throwIfAborted();
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new SummaryProviderError("network");
  }
}

function ensureProviderSuccess(status: number): void {
  if (status >= 200 && status < 300) return;
  if (status === 401 || status === 403)
    throw new SummaryProviderError("authentication");
  if (status === 429) throw new SummaryProviderError("rate-limit");
  if (status >= 500) throw new SummaryProviderError("service");
  throw new SummaryProviderError("request");
}

function parseProviderJson(value: unknown): unknown {
  if (typeof value !== "string" || value.trim().length === 0)
    throw new SummaryProviderError("request");
  try {
    return JSON.parse(value);
  } catch {
    throw new SummaryProviderError("request");
  }
}

function objectValue(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

async function upsertVaultFile(
  app: App,
  path: string,
  content: string
): Promise<TFile> {
  const existing = app.vault.getAbstractFileByPath(path);
  if (existing instanceof TFile) {
    await app.vault.modify(existing, content);
    return existing;
  }
  if (existing !== null) throw new Error(`DayTrace path is not a file: ${path}`);
  await ensureParentFolder(app, path);
  return app.vault.create(path, content);
}

async function ensureParentFolder(app: App, filePath: string): Promise<void> {
  const folder = filePath.slice(0, filePath.lastIndexOf("/"));
  if (!folder || app.vault.getAbstractFileByPath(folder)) return;
  await app.vault.createFolder(folder);
}
