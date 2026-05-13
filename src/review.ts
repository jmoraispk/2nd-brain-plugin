import { App, TFile } from "obsidian";
import { SecondBrainSettings } from "./settings";
import { resolveDailyLogPath, todayISO } from "./paths";
import { callLLM } from "./llm";

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

  const reviewText = await callLLM(settings, systemPrompt, userMsg);

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
