# Second Brain — Obsidian plugin

Big-button capture into today's daily log, plus a one-tap synthesized daily review via the Claude API. Mobile-first.

This is v0 of the PWA-equivalent surface for the [2nd-brain](https://github.com/jmoraispk/2nd-brain) framework. Same loop, but living inside Obsidian on your phone.

## What it does

The plugin view has three tabs:

- **Dashboard** — auto-generated overview: today's status with Capture + Today's Review quick-action buttons, a pending-reviews banner, threads in motion (wikilinks recurring across recent captures), and a list of projects. Pure local reads, no LLM calls. Refreshes via ↻.
- **Review** — every review-flavoured command in one place: daily (Today's Review, Plan Tomorrow), periodic (this week, last week/month/quarter/year), and a date picker for reviewing any specific past day. Also lists recent review outputs.
- **Think** — tools-of-thought commands and any user-added custom commands. Tier-S thinking commands (Contradict, Drift, Trace, Challenge) arrive in v0.5.1; for now this tab houses your custom commands.

Built-in commands shipped:

1. **Capture** — opens a textarea, saves with a `[HH:MM]` timestamp into today's daily log.
2. **Today's Review** — reads today's daily log, sends it to your configured LLM (OpenAI or Anthropic), writes a synthesized review to `_AI/Reviews/Daily/<today>.md`, and opens it.
3. **Plan Tomorrow** — reads today's review (which you've presumably edited with your own reflections), produces a focused scaffold for tomorrow at `_AI/Plans/Daily/<tomorrow>.md`. Run this after editing the daily review.
4. **Week's Review** — reads all daily logs from Monday through today of the current ISO week, writes a weekly synthesis to `_AI/Reviews/Weekly/{ISO_YEAR}-W{WW}.md`.

The natural daily loop: **Capture** throughout the day → **Today's Review** at end of day → edit the review with your own thoughts → **Plan Tomorrow** before bed. On Sunday: **Week's Review**.

## Custom commands (v0.2.0+)

Settings → Second Brain → **Commands** lets you edit any built-in (label / input / output path / prompt) or add your own. Built-ins can be reset to their default; custom commands can be deleted. Custom commands appear as additional buttons in the plugin view.

A custom command consists of:
- **Label** — button text.
- **Input** — one of: today's log, yesterday's log, today's review, yesterday's review, this week's logs.
- **Output path** — templated; supports `{YYYY-MM-DD}`, `{TOMORROW}`, `{YESTERDAY}`, `{ISO_YEAR}`, `{YYYY}`, `{YYYY-MM}`, `{MM}`, `{DD}`, `{Q}`, `{WW}`. Use `{REVIEWS_TEMPLATE}` to refer to the daily review template path.
- **System prompt** — instructions for the LLM.

Because commands are just prompts sent to whichever LLM provider you've configured, they're provider-agnostic. The same custom command works with OpenAI or Anthropic — no plugin install needed for each.

## Install (mobile, the easy path)

Use [BRAT](https://github.com/TfTHacker/obsidian42-brat) — Obsidian's standard way to install plugins from GitHub releases, with auto-update on new tags. Works on iOS and Android Obsidian.

1. In Obsidian (phone or desktop): **Settings → Community plugins → Browse**. Install **BRAT** and enable it.
2. **Settings → BRAT → Add Beta plugin** → paste this repo's URL (e.g. `https://github.com/jmoraispk/2nd-brain-plugin`).
3. BRAT downloads from the latest release and installs into `<vault>/.obsidian/plugins/obsidian-second-brain/`.
4. **Settings → Community plugins → Installed** → toggle **Second Brain** on.
5. **Settings → Second Brain** → paste your Anthropic API key.

To push an update: bump `version` in `manifest.json`, commit, and push a tag matching that version (`git tag v0.0.2 && git push --tags`). The GitHub Actions workflow builds and publishes a release. BRAT picks it up automatically on phone.

## Install (desktop, manual)

```bash
git clone <this repo> 2nd-brain-plugin
cd 2nd-brain-plugin
npm install
npm run build
mkdir -p "<vault>/.obsidian/plugins/obsidian-second-brain"
cp manifest.json main.js styles.css "<vault>/.obsidian/plugins/obsidian-second-brain/"
```

Then **Settings → Community plugins → Installed → toggle "Second Brain" on**.

### Faster dev loop

Build directly into the vault's plugin folder so you don't have to copy on every change:

```bash
# Replace the outfile in esbuild.config.mjs with the absolute path inside your vault, or symlink:
ln -s "$(pwd)" "<vault>/.obsidian/plugins/obsidian-second-brain"
npm run dev    # watches and rebuilds main.js in place
```

Reload Obsidian (Cmd/Ctrl-R on desktop) after each rebuild.

## Settings

| Setting | Default | Notes |
|---|---|---|
| Provider | `openai` | `openai` or `anthropic`. Switching preserves both keys. |
| OpenAI API key | _empty_ | Required when provider = openai. Sent only to api.openai.com. |
| OpenAI model | `gpt-4o` | Any chat-completions model id. |
| Anthropic API key | _empty_ | Required when provider = anthropic. Sent only to api.anthropic.com. |
| Anthropic model | `claude-opus-4-7` | Any Anthropic model id. |
| Logs folder | `Logs` | Recursively searched for `<today>.md`. |
| Daily log path template | `Logs/{YYYY-MM-DD}.md` | Used only when today's file doesn't exist yet. Placeholders: `{YYYY-MM-DD}`, `{WEEK_NUM_2DIGIT}`. |
| Reviews path template | `_AI/Reviews/Daily/{YYYY-MM-DD}.md` | Where the review is written. Overwrites on rerun. |
| Review prompt override | _empty_ | Optional. Replace the built-in review prompt. |

## How capture finds today's log

1. Search recursively under `Logs folder` for any file named `<YYYY-MM-DD>.md`. If found, append there.
2. Otherwise, derive a path from `Daily log path template` and create it.

This means the plugin adapts to whatever folder structure already exists (`Logs/Week_07/2026-04-21.md`, `Logs/2026-04-21.md`, etc.).

## Privacy / costs

- BYOK: bring your own Anthropic API key. The plugin only talks to `api.anthropic.com`.
- Daily log content is sent to Anthropic when you press "Today's Review". Nothing else is exfiltrated.
- All vault writes happen client-side via Obsidian's normal API.

## Roadmap

- v0.0.2 ✅ multi-provider (OpenAI + Anthropic)
- v0.1.0 ✅ Commands abstraction + Plan Tomorrow
- v0.1.1 ✅ Settings button in main view
- v0.1.2 ✅ Year/Quarter/Week folder layout
- v0.2.0 ✅ User-editable commands UI + Week's Review + settings auto-migration
- v0.3.0 ✅ Dashboard view (today's status, threads in motion, projects, recent reviews)
- v0.4.0 ✅ Last-period reviews (week/month/quarter/year) + pending-review banner on Dashboard
- v0.4.1 ✅ Today on top of Dashboard, per-day pending dailies, skip button on pending rows
- v0.5.0 ✅ Three tabs (Dashboard / Review / Think)
- v0.5.1 ✅ Tier-S Think commands (Contradict, Drift, Trace, Challenge); Review tab redesigned (single picker + inline AI summary + your-review textbox + Finish); AI-writable zone renamed `_AI/` → `🤖 AI/` with auto-migration; PARA folders reordered `1. 🎯 Projects` etc.
- v0.5.2 ✅ Think tab sub-tabs (S / A / B) with thin one-row commands and Run on the right; Pending Reviews banner collapsible; bottom padding so Obsidian Mobile's toolbar never overlaps the last clickable element; capture-path bug fixed
- v0.6.0 ✅ Pending-banner click forwards into the Review tab pre-configured (auto-fills picker, auto-runs, shows AI summary inline ready for your reflection); Test-connection button in settings (5-token call, reports provider error verbatim); Troubleshooting guide in settings; settings sections are collapsible
- v0.7.0 — Project context command (tap project → AI synthesizes state from project file + recent daily mentions → writes to `🤖 AI/Project-Context/`)
- v0.8.0–v0.9.0 — **Graph-connected reviews** (research-direction): during review/synthesis the AI auto-injects `[[wikilinks]]` for known topics so the Obsidian graph stays dense. Inspired by Kepano's "links over folders" philosophy. Likely implementation: pass the LLM a list of existing vault note titles + recently-mentioned wikilinks, instruct it to wrap matching mentions in `[[ ]]`. Possibly also auto-detect new "topic" candidates (capitalized recurring phrases) and propose new topic notes.
- v0.6.0 — Project context: tap a project in Dashboard → AI synthesizes its current state from project file + recent daily mentions, writes to _AI/Project-Context/. AI reads PARA, never writes there.
- v0.7.0 — Interactive review chat: docked panel scoped to an open review file, streaming, can propose edits.
- v1.0.0 — Obsidian community-store release; additional providers (Google, local)
- v2.0.0 — Optional port to Tauri for a standalone app outside Obsidian

Voice capture is intentionally not on the roadmap: phone OS dictation already covers it.
