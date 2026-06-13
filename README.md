# GTM Capacity Model

A zero-build, browser-based **go-to-market capacity & cost planning tool** with an AI review board. Plan headcount, cost, and revenue capacity across any horizon (12–36 months), then have AI personas interrogate the plan with CFO/COO/CRO/CHRO rigor before your real board does.

No server. No build step. No framework. Open `index.html` and plan.

## Why this exists

GTM capacity planning usually lives in a fragile spreadsheet: one owner, formulas nobody trusts, assumptions nobody challenged until the board meeting. This tool keeps the spreadsheet's rigor (the engine reconciles to a reference workbook to the cent) and adds what spreadsheets can't do well: teams as composable archetypes, ramp-and-attrition-aware hiring physics, deterministic over-hiring checks, an assumption ledger with owners and statuses, scenario diffing, board-ready outputs — and an AI board review.

## Quick start

1. Clone or download this repo.
2. Open `index.html` in a browser. That's it — everything persists to `localStorage`.
3. The app opens blank — a setup checklist on the dashboard walks you through the build. Hit **↺ Load demo data** to explore a fully populated example plan first.
4. Optional — enable the AI agents: **Agents tab → pick a provider → paste a key.**

## Bring your own LLM

The agent layer is provider-agnostic. Out of the box:

| Provider | Protocol | Web search | Notes |
|---|---|---|---|
| Anthropic (Claude) | native Messages API | ✓ | Full functionality incl. live comp & FX research |
| OpenAI | OpenAI-compatible | — | Board personas fully supported |
| OpenRouter | OpenAI-compatible | — | Any model on their catalog |
| Ollama | OpenAI-compatible | — | Local and free; no API key needed |
| Custom | OpenAI-compatible | — | Any endpoint speaking `/chat/completions` (Groq, Mistral, Together, …) |

Per-agent model overrides, editable system prompts, and hard daily call/spend caps are all on the Agents tab. The two research agents (comp bands, FX rates) need web search — on providers without it they still run, but return knowledge-based estimates explicitly marked low-confidence.

**Keys never leave your browser.** They're stored in `localStorage` and calls go directly from your machine to the provider. See [SECURITY.md](SECURITY.md).

## What's inside

- **Team Setup** — geography & FX (budget rates, employer burden per country), a role catalog with per-country pay bands and location mix, and teams built from archetypes (sales, prospecting, demand funnel, channel, retention, expansion, custom). Bulk CSV templates for everything: download prefilled, edit in Excel, re-import.
- **Model Drivers** — every company-level dial on one tab: starting ARR, ending-ARR goals with a solver that derives the implied new-business targets, revenue bridge with a waterfall chart (plan vs capacity-feasible vs goal), channel mix, expansion target, seasonality, hiring economics. **⚙ Build the plan** drafts ramp-aware hiring against the goal and tells you which checks the draft trips.
- **Plan Builder** — the org itself: teams with role lines, monthly hiring grids (Excel paste supported), live coverage flags.
- **Readiness** — guardrails (ARR/head, cost ceiling, payback), hiring-health gate, sensitivity tornado.
- **Ledger** — every assumption tracked with owner and status (PROPOSED / CHALLENGED / AGREED); AI challenges push straight in; exports a defendability brief.
- **Board Review** — four AI personas (MARGIN/CFO, FOREMAN/COO, QUOTA/CRO, BENCH/CHRO) receive the full live model and return verdicts and quantified challenges; CHAIR synthesizes. Every number they cite comes from your model.
- **Outputs** — req-level hiring plan CSV, monthly + FP&A long-format budget CSVs with FX exposure, a print-ready board pack with auto-written executive summary, plan-vs-actuals operating report (vendor-agnostic actuals import), and full model export/import as JSON.

## Architecture

```
index.html        app shell (all pages + modals)
js/engine.js      pure calculation engine — runs in browser AND Node, zero DOM. All model math lives here.
js/app.js         UI, state, localStorage, exports, ledger
js/agents.js      AI layer: personas, prompts, provider abstraction, spend caps
js/charts.js      dependency-free SVG charts (bars, lines, steps, tornado, waterfall) with hover tooltips
css/              design tokens + app styles
docs/             MODEL_SPEC (the math, source of truth), USER_GUIDE
tests/            verify.js (engine reconciliation) · smoke/ (UI suites) · e2e_scenario.js · run_all.js
```

Design rules that keep forks sane:

- **`engine.js` is pure.** No DOM, no fetch, no localStorage. It computes a full result object from a model object. If you change model math, change it here and only here, then run `node tests/verify.js`.
- **Teams are archetypes with a uniform interface.** Every team type emits the same shape (cost, headcount, capacity, demand, coverage, flags), so rollups, charts, checks and exports never special-case a team. Adding a new archetype = one compute function + one entry in the team library.
- **`migrate()` owns backward compatibility.** Every schema change ships with a migration so old exported models always import.
- **No build step is a feature.** Plain scripts, `file://` compatible. Keep it that way unless you have a very good reason.

## Tests

```bash
node tests/verify.js        # engine vs reference-workbook reconciliation (no dependencies)
npm install                  # installs jsdom (dev-only, for UI suites)
npm test                     # full battery: verify + smoke suites + E2E scenario
```

The E2E suite drives the real UI in jsdom as a simulated first-time user — boot → setup → drivers → auto-build → outputs → versions → actuals → JSON round-trip.

## Forking ideas

- New team archetypes (PLG funnel, services attach, usage-based expansion)
- A hosted backend for multi-user planning (keep `engine.js` untouched — it already runs in Node)
- HRIS/CRM actuals feeds (the actuals import is deliberately vendor-agnostic CSV)
- Additional board personas or localized comp-research prompts
- Your own design system — tokens live in `css/colors_and_type.css`

## License

[MIT](LICENSE)
