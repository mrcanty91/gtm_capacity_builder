/* Regression: the six E2E findings fixed 2026-06-11.
   F1 country-delete auto-rebalance · E1 unique team names · E2 scenario compare feasible ARR
   E3 staff-to-goal disclosure · F2 dashboard reset · F3 blank start. */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const dir = require('path').resolve(__dirname, '..', '..');
const dom = new JSDOM(fs.readFileSync(dir + '/index.html', 'utf8'), { runScripts: 'outside-only', url: 'http://localhost/', pretendToBeVisual: true });
const w = dom.window;
w.fetch = () => Promise.reject(new Error('no network'));
const errs = [];
w.addEventListener('error', e => errs.push(e.message));
for (const f of ['engine.js', 'charts.js', 'agents.js', 'app.js']) {
  if (f === 'app.js') w.eval("localStorage.setItem('ro_capacity_model_v2', JSON.stringify(Engine.demoModel()))"); // suites exercise the populated demo plan
  w.eval(fs.readFileSync(dir + '/js/' + f, 'utf8'));
}
const $ = s => w.document.querySelector(s);
const $$ = s => Array.from(w.document.querySelectorAll(s));
const click = el => (typeof el === 'string' ? $(el) : el).dispatchEvent(new w.Event('click', { bubbles: true }));
const change = (el, v) => { const t = typeof el === 'string' ? $(el) : el; t.value = v; t.dispatchEvent(new w.Event('change', { bubbles: true })); };
const flush = (ms = 200) => new Promise(r => setTimeout(r, ms));
let fails = 0;
const expect = (n, c) => { console.log((c ? 'PASS' : 'FAIL'), n); if (!c) fails++; };
const getModel = () => JSON.parse(w.localStorage.getItem('ro_capacity_model_v2'));
const eng = () => w.eval(`Engine.compute(JSON.parse(localStorage.getItem('ro_capacity_model_v2')))`);
const okAsk = async (val) => { await flush(80); if (!$('#askModal').classList.contains('open')) return false; if (val !== undefined && $('#askInput')) change('#askInput', val); click('#askOk'); await flush(250); return true; };
const nav = async p => { click($(`.nav-tab[data-page=${p}]`)); await flush(); };

(async () => {
  await flush(300);

  // ---- F1: country delete auto-rebalances mixes ----
  await nav('rates');
  let m = getModel();
  const idxUK = m.fx.findIndex(f => f.country === 'United Kingdom');
  click($(`#fxSection [data-delfx="${idxUK}"]`)); await okAsk(); await flush(300);
  const mixErrs = eng().checks.filter(c => /mix sums/.test(c.title)).length;
  expect('F1: deleting UK leaves zero broken mixes (auto-rebalance)', mixErrs === 0);
  m = getModel();
  expect('F1: UK gone from FX', !m.fx.some(f => f.country === 'United Kingdom'));
  const aeRole = m.rateCard.roles.find(r => r.name === 'Account Executive');
  const aeSum = Object.entries(aeRole.mix).filter(([c]) => m.fx.some(f => f.country === c)).reduce((a, [, v]) => a + v, 0);
  expect('F1: AE mix re-sums to 100%', Math.abs(aeSum - 1) < 0.005);

  // ---- E1: duplicate team names auto-suffix ----
  await nav('builder');
  click('#btnAddTeam'); await flush();
  const arch = $$('#archetypeList [data-arch]');
  click(arch.find(a => a.getAttribute('data-arch') === 'pipeline-channel')); await okAsk('Sales'); await flush(400);
  m = getModel();
  expect('E1: naming a new team "Sales" auto-suffixes', m.teams.filter(t => t.name === 'Sales').length === 1 && m.teams.some(t => t.name === 'Sales 2'));
  const dupCount = m.teams.map(t => t.name).filter((n, i, a) => a.indexOf(n) !== i).length;
  expect('E1: no duplicate names in model', dupCount === 0);
  await nav('builder');
  const rail = $$('#teamRail .rail-item');
  const i2 = rail.findIndex(r => r.textContent.includes('Sales 2'));
  click(rail[i2]); await flush();
  const rm = $$('#teamDetail .btn').find(b => /remove/i.test(b.textContent));
  click(rm); await okAsk(); await flush(300);
  expect('E1: cleanup — Sales 2 removed', !getModel().teams.some(t => t.name === 'Sales 2'));

  // ---- E2: scenario compare shows feasible ARR + gap, not identical revenue ----
  await nav('dashboard');
  const sc = $('#scenCompare');
  expect('E2: compare table has Feasible ARR column', /Feasible ARR/i.test(sc.textContent));
  expect('E2: compare table has vs-goal gap column', /vs goal/i.test(sc.textContent));
  expect('E2: old identical Revenue/Ending ARR columns gone', !/<th>Revenue<\/th>/.test(sc.innerHTML) && !/<th>Ending ARR<\/th>/.test(sc.innerHTML));
  expect('E2: footnote explains fixed targets', /don't move across scenarios/i.test(sc.textContent));

  // ---- E3: staff-to-goal discloses tripped checks ----
  await nav('drivers');
  if ($('#btnStaffGoal')) {
    click('#btnStaffGoal'); await okAsk(); await flush(900);
    const disclosed = $('#askModal').classList.contains('open') && /check/i.test($('#askBody').textContent);
    const toastVisible = ($('#toast') || {}).style && $('#toast').style.display !== 'none';
    expect('E3: post-draft disclosure (modal with checks, or clean toast)', disclosed || toastVisible);
    if (disclosed) {
      expect('E3: disclosure lists actual flags + Undo note', /Undo/i.test($('#askBody').textContent));
      click('#askOk'); await flush(200);
    }
  } else expect('E3: btnStaffGoal present', false);
  click('#btnUndo'); await flush(300);

  // ---- F2/F3: dashboard lifecycle buttons ----
  await nav('dashboard');
  expect('F2: reset button on dashboard', !!$('#btnDashReset'));
  expect('F3: start-blank button on dashboard', !!$('#btnStartBlank'));
  click('#btnStartBlank'); await okAsk(); await flush(400);
  m = getModel();
  expect('F3: blank model — no teams, no roles, US only', m.teams.length === 0 && m.rateCard.roles.length === 0 && m.fx.length === 1 && m.fx[0].country === 'United States');
  expect('F3: blank start lands on Team Setup', $('.nav-tab[data-page=rates]').classList.contains('active'));
  let crashed = null;
  try { const c = eng(); if (!c || !c.summary) crashed = 'no summary'; } catch (e) { crashed = e.message; }
  expect('F3: engine computes blank model without crashing', !crashed);
  for (const p of ['dashboard', 'rates', 'drivers', 'builder', 'readiness', 'ledger', 'board', 'agents']) { await nav(p); }
  expect('F3: all pages render with blank model, zero script errors', errs.length === 0);
  expect('F3: blank dashboard has no NaN', !/NaN|undefined/.test($('#kpiRow').textContent));
  for (let i = 0; i < 6 && getModel().teams.length === 0; i++) { click('#btnUndo'); await flush(300); }
  expect('F3: undo walks back to the pre-blank org', getModel().teams.length > 0);
  await nav('dashboard');
  click('#btnDashReset'); await okAsk(); await flush(400);
  m = getModel();
  expect('F2: dashboard reset restores demo defaults (5 countries)', m.fx.length === 5 && m.teams.length === 6);
  const t = eng().summary.totals;
  expect('F2: reset loads the Series B sample plan ($30M ending-ARR goal)', Math.abs(t.endingARR - 30000000) < 50000);

  console.log('script errors:', errs.length ? errs.join(' | ') : 'none');
  console.log(fails ? `${fails} FAILURES` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
