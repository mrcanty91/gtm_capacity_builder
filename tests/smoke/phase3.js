/* Phase 3: saved-run diff/compare, setup checklist, quarter shading in the hiring grid. */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const dir = require('path').resolve(__dirname, '..', '..');
const dom = new JSDOM(fs.readFileSync(dir + '/index.html', 'utf8'), { runScripts: 'outside-only', url: 'http://localhost/', pretendToBeVisual: true });
const w = dom.window;
w.fetch = () => Promise.reject(new Error('no network'));
const errs = [];
w.addEventListener('error', e => errs.push(e.message));
w.URL.createObjectURL = () => 'blob:x';
w.URL.revokeObjectURL = () => {};
w.HTMLAnchorElement.prototype.click = function () {};
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
const okAsk = async (val) => { await flush(80); if (!$('#askModal').classList.contains('open')) return false; if (val !== undefined && $('#askInput')) change('#askInput', val); click('#askOk'); await flush(250); return true; };
const nav = async p => { click($(`.nav-tab[data-page=${p}]`)); await flush(); };

(async () => {
  await flush(300);

  // ---- 1. quarter shading in the fullscreen grid ----
  await nav('builder');
  click($$('#teamRail .rail-item')[0]); await flush();
  click($('[data-fullgrid]')); await flush(300);
  expect('shade: grid modal open', $('#gridModal').classList.contains('open'));
  const banded = $$('#gridModal .qband');
  expect('shade: alternate quarters carry the qband class', banded.length > 0);
  // demo starts JUL (Q3, odd index from calendar) — check correctness: a banded th belongs to Q2 or Q4
  const headBand = $$('#gridModal thead th.qband');
  expect('shade: header cells banded too', headBand.length > 0);
  // 24 columns over 2 years -> roughly half banded across all 5 row types
  const closeBtn = $$('#gridModal .btn').find(b => /close|done/i.test(b.textContent));
  if (closeBtn) { click(closeBtn); await flush(); } else $('#gridModal').classList.remove('open');

  // ---- 2. version diff / compare ----
  // save baseline
  click('#btnVersions'); await flush(250);
  change('#vName', 'Baseline 8M'); click($$('#versionsBody .btn').find(b => /save current run/i.test(b.textContent))); await flush(300);
  expect('diff: baseline saved', JSON.parse(w.localStorage.getItem('ro_capacity_versions') || '[]').length === 1);
  click($$('#versionsBody .btn').find(b => /close/i.test(b.textContent))); await flush();
  // change drivers + a hire, then compare current vs baseline
  await nav('drivers');
  change($('input[data-path="config.startingARR"]'), '9M'); await flush(300);
  change($('input[data-path="config.grossRetention"]'), '85'); await flush(300);
  click('#btnVersions'); await flush(250);
  expect('diff: compare section present with two pickers', !!$('#vA') && !!$('#vB') && !!$('#vCompare'));
  // default: A = saved version, B = current
  click('#vCompare'); await flush(600);
  const out = $('#vDiffOut').textContent;
  expect('diff: KPI table renders with deltas', /GTM cost/.test(out) && /Ending ARR/.test(out) && /Δ|−|\+/.test(out));
  expect('diff: changed drivers listed old → new', /Starting ARR/.test(out) && /Gross retention/.test(out));
  expect('diff: unchanged drivers not listed', !/Sales-cycle lag/.test(out));
  expect('diff: feasible ARR row present', /Feasible ARR/.test(out));
  expect('diff: no NaN/undefined', !/NaN|undefined/.test(out));
  // compare current vs current → no driver changes
  change('#vA', ''); change('#vB', ''); click('#vCompare'); await flush(500);
  expect('diff: self-compare shows no driver changes', /None — same dials/.test($('#vDiffOut').textContent));
  // ---- run file round-trip: export a saved run, re-import it as a new entry ----
  let lastDl = null, lastBlobV = null;
  w.URL.createObjectURL = b => { lastBlobV = b; return 'blob:x'; };
  w.HTMLAnchorElement.prototype.click = function () { if (this.download) lastDl = { name: this.download, blob: lastBlobV }; };
  const fileBtn = $('#versionsBody [data-vfile]');
  expect('vfile: per-run file export button present', !!fileBtn);
  click(fileBtn); await flush(300);
  expect('vfile: run downloads as a wrapped json file', !!lastDl && /^run-/.test(lastDl.name));
  const runTxt = await lastDl.blob.text();
  const runData = JSON.parse(runTxt);
  expect('vfile: wrapper carries kind/name/json', runData.kind === 'gtm-capacity-run' && !!runData.name && !!runData.json);
  // import it back — list should grow by one
  const beforeN = JSON.parse(w.localStorage.getItem('ro_capacity_versions')).length;
  const vfInp = $('#vFile');
  Object.defineProperty(vfInp, 'files', { value: [new w.File([runTxt], 'run-baseline-8m.json', { type: 'application/json' })], configurable: true });
  vfInp.dispatchEvent(new w.Event('change', { bubbles: true }));
  await flush(600);
  const afterN = JSON.parse(w.localStorage.getItem('ro_capacity_versions')).length;
  expect('vfile: imported run lands in the saved list (current plan untouched)', afterN === beforeN + 1);
  // a raw model export also imports as a run
  const rawModel = w.localStorage.getItem('ro_capacity_model_v2');
  Object.defineProperty(vfInp, 'files', { value: [new w.File([rawModel], 'gtm-capacity-model-export.json', { type: 'application/json' })], configurable: true });
  vfInp.dispatchEvent(new w.Event('change', { bubbles: true }));
  await flush(600);
  expect('vfile: raw model JSON wraps into a run too', JSON.parse(w.localStorage.getItem('ro_capacity_versions')).length === afterN + 1);
  click($$('#versionsBody .btn').find(b => /close/i.test(b.textContent))); await flush();
  // restore
  click('#btnUndo'); await flush(250); click('#btnUndo'); await flush(250);

  // ---- numbers font: plain open zero, enforced. Monospace fonts mark their zeros
  //      (dot or slash) almost universally — so numerals run on Inter Tight with
  //      tabular figures, and NO monospace font name may appear in the app at all. ----
  const ctCss = fs.readFileSync(dir + '/css/colors_and_type.css', 'utf8');
  const acCss = fs.readFileSync(dir + '/css/app.css', 'utf8');
  expect('font: --font-mono token is Inter Tight (plain zero, proven rendering)', /--font-mono:\s*"Inter Tight"/.test(ctCss));
  expect('font: --font-num token is Inter Tight too', /--font-num:\s*'Inter Tight'/.test(acCss));
  const everything = ['css/colors_and_type.css', 'css/app.css', 'js/charts.js', 'js/app.js', 'js/agents.js', 'js/engine.js', 'index.html']
    .map(f => fs.readFileSync(dir + '/' + f, 'utf8')).join('\n');
  expect('font: no marked-zero mono faces anywhere (Space Mono, IBM Plex, Roboto Mono, SF Mono, Menlo, Consolas)',
    !/Space[ +]Mono|IBM[ +]Plex|Roboto[ +]Mono|SFMono|Menlo|Consolas/i.test(everything));
  expect('font: slashed-zero feature never enabled', !/slashed-zero/.test(everything));
  expect('font: tabular figures on numeric surfaces', /font-variant-numeric: tabular-nums/.test(acCss));

  // ---- 3. setup checklist ----
  await nav('dashboard');
  expect('checklist: hidden on demo data', !/SETUP CHECKLIST/.test($('#sampleBanner').textContent));
  // blank start → checklist appears with 0 done
  click('#btnStartBlank'); await okAsk(); await flush(400);
  await nav('dashboard');
  const sb = $('#sampleBanner').textContent;
  expect('checklist: appears on a blank model', /SETUP CHECKLIST/.test(sb));
  expect('checklist: 0 of 5 done on blank', /0 OF 5 DONE/.test(sb));
  expect('checklist: no demo banner on blank model', !/DEMO DATA/.test(sb));
  // step buttons navigate
  const step1 = $('#sampleBanner [data-clstep="rates"]');
  click(step1); await flush();
  expect('checklist: step click navigates to Team Setup', $('.nav-tab[data-page=rates]').classList.contains('active'));
  // import a roles template -> step 1 completes
  const csv = 'role,kind,dept,country,currency,base_local,ote_variable_local,mix_pct\nAccount Executive,ic,sales,United States,USD,120000,120000,100\n';
  const inp = $('#tplFile');
  Object.defineProperty(inp, 'files', { value: [new w.File([csv], 'r.csv', { type: 'text/csv' })], configurable: true });
  inp.dispatchEvent(new w.Event('change', { bubbles: true }));
  await flush(700); await okAsk(); await flush(200);
  await nav('dashboard');
  expect('checklist: progresses after roles imported (1 of 5)', /1 OF 5 DONE/.test($('#sampleBanner').textContent));
  // dismiss persists in the model
  click('#btnClDismiss'); await flush(300);
  expect('checklist: dismiss hides it', !/SETUP CHECKLIST/.test($('#sampleBanner').textContent));
  expect('checklist: dismissal stored on the model', getModel().meta.checklistDismissed === true);
  // back to demo defaults for a clean slate
  click('#btnDashReset'); await okAsk(); await flush(400);
  expect('cleanup: demo restored', getModel().teams.length === 6);

  expect('no script errors through whole suite', errs.length === 0);
  console.log('script errors:', errs.length ? errs.join(' | ') : 'none');
  console.log(fails ? `${fails} FAILURES` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
