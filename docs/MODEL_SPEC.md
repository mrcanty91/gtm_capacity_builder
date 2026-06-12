# GTM Capacity Model — Engine Specification
Extracted 1:1 from `GTM_Capacity_Model.xlsx` (Jun 2026). This is the source of truth the web engine replicates, generalized so teams can be added/removed and the horizon changed without breaking the model.

## 1. Global config
| Input | Excel ref | Default |
|---|---|---|
| Start month | Config!D6 | 2026-07 |
| Horizon (months) | Config!D7 | 24 (web: 12–60, configurable) |
| Reporting currency | Config!D8 | USD |
| Scenario | Config!D9 | Base / Conservative / Aggressive |
| Sales-cycle lag (months) | Config!D10 | 6 |
| Year-1 new-business target | Config!D13 | $6,000,000 |
| Year-2 target | Config!D14 | $9,000,000 |
| Distribution | Config!D15 | Even within year (monthly target = annual/12) |

Scenario multipliers (editable table): rows {Base: 1,1,1,1; Conservative: conv .85, ramp .85, prod .95, cost 1.05; Aggressive: conv 1.15, ramp 1.1, prod 1.1, cost 1.0}. Applied as: `convX` multiplies conversion/win rates, `prodX` multiplies productivity capacity, `costX` multiplies blended comp rates. (`rampX` defined but ramp curve itself is the editable lever.)

## 2. Geography & FX
Budget Rate per currency = `MAX(spot, trailing12moAvg) × (1 + prudencyBuffer)`.
Defaults: USD 1/1/0%; CAD .7196/.7154/3%; GBP 1.3342/1.3169/3%; PLN .2712/.2659/4%; INR .0104/.0115/5%.
All non-USD comp converts at Budget Rate. Countries are user-extensible.

## 3. Rate Card
Per role × country: base salary (local), burden %, OTE variable (local), planned attainment % (default 0.9).
- `loadedBase = base × (1+burden) × budgetRate`
- `variable = OTE × attainment × budgetRate`
- `fullyLoaded = loadedBase + variable`

Location mix per role (shares sum to 1). **Blended rate** = Σ(mix_c × fullyLoaded_c) × scenario costX. Departments charge blended rate / 12 per head per month.

Default roles & US base / burden / OTE / blended result (Base scenario):
AE 180k/.25/180k → $325,808; Senior AE → $442,466; Sales Mgr 243k/.25/178.2k → $399,850; SDR 77.4k/.25/32.25k → $62,071; SDR Mgr → $153,533; DG Specialist 121.5k/.25/16.2k → $87,562; Mktg Mgr → $184,611; Partner Mgr 171.6k/.25/128.7k → $270,423; Partnerships Lead → $303,212; CSM 146k/.25/43.8k → $146,966; CS Mgr → $226,600; AM 144k/.25/96k → $185,860.
(Full per-country bands in the workbook dump `xl_dump/Rate_Card.txt`.)

## 4. Headcount mechanics (shared by all hire-planned teams)
Monthly arrays, month index m = 0..H-1. Inputs: `start` (heads at m=-1), `hires[m]`, `annualAttrition` (default 20%).
- `monthlyAttr = annualAttrition / 12`
- `attrition[m] = ROUND(ending[m-1] × monthlyAttr, 0)` (ending[-1] = start)
- `ending[m] = ending[m-1] + hires[m] − attrition[m]`
- **Ramp** (curve r[0..5], % of full productivity in months 1–6 after start; default Sales/Partnerships/AM-style `[0,.1,.25,.45,.7,.9]`, SDR `[0,.35,.7,.9,1,1]`, AM `[0,.15,.35,.6,.85,1]`, fully ramped ≥ month 7):
  `ramped[m] = ending[m] − Σ_{k=0..5} hires[m−k] × (1 − r[k])`
- Managers: `ceil(ending / span)`, charged at manager blended rate. Tooling: `ending × perSeatAnnual/12 + fixedMonthly`.
- Team cost = IC comp + manager comp + tooling (+ program spend where applicable).

Marketing exception: no ramp; the Excel models a 3-month new-hire pipeline cosmetically but specialists count fully from start (capacity = ending × MQLs/specialist × prodX).

## 5. Top-down revenue → pipeline (Sales Capacity)
- `monthlyTarget[m] = yearTarget(m) / 12`
- AE productivity: annual full productivity/AE (default $1.8M) → monthly = /12. `capacity[m] = rampedAEs[m] × monthlyProd × prodX`. Coverage = capacity/target; flag SHORT if <1.
- Required AEs guide = `ceil(target / (monthlyProd × prodX))`.
- Channel mix (default Marketing 66%/win 18%, Outbound 20%/12%, Partnership 14%/28%; sums to 100%):
  - `channelRevReq[m] = target[m] × mix`
  - `channelPipelineReq[m] = channelRevReq / (winRate × convX)`
  - `dealsReq[m] = ceil(channelRevReq / ASP)` (ASP default $500k)
- Sales mgr span default 6; tooling $3k/seat/yr.

## 6. SDR-BDR
Demand = Outbound opps + share of Marketing opps:
- `outboundOppsReq[m] = ceil(outboundPipelineReq / ASP)`
- `inboundOppsViaSDR[m] = ceil(marketingOppsReq × %workedBySDR)` (default 70%)
- Capacity = rampedSDRs × opps/SDR/mo (default 10) × prodX. Coverage flag vs total demand.
- `SQLs required = demand / SQL→Opp%` (default 40%). Tooling $2k/seat. Span 6.

## 7. Marketing
- `oppsReq[m] = ceil(mktgPipelineReq / ASP)`
- `SQLsReq = ceil(oppsReq / (SQL→Opp% × convX))` (default 50%)
- `MQLsReq = ceil(SQLsReq / (MQL→SQL% × convX))` (default 35%)
- Capacity = specialists × MQLs/specialist (default 60) × prodX.
- Program/ad spend = MQLsReq × costPerMQL (default $1,000). Martech fixed $5k/mo; tooling $3k/seat; span 5.

## 8. Partnerships
Partner types (mix/ticket/close): Referral .4/$350k/.3; Reseller .3/$300k/.25; Tech-ISV .2/$450k/.2; SI-Agency .1/$500k/.18.
- `oppsReq[m] = ceil(pipelineReq × Σ(mix/ticket))`
- `wonDeals[m] = ceil(pipelineReq × Σ(mix×close/ticket))`
- `sourcedRevenue[m] = pipelineReq × Σ(mix×close)`
- Capacity = rampedPMs × opps/PM/mo (default 8) × prodX. MDF = 5% of sourced rev. Span 5; tooling $3k.

## 9. Customer Success (retention)
- `newARRBooked[m] = m ≥ lag ? salesTarget[m−lag] : 0` (lag-adjusted bookings; Excel uses the target row, i.e. plan-of-record bookings)
- `churn[m] = endingARR[m−1] × (1−grossRetention)/12` (GRR default 90%)
- `endingARR[m] = prev + newARR + expansion[m] − churn[m]`; start base default $8M.
- `CSMsReq = ceil(endingARR / ARRperCSM)` (default $4M). CS heads = CSMs + ceil(CSMs/span 6). No hire plan — sized automatically. Tooling $2.5k/seat + $2k/mo platform.
- Monthly NRR = (prevARR − churn + expansion)/prevARR.

## 10. Account Management (expansion)
- Hire-planned with ramp + attrition like Sales.
- `expansionCapacity[m] = rampedAMs × (annualQuota/12) × prodX` (quota default $750k)
- `maxExpansion[m] = prevEndingARR × maxAnnual%/12` (default 15%)
- `expansionRevenue[m] = MIN(capacity, max)` → feeds CS base. Span 6; tooling $2.5k.

## 11. GTM Summary
Sums per-team cost, headcount (ICs + managers per team), hires. Revenue = lag-adjusted bookings + expansion.
- New-business S&M cost = Sales + SDR + Marketing + Partnerships (excl. CS/AM).
- `CAC ratio = cumulative S&M / cumulative new-business booked`
- `GTM cost % of revenue = totalCost / totalRevenue`
- `Cost per new deal = totalCost / Σ channel dealsReq`

## 12. Role Readiness (guardrails — advisory)
Inputs: gross margin % (default 80%), target payback months (18), ARR-per-GTM-head floor ($400k), GTM-cost-%-of-revenue ceiling (60%).
- **Self-funding** per revenue role: `payback = 12 × loadedCost / (outputARR × GM%)`; verdict Self-funding if ≤ target. Output ARR: AE = annual productivity; SDR = opps/mo×12×outboundWin×ASP (attributed); AM = expansion quota; PM = opps/mo×12×blendedClose×blendedTicket (attributed).
- **Monthly hiring health**: in any month with hires>0, flag `AHEAD OF SUPPORT` unless `ARR/GTMhead ≥ floor AND GTMcost% ≤ ceiling`.

## 13. Verified totals (Base scenario, defaults — reconciliation targets)
- 24-mo GTM run-cost: **$9,812,091.60**
- 24-mo total revenue: **$11,250,000** (booked $10.5M + expansion $750k)
- Ending GTM headcount: **26**
- New-business CAC: **0.75**
- Ending ARR base: **$17,138,618.35**
- Sales 24-mo cost $4,732,040.77; SDR $499,280.50; Marketing $1,366,344.30; Partnerships $1,248,145.83; CS $1,447,817.59; AM $518,462.61.

## 14. Web generalization rules
- Teams are instances of archetypes: `pipeline-channel` (Partnerships-like), `demand-funnel` (Marketing), `prospecting` (SDR), `sales-engine` (AE, singleton driver), `retention` (CS), `expansion` (AM), `custom-cost` (generic hire-planned cost team). Each emits the standard interface {headcount, hires, attrition, cost, capacity, demand, coverage} so rollups never break on add/remove.
- Channel mix rows are dynamic; deleting a team re-normalizes prompts (validation requires mix Σ=100%).
- Horizon is variable; year targets become an array of annual targets prorated monthly.
