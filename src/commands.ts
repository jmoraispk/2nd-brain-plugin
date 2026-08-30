import { Command } from "./types";
import { SecondBrainSettings } from "./settings";

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

const CONTRADICT_PROMPT = `You will be given the user's daily notes. Find places where they hold two beliefs, positions, or values that contradict each other across different times or contexts.

Rules:
- Cite verbatim. Quote both sides of the contradiction with the source filename and date.
- Don't manufacture contradictions out of evolution (changing your mind is not a contradiction; holding both simultaneously is).
- Don't flag tradeoffs ("I value X and Y, they're in tension") — only true contradictions ("I claim X is true here and not-X is true there").
- Aim for 3–5 high-confidence findings, not exhaustive coverage.
- For each, end with one sentence: "What would it take to resolve this?"

Output Markdown:

# Contradictions in the vault — <YYYY-MM-DD>

For each finding:
## Contradiction N
**Side A:** "<quote>" — _<filename>, <date>_
**Side B:** "<quote>" — _<filename>, <date>_
**Resolution question:** ...

Be honest. If you find few or none, say so. Don't pad.`;

const DRIFT_PROMPT = `You will be given the user's daily notes. Surface topics, projects, or commitments they're quietly avoiding — detectable via patterns of absence, decline in mention, or being talked about without action.

Cues:
- A project mentioned frequently, then dropped (no mention for 2+ weeks).
- A commitment ("I will…", "I need to…") that recurs but never becomes "I did".
- A topic discussed at length without ever becoming a concrete action.
- Stated intentions losing specificity over time ("definitely doing X this week" → "want to do X eventually" → silence).

Output Markdown:

# Drift report — <YYYY-MM-DD>

For each drifting item:
## <item>
- **Last mentioned:** <date>
- **Pattern:** <how often it appeared, when it stopped>
- **Hypothesis:** <one-line honest read of why it's drifting — procrastination, mismatched priority, fear, etc.>

Be direct. The user wants signal here. Don't soften.`;

const TRACE_PROMPT = `You will be given the user's daily notes plus a topic / idea / decision (in the "Topic / focus" section of the user message). Trace how their thinking on that topic evolved.

Steps:
1. Find every mention of the topic across the notes (verbatim quotes).
2. Group chronologically into phases (e.g., "early exploration", "doubt", "commitment", "execution").
3. For each phase, summarize what they were thinking and what changed between phases.
4. End with: "Where is this thinking now?" — based on the most recent entries.

Output Markdown:

# Trace: <topic> — <YYYY-MM-DD>

## Phase 1: <name>
<dates spanned>
<summary>
> "<verbatim quote>" — _<filename>, <date>_

(repeat phases)

## Where this stands now
<one paragraph>

Cite each quote with date. Don't editorialize beyond paraphrasing. Show evolution; don't interpret motive.`;

const CHALLENGE_PROMPT = `You will be given the user's daily notes plus a current belief or position (in the "Topic / focus" section). Argue against that belief using only evidence from their own vault.

Rules:
- Use only content from the notes. Don't import external arguments.
- Find specific instances where their own notes contradict, weaken, or complicate the belief.
- Present 3–5 of the strongest counterpoints. Quote verbatim.
- For each: "X says Y, but Z (their own note dated…) suggests not-Y."
- End with one question that, if answered, would resolve the strongest tension.

Output Markdown:

# Challenge — <YYYY-MM-DD>

**Belief under examination:** <restate>

## Counterpoint N
**Their own claim:** "<quote>" — _<filename>, <date>_
**Tension:** <how it undermines the belief>

(repeat 3–5 counterpoints)

## The question that resolves the strongest tension
<one sentence>

Be adversarial but fair. The point is to steel-man against them so they can sharpen the belief or update it.`;

// ── Tier-B workflow prompts ──────────────────────────────────────────────

const DRAFT_HABIT_PROMPT = `You are drafting a habit definition for the user, LogLife-style.

Given the user's recent daily logs (and optionally a focus topic in the "Topic / focus" section), either propose a new habit they appear to be forming OR strengthen a habit they've named. Output a single Markdown habit definition file using exactly this structure:

\`\`\`yaml
---
linked-goal:                       # leave blank if unclear; user can fill later
area: "<Wheel area, e.g. [[2. 🌳 Areas/Health/Body]]>"
periodicity: daily                 # daily | weekdays | weekly | monthly
binary-criterion: "<unambiguous pass/fail definition>"
why: "<the user's specific reason; quote them where possible>"
plan:
  when: "<anchor to an existing routine>"
  where: "<concrete place>"
  how: "<concrete first action>"
environment: "<one concrete environment tweak that lowers friction>"
recovery: "<smaller re-entry action if missed>"
status: active
---
\`\`\`

# <habit name>

## Why this habit
1–2 sentences. Use the user's own words where they have them.

## Boost notes
Brief commentary on each boost dimension and why this configuration is likely to fire. Cite specific log entries that motivated the suggestions.

## Open questions for the user
2–3 questions that, if answered, would crisp up the definition further (e.g. "What time of day are you actually most likely to do this?").

Rules:
- Be ruthlessly concrete. "Exercise" is not a habit — "≥5 minutes of intentional movement after morning coffee" is.
- The binary criterion must pass the 3-second test: someone reading the log can decide pass/fail in under 3 seconds.
- If the captures don't yet show enough to draft a habit, say so plainly: "No clear pattern yet — log this for another week."`;

const SNAPSHOT_PROMPT = `You will be given today's daily log. Produce a fast 3-bullet recap. No deep synthesis. Output Markdown:

# Daily snapshot — <YYYY-MM-DD>

- ...
- ...
- ...

(Exactly 3 bullets. Each one sentence, factual, no editorializing. Skip if today's log is empty.)`;

const TRIAGE_PROMPT = `You will be given today's daily log. For each captured item (one per [HH:MM] timestamp), suggest a likely destination folder using the PARA hybrid layout:
- 1. 🎯 Projects (current work with a defined end)
- 2. 🌳 Areas (ongoing zones — health, work, family, finance)
- 3. 📚 Resources (reference material)
- 4. 🗄️ Archives (inactive)
- 🤖 AI (AI-generated; not usually a destination for user captures)
- Or "keep in Logs" if it's pure stream-of-consciousness with no destination

Output Markdown:

# Inbox triage — <YYYY-MM-DD>

For each capture:
## [HH:MM]
"<verbatim or near-verbatim phrasing>"
**Suggestion:** <folder> · <one-line reason>

Rules: don't move anything (just suggest). If a capture spans multiple destinations, list them.`;

// ── Tier-A synthesizer prompts ───────────────────────────────────────────

const CONTEXT_PROMPT = `You are building a comprehensive context document about the user. Synthesize from their daily logs a picture of who they are RIGHT NOW: what they care about, what they're working on, what's been on their mind, what tensions or unresolved threads exist.

Output Markdown:

# Context — <YYYY-MM-DD>

## Who they are
Identity, role, primary concerns. Short paragraph.

## What they're working on
3–7 active projects/threads with one-line status each.

## What's on their mind
Recurring topics, open questions, unresolved decisions.

## What they care about
Values, priorities revealed by where attention actually goes.

## Recent shifts
What's changed in the last 2–4 weeks — new priorities, new commitments, dropped projects.

Rules: be faithful, no invented content. Synthesize at the level of "if a new assistant joined them tomorrow, this is what they'd need to know."`;

const EMERGE_PROMPT = `You will be given the user's daily logs. Find conclusions that follow from premises scattered across the notes — conclusions the user has NOT drawn explicitly.

An emergence IS:
- A conclusion that follows from premises in multiple notes
- Something the user would react to with "oh, I think that's right but I've never said it"
- Backed by at least 3 specific data points (otherwise it's just creative inference)

Anti-patterns (the Creativity Trap):
- Don't manufacture creativity. No 3+ specific citations → drop the finding.
- Don't restate what they explicitly said. Emergence is between the lines.
- Don't generalize platitudes ("you value growth").

Output Markdown:

# Emergent ideas — <YYYY-MM-DD>

For each finding (3–5 max):
## Idea N
**The emergence:** ...
**Premises (cite at least 3):**
- "<quote>" — _<filename>, <date>_
- "<quote>" — _<filename>, <date>_
- "<quote>" — _<filename>, <date>_
**Why it's the next step they'd say if asked:** one sentence

Be honest. 2 strong findings beats 5 weak ones.`;

const CONNECT_PROMPT = `The user has given you two domains/topics in the "Topic / focus" section (e.g. "X and Y"). Find non-obvious connections between them in the daily logs.

Method:
1. Map each domain independently — what notes mention it, what themes attach to it.
2. Find bridges — people who appear in both, themes that span them, decisions touching both, time periods where both were active.
3. If one domain has much more depth than the other, lean into the smaller domain's mentions — it's the limiting factor for any real bridge.

Output Markdown:

# Connections: <X> ↔ <Y> — <YYYY-MM-DD>

## Bridges found
For each:
- **Bridge:** what links them
- **Evidence:** verbatim quotes from both sides
- **What it implies:** one line

## What's NOT connected
If the vault has no real bridge between the two, say so. Don't manufacture connections.

Rules: cite verbatim. Don't editorialize beyond paraphrasing the connection.`;

const FOCUS_PROMPT = `You will be given the user's recent daily logs (~30 days). Run a focus diagnostic.

Phase 1: Front inventory
List every active "front" — every project, commitment, area, or thread the user is currently spending attention on. Aim for 8–15 items.

Phase 2: The One Bet
From the inventory, identify what they SHOULD be focusing on. Two signals:
- **Stated primacy:** what they say is most important.
- **Behavioral primacy:** what actually gets attention.
If they diverge, NAME the divergence.

Phase 3: Kill/Park ledger
For every front that isn't the One Bet, default to KILL or PARK. Don't pile them into "things I'm also doing." Make the user defend keeping anything.

Phase 4: Honest sentence
One sentence the user would say to themselves about how their focus is actually going. Don't soften.

Output Markdown:

# Focus diagnostic — <YYYY-MM-DD>

## Inventory
- ...

## The One Bet
**Stated:** ...
**Behavioral:** ...
**Tension (if any):** ...

## Kill / Park / Coast
For each non-primary front: KILL (stop entirely), PARK (paused, defined revival condition), or COAST (low-effort maintenance). Default to KILL.

## Honest sentence
"..."

Rules: forcing function. Default to KILL when in doubt. Resist letting them keep everything.`;

const LEVERAGE_PROMPT = `You will be given the user's daily logs. Find the 3–7 skills, knowledge domains, or mental models where concentrated investment would unlock progress across multiple fronts.

Method:
1. Map their constraints — what's blocking progress across multiple projects?
2. Find leverage points — where would one capability unlock 3+ areas?
3. Look beyond the vault — if the leverage point requires a skill they don't have, name it. You're NOT limited to what they've already mentioned.

A true leverage point:
- Unlocks ≥3 areas when developed
- Is not currently being invested in (or under-invested)
- Has a concrete forming criterion (something measurable)

Output Markdown:

# Leverage points — <YYYY-MM-DD>

For each (3–7 max):
## Leverage point N
**The capability:** what it is
**Areas it unlocks:** at least 3, listed
**Why under-invested:** what's keeping the user from developing it
**Concrete first step:** one specific action they could take this week

Rules: it's OK to import frameworks from outside the vault — that's what makes Leverage strategically useful. Anchor recommendations in actual constraints visible in the notes.`;

const REVIEW_PROMPT = `You are producing a daily SUMMARY (not a reflection). It's the light, frequent digest the user reads before optionally writing their own reflection separately. Keep it factual and tight — no coaching, no invented prompts.

The user message has two date fields: "Period anchor" (the day being summarized — the target) and "Today's date" (the day the summary is generated). Use the **anchor** for the title and any "today" framing. Use **Today's date** ONLY in the "Generated on" footer.

You will be given the user's raw captures for the anchor day. If the user message also contains an "## Active habits to evaluate" section, you MUST include a "Today's habits status" section near the top of your output (immediately after Captures summary). Produce a clean Markdown summary using exactly this structure (do not invent content):

# Daily Summary — <human-readable anchor date>

_Generated on <Today's date>. Owned by the command, overwritten on re-run; your own reflection lives in a separate file._

## Captures summary
A condensed, faithful summary of what was captured. Group by theme if many items. Quote verbatim where a phrasing is striking.

## Today's habits status
ONLY include this section if the user message contains active habits. For each habit listed there, output one line:
- ✅ <habit-id> — <verbatim evidence from the captures> (and the quantitative value if applicable, e.g. "40 minutes")
- ⚠️ <habit-id> — no evidence in today's log; track if it happened
- ❌ <habit-id> — explicitly missed: <verbatim quote from the log showing the miss>

Rules for habit evaluation:
- ✅ pass — the captures contain explicit evidence (action verb + reference to the habit OR a #tag like #gym:40).
- ⚠️ uncertain — no capture either way. This is the OPTIMISTIC default. Issue exactly ONE warning (no double-nag).
- ❌ fail — the captures explicitly say it was missed ("skipped gym", "no run today").
- Do NOT invent evidence. If you're not sure, mark uncertain.
- Quantitative habits: extract the numeric value from the capture (e.g. "gym 40min" → 40).

## Threads worth continuing
3–8 bullets: unresolved questions, recurring topics, projects with momentum.

## Lessons and observations
What the user noticed, learned, or flagged. Direct quotes welcome.

## Forward-looking items
Items the user explicitly earmarked for a later day (cues: "tomorrow I will…", "next week…", "remind me to…", "TODO"). For each, attempt to anchor it to a target date if the capture suggests one (interpret "tomorrow" relative to the anchor's date, not today's). Format:
- [target: YYYY-MM-DD] verbatim phrasing — _from <source>_
If no target date is implied, use [target: ?]. **If there are no such items, skip this section entirely.**

## Backward references
Mentions in captures that refer to earlier days. **Skip entirely if none.**

## TODO proposals
If the user message contains an "## Active projects (for TODO matching)" section, emit a fenced YAML block at the end of your output with TWO lists:

\`\`\`yaml
todos:       # NEW action items implied by today's captures
  - text: "Be specific about the action — readable standalone"
    project: "1. 🎯 Projects/Project A.md"   # exact path from the list, or null
    captured-at: "[14:22]"                    # the [HH:MM] timestamp that triggered it
updates:     # EXISTING TODOs today's captures indicate are DONE
  - text: "Exact text of the existing TODO from the project's Active TODOs"
    project: "1. 🎯 Projects/Project A.md"   # exact path the TODO lives in
    captured-at: "[16:39]"
\`\`\`

Rules:
- \`todos\` = new actions. \`updates\` = existing TODOs the captures say were completed (match the existing TODO text as closely as you can; only from the "Active TODOs" lists provided).
- One item per concrete action. Don't aggregate "do X and Y".
- text must be standalone — readable without context.
- project must be an EXACT path from the list above, or null (for \`todos\`). Don't invent project names.
- If nothing applies, emit \`todos: []\` and/or \`updates: []\`.
- Skip the whole block only if the user message had no projects list.

Rules:
- Be faithful. No fluff. No invented content. This is a summary — do NOT add reflection questions or coaching; the user reflects separately.
- Skip empty sections entirely (no "N/A" placeholders).`;

const WEEKLY_REVIEW_PROMPT = `You are synthesizing a weekly review for the user.

The user message includes "Period anchor" (a date within the week being reviewed) and "Today's date" (when the review is generated). Use the anchor for the title; use Today's date in the "Reviewed on" footer.

You will be given the user's daily logs for one ISO week (some days may be missing — skip them silently). Produce a clean Markdown weekly review with this structure (do not invent content):

# Weekly Review — Week of <human-readable Monday date>

_Reviewed on <Today's date>._

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

const DATE_RANGE_REVIEW_PROMPT = `You are producing a FACTUAL review of captures from a user-selected date range within one calendar month. This is a record of what actually happened, not coaching, planning, or reflection.

The user message includes "Period range" with the exact inclusive start and end dates. Use that range in the title. You will receive only daily logs that exist inside the range. A missing day means "no capture available," not that nothing happened.

Output ONLY this Markdown structure:

# Review — <start date> to <end date>

## Key progress
- The most important things completed, advanced, decided, resolved, or materially changed.

## Main lessons
- Lessons or conclusions the user explicitly stated, or that are directly and strongly supported by multiple factual entries.

## Unique events that mattered
- Specific non-routine events, milestones, conversations, decisions, setbacks, or experiences that were important in this period.

## Health statistics
- OPTIONAL. Include only when the captures contain enough explicit evidence to count or summarize: exercise sessions, sleep duration/quality, illness, recovery, weight, or similarly concrete health facts.

Rules:
- Bullets only under the section headings. No introductory or closing prose.
- Use 3–7 bullets per required section when the evidence supports them; use fewer rather than padding.
- Every bullet must state a fact and end with its supporting date or dates in parentheses, using YYYY-MM-DD.
- Prioritize significance over frequency. Omit routine details unless they changed the period's outcome.
- Key progress requires evidence of movement or a decision, not merely an intention or TODO.
- Main lessons must be the user's actual lesson or a conservative synthesis of repeated evidence. Do not invent advice.
- Unique events should not duplicate Key progress unless the event itself is independently important.
- For Health statistics, count only explicit evidence. Say "mentioned on N captured days" when a true session count is uncertain. Never treat a missing capture as a negative result.
- Omit Health statistics entirely when there is not enough concrete health evidence.
- Do not add themes, open loops, recommendations, plans, reflection questions, sentiment, or generic coaching.
- Do not invent, embellish, or infer beyond the captures.`;

/** Simplified dashboard command; range values are supplied by its calendar UI. */
export const DATE_RANGE_REVIEW_COMMAND: Command = {
  id: "review-date-range",
  label: "Capture Review",
  inputs: [
    { kind: "date-range-logs", label: "Captures in the selected range" },
  ],
  outputPath: "🤖 AI/Reviews/Custom/{RANGE_START}--{RANGE_END}.md",
  systemPrompt: DATE_RANGE_REVIEW_PROMPT,
};

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
    outputPath: "🤖 AI/Plans/Daily/{TOMORROW}.md",
    systemPrompt: PLAN_PROMPT,
  },
  {
    id: "weeks-review",
    label: "Week's Review",
    inputs: [{ kind: "this-week-logs", label: "This week's daily logs" }],
    outputPath: "🤖 AI/Reviews/Weekly/{ISO_YEAR}-W{WW}.md",
    systemPrompt: WEEKLY_REVIEW_PROMPT,
    kepanoQuestion: "year",
  },
  {
    id: "review-last-week",
    label: "Last Week's Review",
    inputs: [{ kind: "last-week-logs", label: "Last week's daily logs" }],
    outputPath: "🤖 AI/Reviews/Weekly/{ISO_YEAR}-W{WW}.md",
    systemPrompt: WEEKLY_REVIEW_PROMPT,
    kepanoQuestion: "year",
  },
  {
    id: "review-last-month",
    label: "Last Month's Review",
    inputs: [{ kind: "last-month-logs", label: "Last month's daily logs" }],
    outputPath: "🤖 AI/Reviews/Monthly/{YYYY-MM}.md",
    systemPrompt: MONTHLY_REVIEW_PROMPT,
    kepanoQuestion: "decade",
  },
  {
    id: "review-last-quarter",
    label: "Last Quarter's Review",
    inputs: [{ kind: "last-quarter-logs", label: "Last quarter's daily logs" }],
    outputPath: "🤖 AI/Reviews/Quarterly/{YYYY}-Q{Q}.md",
    systemPrompt: QUARTERLY_REVIEW_PROMPT,
  },
  {
    id: "review-last-year",
    label: "Last Year's Review",
    inputs: [{ kind: "last-year-logs", label: "Last year's daily logs" }],
    outputPath: "🤖 AI/Reviews/Yearly/{YYYY}.md",
    systemPrompt: YEARLY_REVIEW_PROMPT,
  },
  // Anchor-driven reviews (v0.6.3) — used by the Review tab's two-selector
  // picker when the user chooses Specific + a date. The output path resolves
  // against the anchor (so a specific-week review lands at the correct W{WW}).
  {
    id: "review-anchor-week",
    label: "Specific Week Review",
    inputs: [{ kind: "anchor-week-logs", label: "Specified week's daily logs" }],
    outputPath: "🤖 AI/Reviews/Weekly/{ISO_YEAR}-W{WW}.md",
    systemPrompt: WEEKLY_REVIEW_PROMPT,
    kepanoQuestion: "year",
  },
  {
    id: "review-anchor-month",
    label: "Specific Month Review",
    inputs: [{ kind: "anchor-month-logs", label: "Specified month's daily logs" }],
    outputPath: "🤖 AI/Reviews/Monthly/{YYYY-MM}.md",
    systemPrompt: MONTHLY_REVIEW_PROMPT,
    kepanoQuestion: "decade",
  },
  {
    id: "review-anchor-quarter",
    label: "Specific Quarter Review",
    inputs: [{ kind: "anchor-quarter-logs", label: "Specified quarter's daily logs" }],
    outputPath: "🤖 AI/Reviews/Quarterly/{YYYY}-Q{Q}.md",
    systemPrompt: QUARTERLY_REVIEW_PROMPT,
  },
  {
    id: "review-anchor-year",
    label: "Specific Year Review",
    inputs: [{ kind: "anchor-year-logs", label: "Specified year's daily logs" }],
    outputPath: "🤖 AI/Reviews/Yearly/{YYYY}.md",
    systemPrompt: YEARLY_REVIEW_PROMPT,
  },
  // Tier-S thinking commands (v0.5.1) — vault-scanning tools of thought.
  {
    id: "think-contradict",
    label: "Contradict",
    tier: "S",
    description: "Surface incompatible beliefs you hold simultaneously, across the whole vault.",
    inputs: [{ kind: "all-logs", label: "All daily logs" }],
    outputPath: "🤖 AI/Thinking/Contradict/{YYYY-MM-DD}.md",
    systemPrompt: CONTRADICT_PROMPT,
  },
  {
    id: "think-drift",
    label: "Drift",
    tier: "S",
    description: "Topics, projects, or commitments you've been quietly avoiding (via absence in your notes).",
    inputs: [{ kind: "all-logs", label: "All daily logs" }],
    outputPath: "🤖 AI/Thinking/Drift/{YYYY-MM-DD}.md",
    systemPrompt: DRIFT_PROMPT,
  },
  {
    id: "think-trace",
    label: "Trace",
    tier: "S",
    description: "Trace how your thinking on a specific topic evolved over time.",
    topicPromptText: "Which topic, idea, or decision should I trace through your notes?",
    inputs: [{ kind: "all-logs", label: "All daily logs" }],
    outputPath: "🤖 AI/Thinking/Trace/{YYYY-MM-DD}.md",
    systemPrompt: TRACE_PROMPT,
  },
  {
    id: "think-challenge",
    label: "Challenge",
    tier: "S",
    description: "Steel-man against a current belief using evidence from your own vault.",
    topicPromptText: "What belief or position do you want me to challenge?",
    inputs: [{ kind: "all-logs", label: "All daily logs" }],
    outputPath: "🤖 AI/Thinking/Challenge/{YYYY-MM-DD}.md",
    systemPrompt: CHALLENGE_PROMPT,
  },
  // Tier-A synthesizers (v0.6.1).
  {
    id: "think-context",
    label: "Context",
    tier: "A",
    description: "Build a comprehensive picture of who you are right now — projects, priorities, threads, recent shifts.",
    inputs: [{ kind: "all-logs", label: "All daily logs" }],
    outputPath: "🤖 AI/Thinking/Context/{YYYY-MM-DD}.md",
    systemPrompt: CONTEXT_PROMPT,
  },
  {
    id: "think-emerge",
    label: "Emerge",
    tier: "A",
    description: "Find ideas your vault implies but has never stated — conclusions hiding between premises.",
    inputs: [{ kind: "all-logs", label: "All daily logs" }],
    outputPath: "🤖 AI/Thinking/Emerge/{YYYY-MM-DD}.md",
    systemPrompt: EMERGE_PROMPT,
  },
  {
    id: "think-connect",
    label: "Connect",
    tier: "A",
    description: "Find non-obvious connections between two domains, projects, or topics.",
    topicPromptText: "Which two domains / topics should I connect? (e.g. 'Berimbau Pro and Capoeira System')",
    inputs: [{ kind: "all-logs", label: "All daily logs" }],
    outputPath: "🤖 AI/Thinking/Connect/{YYYY-MM-DD}.md",
    systemPrompt: CONNECT_PROMPT,
  },
  {
    id: "think-focus",
    label: "Focus",
    tier: "A",
    description: "Forcing function: identify the one bet you're actually making, kill/park everything else.",
    inputs: [{ kind: "month-logs", label: "This month's daily logs" }],
    outputPath: "🤖 AI/Thinking/Focus/{YYYY-MM-DD}.md",
    systemPrompt: FOCUS_PROMPT,
  },
  {
    id: "think-leverage",
    label: "Leverage",
    tier: "A",
    description: "Find 3–7 skills, domains, or models where concentrated investment unlocks progress across multiple fronts.",
    inputs: [{ kind: "all-logs", label: "All daily logs" }],
    outputPath: "🤖 AI/Thinking/Leverage/{YYYY-MM-DD}.md",
    systemPrompt: LEVERAGE_PROMPT,
  },
  // Lessons ledger (v0.14.1). Distil durable lessons from recent reviews into
  // the growing 🤖 AI/Lessons/lessons.md (the runner injects the review
  // context and merges the output, deduped — it ignores the inputs below).
  {
    id: "extract-lessons",
    label: "Extract Lessons",
    tier: "A",
    description:
      "Distil durable lessons from your recent reviews into a growing, area-tagged ledger (🤖 AI/Lessons). Append-only + deduped.",
    inputs: [{ kind: "all-logs", label: "(reviews injected by the runner)" }],
    outputPath: "🤖 AI/Lessons/lessons.md",
    systemPrompt: `You distil DURABLE lessons from the user's recent reviews (provided in the message). A durable lesson is a generalizable insight the user can carry forward — not a one-off event.

Output ONLY a fenced YAML block:

\`\`\`yaml
lessons:
  - text: "A crisp, first-person lesson — generalizable, not a diary entry"
    area: "Health/Body"   # best-fit Wheel sub-area (Macro/Sub), or omit
\`\`\`

Rules:
- Lessons must be durable and reusable ("I focus better with my phone in another room"), not events ("worked on the plugin today").
- De-duplicate semantically — don't restate the same lesson twice.
- 3–8 strong lessons beats 20 weak ones. If there's nothing durable, emit \`lessons: []\`.
- Use the user's own framing. Don't moralize or invent.`,
  },
  // Habit backfill (v0.8.2). One-shot: scan past logs, evaluate each habit
  // retroactively, and write a YAML report the plugin then merges into the
  // per-habit data files so streaks + heatmaps reflect real history.
  {
    id: "backfill-habits",
    label: "Backfill Habits",
    tier: "B",
    description:
      "Evaluate each active habit retroactively across all past daily logs, so streaks and heatmaps reflect real history. Costs one larger LLM call.",
    inputs: [{ kind: "all-logs", label: "All daily logs" }],
    outputPath: "🤖 AI/Habit-Backfill/{YYYY-MM-DD}.md",
    systemPrompt: `You are doing a one-shot RETROACTIVE evaluation of habits.

You will be given:
1. The user's complete daily logs (one section per day, dated).
2. An "Active habits to evaluate" block listing the user's currently-active habits with their binary criteria.

For EVERY day that has a log, evaluate every habit and output a single fenced YAML block of the form:

\`\`\`yaml
backfill:
  2026-04-15:
    gym: pass
    meditate: fail
  2026-04-16:
    gym: pass
    meditate: pass
\`\`\`

Rules:
- pass = captures contain explicit evidence (action verb + reference to the habit, OR a #tag like #gym).
- fail = captures explicitly say the habit was missed ("skipped gym", "no run today").
- uncertain = no capture either way. Use uncertain (NOT pass and NOT fail).
- Do NOT invent evidence. When unsure, mark uncertain.
- Include EVERY date that has a log entry. Omit dates without a log.
- Habit ids must match exactly what was listed in the "Active habits" block.
- The YAML block is the primary output. After the block, write a 2–3 sentence summary of patterns observed (which habits show consistent streaks, which are spotty). Don't editorialize beyond what the data shows.`,
  },
  // Habit drafting (v0.8).
  {
    id: "draft-habit",
    label: "Draft Habit",
    tier: "A",
    description:
      "Propose a new habit (or strengthen an existing one) using the LogLife boost framework: Define / Why / Plan / Environment / Recover.",
    topicPromptText:
      "Which habit should I draft? Leave empty to let me propose one from your recent captures.",
    inputs: [{ kind: "all-logs", label: "All daily logs" }],
    outputPath: "🤖 AI/Habit-Drafts/{YYYY-MM-DD}.md",
    systemPrompt: DRAFT_HABIT_PROMPT,
  },
  // Tier-B workflow / quick-cost commands (v0.6.2).
  {
    id: "think-daily-snapshot",
    label: "Daily snapshot",
    tier: "B",
    description: "Cheap, fast 3-bullet recap of today's log. No deep synthesis — just a quick read.",
    inputs: [{ kind: "today-log", label: "Today's captures" }],
    outputPath: "🤖 AI/Thinking/Snapshots/{YYYY-MM-DD}.md",
    systemPrompt: SNAPSHOT_PROMPT,
  },
  {
    id: "think-inbox-triage",
    label: "Inbox triage",
    tier: "B",
    description: "Read today's captures and suggest which PARA folder each likely belongs in.",
    inputs: [{ kind: "today-log", label: "Today's captures" }],
    outputPath: "🤖 AI/Thinking/Triage/{YYYY-MM-DD}.md",
    systemPrompt: TRIAGE_PROMPT,
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
