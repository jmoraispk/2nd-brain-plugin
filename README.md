# Second Brain — Obsidian plugin

Big-button capture into today's daily log, plus a one-tap synthesized daily review via the Claude API. Mobile-first.

This is v0 of the PWA-equivalent surface for the [2nd-brain](https://github.com/jmoraispk/2nd-brain) framework. Same loop, but living inside Obsidian on your phone.

## What it does

Two buttons inside the plugin view:

1. **Capture** — opens a textarea, saves with a `[HH:MM]` timestamp into today's daily log.
2. **Today's Review** — reads today's daily log, calls Claude, writes a synthesized review to `_AI/Reviews/Daily/<today>.md`, opens the file.

That's it for v0. Voice capture, weekly review, and `/plan` come next.

## Install (dev / local)

Until the plugin is in the Obsidian community store, install manually:

```bash
# 1. Clone & build
git clone <this repo> 2nd-brain-plugin
cd 2nd-brain-plugin
npm install
npm run build

# 2. Copy build artifacts into your vault
mkdir -p "<vault>/.obsidian/plugins/obsidian-second-brain"
cp manifest.json main.js styles.css "<vault>/.obsidian/plugins/obsidian-second-brain/"
```

Then in Obsidian: **Settings → Community plugins → Installed → toggle "Second Brain" on**.

On mobile: use [BRAT](https://github.com/TfTHacker/obsidian42-brat) and point it at this repo, or copy the same three files into the same path on your phone.

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
| Anthropic API key | _empty_ | Required. Stored in plugin data.json, only sent to api.anthropic.com. |
| Model | `claude-opus-4-7` | Any Anthropic model id. |
| Logs folder | `Logs` | Recursively searched for `<today>.md`. |
| Daily log path template | `Logs/{YYYY-MM-DD}.md` | Used only when today's file doesn't exist yet. Placeholders: `{YYYY-MM-DD}`, `{WEEK_NUM_2DIGIT}`. |
| Reviews path template | `_AI/Reviews/Daily/{YYYY-MM-DD}.md` | Where the review is written. Overwrites on rerun. |
| Review prompt (advanced) | _empty_ | Override the built-in review prompt. |

## How capture finds today's log

1. Search recursively under `Logs folder` for any file named `<YYYY-MM-DD>.md`. If found, append there.
2. Otherwise, derive a path from `Daily log path template` and create it.

This means the plugin adapts to whatever folder structure already exists (`Logs/Week_07/2026-04-21.md`, `Logs/2026-04-21.md`, etc.).

## Privacy / costs

- BYOK: bring your own Anthropic API key. The plugin only talks to `api.anthropic.com`.
- Daily log content is sent to Anthropic when you press "Today's Review". Nothing else is exfiltrated.
- All vault writes happen client-side via Obsidian's normal API.

## Roadmap

- v0.1: voice capture (record + Whisper transcription)
- v0.2: weekly / monthly review
- v0.3: `/plan` — produces tomorrow's scaffold from today's review
- v1.0: multiple LLM providers (OpenAI, Google), Obsidian community-store release
- v2.0: port to Tauri for a standalone app
