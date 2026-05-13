import { App, TFile, requestUrl } from "obsidian";
import { SecondBrainSettings } from "./settings";
import { resolveDailyLogPath, todayISO } from "./paths";

const DEFAULT_REVIEW_PROMPT = `You are synthesizing a daily review for the user.

I will give you the user's raw captures for today. Produce a clean Markdown review using exactly this structure (do not invent content, be faithful to the captures):

# Daily Review — <human-readable date>

## Captures summary
A condensed, faithful summary of what was captured. Group by theme if many items. Quote verbatim where a phrasing is striking.

## Threads worth continuing
3–8 bullets: unresolved questions, recurring topics, projects with momentum.

## Lessons and observations
What the user noticed, learned, or flagged. Direct quotes welcome.

## Forward-looking items
Items the user explicitly earmarked for a later day. Cues: "tomorrow I will…", "next week…", "remind me to…", "TODO". Format each as:
- [target: YYYY-MM-DD] verbatim phrasing  — _from <source filename>_
If no target date is implied, use [target: ?].

## Review prompts (for the user to answer)
3–5 pointed questions phrased in the user's voice.

## Plan scaffold (for the user to fill)
- What's unfinished?
- What's next?
- What to drop?

Rules:
- Be faithful. No fluff. No invented content.
- If the captures are empty or trivial, still produce the scaffold with a "No substantial captures." note in the summary.`;

export async function generateDailyReview(
  app: App,
  settings: SecondBrainSettings
): Promise<TFile> {
  if (!settings.anthropicApiKey) {
    throw new Error(
      "Anthropic API key not set. Configure in plugin settings."
    );
  }

  const today = todayISO();
  const logPath = await resolveDailyLogPath(app, settings, today);
  const logFile = app.vault.getAbstractFileByPath(logPath);
  if (!(logFile instanceof TFile)) {
    throw new Error(
      `No daily log found at ${logPath}. Capture something first.`
    );
  }

  const captures = await app.vault.read(logFile);
  if (!captures.trim()) {
    throw new Error("Today's daily log is empty.");
  }

  const systemPrompt =
    settings.reviewPromptOverride.trim() || DEFAULT_REVIEW_PROMPT;
  const userMsg = `Today's date: ${today}\nSource file: ${logFile.name}\n\nCaptures:\n\n${captures}`;

  const body = JSON.stringify({
    model: settings.model,
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: "user", content: userMsg }],
  });

  const res = await requestUrl({
    url: "https://api.anthropic.com/v1/messages",
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": settings.anthropicApiKey,
      "anthropic-version": "2023-06-01",
    },
    body,
    throw: false,
  });

  if (res.status >= 400) {
    const errMsg =
      res.json?.error?.message || res.text || `HTTP ${res.status}`;
    throw new Error(`Anthropic error: ${errMsg}`);
  }

  const reviewText = res.json?.content?.[0]?.text;
  if (!reviewText) {
    throw new Error("No content returned by Anthropic API.");
  }

  const reviewPath = settings.reviewsPathTemplate.replace(
    "{YYYY-MM-DD}",
    today
  );
  await ensureFolderExists(app, reviewPath);

  const existing = app.vault.getAbstractFileByPath(reviewPath);
  if (existing instanceof TFile) {
    await app.vault.modify(existing, reviewText);
    return existing;
  } else {
    return await app.vault.create(reviewPath, reviewText);
  }
}

async function ensureFolderExists(app: App, filePath: string) {
  const parts = filePath.split("/");
  parts.pop();
  const folderPath = parts.join("/");
  if (!folderPath) return;
  if (app.vault.getAbstractFileByPath(folderPath)) return;
  await app.vault.createFolder(folderPath);
}
