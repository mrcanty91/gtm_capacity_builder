# Security notes

**This is a local-first tool.** There is no server, no telemetry, and no data leaves your machine except the LLM API calls you explicitly trigger.

## API keys

- Keys are stored in browser `localStorage` under `ro_capacity_settings`, scoped to the page origin. Anyone with access to your browser profile (or any script running on the same origin) can read them. Don't use this on shared machines with keys you care about, and prefer keys with spend limits set provider-side.
- Calls go **directly from your browser to the provider**. For Anthropic this uses the `anthropic-dangerous-direct-browser-access` header — the "dangerous" part is exactly the above: the key lives client-side. That is the deliberate trade-off of a serverless tool.
- The app enforces its own daily call-count and estimated-spend caps (Agents tab), but treat the provider-side spend limit as the real guardrail.

## Your planning data

- The model (comp bands, hiring plans, revenue goals) lives in `localStorage` and in any JSON/CSV files you export. Treat exports as confidential — they contain compensation data.
- The `.gitignore` excludes `*.xlsx` and exported model JSONs so real plans don't end up in commits. Check before you push.

## When agents see your data

Running a board persona or research agent sends the full model brief (assumptions, comp rates, results, ledger) to your chosen LLM provider. If that's not acceptable for your data, use a local provider (Ollama) or don't enable agents — the entire planning tool works without them.

## Hosted instances and GitHub Pages

`localStorage` (and therefore your API key) is scoped to the page's *origin*. Two consequences if you use a hosted copy instead of opening `index.html` locally: (1) on GitHub Pages, **all of an account's project pages share one origin** (e.g. `username.github.io`), so any other page hosted under the same account could read this app's stored key — only enable Pages on an account that hosts nothing else, or don't store a key on the hosted copy; (2) entering your key on *someone else's* hosted instance means trusting whoever controls that deployment, since they can change the JavaScript at any time. The safest pattern stays the simplest: run the file locally, or fork and host it yourself.

## Custom LLM endpoints

The Agents tab lets you point the app at any OpenAI-compatible base URL. Understand what that means: **the app will send your API key (as a Bearer token) and your full model brief to whatever URL is configured.** Only use endpoints you control or trust; never paste a base URL from a tutorial or message you haven't verified. The same applies to per-agent prompt edits sourced from strangers — prompts shape what the model is asked to do with your data.

## Spreadsheet exports

CSV exports neutralize formula injection (cells beginning with `=`, `+`, `@`, or a non-numeric `-` get an apostrophe prefix), because names inside shared run/model files are attacker-controllable. Still treat spreadsheets from untrusted run files with normal caution.

## External requests the app makes

Exactly two kinds: Google Fonts (CSS + font files at page load — discloses your IP to Google; the app works offline on system fonts if blocked) and the LLM provider you configure (only when you run an agent). Nothing else, ever.

## Reporting

Found a vulnerability? Open a GitHub issue (or a private security advisory if sensitive).
