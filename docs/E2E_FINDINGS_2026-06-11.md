# E2E Test Findings — June 11, 2026

> **Status: ALL FINDINGS FIXED (same day).** E1 unique team names · E2 scenario compare shows feasible ARR + vs-goal gap · E3 staff-to-goal discloses tripped checks · F1 country delete auto-rebalances mixes · F2 reset on dashboard · F3 "Start blank" added. Re-run: 47 passed / 0 issues. Regression: smoke8–20 (188 tests) + workbook reconciliation all green. Harness: `tests/e2e_scenario.js`.

**Scenario:** "Meridian Software" — NYC B2B SaaS, $5M starting ARR, 24-month expansion plan (Jan 2027 start), goals $8M → $12.5M ending ARR, 90% GRR, 3% escalator, 10% expansion-of-book, backloaded seasonality, US + Canada footprint, NYC comp bands and burden.

**Method:** Simulated first-time user driving the real UI in jsdom (`tests/e2e_scenario.js`, requires jsdom). Full journey: boot → reset → Team Setup (FX, catalog, teams) → Model Drivers → auto-build → Plan Builder edits → Readiness → Dashboard → outputs → versions/undo → ledger → actuals import → JSON round-trip. Agents excluded by design.

**Result: 44 passed · 2 issues · 3 friction · 0 script errors.**

Final plan state: $15.7M GTM cost / 34 ending HC / $12.5M ending ARR (goal hit by solver+auto-build) / CAC 1.17.

## Issues to address

**E1 (med) — Duplicate team names allowed silently.** Created two teams both named "Resellers" with no warning. Rail entries, deterministic checks, exports and the board pack all become ambiguous. Fix: block or auto-suffix duplicates at creation/rename.

**E2 (med) — Scenario compare shows identical Revenue / Ending ARR across all three scenarios.** Targets are fixed by design; scenario multipliers move capacity, coverage and cost only. Correct mechanically, but the table renders three identical revenue columns, which reads as broken. Fix options: show scenario-feasible ARR (capacity-capped) in those columns, or drop/annotate them ("revenue is the plan; what moves is cost & coverage").

**E3 (med) — Auto-build trips the app's own checks.** Immediately after "Build the plan from drivers," the checks panel fires `[error] Hiring ahead of revenue support in 8 month(s)` and two `hiring while coverage ≥150%` warnings. The drafter optimizes goal attainment without consulting the readiness guardrails it will be judged against. Fix: have staff-to-goal respect (or at minimum report) guardrail violations in its confirm/summary.

## Friction to address

**F1 — Country deletion leaves a mix-repair scavenger hunt.** Deleting 3 countries broke location mix on 11 roles (comp silently underpriced until repaired — the validator catches it with error flags, which worked well). Repair required 11 separate per-role ⚖ clicks plus 18 expand clicks to reach them. Fix: "Rebalance all affected roles now" option in the delete-country confirm, or one global ⚖ beside the validator.

**F2 — Reset lives on the Agents page.** A new user starting over looks on the Dashboard. Move or duplicate "Reset model" near the sample-data banner / Export-Import cluster.

**F3 — No blank-slate start.** A new company must demolish the demo org team-by-team. Offer "Start empty" alongside "Reset to demo defaults."

## What passed (highlights)

Solver converged implied NB targets to within 2% of the ARR goals; the build-itself flow drafted 9 ramp-aware hires and reached the $12.5M goal feasibly; fullscreen grid edits recompute live; Conservative scenario correctly raises cost ($15.7M → $16.8M); all three exports (hiring CSV with req-level open-by dates, monthly budget CSV, board-pack HTML) download clean with no NaN; undo reverts exactly; version save/restore round-trips; ledger chip → tracked assumption → defendability brief works; generic actuals CSV import + variance + clear works; full model JSON export/import round-trips; zero uncaught script errors across the entire session.
