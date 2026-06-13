# GTM Capacity Model — User Guide

A planning tool that sizes your go-to-market org from a revenue target: how many people in each team and role, what they cost month-by-month across countries, how much pipeline each channel must produce, and when the business can actually support each hire. Everything recalculates live, every assumption can be put on trial, and an AI board review interrogates the result before your CFO does.

Open `index.html` in a desktop browser. No install, no server. Your work saves automatically to the browser; use **Versions** for named snapshots and **Export/Import** to share the model file with the team.

---

## 1. Before you touch anything: how the tool is organized

| Where | What it's for |
|---|---|
| **Dashboard** | One-page exec view. KPIs, cost vs revenue, headcount, CAC, scenario compare, actuals. |
| **1 · Team Setup** | Who you hire and what they cost: teams, roles, pay bands, location mix, FX. |
| **2 · Model Drivers** | Every company-level dial in one place: timeline, starting ARR, goals, commitments, channel mix, seasonality, hiring economics — plus the revenue bridge and the **Build the plan** button. |
| **3 · Plan Builder** | Purely the org: one team at a time, roles, monthly hiring, live sanity checks. A read-only driver strip keeps context. |
| **4 · Readiness** | The discipline. Guardrails, payback, sensitivity, months where hiring runs ahead of revenue. |
| **Ledger** | The paper trail. Who owns each assumption and whether the group has agreed it. |
| **Board Review** | The named board — **MARGIN** (CFO), **FOREMAN** (COO), **QUOTA** (CRO skeptic), **BENCH** (talent) — interrogates the plan; **CHAIR** synthesizes the verdict. |
| **Agents** | AI configuration: LLM provider (Anthropic, OpenAI, OpenRouter, Ollama, or any OpenAI-compatible endpoint), API key, per-agent models and prompts, daily spend caps. |

The nav numbers are the intended order: **set up the teams, set the dials, let the model build the first pass, then validate and adjust.** Drivers are company-level decisions and live only on the Model Drivers tab; team pages carry only that team's operating assumptions (productivity, conversions, spans, tooling).

A few global conveniences: **Undo** (Ctrl/Cmd+Z) covers the last 15 changes, including team removals and applied AI recommendations. **Versions** saves named runs locally — save one before any big what-if. The dashboard shows a **DEMO DATA** banner until someone dismisses it; don't present numbers while it's up.

**Reporting.** Hover any chart to read the exact numbers for that month or bar. The **board pack** opens with an auto-written executive summary and embeds the ARR waterfall, the spend-vs-revenue chart, the scenario table, governance status, and — if a board review has been run — the CHAIR synthesis. The **Budget (CSV)** button now downloads three files: the familiar monthly budget, an FP&A long-format file (`month, year, quarter, team, category, amount`: fixed comp, variable comp, one-time hiring, tooling, program — pivot-ready and reconciled to the engine total), and an FX exposure summary by country. Once actuals are imported, an **⤓ Operating report** button produces a print-ready plan-vs-actuals variance report with callouts (±5% amber, ±10% red).

The bridge has a **waterfall chart** (Model Drivers) — start → churn → escalator → new business → expansion → ending, with the goal as a dashed line; the gap is the conversation. The dashboard carries a **DEFENDABILITY** strip (error/warning/challenged counts); while any are open, the **board pack asks before exporting** — resolve them or export deliberately. Because everything lives in this browser, a **backup nudge** appears when the model hasn't been exported for 7+ days; one click exports the JSON.

**Runs travel as files.** Every saved run has a "⤓ File" button — download it, share it, archive it outside the browser. "⇪ Import run file" adds a teammate's run (or any exported model JSON) to your saved list without touching your current plan: the simplest way to collect scenarios from several people and diff them side by side.

**Compare runs** (Versions modal): pick any two saved runs (or a run vs the current plan) and get the deltas — KPIs side by side, exactly which drivers changed (old → new), and which teams moved in cost or headcount. This is the group-exercise tool: save "What it takes to hit $8M" and "What it takes to hit $12M" and put the diff on screen. A **setup checklist** appears on the dashboard for new (non-demo) models — five steps with live completion states that jump you to the right page; dismiss it once you know the flow. Hiring grids shade alternate **calendar quarters** so month columns stop blurring together at 24+ months.

More conveniences: **Shorthand entry** — currency fields accept `5M`, `750k`, `12.5m`, or `$1,250,000`. **Paste from Excel** — copy a row of cells and paste into any month of a hiring grid; values fill left-to-right from that month. **ⓘ The math** — every dashboard KPI and the revenue bridge have an ⓘ that shows exactly how the number is computed, with your live figures plugged in; use it when someone asks "where does that come from?"

**Bulk edit with templates** (Team Setup → BULK EDIT — TEMPLATES): download a CSV prefilled with your current data — Geography & FX, Roles & comp bands (a row per role × country), or Teams & hiring plan (a column per month) — edit it in Excel or Sheets, and re-import. Rows match on names: existing entries update, new ones are created, and the import report lists what changed and any rows it rejected (with the reason). Import the FX template before roles that reference new countries, and roles before teams that pay as them. One Undo reverts a whole import.

---

## 2. Five-minute quick start

1. **Team Setup → Geography & FX.** Confirm countries, exchange rates, and the per-country **employer burden %**. Field guides explain every column.
2. **Team Setup → Team Library.** Add the teams your org runs; each opens a **configurator** for name, manager role, and roles (recommended chips or your own).
3. **Team Setup → Role Catalog & My Teams.** The Catalog is the single source of role *names* and classification — renaming there updates every team safely. Pay lives in **My Teams**: expand a team, set bands and location mix per role (mix must total 100% — the model raises an error until it does), or ask **BANDS** (the comp-band research agent) at role, team, or all-teams level and apply cited market data. **TICKER** does the same for FX rates. Every agent run confirms first — who you're invoking, how many calls, and today's spend against your cap.
4. **Model Drivers.** Set the dials: start month, horizon, **Starting ARR**, **ending-ARR goals** (they auto-seed from trajectory — type the real ambition), seasonality, escalator, expansion target % of book, hiring economics, and the **channel mix** (agree it through the ledger). The **revenue bridge** shows who brings what and where the Δ is.
5. **⚙ Build the plan.** One click sets the implied new-business targets and drafts ramp-aware hiring across the revenue teams (respecting your max-starts-per-month driver), then drops you in the Builder. If the draft trips any deterministic checks (e.g. hiring ahead of revenue support), it tells you exactly which ones right there — trim early starts or accept the flags deliberately; one Undo reverts the whole draft.
6. **Plan Builder → validate.** One team at a time: adjust roles, move hires (use **⛶ Edit role full screen**), and read each team's live sanity check. The model drafted it; you make it yours.
7. **Readiness.** Work the flags until every AHEAD OF SUPPORT month has a story; run the sensitivity tornado.
8. **Board Review.** Run the skeptics, push challenges to the ledger, answer them, export the **defendability brief**.

---

## 3. How the model thinks (one paragraph)

It runs **top-down**. The revenue target (or the ending-ARR goal that derives it) splits across channels by the agreed mix; each channel's share ÷ win rate becomes the **pipeline that channel must generate**. Marketing, SDR and Partnerships size themselves against that demand through their own funnels. Customer Success auto-sizes to the ARR base; Account Management drives expansion on top of it, capped by the base. Hiring follows the plan you enter — the model never blocks a hire, but Readiness flags when you're hiring ahead of what revenue supports. Spend leads bookings by the sales-cycle lag, and every new hire ramps before they produce.

---

## 4. Mechanics worth understanding

- **Starting ARR is a model driver.** It sizes CSMs, caps expansion, feeds ARR-per-head readiness, and anchors the goal solver. It lives in Model Drivers, not on the CS team.
- **The Revenue Bridge is where the argument happens.** Per year: Start + New business (Sales) + Expansion (AM) + Escalator − Churn = Ending vs Goal, with the Δ in your face. Goals auto-seed from the current trajectory (badged SEEDED until someone types real ambition — a seeded goal is a conversation starter, not a commitment). When there's a gap, either Sales closes it (one-click implied targets) or the base picks it up (more AM capacity, better GRR, higher escalator) — the bridge shows exactly how much.
- **Plan vs Feasible.** The bridge shows two endings: **Ending (plan)** — what the targets demand — and **Feasible (staffed)** — what the org as currently staffed can actually produce, with bookings capped by sales capacity and expansion capped by AM capacity. When they diverge, the warning says it plainly: targets without hires are wishes.
- **Expansion target** (Model Driver): set "Expansion TARGET, % of book / yr" and AM commits to it like Sales commits to its target — the bridge books it, AM coverage flags the months the bench can't deliver, and "Build the plan" staffs AMs against it. At 0% (default), expansion stays capacity-driven, capped by the ceiling on the AM team. The target is the commitment; capacity is the proof.
- **Model Drivers are grouped by what they govern**: Timeline (horizon is a 12–36-month dropdown) · **Goals first** · Existing revenue (starting ARR, escalator, **gross retention**) · New business (targets, lag, seasonality) · Expansion (target % of book) · Hiring economics (agency fee × agency share, onboarding, time-to-fill, build guardrail) — then the bridge.
- **⚙ Draft the org for this goal** turns "what it takes to hit $X" into an actual plan: implied targets plus a drafted, ramp-aware hiring schedule across Sales, SDR, Marketing and Partnerships (you set a max-starts-per-month onboarding guardrail; default 3). The draft lands in the normal editable hiring plans and is one Undo away. Know the physics: with a 6-month ramp and a 6-month sales cycle, the first ~6–9 months are locked to your starting staff — no hiring spree can rescue an in-year goal that ignores ramp, and the tool will honestly leave those months SHORT rather than pretend.
- **Renewal escalator** (Model Drivers): baked-in COL/price uplift on the retained base, compounding monthly. Over a large base it's significant — 4% on $8M adds ~$800K over 24 months. Counts as revenue and NRR but consumes no sales capacity.
- **Channel ↔ team assignment** lives in the channel mix table: the "Generated by" picklist binds a channel to the team that must produce its pipeline. A channel with mix % and no team is an unfunded assumption (flagged).
- **Bookings seasonality** (Model Drivers): Even, Back-loaded (20/24/26/30 by quarter), or custom quarterly shares. Annual totals are preserved; the monthly shape moves — and with it pipeline requirements and coverage months.
- **Quota over-assignment policy** (Sales team): set it to 1.2–1.5× and Readiness flags months where capacity covers the target but not the buffer that absorbs rep misses and rep churn. At 1.0 it's silent.
- **One-time hire costs** (Model Drivers): agency fee (% of loaded comp) × **share of hires via agency** + flat onboarding/equipment per hire. The product is an *expected value* across all hires — referrals and direct sourcing dilute the fee (20% fee × 40% agency share = 8% average). Lands in the month of hire, flows into team costs, the budget export, and a per-req column on the hiring plan.
- **Scenario compare** (Dashboard): Base / Conservative / Aggressive side by side. Targets are the plan and don't move across scenarios — what moves is **feasible ARR** (what scenario-adjusted capacity actually supports), the **vs-goal gap**, cost, CAC, and months SHORT/AHEAD. If the gap goes red under Conservative, fix it before the CFO finds it.
- **Sensitivity** (Readiness): flexes the seven load-bearing assumptions both ways and ranks what actually moves the output you pick (ending ARR, revenue, cost, CAC). The longest bars are where ledger evidence matters most.
- **Plan vs Actuals** (Dashboard): import a CSV (`month, metric, value` — headcount, cost, bookings, revenue, arr) from any system, get an overlay chart and a variance table. Vendor-agnostic by design; a template is downloadable.
- **Sales-cycle lag** (default 6 months): pipeline created today books as revenue 6 months later. Early months always look expensive — spend leads bookings by design.
- **Ramp**: new hires reach full productivity over up to 6 months on an editable curve per role line. A rep hired in the final quarter contributes almost nothing in-window (the tool flags this).
- **Attrition is per role line** and rounds to whole heads each month — a 4-person team at 20%/yr shows zero monthly attrition because 0.07 heads don't resign. The %/yr in the hiring-plan header is the tell that it's still assumed; on bigger teams it materializes.
- **Integer deal counts**: opportunities, deals, SQLs and MQLs round up. Small changes (e.g. modest installed-base routing) can be absorbed by rounding in a given month — that's realistic, not a bug.
- **Comp is blended**: base × (1 + country burden) × locked FX budget rate + variable × planned attainment, weighted by location mix. Burden is set once per country in Geography & FX; attainment is a global default (90%) with rare per-band overrides behind a toggle.
- **FX budget rate** = MAX(spot, trailing-12-mo) × (1 + buffer). Locked for the cycle so daily currency moves never disturb the plan. The buffer deliberately prices foreign costs slightly high.
- **Installed-base pipeline demand** (optional, default 0%): the AM team can route a share of expansion pipeline through Marketing/SDR ("Expansion sourced by Marketing" + expansion win rate). At 0% the base is self-served and nothing moves.
- **Scenarios** (Base / Conservative / Aggressive) flex conversion, ramp, productivity and cost via the multiplier table behind "Show scenario levers".
- **Sales can't be removed.** The model is target-driven: the channel mix and ASP live on the Sales team, and capacity-vs-target is the core check. Rebuild it in place instead.

---

## 5. Definitions the review panel will ask about

### Definitions a CFO will ask about

These are the exact conventions the engine uses — quote them with confidence.

**Net-new ARR (not "revenue").** What the model adds each month: new-business bookings + expansion + renewal escalator. It is ARR *added*, not recognized (GAAP) revenue — recognized revenue lags as contracts are delivered. Every label in the app says net-new ARR for this reason.

**CAC ratio.** Cumulative **S&M cost only** (sales, prospecting, marketing, channel — CS and AM are deliberately excluded) ÷ cumulative **booked new-business ARR**. A clean new-business CAC: 0.75 means $0.75 of S&M buys $1.00 of new ARR. Expansion ARR is not in the denominator, so blended efficiency always looks better than this number — it's the conservative one.

**Payback.** Gross-margin-adjusted, per role: loaded annual cost ÷ (annual ARR output × gross margin), in months. Gross margin is an editable guardrail (default 80%). An AE quoted at 14 months pays back on *margin dollars*, not bookings — the convention a finance team expects.

**Churn.** Gross retention is applied as a monthly rate compounding on the full prior-month base, *including* in-year bookings. That's deliberately conservative versus annual-contract reality (new logos can't churn before first renewal). If your contracts are annual, true churn will land slightly better than planned.

**Escalator vs expansion.** Two different dollars: the escalator is price uplift on the *surviving* base (converted to an exact geometric monthly rate, so 3%/yr compounds to precisely 3%); expansion is AM-driven upsell, either capacity-derived or committed as a % of book. They never double-count.

**Two cost-efficiency lenses (Readiness page).** *GTM cost % of net-new ARR* — spend per dollar added; the guardrail ceiling applies here. *GTM cost % of run-rate revenue* — spend against the recognized-revenue proxy (ending ARR ÷ 12); this is the line that should trend down as the base compounds, and the one most CFOs reach for first.

### Definitions a COO will ask about

**Ramp.** Every role line carries a monthly ramp curve (editable; defaults per archetype, e.g. 6 months for sellers). A hire is **full cost from the start month** while output follows the curve — capacity = ramped-equivalent heads × productivity, so the cash-leads-output reality is built in, never assumed away.

**Attrition and backfill.** Annual attrition ÷ 12, applied to the prior-month bench, **rounded to whole people** — small teams legitimately show zero attrition until the base is big enough, and a hire never churns in their own start month. Leavers are assumed tenured (recent cohorts keep their full ramp deficit), so capacity loss is immediate and complete. The model **never auto-backfills**: net growth is exactly your hires minus attrition, and the checks flag teams draining without replacement.

**Managers.** Auto-added per team at ⌈ICs ÷ span⌉, priced at their own rate-card role. They are pure overhead — no quota, no capacity — which is why thin spans show up as cost without output.

**Hiring physics.** Hire months are **start months**; the requisition must open time-to-fill days earlier (the hiring-plan CSV computes the open-by date for every req). One-time costs — recruiting % × agency share + onboarding — land in the start month. The max-starts-per-month driver constrains the auto-drafter; manual plans beyond it surface through the checks rather than being blocked.

### Definitions a CRO will ask about

**Targets vs bookings (the lag).** Monthly new-business targets are **sales-effort plans**. Bookings land `sales-cycle lag` months after the effort month: the first lag months of the plan book nothing, and effort in the final lag months remains in-flight — generated but uncredited — at the horizon. The goal solver accounts for this when deriving implied targets from ending-ARR goals, so goals still reconcile.

**Productivity vs quota.** Enter **expected attained production** per fully-ramped rep — not assigned quota. Variable comp is costed at the attainment guardrail (default 90% of OTE). Quota over-assignment lives in one explicit place: the coverage policy dial on the Sales team.

**Channel and funnel math.** Each channel must generate pipeline = its share of target ÷ its win rate; deals = revenue ÷ ASP, rounded up to whole deals. Funnel teams chain backwards — MQL → SQL → opportunity — with stage conversions rounded up at every step, plus any installed-base expansion pipeline you route through marketing.

**Seasonality.** Quarterly weights (even, back-loaded 20/24/26/30, or custom), spread evenly across the three months of each quarter.

**Coverage.** Capacity ÷ same-month target, per team per month. SHORT flags mark the months where the staffed bench cannot generate the plan — and through the lag, a SHORT effort month surfaces as missed bookings months later.

### Definitions a CHRO will ask about

**Loaded cost.** Base × (1 + country employer burden) + OTE × attainment, blended across the role's location mix at locked FX budget rates (max(spot, trailing) × (1 + buffer)). Burden applies to **base only** — matching the source workbook — so if your jurisdictions levy payroll taxes on commissions too, set burden slightly higher to compensate.

**Location mix.** Every role's country mix must total 100% (the validator raises an error otherwise, and country deletion auto-rebalances). The blended rate is therefore an honest weighted price of where the role actually sits, not a single-site guess.

**Cost from day one.** People are paid from their start month; productivity ramps. Combined with one-time hiring costs in the start month, a hiring wave's true cash profile is visible before its output is.

**Attrition.** Same convention as the COO section: whole-person, monthly, on the prior-month bench, never auto-backfilled — what you see in net adds is what the plan actually delivers.

## 6. Working as a group

- **The ledger chips** (the small `+` beside numbers) are how the plan becomes defendable. Click one → assign an **owner tag** (set once, picked from existing tags) → the group debates in the comment trail → status moves PROPOSED → CHALLENGED → AGREED.
- The Ledger page groups by owner tag, filters by status/owner, and counts what's still open. A plan ships when everything material reads AGREED.
- **Export defendability brief** produces the board-ready markdown: the ask, the teams, the guardrails, every open flag, and the full assumption trail.
- **Versions** = named local snapshots (capped at 25). Save before working sessions and big what-ifs; opening an old run keeps your current state one Undo away.
- Sharing across machines is Export/Import of the model JSON for now (a hosted multi-user backend is the planned next phase).

---

## 7. The AI layer

- **Board Review**: CFO, COO, CRO Skeptic, and CHRO each receive the entire live model — inputs, computed results, deterministic flags, and your ledger — and return a verdict plus specific, quantified challenges. Push any challenge into the ledger as CHALLENGED for the owning team to answer. A Chief-of-Staff synthesis consolidates the four into a board-readiness call.
- **Research agents** (Rates & FX): comp-band research per role × country and FX rate research, both with web search and cited sources, both apply-with-one-click. Treat them as market research, not your comp philosophy.
- **Agents tab**: pick your **LLM provider** — Anthropic (Claude), OpenAI, OpenRouter, a local Ollama (free, no key), or any custom OpenAI-compatible endpoint — set the base URL, key (stored only in this browser) and a default model — Anthropic and OpenAI show their full model catalog as a dropdown (with a Custom… option for new releases); open catalogs like OpenRouter and Ollama take free text. Each agent can override the model the same way (blank = provider default). Prompts are fully editable; **hard daily caps** on calls and estimated spend stop runaway costs with a clear message. The page recommends caps sized to your model (roles × sites + board runs, padded). One capability note: **live web search only exists on the Anthropic provider** — on others, BANDS and TICKER still run but return knowledge-based estimates marked LOW confidence; verify before applying. The board personas work fully everywhere.

---

## 7½. Outputs — fueling the next step

On the Dashboard, under the KPIs:

- **Hiring plan (CSV)** — every planned hire as a req: team, role, start month, **open-req-by date** (backed off by the time-to-fill driver), loaded cost, location mix, ramp. Hand it to recruiting / load it into the ATS. Expected attrition is noted but backfills aren't pre-listed as reqs — open those on trigger.
- **Budget (CSV)** — monthly cost by team and category (IC comp, manager comp, tooling, program/MDF) plus revenue lines (booked, expansion, built-in growth) and ending ARR. Built for FP&A's spreadsheet.
- **Board pack (HTML)** — a print-ready single page: KPIs, the revenue bridge, investment by team per year, readiness verdicts, and assumption-governance status. Open and print to PDF.
- **Defendability brief** (Ledger page) — the full assumption trail with owners, statuses and discussion.

## 8. How to do common things

**Change the revenue target.** Plan Builder → Model Drivers. Or set an ending-ARR goal and click "Use implied targets".

**Add a team.** Rates & FX → Team Library (preferred — opens the configurator), or "+ Add team" in the Plan Builder rail.

**Add a role to a team.** Team configurator (Rates & FX → Configure team): recommended chips, the library picklist, or create new. New roles clone bands from a sensible sibling and land in the Role Library.

**Split a role** (e.g. Enterprise vs Mid-Market AE). Plan Builder → team → "+ Add a role to this team", set its own productivity, attrition, ramp and hires.

**Enter a hiring plan without scroll pain.** "⛶ Edit role full screen" — assumptions on top, year-by-year months below, live attrition/ending/ramped rows.

**Add a country.** Geography & FX → "+ Add country" (rate, buffer, burden), then attach it only to the roles that hire there and rebalance their mix (the ⚖ button does the arithmetic).

**Remove a country.** Geography & FX → ✕ on the row. Pay bands there are deleted and every affected role's location mix **rebalances automatically** across its remaining countries — no per-role cleanup needed.

**Run a scenario.** Scenario dropdown in the nav. Edit the multipliers under "Show scenario levers" if your Conservative isn't ours.

**Save / compare runs.** Versions → name it → Save. Open an old run any time; Undo returns you.

**Start blank.** Dashboard → "○ Start blank": empty model (no teams, no roles, US-only geography, zeroed goals) — build your org from Team Setup up. Undo brings the previous state back.

**Load the demo / start over.** Dashboard → "↺ Load demo data" swaps in the sample plan (banner and all); "○ Start blank" returns you to a clean model. A fresh install opens blank.

**Team names are unique.** Naming a team the same as an existing one auto-suffixes ("Sales 2") so rails, checks and exports stay unambiguous.

---

## 9. Notes & caveats

- **Demo data**: a fresh model is the reference workbook's sample plan ($6M/$9M targets, $8M base, 26 ending heads). The dashboard banner stays until you dismiss it — do that only when the numbers are yours.
- **Persistence is per-browser.** Export regularly if the machine is shared. Versions live in the same browser storage.
- **Board Review results aren't saved** across refreshes — push the challenges you care about into the ledger, which is.
- **Desktop tool.** Month grids are unusable on phones by design honesty, not accident.
- **The engine is verified.** `node tests/verify.js` reconciles the default model against the source workbook to the cent. If you fork the logic, keep that passing.

*Spotted something this guide doesn't answer? Add it — this document is meant to grow with the tool.*
