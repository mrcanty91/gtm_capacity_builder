/* =============================================================================
   RENEGADE OPS — GTM Capacity Engine
   Replicates GTM_Capacity_Model.xlsx (see docs/MODEL_SPEC.md), generalized:
   - arbitrary horizon (12–60 months)
   - teams are archetype instances; add/remove without breaking rollups
   - each team contains ROLE LINES (e.g. Enterprise AE, Mid-Market AE), each with
     its own rate-card role, productivity, hiring plan, attrition and ramp.
   Runs in browser (global `Engine`) and Node (module.exports) for testing.
   ============================================================================= */
(function (root) {
  'use strict';

  // ---------- helpers ----------
  const sum = a => a.reduce((s, v) => s + v, 0);
  const zeros = n => new Array(n).fill(0);
  const ceil = Math.ceil;
  const padTo = (arr, n) => { const a = (arr || []).slice(0, n); while (a.length < n) a.push(0); return a; };

  // productivity key per archetype (lives on each role line; annual$ for sales/expansion)
  const PROD_KEY = {
    sales: 'annualProdPerRep', prospecting: 'oppsPerRepMo', 'demand-funnel': 'mqlsPerSpecialist',
    'pipeline-channel': 'oppsPerRepMo', expansion: 'quotaAnnual', custom: 'unitsPerRepMo'
  };
  const PROD_LABEL = {
    sales: 'Annual productivity $', prospecting: 'Opps / month', 'demand-funnel': 'MQLs / month',
    'pipeline-channel': 'Opps / month', expansion: 'Expansion quota $/yr', custom: 'Units / month'
  };
  // kind/dept metadata for the default role set (drives dependent picklists in the UI)
  const KNOWN_ROLE_META = {
    'Account Executive': ['ic', 'sales'], 'Senior AE': ['ic', 'sales'], 'Sales Manager': ['manager', 'sales'],
    'SDR': ['ic', 'prospecting'], 'SDR Manager': ['manager', 'prospecting'],
    'Demand Gen Specialist': ['ic', 'demand-funnel'], 'Marketing Manager': ['manager', 'demand-funnel'],
    'Partner Manager': ['ic', 'pipeline-channel'], 'Partnerships Lead': ['manager', 'pipeline-channel'],
    'Customer Success Manager': ['ic', 'retention'], 'CS Manager': ['manager', 'retention'],
    'Account Manager': ['ic', 'expansion']
  };

  const DEFAULT_RAMP = {
    sales: [0, 0.1, 0.25, 0.45, 0.7, 0.9], prospecting: [0, 0.35, 0.7, 0.9, 1, 1],
    'pipeline-channel': [0, 0.1, 0.25, 0.45, 0.7, 0.9], expansion: [0, 0.15, 0.35, 0.6, 0.85, 1],
    'demand-funnel': null, custom: null // null = productive on hire
  };

  function monthLabels(startMonth, horizon) {
    const [y0, m0] = startMonth.split('-').map(Number);
    const out = [];
    for (let i = 0; i < horizon; i++) {
      const m = (m0 - 1 + i) % 12, y = y0 + Math.floor((m0 - 1 + i) / 12);
      out.push(`${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m]} ${String(y).slice(2)}`);
    }
    return out;
  }

  // ---------- migration: single-role teams -> role lines ----------
  function migrate(model) {
    // burden moved from role bands to country level (Geography & FX)
    (model.fx || []).forEach(f => {
      if (f.burden == null) {
        let found = null;
        ((model.rateCard || {}).roles || []).some(r => {
          const b = (r.bands || {})[f.country];
          if (b && b.burden != null) { found = b.burden; return true; }
          return false;
        });
        f.burden = found != null ? found : 0.2;
      }
    });
    if (model.rateCard && model.rateCard.defaultAttain == null) model.rateCard.defaultAttain = 0.9;
    if (model.config && model.config.startingARR == null) {
      const cs = (model.teams || []).find(t => t.type === 'retention');
      model.config.startingARR = cs && cs.startingARR != null ? cs.startingARR : 0;
    }
    if (model.config && !Array.isArray(model.config.arrGoals)) model.config.arrGoals = [];
    if (model.config && model.config.renewalEscalator == null) model.config.renewalEscalator = 0;
    if (model.config && model.config.timeToFillDays == null) model.config.timeToFillDays = 60;
    if (model.config && model.config.recruitingPct == null) model.config.recruitingPct = 0;
    if (model.config && model.config.onboardingPerHire == null) model.config.onboardingPerHire = 0;
    if (model.config && !model.config.seasonality) model.config.seasonality = { mode: 'even', q: [0.25, 0.25, 0.25, 0.25] };
    if (model.config && model.config.expTargetPct == null) {
      const amT = (model.teams || []).find(t => t.type === 'expansion');
      model.config.expTargetPct = amT && amT.expTargetPct != null ? amT.expTargetPct : 0;
    }
    if (model.config && model.config.maxStartsPerMonth == null) model.config.maxStartsPerMonth = 3;
    if (model.config && model.config.grossRetention == null) {
      const csT = (model.teams || []).find(t => t.type === 'retention');
      model.config.grossRetention = csT && csT.grossRetention != null ? csT.grossRetention : 0.9;
    }
    if (model.config && model.config.agencyHirePct == null) model.config.agencyHirePct = 1;
    ((model.rateCard || {}).roles || []).forEach(r => {
      if (!r.kind) {
        const m = KNOWN_ROLE_META[r.name];
        r.kind = m ? m[0] : 'ic';
        if (m && r.dept == null) r.dept = m[1];
      }
    });
    (model.teams || []).forEach(t => {
      t.enabled = true; // disable-team feature removed
      if (t.type === 'expansion') {
        if (t.mktSourcedPct == null) t.mktSourcedPct = 0;
        if (t.expWinRate == null) t.expWinRate = 0.25;
        if (t.expTargetPct == null) t.expTargetPct = 0;
      }
      if (t.type === 'sales' && t.targetCoverage == null) t.targetCoverage = 1.0;
      if (t.type === 'retention') return;
      if (!Array.isArray(t.roles) || !t.roles.length) {
        const pk = PROD_KEY[t.type];
        const line = {
          id: 'r-' + (t.id || Math.random().toString(36).slice(2, 7)),
          name: t.roleIC || 'Role', rateRole: t.roleIC || '',
          start: t.start || 0, hires: (t.hires || []).slice(),
          annualAttrition: t.annualAttrition != null ? t.annualAttrition : 0.2
        };
        if (t.ramp) line.ramp = t.ramp.slice();
        if (pk && t[pk] != null) line[pk] = t[pk];
        t.roles = [line];
      }
    });
    return model;
  }

  // ---------- FX & rate card ----------
  function budgetRate(fxRow) { return Math.max(fxRow.spot, fxRow.trailing) * (1 + fxRow.buffer); }

  function blendedRates(model) {
    const costX = activeMultipliers(model).cost;
    const fxByCountry = {};
    model.fx.forEach(r => { fxByCountry[r.country] = budgetRate(r); });
    const out = {};
    model.rateCard.roles.forEach(role => {
      let blended = 0;
      Object.entries(role.mix || {}).forEach(([country, share]) => {
        const band = role.bands[country];
        if (!band || !share) return;
        const fxRow = model.fx.find(f => f.country === country);
        if (!fxRow) return; // country removed from Geography & FX — ghost bands never price
        const rate = fxByCountry[country];
        const burden = fxRow.burden != null ? fxRow.burden : (band.burden != null ? band.burden : 0.2);
        const attain = band.attain != null ? band.attain : (model.rateCard.defaultAttain != null ? model.rateCard.defaultAttain : 0.9);
        blended += share * (band.base * (1 + burden) * rate + (band.ote || 0) * attain * rate);
      });
      out[role.name] = blended * costX;
    });
    return out;
  }

  // like blendedRates, but split into fixed (base × (1+burden)) vs variable (OTE × attain)
  // components, per role — lets exports show comp mix without re-deriving FX/burden logic
  function blendedRateParts(model) {
    const costX = activeMultipliers(model).cost;
    const fxByCountry = {};
    model.fx.forEach(r => { fxByCountry[r.country] = budgetRate(r); });
    const out = {};
    model.rateCard.roles.forEach(role => {
      let fixed = 0, variable = 0;
      const byCountry = {};
      Object.entries(role.mix || {}).forEach(([country, share]) => {
        const band = role.bands[country];
        if (!band || !share) return;
        const fxRow = model.fx.find(f => f.country === country);
        if (!fxRow) return;
        const rate = fxByCountry[country];
        const burden = fxRow.burden != null ? fxRow.burden : (band.burden != null ? band.burden : 0.2);
        const attain = band.attain != null ? band.attain : (model.rateCard.defaultAttain != null ? model.rateCard.defaultAttain : 0.9);
        const f = share * band.base * (1 + burden) * rate;
        const v = share * (band.ote || 0) * attain * rate;
        fixed += f; variable += v;
        byCountry[country] = (f + v) * costX;
      });
      out[role.name] = { fixed: fixed * costX, variable: variable * costX, byCountry };
    });
    return out;
  }

  function activeMultipliers(model) {
    return model.config.scenarios[model.config.scenario] || { conv: 1, ramp: 1, prod: 1, cost: 1 };
  }

  // ---------- shared headcount mechanics ----------
  function headcountSeries(start, hires, annualAttrition, H) {
    const monthlyAttr = (annualAttrition || 0) / 12;
    const ending = zeros(H), attrition = zeros(H);
    let prev = start || 0;
    for (let m = 0; m < H; m++) {
      attrition[m] = Math.round(prev * monthlyAttr);
      ending[m] = prev + (hires[m] || 0) - attrition[m];
      prev = ending[m];
    }
    return { ending, attrition };
  }

  function rampedSeries(ending, hires, rampCurve, H) {
    const r = rampCurve && rampCurve.length ? rampCurve : [1, 1, 1, 1, 1, 1];
    const ramped = zeros(H);
    for (let m = 0; m < H; m++) {
      let unproductive = 0;
      for (let k = 0; k < r.length; k++) {
        const hm = m - k;
        if (hm >= 0) unproductive += (hires[hm] || 0) * (1 - Math.min(1, r[k]));
      }
      // floor at 0: heavy attrition during a hiring wave could otherwise push the
      // ramp deficit past the remaining bench and produce negative capacity.
      // Convention: leavers are assumed tenured — recent cohorts keep their full
      // ramp deficit — so capacity loss from attrition is immediate and complete.
      ramped[m] = Math.max(0, ending[m] - unproductive);
    }
    return ramped;
  }

  function managerSeries(ending, span) { return ending.map(e => e > 0 ? ceil(e / Math.max(1, span || 1)) : 0); }
  function compCost(headSeries, blendedAnnual) { return headSeries.map(h => h * blendedAnnual / 12); }
  function toolingCost(ending, perSeatAnnual, fixedMonthly, H) {
    return zeros(H).map((_, m) => ending[m] * (perSeatAnnual || 0) / 12 + (fixedMonthly || 0));
  }

  // ---------- role-line aggregation ----------
  // Computes every line's headcount/ramp/comp and the team aggregate.
  // prodCapacity = Σ ramped × line productivity (caller scales: /12 for annual$, × prodX)
  function computeLines(team, H, rates, oneTime) {
    const ot = oneTime || { pct: 0, flat: 0 };
    const pk = PROD_KEY[team.type];
    const lines = (team.roles || []).map(l => {
      const hires = padTo(l.hires, H);
      const { ending, attrition } = headcountSeries(l.start, hires, l.annualAttrition, H);
      const ramped = rampedSeries(ending, hires, l.ramp || DEFAULT_RAMP[team.type] || null, H);
      const prod = l[pk] != null ? l[pk] : (team[pk] || 0);
      const comp = compCost(ending, rates[l.rateRole] || 0);
      return { id: l.id, name: l.name, rateRole: l.rateRole, prod, hires, ending, attrition, ramped, comp, annualAttrition: l.annualAttrition };
    });
    const agg = { hires: zeros(H), ics: zeros(H), attrition: zeros(H), icComp: zeros(H), prodCapacity: zeros(H), hireCost: zeros(H) };
    lines.forEach(l => {
      const perHire = (rates[l.rateRole] || 0) * (ot.pct || 0) + (ot.flat || 0);
      for (let m = 0; m < H; m++) {
        agg.hires[m] += l.hires[m]; agg.ics[m] += l.ending[m]; agg.attrition[m] += l.attrition[m];
        agg.icComp[m] += l.comp[m]; agg.prodCapacity[m] += l.ramped[m] * l.prod;
        agg.hireCost[m] += l.hires[m] * perHire;
      }
    });
    return { lines, agg };
  }

  function stdCost(team, agg, rates, H) {
    const mgrs = team.roleMgr ? managerSeries(agg.ics, team.mgrSpan) : zeros(H);
    const mgrComp = compCost(mgrs, rates[team.roleMgr] || 0);
    const tooling = toolingCost(agg.ics, team.toolingSeatAnnual, team.toolingFixedMonthly != null ? team.toolingFixedMonthly : (team.platformFixedMonthly || team.fixedProgramMonthly || 0), H);
    return { mgrs, mgrComp, tooling };
  }

  function pack(team, agg, lines, mgrs, cost, capacity, demand, coverage, extras) {
    const H = capacity.length;
    return {
      id: team.id, name: team.name, type: team.type,
      cost, ics: agg.ics, mgrs, headcount: agg.ics.map((e, m) => e + mgrs[m]),
      hires: agg.hires, attrition: agg.attrition, capacity, demand, coverage,
      coverageFlag: coverage.map((c, m) => (demand[m] || 0) === 0 ? 'OK' : (capacity[m] >= demand[m] - 1e-9 ? 'OK' : 'SHORT')),
      extras: Object.assign({ lines, hireCost: agg.hireCost }, extras)
    };
  }

  // ---------- per-archetype compute ----------
  function computeSales(team, ctx) {
    const { H, mult, rates, targets } = ctx;
    const { lines, agg } = computeLines(team, H, rates, ctx.oneTime);
    const capacityBase = agg.prodCapacity.map(v => v / 12 * mult.prod); // annual$ -> monthly
    const overlay = padTo(team.judgmentOverlay, H);
    const plan = capacityBase.map((c, m) => c + overlay[m]);
    const coverage = plan.map((p, m) => targets[m] === 0 ? 0 : p / targets[m]);
    const { mgrs, mgrComp, tooling } = stdCost(team, agg, rates, H);
    const cost = agg.icComp.map((c, m) => c + mgrComp[m] + tooling[m] + agg.hireCost[m]);
    const channels = (team.channels || []).map(ch => {
      const revReq = targets.map(t => t * ch.mixPct);
      const winEff = ch.winRate * mult.conv;
      const pipelineReq = revReq.map(r => winEff > 0 ? r / winEff : 0);
      const dealsReq = revReq.map(r => team.asp > 0 ? ceil(r / team.asp) : 0);
      return { id: ch.id, name: ch.name, mixPct: ch.mixPct, winRate: ch.winRate, revReq, pipelineReq, dealsReq };
    });
    return pack(team, agg, lines, mgrs, cost, plan, targets.slice(), coverage,
      { channels, icComp: agg.icComp, mgrComp, tooling, asp: team.asp });
  }

  function computeDemandFunnel(team, ctx) {
    const { H, mult, rates } = ctx;
    const basePipe = ctx.installedBasePipeline ? ctx.installedBasePipeline(team) : new Array(H).fill(0);
    const pipelineReq = ctx.channelPipeline(team.servesChannel).map((p, m) => p + basePipe[m]);
    const asp = ctx.salesASP;
    const oppsReq = pipelineReq.map(p => asp > 0 ? ceil(p / asp) : 0);
    const sqlsReq = oppsReq.map(o => ceil(o / Math.max(1e-9, team.sqlToOpp * mult.conv)));
    const mqlsReq = sqlsReq.map(s => ceil(s / Math.max(1e-9, team.mqlToSql * mult.conv)));
    const { lines, agg } = computeLines(team, H, rates, ctx.oneTime);
    const capacity = agg.prodCapacity.map(v => v * mult.prod);
    const coverage = capacity.map((c, m) => mqlsReq[m] === 0 ? 1 : c / mqlsReq[m]);
    const programSpend = mqlsReq.map(q => q * (team.costPerMQL || 0));
    const { mgrs, mgrComp, tooling } = stdCost(team, agg, rates, H);
    const cost = agg.icComp.map((c, m) => c + mgrComp[m] + tooling[m] + programSpend[m] + agg.hireCost[m]);
    return pack(team, agg, lines, mgrs, cost, capacity, mqlsReq, coverage,
      { oppsReq, sqlsReq, mqlsReq, programSpend, icComp: agg.icComp, mgrComp, tooling });
  }

  function computeProspecting(team, ctx) {
    const { H, mult, rates } = ctx;
    const outboundPipeline = ctx.channelPipeline(team.servesChannel);
    const asp = ctx.salesASP;
    const outboundOpps = outboundPipeline.map(p => asp > 0 ? ceil(p / asp) : 0);
    const mktOpps = ctx.marketingOpps();
    const inboundOpps = mktOpps.map(o => ceil(o * (team.pctMarketingWorked || 0)));
    const demand = outboundOpps.map((o, m) => o + inboundOpps[m]);
    const { lines, agg } = computeLines(team, H, rates, ctx.oneTime);
    const capacity = agg.prodCapacity.map(v => v * mult.prod);
    const coverage = capacity.map((c, m) => demand[m] === 0 ? 1 : c / demand[m]);
    const sqlsToFeed = demand.map(d => team.sqlToOpp > 0 ? d / team.sqlToOpp : 0);
    const { mgrs, mgrComp, tooling } = stdCost(team, agg, rates, H);
    const cost = agg.icComp.map((c, m) => c + mgrComp[m] + tooling[m] + agg.hireCost[m]);
    return pack(team, agg, lines, mgrs, cost, capacity, demand, coverage,
      { outboundOpps, inboundOpps, sqlsToFeed, icComp: agg.icComp, mgrComp, tooling });
  }

  function computePipelineChannel(team, ctx) {
    const { H, mult, rates } = ctx;
    const pipelineReq = ctx.channelPipeline(team.servesChannel);
    const pt = team.partnerTypes || [];
    const invTicket = sum(pt.map(p => p.ticket > 0 ? p.mix / p.ticket : 0));
    const closePerTicket = sum(pt.map(p => p.ticket > 0 ? p.mix * p.close / p.ticket : 0));
    const mixClose = sum(pt.map(p => p.mix * p.close));
    const oppsReq = pipelineReq.map(p => ceil(p * invTicket));
    const wonDeals = pipelineReq.map(p => ceil(p * closePerTicket));
    const sourcedRev = pipelineReq.map(p => p * mixClose);
    const { lines, agg } = computeLines(team, H, rates, ctx.oneTime);
    const capacity = agg.prodCapacity.map(v => v * mult.prod);
    const coverage = capacity.map((c, m) => oppsReq[m] === 0 ? 1 : c / oppsReq[m]);
    const mdf = sourcedRev.map(r => r * (team.mdfPct || 0));
    const { mgrs, mgrComp, tooling } = stdCost(team, agg, rates, H);
    const cost = agg.icComp.map((c, m) => c + mgrComp[m] + tooling[m] + mdf[m] + agg.hireCost[m]);
    return pack(team, agg, lines, mgrs, cost, capacity, oppsReq, coverage,
      { oppsReq, wonDeals, sourcedRev, mdf, blendedClose: mixClose, blendedTicket: sum(pt.map(p => p.mix * p.ticket)), icComp: agg.icComp, mgrComp, tooling });
  }

  function computeCustom(team, ctx) {
    const { H, mult, rates } = ctx;
    const { lines, agg } = computeLines(team, H, rates, ctx.oneTime);
    const capacity = agg.prodCapacity.map(v => v * mult.prod);
    const demand = padTo(team.manualDemand, H);
    const hasDemand = sum(demand) > 0;
    const coverage = capacity.map((c, m) => !hasDemand || demand[m] === 0 ? 1 : c / demand[m]);
    const { mgrs, mgrComp, tooling } = stdCost(team, agg, rates, H);
    const cost = agg.icComp.map((c, m) => c + mgrComp[m] + tooling[m] + agg.hireCost[m]);
    const res = pack(team, agg, lines, mgrs, cost, capacity, demand, coverage,
      { icComp: agg.icComp, mgrComp, tooling, unitName: team.unitName || 'units' });
    if (!hasDemand) res.coverageFlag = zeros(H).map(() => 'OK');
    return res;
  }

  // ---------- main compute ----------
  function compute(model) {
    migrate(model);
    const H = model.config.horizon;
    const mult = activeMultipliers(model);
    const rates = blendedRates(model);
    const labels = monthLabels(model.config.startMonth, H);

    const seas = model.config.seasonality || { mode: 'even' };
    const qw = seas.mode === 'custom' && Array.isArray(seas.q) ? seas.q
      : seas.mode === 'backloaded' ? [0.20, 0.24, 0.26, 0.30]
      : [0.25, 0.25, 0.25, 0.25];
    const targets = zeros(H);
    for (let m = 0; m < H; m++) {
      const yr = Math.floor(m / 12);
      const annual = model.config.annualTargets[Math.min(yr, model.config.annualTargets.length - 1)] || 0;
      targets[m] = annual * qw[Math.floor((m % 12) / 3)] / 3;
    }

    const teams = model.teams.filter(t => t.enabled !== false);
    const salesTeam = teams.find(t => t.type === 'sales');
    const warnings = [];
    if (!salesTeam) warnings.push('No Sales (AE) team — the model is target-driven and needs one sales engine.');

    let salesResult = null;
    const results = [];
    const ctx = {
      H, mult, rates, targets,
      oneTime: { pct: (model.config.recruitingPct || 0) * (model.config.agencyHirePct != null ? model.config.agencyHirePct : 1), flat: model.config.onboardingPerHire || 0 },
      salesASP: salesTeam ? salesTeam.asp : 0,
      channelPipeline(channelId) {
        if (!salesResult) return zeros(H);
        const ch = salesResult.extras.channels.find(c => c.id === channelId);
        return ch ? ch.pipelineReq : zeros(H);
      },
      marketingOpps() {
        const out = zeros(H);
        results.filter(r => r.type === 'demand-funnel').forEach(r => r.extras.oppsReq.forEach((o, m) => out[m] += o));
        return out;
      }
    };

    if (salesTeam) { salesResult = computeSales(salesTeam, ctx); results.push(salesResult); }

    // ----- CS (retention) + AM (expansion) joint monthly loop -----
    // computed BEFORE demand teams so the installed base can create pipeline demand
    const csTeam = teams.find(t => t.type === 'retention');
    const amTeam = teams.find(t => t.type === 'expansion');
    const lag = model.config.salesCycleLag;
    const startARR = model.config.startingARR != null ? model.config.startingARR : (csTeam ? csTeam.startingARR || 0 : 0);
    const newARRBooked = zeros(H).map((_, m) => m >= lag ? targets[m - lag] : 0);

    let amLines = null;
    if (amTeam) amLines = computeLines(amTeam, H, rates, ctx.oneTime);

    const endingARR = zeros(H), churn = zeros(H), expansion = zeros(H), maxExp = zeros(H), expCapacity = zeros(H), expTarget = zeros(H), nrr = zeros(H), builtIn = zeros(H);
    let prevARR = startARR;
    const grr = model.config.grossRetention != null ? model.config.grossRetention : (csTeam && csTeam.grossRetention != null ? csTeam.grossRetention : 1);
    const monthlyChurnRate = csTeam ? (1 - grr) / 12 : 0;
    const escM = Math.pow(1 + (model.config.renewalEscalator || 0), 1 / 12) - 1; // COL/price uplift on the surviving base
    const expPct = amTeam ? (model.config.expTargetPct != null ? model.config.expTargetPct : (amTeam.expTargetPct || 0)) : 0; // expansion TARGET (model driver) as % of current book
    for (let m = 0; m < H; m++) {
      maxExp[m] = amTeam ? prevARR * (amTeam.maxExpansionPct || 0) / 12 : 0;
      expCapacity[m] = amTeam ? amLines.agg.prodCapacity[m] / 12 * mult.prod : 0;
      expTarget[m] = prevARR * expPct / 12;
      expansion[m] = expPct > 0 ? expTarget[m] : Math.min(expCapacity[m], maxExp[m]);
      churn[m] = prevARR * monthlyChurnRate;
      builtIn[m] = (prevARR - churn[m]) * escM;
      endingARR[m] = prevARR + newARRBooked[m] + expansion[m] + builtIn[m] - churn[m];
      nrr[m] = prevARR === 0 ? 0 : (prevARR - churn[m] + expansion[m] + builtIn[m]) / prevARR;
      prevARR = endingARR[m];
    }

    // % of expansion pipeline sourced by Marketing (and worked by SDR) — default 0
    ctx.installedBasePipeline = (team) => {
      const out = zeros(H);
      if (!amTeam || !(amTeam.mktSourcedPct > 0) || team.type !== 'demand-funnel') return out;
      const dfCount = teams.filter(t => t.type === 'demand-funnel').length || 1;
      const winEff = Math.max(1e-9, (amTeam.expWinRate != null ? amTeam.expWinRate : 0.25) * mult.conv);
      for (let m = 0; m < H; m++) out[m] = expansion[m] * amTeam.mktSourcedPct / winEff / dfCount;
      return out;
    };

    teams.filter(t => t.type === 'demand-funnel').forEach(t => results.push(computeDemandFunnel(t, ctx)));
    teams.filter(t => t.type === 'prospecting').forEach(t => results.push(computeProspecting(t, ctx)));
    teams.filter(t => t.type === 'pipeline-channel').forEach(t => results.push(computePipelineChannel(t, ctx)));
    teams.filter(t => t.type === 'custom').forEach(t => results.push(computeCustom(t, ctx)));

    if (csTeam) {
      const csms = endingARR.map(a => csTeam.arrPerCSM > 0 ? ceil(a / csTeam.arrPerCSM) : 0);
      const csMgrs = managerSeries(csms, csTeam.mgrSpan);
      const csmComp = compCost(csms, rates[csTeam.roleIC] || 0);
      const csMgrComp = compCost(csMgrs, rates[csTeam.roleMgr] || 0);
      const csTooling = toolingCost(csms, csTeam.toolingSeatAnnual, csTeam.platformFixedMonthly, H);
      const csHires = csms.map((c, m) => Math.max(0, c - (m === 0 ? ceil(startARR / Math.max(1, csTeam.arrPerCSM)) : csms[m - 1])));
      const csPerHire = (rates[csTeam.roleIC] || 0) * ctx.oneTime.pct + ctx.oneTime.flat;
      const csHireCost = csHires.map(n2 => n2 * csPerHire);
      const csCost = csmComp.map((c, m) => c + csMgrComp[m] + csTooling[m] + csHireCost[m]);
      results.push({
        id: csTeam.id, name: csTeam.name, type: csTeam.type,
        cost: csCost, ics: csms, mgrs: csMgrs, headcount: csms.map((c, m) => c + csMgrs[m]),
        hires: csHires, attrition: zeros(H), capacity: zeros(H), demand: zeros(H),
        coverage: zeros(H).map(() => 1), coverageFlag: zeros(H).map(() => 'OK'),
        extras: { endingARR, churn, newARRBooked, expansionInflow: expansion, nrr, csmComp, csMgrComp, csTooling, hireCost: csHireCost, autoSized: true, lines: [] }
      });
    }

    if (amTeam) {
      const { lines, agg } = amLines;
      const { mgrs, mgrComp, tooling } = stdCost(amTeam, agg, rates, H);
      const cost = agg.icComp.map((c, m) => c + mgrComp[m] + tooling[m] + agg.hireCost[m]);
      const targetMode = expPct > 0;
      const amDemand = targetMode ? expTarget : maxExp;
      const coverage = expCapacity.map((c, m) => amDemand[m] === 0 ? 1 : c / Math.max(1e-9, amDemand[m]));
      const res = pack(amTeam, agg, lines, mgrs, cost, expCapacity, amDemand, coverage,
        { expansion, expCapacity, maxExp, expTarget, targetMode, icComp: agg.icComp, mgrComp, tooling });
      if (!targetMode) res.coverageFlag = zeros(H).map(() => 'OK'); // ceiling is not unmet demand
      results.push(res);
    }

    // ----- capacity-feasible ARR path: bookings capped by sales capacity -----
    // "what's possible with the org as staffed" vs the target-driven path above
    const feasARR = zeros(H), feasBooked = zeros(H);
    {
      let prevF = startARR;
      for (let m = 0; m < H; m++) {
        const src = m - lag;
        feasBooked[m] = src >= 0 ? (salesResult ? Math.min(targets[src], salesResult.capacity[src]) : targets[src]) : 0;
        const feasExp = expPct > 0 ? Math.min(expansion[m], expCapacity[m]) : expansion[m];
        const ch = prevF * monthlyChurnRate;
        const bi = (prevF - ch) * escM;
        feasARR[m] = prevF + feasBooked[m] + feasExp + bi - ch;
        prevF = feasARR[m];
      }
    }

    // ----- GTM summary -----
    const totalCost = zeros(H), totalHeadcount = zeros(H), totalHires = zeros(H), totalAttrition = zeros(H);
    results.forEach(r => { for (let m = 0; m < H; m++) { totalCost[m] += r.cost[m]; totalHeadcount[m] += r.headcount[m]; totalHires[m] += r.hires[m] || 0; totalAttrition[m] += r.attrition[m] || 0; } });
    const bookedRevenue = newARRBooked;
    const totalRevenue = bookedRevenue.map((b, m) => b + expansion[m] + builtIn[m]);

    const smCost = zeros(H);
    results.filter(r => !['retention', 'expansion'].includes(r.type)).forEach(r => { for (let m = 0; m < H; m++) smCost[m] += r.cost[m]; });
    const cumSM = [], cumBooked = [];
    smCost.reduce((s, v, m) => { const t = s + v; cumSM[m] = t; return t; }, 0);
    bookedRevenue.reduce((s, v, m) => { const t = s + v; cumBooked[m] = t; return t; }, 0);
    const cac = cumSM.map((c, m) => cumBooked[m] === 0 ? 0 : c / cumBooked[m]);
    const costPctRevenue = totalCost.map((c, m) => totalRevenue[m] === 0 ? 0 : c / totalRevenue[m]);
    const dealsReq = zeros(H);
    if (salesResult) salesResult.extras.channels.forEach(ch => ch.dealsReq.forEach((d, m) => dealsReq[m] += d));
    const costPerDeal = totalCost.map((c, m) => dealsReq[m] === 0 ? 0 : c / dealsReq[m]);

    // ----- Role Readiness -----
    const g = model.guardrails;
    const arrPerHead = endingARR.map((a, m) => totalHeadcount[m] === 0 ? 0 : a / totalHeadcount[m]);
    const plannedHires = zeros(H);
    results.filter(r => !(r.extras && r.extras.autoSized)).forEach(r => { for (let m = 0; m < H; m++) plannedHires[m] += r.hires[m] || 0; });
    const hiringHealth = zeros(H).map((_, m) => {
      if (plannedHires[m] === 0) return '-';
      return (arrPerHead[m] >= g.arrPerHeadFloor && costPctRevenue[m] <= g.costPctCeiling) ? 'OK' : 'AHEAD OF SUPPORT';
    });

    // self-funding per role line
    const selfFunding = [];
    results.forEach(r => {
      const team = teams.find(t => t.id === r.id);
      if (!team || !r.extras.lines) return;
      r.extras.lines.forEach(line => {
        let output = null, attributed = false;
        if (team.type === 'sales') output = line.prod;
        else if (team.type === 'expansion') output = line.prod;
        else if (team.type === 'prospecting' && salesTeam) {
          const ch = salesResult.extras.channels.find(c => c.id === team.servesChannel);
          if (ch) { output = line.prod * 12 * ch.winRate * salesTeam.asp; attributed = true; }
        } else if (team.type === 'pipeline-channel') {
          output = line.prod * 12 * r.extras.blendedClose * r.extras.blendedTicket; attributed = true;
        }
        if (output != null) selfFunding.push(sfRow(`${line.name} (${team.name})${attributed ? ' — attributed' : ''}`, rates[line.rateRole], output, g, attributed, team.id));
      });
    });

    const checks = buildChecks(model, results, { hiringHealth, arrPerHead, costPctRevenue, selfFunding, labels, salesResult, H });
    warnings.forEach(w => checks.unshift({ severity: 'error', team: 'Model', title: w, detail: '' }));

    return {
      H, labels, targets, mult, rates, teams: results,
      summary: {
        totalCost, totalHeadcount, totalHires, totalAttrition, smCost,
        bookedRevenue, expansion, builtInGrowth: builtIn, totalRevenue, endingARR, churn, nrr,
        feasibleARR: feasARR, feasibleBooked: feasBooked,
        cac, costPctRevenue, costPerDeal, dealsReq, cumSM, cumBooked,
        totals: {
          cost: sum(totalCost), revenue: sum(totalRevenue), booked: sum(bookedRevenue),
          expansion: sum(expansion), builtIn: sum(builtIn), endingHeadcount: totalHeadcount[H - 1] || 0,
          feasibleEndingARR: feasARR[H - 1] || 0,
          endingARR: endingARR[H - 1] || 0, finalCAC: cac[H - 1] || 0,
          hires: sum(totalHires), attrition: sum(totalAttrition)
        }
      },
      readiness: { hiringHealth, arrPerHead, costPctRevenue, selfFunding, guardrails: g },
      checks
    };
  }

  function sfRow(role, loaded, outputARR, g, attributed, teamId) {
    const gp = (outputARR || 0) * g.grossMargin;
    const payback = gp === 0 ? Infinity : 12 * (loaded || 0) / gp;
    return {
      role, teamId, loaded: loaded || 0, outputARR: outputARR || 0, grossProfit: gp,
      payback, verdict: gp === 0 ? '-' : (payback <= g.paybackMonths ? 'SELF-FUNDING' : 'LONG PAYBACK'),
      attributed: !!attributed
    };
  }

  // ---------- hard checks ----------
  function buildChecks(model, results, s) {
    const checks = [];
    const { H, labels } = s;

    const aheadMonths = [];
    s.hiringHealth.forEach((h, m) => { if (h === 'AHEAD OF SUPPORT') aheadMonths.push(labels[m]); });
    if (aheadMonths.length) checks.push({
      severity: 'error', team: 'Role Readiness', title: `Hiring ahead of revenue support in ${aheadMonths.length} month(s)`,
      detail: `Months: ${aheadMonths.join(', ')}. ARR/GTM-head below $${fmtN(model.guardrails.arrPerHeadFloor)} floor or GTM cost above ${Math.round(model.guardrails.costPctCeiling * 100)}% of net-new ARR while adding heads.`
    });

    s.selfFunding.filter(r => r.verdict === 'LONG PAYBACK').forEach(r => checks.push({
      severity: 'error', team: 'Role Readiness', title: `${r.role} does not pay back within ${model.guardrails.paybackMonths} months`,
      detail: `Payback ${r.payback === Infinity ? '∞' : r.payback.toFixed(1)} months at ${Math.round(model.guardrails.grossMargin * 100)}% gross margin.`
    }));

    results.forEach(r => {
      const shortM = [], overM = [];
      r.coverageFlag.forEach((f, m) => { if (f === 'SHORT') shortM.push(labels[m]); });
      r.coverage.forEach((c, m) => { if ((r.hires[m] || 0) > 0 && c >= 1.5 && r.type !== 'expansion') overM.push(labels[m]); });
      if (shortM.length) checks.push({
        severity: 'warn', team: r.name, title: `Under capacity in ${shortM.length} month(s)`,
        detail: `Capacity below demand: ${shortM.slice(0, 8).join(', ')}${shortM.length > 8 ? '…' : ''}. Either hire earlier or lower the target.`
      });
      if (overM.length) checks.push({
        severity: 'warn', team: r.name, title: `Hiring while coverage already ≥150%`,
        detail: `New starts added in ${overM.join(', ')} when existing capacity already exceeds demand by 50%+. Challenge the timing.`
      });
    });

    results.forEach(r => {
      if (r.extras && r.extras.autoSized) return;
      (r.extras.lines || []).forEach(line => {
        if ((line.annualAttrition === 0 || line.annualAttrition == null) && Math.max(...line.ending) > 0) checks.push({
          severity: 'warn', team: r.name, title: `Zero attrition assumed for ${line.name}`,
          detail: 'No role holds 0% attrition over a multi-year plan. Use 15–25% for GTM roles (SDRs often 30%+) and backfill.'
        });
      });
      const lost = sum(r.attrition);
      if (lost > 0 && sum(r.hires) === 0) checks.push({
        severity: 'error', team: r.name, title: `Attrition not backfilled — ${lost} head(s) lost, zero hires planned`,
        detail: 'The plan shrinks this team through attrition with no replacement hiring. Confirm this is intentional.'
      });
    });

    // location-mix validator: every role a team actually uses must blend to exactly 100%
    const usedRoleNames = new Set();
    model.teams.filter(t => t.enabled !== false).forEach(t => {
      (t.roles || []).forEach(l => { if (l.rateRole) usedRoleNames.add(l.rateRole); });
      if (t.roleMgr) usedRoleNames.add(t.roleMgr);
      if (t.type === 'retention' && t.roleIC) usedRoleNames.add(t.roleIC);
    });
    usedRoleNames.forEach(name => {
      const role = model.rateCard.roles.find(r => r.name === name);
      if (!role) {
        checks.push({ severity: 'error', team: 'Rate card', title: `Role "${name}" is assigned to a team but missing from the catalog`, detail: 'Its comp prices at $0 — every head is free, which your CFO will not believe. Re-point the team or recreate the role.' });
        return;
      }
      const mixSum = model.fx.reduce((a, f) => a + ((role.bands[f.country] && role.mix[f.country]) || 0), 0);
      if (Math.abs(mixSum - 1) > 0.005) checks.push({
        severity: 'error', team: 'Rate card', title: `"${name}" location mix sums to ${(mixSum * 100).toFixed(0)}% — comp is mispriced`,
        detail: 'Location mix must total 100% across the role\'s countries. Open the role under My Teams (Team Setup) and use the ⚖ Balance button.'
      });
    });

    const sales = model.teams.find(t => t.type === 'sales' && t.enabled !== false);
    if (sales) {
      const mixSum = sum((sales.channels || []).map(c => c.mixPct));
      if (Math.abs(mixSum - 1) > 0.001) checks.push({
        severity: 'error', team: 'Channel Mix', title: `Channel mix sums to ${(mixSum * 100).toFixed(1)}% (must be 100%)`,
        detail: 'Pipeline requirements are over- or under-stated until the mix is corrected.'
      });
      (sales.channels || []).forEach(ch => {
        const served = model.teams.some(t => t.enabled !== false && t.servesChannel === ch.id);
        if (!served && ch.mixPct > 0 && ch.id !== 'outbound') checks.push({
          severity: 'warn', team: 'Channel Mix', title: `Channel “${ch.name}” (${Math.round(ch.mixPct * 100)}% of plan) has no team generating it`,
          detail: 'A revenue channel with no owning team is an unfunded assumption. Add a team or move the mix.'
        });
      });
    }

    const salesT = model.teams.find(t => t.type === 'sales' && t.enabled !== false);
    if (salesT && (salesT.targetCoverage || 0) > 1) {
      const sr = results.find(r => r.type === 'sales');
      if (sr) {
        const below = [];
        sr.coverage.forEach((c, m) => { if (c < salesT.targetCoverage - 1e-9) below.push(labels[m]); });
        if (below.length) checks.push({
          severity: 'warn', team: sr.name, title: `Capacity below quota over-assignment policy (${salesT.targetCoverage.toFixed(2)}×) in ${below.length} month(s)`,
          detail: `${below.slice(0, 8).join(', ')}${below.length > 8 ? '…' : ''}. Coverage clears the target but not the buffer that absorbs rep misses and rep churn.`
        });
      }
    }

    results.filter(r => r.type === 'sales').forEach(r => {
      const lastQ = Math.max(0, H - 3);
      let lateHires = 0;
      for (let m = lastQ; m < H; m++) lateHires += r.hires[m];
      if (lateHires > 0) checks.push({
        severity: 'info', team: r.name, title: `${lateHires} rep(s) hired in the final quarter contribute almost nothing in-plan`,
        detail: 'With a 6-month ramp these hires produce after the window ends. Valid for next-cycle pipeline; not for this plan’s number.'
      });
    });

    return checks;
  }

  const fmtN = n => (n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });

  // ---------- default model (Excel defaults, verified) ----------
  function defaultModel() {
    const H = 24;
    const z = () => zeros(H);
    const salesHires = z(); salesHires[7] = 1; salesHires[9] = 1; salesHires[17] = 1;
    const sdrHires = z(); sdrHires[12] = 1;
    const amHires = z(); amHires[14] = 1; amHires[17] = 1; amHires[20] = 1;
    return {
      meta: { name: 'GTM Capacity Plan', version: 3, savedAt: null, sample: true },
      config: {
        startMonth: '2026-07', horizon: H, currency: 'USD', scenario: 'Base', salesCycleLag: 6,
        annualTargets: [6000000, 9000000], arrGoals: [0, 0], startingARR: 8000000,
        renewalEscalator: 0, timeToFillDays: 60,
        recruitingPct: 0, onboardingPerHire: 0,
        expTargetPct: 0, maxStartsPerMonth: 3, grossRetention: 0.9, agencyHirePct: 1,
        seasonality: { mode: 'even', q: [0.25, 0.25, 0.25, 0.25] },
        scenarios: {
          Base: { conv: 1, ramp: 1, prod: 1, cost: 1 },
          Conservative: { conv: 0.85, ramp: 0.85, prod: 0.95, cost: 1.05 },
          Aggressive: { conv: 1.15, ramp: 1.1, prod: 1.1, cost: 1 }
        }
      },
      fx: [
        { country: 'United States', burden: 0.25, currency: 'USD', spot: 1, trailing: 1, buffer: 0 },
        { country: 'Canada', burden: 0.22, currency: 'CAD', spot: 0.7196, trailing: 0.7154, buffer: 0.03 },
        { country: 'United Kingdom', burden: 0.2, currency: 'GBP', spot: 1.3342, trailing: 1.3169, buffer: 0.03 },
        { country: 'Poland', burden: 0.21, currency: 'PLN', spot: 0.2712, trailing: 0.2659, buffer: 0.04 },
        { country: 'India', burden: 0.18, currency: 'INR', spot: 0.0104, trailing: 0.0115, buffer: 0.05 }
      ],
      rateCard: { defaultAttain: 0.9, roles: defaultRoles() },
      guardrails: { grossMargin: 0.8, paybackMonths: 18, arrPerHeadFloor: 400000, costPctCeiling: 0.6 },
      teams: [
        {
          id: 'sales', type: 'sales', name: 'Sales', enabled: true,
          roleMgr: 'Sales Manager', asp: 500000, targetCoverage: 1.0, mgrSpan: 6,
          toolingSeatAnnual: 3000, toolingFixedMonthly: 0, judgmentOverlay: z(),
          roles: [{ id: 'r-ae', name: 'Account Executive', rateRole: 'Account Executive', annualProdPerRep: 1800000, start: 4, hires: salesHires, annualAttrition: 0.2, ramp: [0, 0.1, 0.25, 0.45, 0.7, 0.9] }],
          channels: [
            { id: 'marketing', name: 'Marketing', mixPct: 0.66, winRate: 0.18 },
            { id: 'outbound', name: 'Outbound', mixPct: 0.20, winRate: 0.12 },
            { id: 'partnership', name: 'Partnership', mixPct: 0.14, winRate: 0.28 }
          ]
        },
        {
          id: 'sdr', type: 'prospecting', name: 'SDR / BDR', enabled: true,
          roleMgr: 'SDR Manager', servesChannel: 'outbound',
          sqlToOpp: 0.4, pctMarketingWorked: 0.7, mgrSpan: 6, toolingSeatAnnual: 2000, toolingFixedMonthly: 0,
          roles: [{ id: 'r-sdr', name: 'SDR', rateRole: 'SDR', oppsPerRepMo: 10, start: 1, hires: sdrHires, annualAttrition: 0.2, ramp: [0, 0.35, 0.7, 0.9, 1, 1] }]
        },
        {
          id: 'marketing', type: 'demand-funnel', name: 'Marketing', enabled: true,
          roleMgr: 'Marketing Manager', servesChannel: 'marketing',
          costPerMQL: 1000, mqlToSql: 0.35, sqlToOpp: 0.5, mgrSpan: 5,
          toolingSeatAnnual: 3000, platformFixedMonthly: 5000,
          roles: [{ id: 'r-dg', name: 'Demand Gen Specialist', rateRole: 'Demand Gen Specialist', mqlsPerSpecialist: 60, start: 1, hires: z(), annualAttrition: 0.2 }]
        },
        {
          id: 'partnerships', type: 'pipeline-channel', name: 'Partnerships', enabled: true,
          roleMgr: 'Partnerships Lead', servesChannel: 'partnership',
          mdfPct: 0.05, mgrSpan: 5, toolingSeatAnnual: 3000, fixedProgramMonthly: 0,
          roles: [{ id: 'r-pm', name: 'Partner Manager', rateRole: 'Partner Manager', oppsPerRepMo: 8, start: 1, hires: z(), annualAttrition: 0.2, ramp: [0, 0.1, 0.25, 0.45, 0.7, 0.9] }],
          partnerTypes: [
            { name: 'Referral', mix: 0.4, ticket: 350000, close: 0.3 },
            { name: 'Reseller / Channel', mix: 0.3, ticket: 300000, close: 0.25 },
            { name: 'Tech / ISV', mix: 0.2, ticket: 450000, close: 0.2 },
            { name: 'SI / Agency', mix: 0.1, ticket: 500000, close: 0.18 }
          ]
        },
        {
          id: 'cs', type: 'retention', name: 'Customer Success', enabled: true,
          roleIC: 'Customer Success Manager', roleMgr: 'CS Manager',
          arrPerCSM: 4000000, mgrSpan: 6,
          toolingSeatAnnual: 2500, platformFixedMonthly: 2000
        },
        {
          id: 'am', type: 'expansion', name: 'Account Management', enabled: true,
          roleMgr: 'CS Manager', maxExpansionPct: 0.15, mktSourcedPct: 0, expWinRate: 0.25, mgrSpan: 6,
          toolingSeatAnnual: 2500, toolingFixedMonthly: 0,
          roles: [{ id: 'r-am', name: 'Account Manager', rateRole: 'Account Manager', quotaAnnual: 750000, start: 0, hires: amHires, annualAttrition: 0.2, ramp: [0, 0.15, 0.35, 0.6, 0.85, 1] }]
        }
      ],
      ledger: {}
    };
  }

  function defaultRoles() {
    const mk = (name, bands, mix) => ({ name, bands, mix });
    const roles = [
      mk('Account Executive', {
        'United States': { base: 180000, ote: 180000 },
        'Canada': { base: 190000, ote: 190000 },
        'United Kingdom': { base: 120000, ote: 120000 },
        'Poland': { base: 440000, ote: 440000 },
        'India': { base: 3600000, ote: 3600000 }
      }, { 'United States': 0.45, 'Canada': 0.1, 'United Kingdom': 0.25, 'Poland': 0.1, 'India': 0.1 }),
      mk('Senior AE', {
        'United States': { base: 249600, ote: 249600 },
        'Canada': { base: 260000, ote: 239200 },
        'United Kingdom': { base: 166400, ote: 156000 },
        'Poland': { base: 624000, ote: 416000 },
        'India': { base: 5824000, ote: 4160000 }
      }, { 'United States': 0.45, 'Canada': 0.1, 'United Kingdom': 0.25, 'Poland': 0.1, 'India': 0.1 }),
      mk('Sales Manager', {
        'United States': { base: 243000, ote: 178200 },
        'Canada': { base: 251100, ote: 178200 },
        'United Kingdom': { base: 153900, ote: 113400 },
        'Poland': { base: 583200, ote: 324000 },
        'India': { base: 6480000, ote: 3564000 }
      }, { 'United States': 0.5, 'Canada': 0.1, 'United Kingdom': 0.25, 'Poland': 0.1, 'India': 0.05 }),
      mk('SDR', {
        'United States': { base: 77400, ote: 32250 },
        'Canada': { base: 79980, ote: 33540 },
        'United Kingdom': { base: 49020, ote: 20640 },
        'Poland': { base: 154800, ote: 58050 },
        'India': { base: 1032000, ote: 387000 }
      }, { 'United States': 0.15, 'Canada': 0.05, 'United Kingdom': 0.1, 'Poland': 0.3, 'India': 0.4 }),
      mk('SDR Manager', {
        'United States': { base: 143000, ote: 52000 },
        'Canada': { base: 149500, ote: 54600 },
        'United Kingdom': { base: 91000, ote: 32500 },
        'Poland': { base: 312000, ote: 104000 },
        'India': { base: 2860000, ote: 910000 }
      }, { 'United States': 0.3, 'Canada': 0.05, 'United Kingdom': 0.2, 'Poland': 0.2, 'India': 0.25 }),
      mk('Demand Gen Specialist', {
        'United States': { base: 121500, ote: 16200 },
        'Canada': { base: 124200, ote: 16200 },
        'United Kingdom': { base: 67500, ote: 9450 },
        'Poland': { base: 216000, ote: 27000 },
        'India': { base: 1755000, ote: 202500 }
      }, { 'United States': 0.2, 'Canada': 0.05, 'United Kingdom': 0.15, 'Poland': 0.25, 'India': 0.35 }),
      mk('Marketing Manager', {
        'United States': { base: 172900, ote: 26600 },
        'Canada': { base: 172900, ote: 26600 },
        'United Kingdom': { base: 93100, ote: 13300 },
        'Poland': { base: 319200, ote: 46550 },
        'India': { base: 2926000, ote: 399000 }
      }, { 'United States': 0.45, 'Canada': 0.1, 'United Kingdom': 0.25, 'Poland': 0.1, 'India': 0.1 }),
      mk('Partner Manager', {
        'United States': { base: 171600, ote: 128700 },
        'Canada': { base: 178750, ote: 128700 },
        'United Kingdom': { base: 107250, ote: 85800 },
        'Poland': { base: 371800, ote: 228800 },
        'India': { base: 3718000, ote: 2288000 }
      }, { 'United States': 0.45, 'Canada': 0.1, 'United Kingdom': 0.25, 'Poland': 0.1, 'India': 0.1 }),
      mk('Partnerships Lead', {
        'United States': { base: 216000, ote: 94500 },
        'Canada': { base: 222750, ote: 94500 },
        'United Kingdom': { base: 135000, ote: 60750 },
        'Poland': { base: 459000, ote: 175500 },
        'India': { base: 5130000, ote: 1890000 }
      }, { 'United States': 0.5, 'Canada': 0.1, 'United Kingdom': 0.25, 'Poland': 0.1, 'India': 0.05 }),
      mk('Customer Success Manager', {
        'United States': { base: 146000, ote: 43800 },
        'Canada': { base: 146000, ote: 43800 },
        'United Kingdom': { base: 87600, ote: 26280 },
        'Poland': { base: 292000, ote: 73000 },
        'India': { base: 2628000, ote: 657000 }
      }, { 'United States': 0.3, 'Canada': 0.1, 'United Kingdom': 0.2, 'Poland': 0.15, 'India': 0.25 }),
      mk('CS Manager', {
        'United States': { base: 189000, ote: 60750 },
        'Canada': { base: 195750, ote: 60750 },
        'United Kingdom': { base: 121500, ote: 37800 },
        'Poland': { base: 405000, ote: 101250 },
        'India': { base: 4050000, ote: 1012500 }
      }, { 'United States': 0.4, 'Canada': 0.1, 'United Kingdom': 0.25, 'Poland': 0.1, 'India': 0.15 }),
      mk('Account Manager', {
        'United States': { base: 144000, ote: 96000 },
        'Canada': { base: 152000, ote: 96000 },
        'United Kingdom': { base: 96000, ote: 64000 },
        'Poland': { base: 320000, ote: 192000 },
        'India': { base: 2880000, ote: 1600000 }
      }, { 'United States': 0.3, 'Canada': 0.1, 'United Kingdom': 0.2, 'Poland': 0.15, 'India': 0.25 })
    ];
    roles.forEach(r => { const m = KNOWN_ROLE_META[r.name] || ['ic', null]; r.kind = m[0]; r.dept = m[1]; });
    return roles;
  }

  // Solve the annual new-business targets needed to hit ending-ARR goals,
  // accounting for churn, expansion and the sales-cycle lag. goals[y] = ending ARR
  // at the end of year y (0/null = no goal for that year).
  function solveTargets(model, goals) {
    const clone = JSON.parse(JSON.stringify(model));
    const H = clone.config.horizon;
    const lag = clone.config.salesCycleLag || 0;
    const years = Math.ceil(H / 12);
    for (let iter = 0; iter < 18; iter++) {
      const res = compute(clone);
      for (let y = 0; y < years; y++) {
        const goal = goals[y];
        if (!goal) continue;
        const endIdx = Math.min(H, (y + 1) * 12) - 1;
        const achieved = res.summary.endingARR[endIdx];
        // months of year-y target that have booked by endIdx (lag shifts bookings)
        let cnt = 0;
        for (let m = 0; m <= endIdx; m++) {
          const src = m - lag;
          if (src >= 0 && Math.floor(src / 12) === y) cnt++;
        }
        if (!cnt) continue;
        const adj = (goal - achieved) * 12 / cnt;
        clone.config.annualTargets[y] = Math.max(0, (clone.config.annualTargets[y] || 0) + adj * 0.85);
      }
    }
    const finalRes = compute(clone);
    return {
      targets: clone.config.annualTargets.map(t => Math.round(t / 1000) * 1000),
      achieved: goals.map((g, y) => {
        const endIdx = Math.min(H, (y + 1) * 12) - 1;
        return g ? Math.round(finalRes.summary.endingARR[endIdx]) : null;
      })
    };
  }

  const Engine = { compute, defaultModel, blendedRates, blendedRateParts, budgetRate, monthLabels, activeMultipliers, migrate, solveTargets, PROD_KEY, PROD_LABEL, DEFAULT_RAMP };
  if (typeof module !== 'undefined' && module.exports) module.exports = Engine;
  else root.Engine = Engine;
})(typeof window !== 'undefined' ? window : globalThis);
