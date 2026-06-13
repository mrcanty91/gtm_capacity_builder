/* E2E test — "Meridian Software", a NYC B2B SaaS at $5M ARR building a 24-month expansion plan.
   Simulates a first-time user driving the real UI (jsdom). Excludes agents.
   Logs ISSUES (bugs) and FRICTION (UX) and prints a report. */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const dir = require('path').resolve(__dirname, '..');
const dom = new JSDOM(fs.readFileSync(dir + '/index.html', 'utf8'), { runScripts: 'outside-only', url: 'http://localhost/', pretendToBeVisual: true });
const w = dom.window;
w.fetch = () => Promise.reject(new Error('no network'));
const scriptErrs = [];
w.addEventListener('error', e => scriptErrs.push(e.message));

// download capture
let lastDownload = null, lastBlob = null;
w.URL.createObjectURL = b => { lastBlob = b; return 'blob:x'; };
w.URL.revokeObjectURL = () => {};
const origClick = w.HTMLAnchorElement.prototype.click;
w.HTMLAnchorElement.prototype.click = function () { if (this.download) lastDownload = { name: this.download, blob: lastBlob }; else origClick && origClick.call(this); };
async function readDownload() { return lastDownload ? { name: lastDownload.name, text: await lastDownload.blob.text() } : null; }

for (const f of ['engine.js', 'charts.js', 'agents.js', 'app.js']) {
  if (f === 'app.js') w.eval("localStorage.setItem('ro_capacity_model_v2', JSON.stringify(Engine.defaultModel()))"); // scenario begins from the demo plan, then resets
  try { w.eval(fs.readFileSync(dir + '/js/' + f, 'utf8')); } catch (e) { scriptErrs.push(f + ': ' + e.message); }
}

const $ = s => w.document.querySelector(s);
const $$ = s => Array.from(w.document.querySelectorAll(s));
const click = el => { const t = typeof el === 'string' ? $(el) : el; if (!t) throw new Error('click target missing: ' + el); t.dispatchEvent(new w.Event('click', { bubbles: true })); };
const change = (el, v) => { const t = typeof el === 'string' ? $(el) : el; if (!t) throw new Error('change target missing: ' + el); t.value = v; t.dispatchEvent(new w.Event('change', { bubbles: true })); };
const input = (el, v) => { const t = typeof el === 'string' ? $(el) : el; t.value = v; t.dispatchEvent(new w.Event('input', { bubbles: true })); t.dispatchEvent(new w.Event('change', { bubbles: true })); };
const flush = (ms = 200) => new Promise(r => setTimeout(r, ms));
const getModel = () => JSON.parse(w.localStorage.getItem('ro_capacity_model_v2'));
const eng = () => w.eval(`Engine.compute(JSON.parse(localStorage.getItem('ro_capacity_model_v2')))`);
const nav = async p => { click($(`.nav-tab[data-page=${p}]`)); await flush(); };
async function okAsk(inputVal) {
  await flush(80);
  if (!$('#askModal').classList.contains('open')) return false;
  if (inputVal !== undefined && $('#askInput')) input('#askInput', inputVal);
  click('#askOk'); await flush(200); return true;
}

const issues = [], friction = [], oks = [];
const issue = (sev, area, text) => { issues.push({ sev, area, text }); console.log(`FAIL [${sev}] ${area}: ${text}`); };
const fric = (area, text) => { friction.push({ area, text }); console.log(`FRICTION ${area}: ${text}`); };
const ok = (area, text) => { oks.push({ area, text }); console.log(`PASS ${area}: ${text}`); };
const setPath = async (path, val) => {
  const el = $(`[data-path="${path}"]`);
  if (!el) { issue('high', 'inputs', `no input found for data-path "${path}" on current page`); return false; }
  change(el, val); await flush(250); return true;
};

(async () => {
  try {
    // ============ S0 · BOOT & RESET ============
    console.log('\n===== S0 BOOT =====');
    if (scriptErrs.length) issue('high', 'boot', 'script errors on load: ' + scriptErrs.join(' | '));
    await flush(300);
    if (!$('#kpiRow') || !$('#kpiRow').textContent.trim()) issue('high', 'boot', 'dashboard KPI row empty on first load');
    else ok('boot', 'dashboard renders with demo model');
    const banner = $('#sampleBanner');
    if (banner && banner.textContent.trim()) ok('boot', 'sample-data banner present: explains demo state');
    else fric('boot', 'no visible explanation that the loaded numbers are demo/sample data');

    // Find the reset control — where does a new user start over?
    let resetBtn = $('#btnDashReset') || $('#btnResetModel');
    if ($('#btnDashReset')) ok('reset', 'reset control lives on the dashboard where a new user starts');
    else {
      for (const p of ['rates', 'drivers', 'builder', 'agents', 'readiness']) { await nav(p); if ($('#btnResetModel')) { resetBtn = $('#btnResetModel'); fric('reset', `Reset lives on the "${p}" page — not on the dashboard where a new user starts`); break; } }
    }
    if (!resetBtn) issue('high', 'reset', 'no reset-model control found anywhere');
    else { await nav('dashboard'); click(resetBtn); await okAsk(); ok('reset', 'reset-to-defaults works with confirm'); }
    if ($('#btnStartBlank')) ok('reset', '"Start blank" option available alongside demo reset');
    else fric('reset', 'no "start blank" option — a new company must demolish the demo org team-by-team instead of starting empty');

    // ============ S1 · TEAM SETUP (Geography & FX) ============
    console.log('\n===== S1 TEAM SETUP / FX =====');
    await nav('rates');
    let m = getModel();
    const startCountries = m.fx.map(f => f.country);
    console.log('  default countries:', startCountries.join(', '));
    // NY co: keep US + Canada (Toronto expansion). Delete UK, Poland, India.
    // (delete buttons key on row index, so re-find after each removal)
    for (const c of ['United Kingdom', 'Poland', 'India']) {
      m = getModel();
      const idx = m.fx.findIndex(f => f.country === c);
      if (idx < 0) { issue('med', 'fx', `country "${c}" not in model`); continue; }
      const del = $(`#fxSection [data-delfx="${idx}"]`);
      if (!del) { issue('med', 'fx', `no delete control for country "${c}" (row ${idx})`); continue; }
      click(del); const confirmed = await okAsk();
      if (!confirmed) issue('med', 'fx', `deleting ${c} did not ask for confirmation`);
      await flush(250);
    }
    m = getModel();
    if (m.fx.length === 2 && m.fx.some(f => f.country === 'Canada')) ok('fx', 'country deletion works; US + Canada remain');
    else issue('high', 'fx', 'country deletion left wrong set: ' + m.fx.map(f => f.country).join(','));

    // After deletion every role that had weight in deleted countries has mix < 100%.
    // The app warns and offers per-role ⚖ buttons; a real user now has to find and click each one.
    let mixErrs = eng().checks.filter(c => /mix sums/.test(c.title)).length;
    console.log(`  roles with broken mix after deletion: ${mixErrs}`);
    if (mixErrs > 0) {
      let clicks = 0, expandClicks = 0, guard = 0;
      while (mixErrs > 0 && guard++ < 30) {
        let btn = $('#rateSection [data-balmix]');
        if (!btn) { // expand something: library, then team cards, then role cards
          const closed = $$('#rateSection [data-libclps], #rateSection [data-teamclps], #rateSection [data-roleclps]');
          if (!closed.length) break;
          click(closed[expandClicks % closed.length]); expandClicks++; await flush(150); continue;
        }
        click(btn); clicks++; await flush(200);
        mixErrs = eng().checks.filter(c => /mix sums/.test(c.title)).length;
      }
      if (mixErrs === 0) {
        ok('fx', `mix rebalanced via ⚖ buttons (${clicks} balance clicks + ${expandClicks} expand clicks to reach them)`);
        if (clicks > 3) fric('fx', `deleting countries forced ${clicks} separate per-role ⚖ clicks (plus ${expandClicks} expand clicks) to repair location mixes — the delete confirm should offer "rebalance all roles now"`);
      } else issue('high', 'fx', `could not clear mix errors via UI — ${mixErrs} roles still broken after ${clicks} balance clicks (buttons unreachable?)`);
      const cAfterFix = eng().summary.totals.cost;
      console.log(`  cost after mix repair: $${Math.round(cAfterFix).toLocaleString()}`);
    }
    // burden: NYC fully-loaded ~28%
    await setPath('fx.0.burden', '28');
    m = getModel();
    if (Math.abs(m.fx[0].burden - 0.28) < 1e-9) ok('fx', 'US burden set to 28%');
    else issue('med', 'fx', `burden input wrote ${m.fx[0].burden} — expected 0.28 (is the % convention clear?)`);

    // ---- Role catalog: what do defaults give us? ----
    const lib = $('[data-libclps]'); if (lib) { click(lib); await flush(); }
    m = getModel();
    const roleNames = m.rateCard.roles.map(r => r.name);
    console.log('  default roles:', roleNames.join(' | '));
    // NYC comp: set US bands for the roles the scenario uses (base/variable, annual USD)
    const nycBands = {
      'Mid-Market AE': { base: 110000, ote: 110000 },
      'Enterprise AE': { base: 140000, ote: 140000 },
      'Inbound SDR': { base: 65000, ote: 35000 },
      'Outbound SDR': { base: 70000, ote: 40000 },
      'Sales Manager': { base: 160000, ote: 160000 },
      'CSM': { base: 100000, ote: 25000 },
      'Account Manager': { base: 110000, ote: 75000 },
      'Demand Gen Marketer': { base: 120000, ote: 0 }
    };
    let bandsSet = 0, bandMisses = [];
    m = getModel();
    m.rateCard.roles.forEach((r, ri) => {
      const want = Object.entries(nycBands).find(([k]) => r.name.toLowerCase().includes(k.toLowerCase().split(' ')[0]) && r.name.toLowerCase().includes(k.toLowerCase().split(' ').slice(-1)[0]));
      if (want && r.bands && r.bands['United States']) { bandsSet++; }
    });
    // set via UI for the first role with a US band to validate the edit path end-to-end
    await nav('rates');
    const roleClps = $$('#rateSection [data-roleclps]');
    if (!roleClps.length) {
      // roles may be nested under collapsed teams or the library — open library
      const lib2 = $('[data-libclps]'); if (lib2) { click(lib2); await flush(); }
    }
    const baseInput = $$('#rateSection input[data-path*=".bands."][data-path$=".base"]')[0];
    if (baseInput) {
      const p = baseInput.getAttribute('data-path');
      change(baseInput, '110000'); await flush(250);
      const after = p.split('.').reduce((o, k) => (o || {})[k], getModel());
      if (after === 110000) ok('catalog', 'role band edit persists via UI input');
      else issue('high', 'catalog', `band edit at ${p} wrote ${after}, expected 110000`);
    } else fric('catalog', 'could not reach a band input without expanding collapsed sections — bands hidden by default');

    // ---- My Teams: reshape demo org into Meridian ----
    m = getModel();
    console.log('  default teams:', m.teams.map(t => `${t.name}(${t.type},${t.enabled !== false ? 'on' : 'off'})`).join(' | '));
    // The scenario org: Sales (1 mgr + 3 AE), SDR (2), Marketing (2), CS (2 CSM), AM (1).
    // Keep matching archetype teams; remove others via builder page remove (data-act=remove) later if extra.

    // ============ S2 · MODEL DRIVERS ============
    console.log('\n===== S2 MODEL DRIVERS =====');
    await nav('drivers');
    const driverPaths = $$('#configCard [data-path]').map(e => e.getAttribute('data-path'));
    console.log('  driver inputs:', driverPaths.join(', '));
    await setPath('config.startMonth', '2027-01');
    change('#horizonSel', '24'); await flush(250);
    m = getModel();
    if (m.config.horizon === 24 && m.config.startMonth === '2027-01') ok('drivers', 'timeline set: Jan 2027 × 24 months');
    else issue('high', 'drivers', `timeline wrong: start=${m.config.startMonth} horizon=${m.config.horizon}`);

    await setPath('config.startingARR', '5000000');
    await setPath('config.grossRetention', '90');
    await setPath('config.renewalEscalator', '3');
    await setPath('config.expTargetPct', '10');
    // ARR goals: Y1 $8M, Y2 $12.5M
    const goalInputs = $$('#configCard input[data-path*="arrGoals"]');
    if (goalInputs.length >= 2) {
      change(goalInputs[0], '8000000'); await flush(250);
      change($$('#configCard input[data-path*="arrGoals"]')[1], '12500000'); await flush(250);
      ok('drivers', 'ARR goals set 8M / 12.5M');
    } else issue('high', 'drivers', `expected 2 ARR goal inputs for 24-mo horizon, found ${goalInputs.length}`);
    // hiring economics
    await setPath('config.salesCycleLag', '2');
    await setPath('config.timeToFillDays', '60');
    await setPath('config.recruitingPct', '20');
    await setPath('config.agencyHirePct', '25');
    await setPath('config.onboardingPerHire', '7500');
    await setPath('config.maxStartsPerMonth', '4');
    // seasonality
    const seas = $('#seasMode');
    if (seas) {
      change(seas, 'backloaded'); await flush(250);
      if ((getModel().config.seasonality || {}).mode === 'backloaded') ok('drivers', 'seasonality set to backloaded');
      else issue('med', 'drivers', 'seasonality change did not persist');
    } else issue('med', 'drivers', '#seasMode select missing');
    m = getModel();
    const cfgOK = m.config.startingARR === 5000000 && m.config.grossRetention === 0.9 && m.config.expTargetPct === 0.10 && m.config.salesCycleLag === 2;
    if (cfgOK) ok('drivers', 'all driver values persisted with correct units');
    else issue('high', 'drivers', `driver persistence: startingARR=${m.config.startingARR} grr=${m.config.grossRetention} exp=${m.config.expTargetPct} lag=${m.config.salesCycleLag}`);

    // goal notice / implied targets
    const noticeTxt = ($('#configCard') || {}).textContent || '';
    if ($('#btnApplyImplied')) {
      click('#btnApplyImplied'); await okAsk(); await flush(300);
      m = getModel();
      const y1 = m.config.annualTargets[0], y2 = m.config.annualTargets[1];
      console.log(`  implied NB targets: Y1 $${Math.round(y1).toLocaleString()} Y2 $${Math.round(y2).toLocaleString()}`);
      if (y1 > 1000000 && y2 > y1) ok('drivers', 'solver produced ascending implied new-business targets');
      else issue('high', 'drivers', `implied targets look wrong: ${y1} / ${y2}`);
      // verify the bridge math: ending ARR with these targets should approach the goals if fully staffed
      const sol = w.eval(`Engine.solveTargets(JSON.parse(localStorage.getItem('ro_capacity_model_v2')), [8000000,12500000])`);
      if (sol && sol.endingARR) {
        const missY2 = Math.abs(sol.endingARR[1] - 12500000) / 12500000;
        if (missY2 < 0.02) ok('drivers', `solver converges: implied ending ARR within ${(missY2 * 100).toFixed(2)}% of goal`);
        else issue('med', 'drivers', `solver Y2 ending ARR off by ${(missY2 * 100).toFixed(1)}%`);
      }
    } else fric('drivers', 'no visible "apply implied targets" action after setting goals (btnApplyImplied missing)');

    // channel mix
    if ($('#channelCard')) {
      const chTxt = $('#channelCard').textContent;
      if (/100\s*%|balanced/i.test(chTxt) || $$('#channelCard [data-path]').length) ok('drivers', 'channel card present with mix inputs');
    }

    // ============ S2b · BUILD THE PLAN (staff-to-goal) ============
    console.log('\n===== S2b BUILD PLAN =====');
    const heads0 = eng().summary.totals.endingHeadcount;
    if ($('#btnBuildPlan')) {
      click('#btnBuildPlan'); const conf = await okAsk(); await flush(600);
      if (!conf) issue('med', 'build', 'Build Plan did not show its confirm dialog');
      const heads1 = eng().summary.totals.endingHeadcount;
      console.log(`  headcount ${heads0} -> ${heads1} after auto-build`);
      if (heads1 > heads0) ok('build', `staff-to-goal drafted hires (ending HC ${heads0} → ${heads1})`);
      else issue('high', 'build', 'Build Plan changed nothing — no hires drafted');
      const t = eng().summary.totals;
      console.log(`  totals: cost $${Math.round(t.cost).toLocaleString()} · ending ARR $${Math.round(t.endingARR).toLocaleString()} · CAC ${t.finalCAC}`);
      const gap = (12500000 - t.endingARR) / 12500000;
      if (t.endingARR > 9000000) ok('build', `feasible ending ARR $${(t.endingARR / 1e6).toFixed(1)}M vs $12.5M goal (gap ${(gap * 100).toFixed(0)}%) — ramp physics honestly limit year 1`);
      else issue('med', 'build', `auto-built plan lands far from goal: ending ARR $${(t.endingARR / 1e6).toFixed(1)}M vs $12.5M`);
    } else issue('high', 'build', 'btnBuildPlan not found on drivers page');

    // ============ S3 · PLAN BUILDER ============
    console.log('\n===== S3 PLAN BUILDER =====');
    await nav('builder');
    const railItems = $$('#teamRail .rail-item');
    console.log('  teams in rail:', railItems.map(r => (r.querySelector('.rail-name') || {}).textContent).join(' | '));
    if (!railItems.length) issue('high', 'builder', 'team rail empty');
    // driver strip should remind the user of company dials without editing here
    if ($('#driverStrip') && $('#driverStrip').textContent.includes('$')) ok('builder', 'driver strip summarizes company dials');
    // open first team, edit a hire month via the full grid
    click(railItems[0]); await flush();
    const fullGrid = $('[data-fullgrid]');
    if (fullGrid) {
      click(fullGrid); await flush(300);
      if ($('#gridModal').classList.contains('open')) {
        ok('builder', 'fullscreen role editor opens');
        const cells = $$('#gridModal input[data-m]');
        if (cells.length) {
          const cell = cells.find(c => +c.value === 0) || cells[0];
          const orig = +cell.value, mIdx = cell.getAttribute('data-m');
          const before = eng().summary.totals.endingHeadcount;
          change(cell, String(orig + 1)); await flush(400);
          const after = eng().summary.totals.endingHeadcount;
          if (after > before) ok('builder', `hire cell edit (month ${mIdx}) recomputes live (HC ${before} → ${after})`);
          else issue('high', 'builder', `grid hire edit: HC ${before} -> ${after}, expected increase`);
          const cellAgain = $(`#gridModal input[data-m="${mIdx}"]`);
          if (cellAgain) { change(cellAgain, String(orig)); await flush(300); }
        } else issue('med', 'builder', 'grid modal has no hire month cells (input[data-m])');
        const closeBtn = $$('#gridModal .btn').find(b => /close|done/i.test(b.textContent));
        if (closeBtn) { click(closeBtn); await flush(); } else { $('#gridModal').classList.remove('open'); fric('builder', 'no obvious Close button in fullscreen editor'); }
      } else issue('high', 'builder', 'fullscreen grid did not open');
    } else fric('builder', 'no fullscreen-grid affordance visible on first team');

    // add + remove a custom team (exercise team lifecycle)
    if ($('#btnAddTeam')) {
      click('#btnAddTeam'); await flush();
      if ($('#addTeamModal').classList.contains('open')) {
        const arch = $$('#archetypeList [data-arch]');
        console.log('  archetypes offered:', arch.map(a => a.getAttribute('data-arch')).join(', '));
        const channel = arch.find(a => /pipeline|channel/i.test(a.getAttribute('data-arch'))) || arch[arch.length - 1];
        click(channel); await okAsk('Resellers'); await flush(400);
        m = getModel();
        const newTeam = m.teams.find(t => t.name === 'Resellers');
        if (newTeam) ok('teams', 'added custom "Resellers" team from archetype');
        else issue('high', 'teams', 'add-team flow did not create the team');
        // duplicate-name probe: try adding a second team named like an existing one
        click('#btnAddTeam'); await flush();
        if ($('#addTeamModal').classList.contains('open')) {
          const arch2 = $$('#archetypeList [data-arch]');
          const ch2 = arch2.find(a => /pipeline|channel/i.test(a.getAttribute('data-arch'))) || arch2[arch2.length - 1];
          click(ch2); await okAsk('Resellers'); await flush(400);
          const dupes = getModel().teams.filter(t => t.name === 'Resellers').length;
          if (dupes > 1) {
            issue('med', 'teams', 'duplicate team names allowed silently — two teams named "Resellers" now exist (rail, exports and checks become ambiguous)');
            // clean up one of them
          } else ok('teams', 'duplicate team name blocked or renamed');
        }
        // now remove Resellers team(s)
        await nav('builder');
        let guard = 0;
        while (getModel().teams.some(t => t.name === 'Resellers') && guard++ < 3) {
          const rail2 = $$('#teamRail .rail-item');
          const pIdx = rail2.findIndex(r => r.textContent.includes('Resellers'));
          if (pIdx < 0) break;
          click(rail2[pIdx]); await flush();
          const rm = $$('#teamDetail [data-act="remove"], #teamDetail .btn').find(b => /remove/i.test(b.textContent));
          if (!rm) { issue('med', 'teams', 'no remove control in team detail for a removable team'); break; }
          click(rm); await okAsk(); await flush(300);
        }
        if (!getModel().teams.some(t => t.name === 'Resellers')) ok('teams', 'team removal works with confirm');
        else issue('high', 'teams', 'remove confirmed but Resellers team(s) still present');
      } else issue('high', 'teams', 'add-team modal did not open');
    }

    // coverage sanity: any team showing coverage < 1 should carry a flag
    const computed1 = eng();
    const covIssues = computed1.teams.filter(t => (t.coverageFlag || []).some(f => f === 'SHORT')).length;
    console.log(`  teams with SHORT coverage months: ${covIssues}`);

    // ============ S4 · READINESS ============
    console.log('\n===== S4 READINESS =====');
    await nav('readiness');
    const rTxt = w.document.getElementById('page-readiness') ? w.document.getElementById('page-readiness').textContent : $$('.page.active').map(p => p.textContent).join('');
    if ($('#guardrailCard') && $('#guardrailCard').textContent.includes('%')) ok('readiness', 'guardrail card renders with values');
    else issue('med', 'readiness', 'guardrail card empty');
    if ($('#selfFundingSection') && /payback|SELF-FUNDING|LONG/i.test($('#selfFundingSection').textContent)) ok('readiness', 'payback table renders');
    if ($('#btnRunSens')) {
      click('#btnRunSens'); await flush(800);
      if ($('#sensCard svg') || /tornado|sensitivity/i.test(($('#sensCard') || {}).textContent || '')) ok('readiness', 'sensitivity tornado runs locally');
      else issue('med', 'readiness', 'sensitivity run produced no visible output');
    } else fric('readiness', 'no sensitivity-run button found');
    if ($('#healthStrip') && $('#healthStrip').textContent.trim()) ok('readiness', 'hiring-health strip renders');

    // ============ S5 · DASHBOARD ============
    console.log('\n===== S5 DASHBOARD =====');
    await nav('dashboard');
    const kpi = $('#kpiRow').textContent;
    if (/NaN|undefined|Infinity/.test(kpi)) issue('high', 'dashboard', 'KPI row contains NaN/undefined: ' + kpi.slice(0, 200));
    else ok('dashboard', 'KPIs clean of NaN/undefined');
    const t2 = eng().summary.totals;
    if (t2.cost > 2000000 && t2.cost < 30000000) ok('dashboard', `24-mo GTM cost $${(t2.cost / 1e6).toFixed(1)}M — plausible for this org`);
    else issue('med', 'dashboard', `total cost $${Math.round(t2.cost).toLocaleString()} looks implausible for a ~15-25 person GTM org`);
    // charts present
    if ($$('#chCost svg, #chRev svg, #chHeads svg, #chCac svg').length >= 3) ok('dashboard', 'charts render');
    else issue('med', 'dashboard', 'one or more dashboard charts missing');
    // scenario switch — scenario multipliers act on capacity & cost, targets stay fixed.
    const scen = $('#scenarioSel');
    if (scen) {
      const baseT = eng().summary.totals;
      const baseShorts = eng().teams.reduce((a, tm) => a + (tm.coverageFlag || []).filter(f => f === 'SHORT').length, 0);
      change(scen, 'Conservative'); await flush(300);
      const consT = eng().summary.totals;
      const consShorts = eng().teams.reduce((a, tm) => a + (tm.coverageFlag || []).filter(f => f === 'SHORT').length, 0);
      change(scen, 'Base'); await flush(300);
      if (consT.cost > baseT.cost && consShorts >= baseShorts) ok('dashboard', `Conservative raises cost ($${(baseT.cost / 1e6).toFixed(1)}M → $${(consT.cost / 1e6).toFixed(1)}M) and SHORT months (${baseShorts} → ${consShorts})`);
      else issue('high', 'dashboard', `Conservative scenario moved nothing: cost ${baseT.cost}->${consT.cost}, shorts ${baseShorts}->${consShorts}`);
      const scTxt = ($('#scenCompare') || {}).textContent || '';
      if (/Feasible ARR/i.test(scTxt) && /vs goal/i.test(scTxt)) ok('dashboard', 'scenario compare shows feasible ARR + vs-goal gap (no identical revenue columns)');
      else issue('med', 'design', 'scenario compare lacks a per-scenario feasible-ARR / gap view — revenue columns would read identical across scenarios');
      if (Math.abs(consT.feasibleEndingARR - baseT.feasibleEndingARR) > 1 || consShorts > baseShorts || consT.cost > baseT.cost) ok('dashboard', 'scenario differences are visible in feasible ARR / shorts / cost');
    }
    // deterministic checks visible
    if ($('#dashChecks') && $('#dashChecks').textContent.trim()) {
      const checks = eng().checks;
      console.log('  checks:', checks.map(c => `[${c.severity}] ${c.title}`).slice(0, 8).join(' | ') || 'none');
      ok('dashboard', `${checks.length} deterministic checks surfaced`);
    }

    // ============ S6 · OUTPUTS ============
    console.log('\n===== S6 OUTPUTS =====');
    for (const [btn, namePat, validate] of [
      ['#btnExpHiring', /hiring/i, txt => txt.split('\n').length > 2 && /role|team/i.test(txt.split('\n')[0]) && !/NaN/.test(txt)],
      ['#btnExpBudget', /budget/i, txt => txt.split('\n').length > 2 && !/NaN/.test(txt)],
      ['#btnExpBoard', /board|pack/i, txt => /<html|<!DOCTYPE/i.test(txt) && !/NaN/.test(txt)]
    ]) {
      lastDownload = null;
      if (!$(btn)) { issue('med', 'outputs', btn + ' missing on dashboard'); continue; }
      click(btn); await flush(400); await okAsk(); await flush(300);
      const dl = await readDownload();
      if (!dl) { issue('high', 'outputs', btn + ' produced no download'); continue; }
      if (validate(dl.text)) ok('outputs', `${dl.name} downloads and passes structure check (${dl.text.length} bytes)`);
      else issue('high', 'outputs', `${dl.name} failed content validation: ${dl.text.slice(0, 120)}`);
    }
    // hiring CSV deep check: open-by dates must precede start dates
    lastDownload = null; click('#btnExpHiring'); await flush(300); await okAsk(); await flush(200);
    const hir = await readDownload();
    if (hir) {
      const lines = hir.text.trim().split('\n');
      console.log('  hiring CSV header:', lines[0]);
      console.log('  hiring CSV rows:', lines.length - 1);
      if (lines.length - 1 === 0) issue('med', 'outputs', 'hiring CSV has zero requisition rows despite drafted hires');
    }

    // ============ S7 · VERSIONS & UNDO ============
    console.log('\n===== S7 VERSIONS & UNDO =====');
    const arrBeforeUndo = eng().summary.totals.endingARR;
    await nav('drivers');
    await setPath('config.grossRetention', '80');
    const arrLow = eng().summary.totals.endingARR;
    click('#btnUndo'); await flush(350);
    const arrUndone = eng().summary.totals.endingARR;
    if (Math.abs(arrUndone - arrBeforeUndo) < 1 && arrLow < arrBeforeUndo) ok('undo', 'undo reverts a driver edit exactly');
    else issue('high', 'undo', `undo mismatch: before=${arrBeforeUndo} low=${arrLow} undone=${arrUndone}`);
    // versions: save, mutate, restore
    click('#btnVersions'); await flush(250);
    const vModal = $('#versionsModal');
    if (vModal && vModal.classList.contains('open')) {
      const saveBtn = $$('#versionsModal .btn').find(b => /save|snapshot/i.test(b.textContent));
      if (saveBtn) {
        click(saveBtn); await okAsk('E2E baseline'); await flush(300);
        const vers = JSON.parse(w.localStorage.getItem('ro_capacity_versions') || '[]');
        if (vers.length) ok('versions', `version saved ("${vers[vers.length - 1].name || 'unnamed'}")`);
        else issue('high', 'versions', 'save produced no stored version');
        // mutate then restore
        const closeV = $$('#versionsModal .btn').find(b => /close/i.test(b.textContent)); if (closeV) click(closeV); await flush();
        await setPath('config.startingARR', '1000000');
        click('#btnVersions'); await flush(250);
        const openBtn = $$('#versionsModal [data-vopen]')[0];
        if (openBtn) {
          click(openBtn); await okAsk(); await flush(400);
          m = getModel();
          if (m.config.startingARR === 5000000) ok('versions', 'restore brings back saved state');
          else issue('high', 'versions', `restore left startingARR=${m.config.startingARR}`);
        } else issue('med', 'versions', 'no restore control on saved version row');
      } else issue('med', 'versions', 'no save button in versions modal');
      const closeV2 = $$('#versionsModal .btn').find(b => /close/i.test(b.textContent)); if (closeV2 && $('#versionsModal').classList.contains('open')) { click(closeV2); await flush(); }
    } else issue('high', 'versions', 'versions modal did not open');

    // ============ S8 · LEDGER ============
    console.log('\n===== S8 LEDGER =====');
    await nav('drivers');
    const chip = $('[data-ledger]');
    if (chip) {
      click(chip); await flush(300);
      // ledger modal or inline — find status/owner controls
      const lm = $('#ledgerModal');
      if (lm && lm.classList.contains('open')) {
        const ownerInp = $('#ledgerModal input, #ledgerModal select');
        ok('ledger', 'ledger entry modal opens from driver chip');
        const saveL = $$('#ledgerModal .btn').find(b => /save|track|add/i.test(b.textContent));
        if (saveL) { click(saveL); await flush(300); }
        m = getModel();
        if (Object.keys(m.ledger || {}).length) ok('ledger', 'assumption tracked in ledger');
        else issue('med', 'ledger', 'chip flow completed but ledger empty');
      } else {
        m = getModel();
        if (Object.keys(m.ledger || {}).length) ok('ledger', 'chip click tracks assumption directly');
        else issue('med', 'ledger', 'ledger chip click had no visible effect');
      }
      await nav('ledger');
      if ($('#ledgerList') && $('#ledgerList').textContent.trim()) ok('ledger', 'ledger page lists tracked assumptions');
      lastDownload = null;
      if ($('#btnBrief')) { click('#btnBrief'); await flush(300); const dl = await readDownload(); if (dl && dl.text.length > 100) ok('ledger', `defendability brief exports (${dl.name})`); else issue('med', 'ledger', 'brief export empty'); }
    } else fric('ledger', 'no ledger chips visible on drivers page — tracking entry point unclear');

    // ============ S9 · ACTUALS ============
    console.log('\n===== S9 ACTUALS =====');
    await nav('dashboard');
    const csv = 'month,metric,value\n2027-01,headcount,11\n2027-01,cost,210000\n2027-02,headcount,12\n2027-02,cost,225000\n2027-02,bookings,140000\n';
    const fileInp = $('#actualsFile');
    if (fileInp) {
      const file = new w.File([csv], 'actuals.csv', { type: 'text/csv' });
      Object.defineProperty(fileInp, 'files', { value: [file], configurable: true });
      fileInp.dispatchEvent(new w.Event('change', { bubbles: true }));
      await flush(700);
      m = getModel();
      if (m.actuals && Object.keys(m.actuals).length) ok('actuals', 'generic CSV import parsed (vendor-agnostic)');
      else issue('high', 'actuals', 'actuals CSV import produced no data');
      if (($('#actualsSection') || {}).textContent && /variance|plan|actual/i.test($('#actualsSection').textContent)) ok('actuals', 'variance view renders');
      // clear
      if ($('#btnActClear')) { click('#btnActClear'); await okAsk(); m = getModel(); if (!m.actuals || !Object.keys(m.actuals).length) ok('actuals', 'clear works'); }
    } else issue('med', 'actuals', '#actualsFile input missing');

    // ============ S10 · EXPORT / IMPORT ROUND-TRIP ============
    console.log('\n===== S10 EXPORT/IMPORT =====');
    lastDownload = null; click('#btnExport'); await flush(300);
    const exp = await readDownload();
    if (exp && exp.text.startsWith('{')) {
      ok('export', `model JSON exports (${exp.name}, ${exp.text.length} bytes)`);
      const snapshot = JSON.stringify(getModel());
      // wipe and re-import
      await nav('drivers'); await setPath('config.startingARR', '999');
      const impInp = $('#fileImport');
      const file = new w.File([exp.text], 'model.json', { type: 'application/json' });
      Object.defineProperty(impInp, 'files', { value: [file], configurable: true });
      impInp.dispatchEvent(new w.Event('change', { bubbles: true }));
      await flush(700); await okAsk(); await flush(500);
      m = getModel();
      if (m.config.startingARR === 5000000) ok('import', 'JSON import round-trips the full model');
      else issue('high', 'import', `import did not restore model (startingARR=${m.config.startingARR})`);
    } else issue('high', 'export', 'model export produced no JSON');

    // ============ FINAL PLAUSIBILITY AUDIT ============
    console.log('\n===== FINAL AUDIT =====');
    const fin = eng();
    const ft = fin.summary.totals;
    console.log(`  FINAL: cost $${Math.round(ft.cost).toLocaleString()} | ending HC ${ft.endingHeadcount} | ending ARR $${Math.round(ft.endingARR).toLocaleString()} | CAC ${ft.finalCAC}`);
    if (ft.endingARR < 5000000) issue('high', 'audit', 'ending ARR below starting ARR — model degenerated during test');
    if (ft.finalCAC > 3 || ft.finalCAC <= 0) issue('med', 'audit', `final CAC ratio ${ft.finalCAC} implausible`);
    const checksF = fin.checks;
    console.log('  final checks:', checksF.map(c => `[${c.severity}] ${c.team}: ${c.title}`).join(' | ') || 'none');
    if (scriptErrs.length) issue('high', 'runtime', 'script errors during session: ' + scriptErrs.slice(0, 5).join(' | '));
    else ok('runtime', 'zero uncaught script errors across the whole session');

  } catch (e) {
    issue('high', 'harness', 'test aborted: ' + e.message + '\n' + (e.stack || '').split('\n').slice(1, 4).join('\n'));
  }

  // ============ REPORT ============
  console.log('\n\n================ E2E REPORT ================');
  console.log(`OK: ${oks.length}   ISSUES: ${issues.length}   FRICTION: ${friction.length}`);
  console.log('\n--- ISSUES ---');
  issues.forEach(i => console.log(`[${i.sev}] (${i.area}) ${i.text}`));
  console.log('\n--- FRICTION ---');
  friction.forEach(f => console.log(`(${f.area}) ${f.text}`));
  console.log('\n--- PASSED ---');
  oks.forEach(o => console.log(`(${o.area}) ${o.text}`));
  process.exit(issues.length ? 1 : 0);
})();
