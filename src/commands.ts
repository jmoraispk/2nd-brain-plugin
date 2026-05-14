import { Command } from "./types";
import { SecondBrainSettings } from "./settings";

const REVIEW_PROMPT = `You are synthesizing a daily review for the user.

You will be given the user's raw captures for today. Produce a clean Markdown review using exactly this structure (do not invent content, be faithful to the captures):

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

const PLAN_PROMPT = `You are producing tomorrow's plan scaffold based on the user's just-edited daily review.

The user has reviewed today and possibly added their own reflections to the review file. Your job: distill what they wrote into a focused, actionable plan for tomorrow. Honor what they prioritized; do not invent priorities they didn't name.

Produce Markdown with exactly this structure:

# Plan — <human-readable tomorrow date>

## Carry-forward from today
3–6 bullets of items that are unfinished, were earmarked for tomorrow in the review, or otherwise have momentum. Quote the review directly where useful.

## Top 3 for tomorrow
Force the user to pick three. Pull from the carry-forward + forward-looking items. If fewer than three credible candidates exist, leave numbered placeholders ("3. _") rather than padding.
1.
2.
3.

## Other candidates (overflow)
Bullets for additional items that didn't make the top 3 but are worth not forgetting.

## Open questions for tomorrow
2–3 questions that would help the user clarify tomorrow if they paused now to think. Phrase as the user's own voice.

## One-paragraph distillation of today
A single paragraph so tomorrow's plan stands on its own without re-reading the review.

Rules:
- No invented content. Only synthesize what's in the review.
- If the review is empty, trivial, or unreviewed, write "No substantial review found — run /Today's Review first and edit it before planning." and stop. Do not produce the scaffold.
- Be brief. Plans get longer when the day starts; this is the seed.`;

const WEEKLY_REVIEW_PROMPT = `You are synthesizing a weekly review for the user.

You will be given the user's daily logs from the Monday of this ISO week through today (some days may be missing — skip them silently). Produce a clean Markdown weekly review using exactly this structure (do not invent content):

# Weekly Review — Week of <human-readable Monday date>

## Themes of the week
3–6 bullets identifying recurring topics, projects with momentum, unresolved threads. Reference which days each appeared.

## What got done
A factual recap: items the user mentioned completing, shipping, or finishing this week. Direct quotes welcome where striking.

## What's still in motion
Projects or threads that span multiple days and aren't done. Brief status for each.

## Lessons and observations
What the user noticed, learned, or flagged this week. Direct quotes welcome.

## Stats
Count days where recurring themes appeared. Examples:
- Exercise: N days mentioned
- Sleep: any patterns or notes
- Deep-work blocks: how many
- Recurring concerns: count days mentioned

Skip stats that don't apply. Don't pad with placeholder values.

## Forward to next week
3–5 things to carry forward. Anchor to a target day or week when possible:
- [target: YYYY-MM-DD or next week] item

## Open questions (for the user's weekly reflection)
3–5 questions in the user's voice.

Rules:
- Be faithful. No fluff. No invented content.
- Weekly = ISO Mon–Sun. You may only have Mon–today; that's fine.`;

export const BUILT_IN_COMMANDS: Command[] = [
  {
    id: "todays-review",
    label: "Today's Review",
    inputs: [{ kind: "today-log", label: "Today's captures" }],
    outputPath: "{REVIEWS_TEMPLATE}",
    systemPrompt: REVIEW_PROMPT,
  },
  {
    id: "plan-tomorrow",
    label: "Plan Tomorrow",
    inputs: [{ kind: "today-review", label: "Today's review" }],
    outputPath: "_AI/Plans/Daily/{TOMORROW}.md",
    systemPrompt: PLAN_PROMPT,
  },
  {
    id: "weeks-review",
    label: "Week's Review",
    inputs: [{ kind: "this-week-logs", label: "This week's daily logs" }],
    outputPath: "_AI/Reviews/Weekly/{ISO_YEAR}-W{WW}.md",
    systemPrompt: WEEKLY_REVIEW_PROMPT,
  },
];

/** Look up a built-in command by id. Returns null if not found. */
export function getBuiltInCommand(id: string): Command | null {
  return BUILT_IN_COMMANDS.find((c) => c.id === id) ?? null;
}

/**
 * Merge built-in commands with user customizations. Custom commands sharing
 * an id with a built-in OVERRIDE that built-in (preserving its display order).
 * Truly-custom commands (no matching built-in id) are appended after the built-ins.
 */
export function getEffectiveCommands(settings: SecondBrainSettings): Command[] {
  const customs = settings.customCommands ?? [];
  const resolved = BUILT_IN_COMMANDS.map((b) => {
    const override = customs.find((c) => c.id === b.id);
    return override ?? b;
  });
  const trulyCustom = customs.filter(
    (c) => !BUILT_IN_COMMANDS.some((b) => b.id === c.id)
  );
  return [...resolved, ...trulyCustom];
}
