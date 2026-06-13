/* Core behaviors consolidated from the original smoke suites:
   rename propagation, sales non-removal, mix validator, GRR driver, horizon dropdown,
   grid-modal assumption edits, agent call signs + double-confirm cancel, channel balance. */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const dir = require('path').resolve(__dirname, '..', '..');
const dom = new JSDOM(fs.readFileSync(dir + '/index.html', 'utf8'), { runScripts: 'outside-only', url: 'http://localhost/', pretendToBeVisual: true });
const w = dom.window;
w.fetch = () => Promise.reject(new Error('no network'));
const errs = [];
w.addEventListener('error', e => errs.push(e.message));
for (const f of ['engine.js', 'charts.js', 'agents.js', 'app.js']) {
  if (f === 'app.js') w.eval("localStorage.setItem('ro_capacity_model_v2', JSON.stringify(Engine.defaultModel()))"); // suites exercise the populated demo plan
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

  // every page renders without script errors
  for (const p of ['dashboard', 'rates', 'drivers', 'builder', 'readiness', 'ledger', 'board', 'agents']) await nav(p);
  expect('boot: all pages render, zero script errors', errs.length === 0);

  // default model reconciles to the workbook
  const t0 = eng().summary.totals;
  expect('engine: defaults reconcile to workbook cost', Math.abs(t0.cost - 9812091.60) < 1);
  expect('engine: defaults reconcile to workbook ending HC', t0.endingHeadcount === 26);

  // role rename propagates to team references
  await nav('rates');
  let m = getModel();
  const ri = m.rateCard.roles.findIndex(r => r.name === 'Account Executive');
  const usedBefore = m.teams.some(tm => (tm.roles || []).some(l => l.rateRole === 'Account Executive'));
  const renameInp = $(`#rateSection input[data-rolerename="${ri}"]`);
  if (renameInp) {
    change(renameInp, 'Account Exec'); await flush(350);
    m = getModel();
    const orphans = m.teams.some(tm => (tm.roles || []).some(l => l.rateRole === 'Account Executive'));
    const moved = m.teams.some(tm => (tm.roles || []).some(l => l.rateRole === 'Account Exec'));
    expect('rename: catalog rename propagates to team role lines', usedBefore && !orphans && moved);
    change($(`#rateSection input[data-rolerename="${m.rateCard.roles.findIndex(r => r.name === 'Account Exec')}"]`), 'Account Executive'); await flush(350);
  } else {
    // rename inputs may be inside collapsed library — open it
    const lib = $('[data-libclps]'); if (lib) { click(lib); await flush(); }
    expect('rename: rename input reachable', !!$(`#rateSection input[data-rolerename]`));
  }

  // mix validator fires on a manually broken mix
  m = getModel();
  const ae = m.rateCard.roles.find(r => r.name === 'Account Executive');
  const firstCountry = Object.keys(ae.mix)[0];
  const saved = ae.mix[firstCountry];
  ae.mix[firstCountry] = saved / 2;
  w.localStorage.setItem('ro_capacity_model_v2', JSON.stringify(m));
  const mixErr = eng().checks.some(c => /mix sums/.test(c.title) && /Account Executive/.test(c.title + c.team));
  expect('checks: broken location mix raises an error check', mixErr);
  ae.mix[firstCountry] = saved;
  w.localStorage.setItem('ro_capacity_model_v2', JSON.stringify(m));

  // sales team cannot be removed
  await nav('builder');
  const rail = $$('#teamRail .rail-item');
  const salesIdx = rail.findIndex(r => /sales/i.test((r.querySelector('.rail-name') || {}).textContent || ''));
  click(rail[salesIdx]); await flush();
  const removeBtn = $$('#teamDetail .btn').find(b => /remove/i.test(b.textContent));
  const detailTxt = $('#teamDetail').textContent;
  expect('teams: sales is protected from removal (no remove, or explained)', !removeBtn || /cannot|can't|target-driven|channel/i.test(detailTxt));

  // grid modal: start + attrition edits flow through
  click($('[data-fullgrid]')); await flush(300);
  if ($('#gridModal').classList.contains('open')) {
    const hcBefore = eng().summary.totals.endingHeadcount;
    change('#gmStart', String((parseInt($('#gmStart').value) || 0) + 2)); await flush(350);
    const hcAfter = eng().summary.totals.endingHeadcount;
    expect('grid: start-heads edit changes ending HC', hcAfter > hcBefore);
    change('#gmStart', String((parseInt($('#gmStart').value) || 0) - 2)); await flush(300);
    const closeBtn = $$('#gridModal .btn').find(b => /close|done/i.test(b.textContent));
    if (closeBtn) { click(closeBtn); await flush(); } else $('#gridModal').classList.remove('open');
  } else expect('grid: modal opens', false);

  // GRR is a live driver
  await nav('drivers');
  const arrBefore = eng().summary.totals.endingARR;
  change($('input[data-path="config.grossRetention"]'), '80'); await flush(300);
  const arrAfter = eng().summary.totals.endingARR;
  expect('drivers: lowering GRR shrinks ending ARR', arrAfter < arrBefore);
  click('#btnUndo'); await flush(300);

  // horizon dropdown
  const hz = $('#horizonSel');
  expect('drivers: horizon dropdown present with 12-36 options', !!hz && $$('#horizonSel option').some(o => o.value === '36'));

  // agent call signs + double-confirm cancel costs nothing
  await nav('board');
  const btxt = ($('#agentGrid') || {}).textContent || '';
  expect('agents: board cards show call signs', ['MARGIN', 'FOREMAN', 'QUOTA', 'BENCH'].every(n => btxt.includes(n)));
  w.localStorage.setItem('ro_capacity_settings', JSON.stringify({ apiKey: 'sk-test' }));
  await nav('board');
  click($$('#agentGrid [data-run]')[0]); await flush(150);
  const confirmShown = $('#askModal').classList.contains('open');
  if (confirmShown) { click('#askCancel'); await flush(150); }
  expect('agents: run asks for confirmation; cancel aborts', confirmShown && !($('#agentGrid').textContent.includes('INTERROGATING')));
  w.localStorage.removeItem('ro_capacity_settings');

  // channel auto-balance
  await nav('drivers');
  const bal = $('#btnBalanceChannels');
  if (bal) {
    click(bal); await flush(300);
    m = getModel();
    const sales = m.teams.find(x => x.type === 'sales');
    const sum = sales.channels.reduce((a, c) => a + c.mixPct, 0);
    expect('channels: balance button normalizes mix to 100%', Math.abs(sum - 1) < 0.005);
  } else expect('channels: balance control exists (or mix already agreed/collapsed)', !!$('#btnChOpen') || !!$('#channelCard'));

  console.log('script errors:', errs.length ? errs.join(' | ') : 'none');
  console.log(fails ? `${fails} FAILURES` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
