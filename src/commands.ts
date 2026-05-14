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

const MONTHLY_REVIEW_PROMPT = `You are synthesizing a monthly review.

You will be given the user's daily logs across an entire calendar month. Produce a clean Markdown review using exactly this structure:

# Monthly Review — <Month YYYY>

## Themes of the month
4–8 bullets identifying recurring topics, projects with momentum, unresolved threads. Reference which days or weeks each appeared.

## Major accomplishments
Items the user mentioned completing, shipping, or finishing. Direct quotes welcome.

## Projects in flight
Multi-week projects that span the month. Brief status and trajectory for each.

## Lessons and observations
Durable takeaways. Surface anything the user explicitly flagged as a lesson.

## Stats
Count days/weeks recurring themes appeared (e.g. exercise: N days, deep-work blocks: M, recurring concerns: count). Skip what doesn't apply.

## Trajectory
How did the user shift this month? More or less aligned with stated priorities than the start of the month? Cite evidence.

## Forward to next month
3–5 things to carry forward, anchored when possible.

## Open questions for the user's monthly reflection
3–5 questions in the user's voice.

Rules:
- Be faithful. No fluff. No invented content.
- Monthly scale → more synthesis, less granularity than a weekly.`;

const QUARTERLY_REVIEW_PROMPT = `You are synthesizing a quarterly review (Q1/Q2/Q3/Q4).

You will be given the user's daily logs across an entire calendar quarter. Produce a strategic-level Markdown review:

# Quarterly Review — <YYYY> Q<N>

## Strategic shifts
What changed at the level of beliefs, direction, or commitments this quarter? 3–5 bullets.

## Completed
Projects shipped, milestones reached, contracts closed.

## Killed / parked
What was started and abandoned, or paused indefinitely. Be honest about why.

## In motion
What's still active and where each thing stands. Group by project.

## Patterns over time
Trends across the 3 months. Things that compounded. Things that decayed.

## Lessons (the durable ones)
Quarter-scale insights — patterns the user noticed multiple times, decisions they made.

## Forward to next quarter
3–5 bets the user should make next quarter, based on what's alive and where leverage is.

## The Honest Sentence
A single sentence the user would say to themselves about how this quarter actually went. Don't soften.

Rules:
- Quarter-scale prompts demand higher-altitude synthesis than weekly or monthly. Resist re-listing every event.
- Anchor strategic claims to specific evidence in the logs.`;

const YEARLY_REVIEW_PROMPT = `You are synthesizing a yearly review.

You will be given the user's daily logs across an entire calendar year. Produce a Markdown review at the highest level of synthesis:

# Yearly Review — <YYYY>

## The story of <YYYY>
2–3 paragraph narrative of the user's year. What was it about? What changed?

## Major arcs
3–5 multi-month threads. For each: when it started, where it went, where it stands.

## What I made
Shipped, released, completed.

## What I let go
Started but abandoned, retired, archived.

## Lessons that stuck
Durable insights — things said multiple times, decisions they don't regret, mistakes they learned from.

## People and relationships
Who appeared in the year. Brief notes on the relational arc if discernible.

## Patterns over the year
Recurring themes — exercise consistency, sleep, mood, deep work, recurring concerns.

## What I'd tell myself a year ago
One paragraph in the user's voice, addressed to the person they were 12 months ago.

## Forward to <YYYY+1>
The 3 most important things to carry forward. Resist listing 10.

Rules:
- Year-scale demands narrative + the honest sentence. Less listing, more synthesis.
- Use the user's own words where they're striking.`;

const WEEKLY_REVIEW_PROMPT = `You are synthesizing a weekly review for the user.

You will be given the user's daily logs for one ISO week (some days may be missing — skip them silently). Produce a clean Markdown weekly review using exactly this structure (do not invent content):

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
  {
    id: "review-last-week",
    label: "Last Week's Review",
    inputs: [{ kind: "last-week-logs", label: "Last week's daily logs" }],
    outputPath: "_AI/Reviews/Weekly/{ISO_YEAR}-W{WW}.md",
    systemPrompt: WEEKLY_REVIEW_PROMPT,
  },
  {
    id: "review-last-month",
    label: "Last Month's Review",
    inputs: [{ kind: "last-month-logs", label: "Last month's daily logs" }],
    outputPath: "_AI/Reviews/Monthly/{YYYY-MM}.md",
    systemPrompt: MONTHLY_REVIEW_PROMPT,
  },
  {
    id: "review-last-quarter",
    label: "Last Quarter's Review",
    inputs: [{ kind: "last-quarter-logs", label: "Last quarter's daily logs" }],
    outputPath: "_AI/Reviews/Quarterly/{YYYY}-Q{Q}.md",
    systemPrompt: QUARTERLY_REVIEW_PROMPT,
  },
  {
    id: "review-last-year",
    label: "Last Year's Review",
    inputs: [{ kind: "last-year-logs", label: "Last year's daily logs" }],
    outputPath: "_AI/Reviews/Yearly/{YYYY}.md",
    systemPrompt: YEARLY_REVIEW_PROMPT,
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
