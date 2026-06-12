# Contributing

## Ground rules

1. **`js/engine.js` stays pure.** No DOM, no fetch, no localStorage. All model math lives there and nowhere else.
2. **`node tests/verify.js` must always pass.** The engine's default model reconciles to a reference workbook to the cent ($9,812,091.60 total cost / 26 ending HC / $17,138,618.35 ending ARR / CAC 0.7472). If your change moves these numbers, it changed the math — either it's a bug or the reconciliation constants need a deliberate, explained update in your PR.
3. **Every schema change ships a migration.** `Engine.migrate()` must keep every previously exported model importable. Add your case there and a test.
4. **No build step.** Plain scripts, `file://` compatible, no frameworks, no bundlers. External network calls only to LLM providers the user configured.
5. **New behavior ships with tests.** Add to an existing suite in `tests/smoke/` or create a new one — the runner picks up any `tests/smoke/*.js` automatically.

## Dev loop

```bash
npm install          # jsdom, dev-only
npm test             # full battery — must be green before a PR
node --check js/app.js   # quick syntax gate after edits
```

The smoke suites drive the real UI in jsdom. Pattern: load `index.html`, eval the scripts, dispatch events, assert on DOM + localStorage. Copy the harness header from any existing suite.

## Architecture orientation

- `js/engine.js` — `compute(model)` returns everything; `defaultModel()` is the demo; team archetypes each have a compute function emitting a uniform interface.
- `js/app.js` — pages render from `computed`; all edits go through `data-path` inputs → `bindFields` → `recompute()` → scheduled re-render with focus preservation.
- `js/agents.js` — `PROVIDERS` (Anthropic native + OpenAI-compatible), `callLLM()` is the single gated entry; per-agent prompts in `AGENT_DEFS`; JSON output schemas are parsed by the UI, so change them in lockstep.
- `js/charts.js` — dependency-free SVG; add new chart types here.

## Good first contributions

New team archetypes, new deterministic checks, additional language/locale formatting, new export formats, board personas for other functions (legal, security), accessibility passes.
