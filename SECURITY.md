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

## Reporting

Found a vulnerability? Open a GitHub issue (or a private security advisory if sensitive).
