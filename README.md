# Second Brain — Obsidian plugin

Big-button capture into today's daily log, plus a one-tap synthesized daily review via the Claude API. Mobile-first.

This is v0 of the PWA-equivalent surface for the [2nd-brain](https://github.com/jmoraispk/2nd-brain) framework. Same loop, but living inside Obsidian on your phone.

## What it does

Two buttons inside the plugin view:

1. **Capture** — opens a textarea, saves with a `[HH:MM]` timestamp into today's daily log.
2. **Today's Review** — reads today's daily log, calls Claude, writes a synthesized review to `_AI/Reviews/Daily/<today>.md`, opens the file.

That's it for v0. Voice capture, weekly review, and `/plan` come next.

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

- v0.1: voice capture (record + Whisper transcription)
- v0.2: weekly / monthly review
- v0.3: `/plan` — produces tomorrow's scaffold from today's review
- v1.0: multiple LLM providers (OpenAI, Google), Obsidian community-store release
- v2.0: port to Tauri for a standalone app
