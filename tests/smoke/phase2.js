/* Phase 2: bridge waterfall, backup nudge, defendability tally + board-pack export gate. */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const dir = require('path').resolve(__dirname, '..', '..');
const dom = new JSDOM(fs.readFileSync(dir + '/index.html', 'utf8'), { runScripts: 'outside-only', url: 'http://localhost/', pretendToBeVisual: true });
const w = dom.window;
w.fetch = () => Promise.reject(new Error('no network'));
const errs = [];
w.addEventListener('error', e => errs.push(e.message));
let lastDownload = null, lastBlob = null;
w.URL.createObjectURL = b => { lastBlob = b; return 'blob:x'; };
w.URL.revokeObjectURL = () => {};
w.HTMLAnchorElement.prototype.click = function () { if (this.download) lastDownload = { name: this.download, blob: lastBlob }; };
for (const f of ['engine.js', 'charts.js', 'agents.js', 'app.js']) w.eval(fs.readFileSync(dir + '/js/' + f, 'utf8'));
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

  // ---- 1. waterfall on Model Drivers ----
  await nav('drivers');
  const wf = $('#bridgeWaterfall');
  expect('waterfall: container renders inside the bridge', !!wf && !!wf.querySelector('svg'));
  const wfTxt = wf ? wf.textContent : '';
  expect('waterfall: shows start/churn/escalator/new-biz/expansion/ending bars', ['START', 'CHURN', 'ESCALATOR', 'NEW BIZ', 'EXPANSION', 'ENDING'].every(n => wfTxt.includes(n)));
  const rects = wf ? wf.querySelectorAll('rect').length : 0;
  expect('waterfall: six bars drawn', rects === 6);
  expect('waterfall: goal line labeled when goals set', /GOAL/.test(wfTxt) || !(getModel().config.arrGoals || []).some(g => g > 0));
  // churn bar uses accent (down = vermillion)
  const accentRect = wf && Array.from(wf.querySelectorAll('rect')).some(r => r.getAttribute('fill') === '#FF3D00');
  expect('waterfall: churn bar uses accent (down)', accentRect);

  // ---- 2. defendability tally on dashboard ----
  await nav('dashboard');
  const dc = $('#dashChecks').textContent;
  expect('tally: DEFENDABILITY strip present', /DEFENDABILITY/.test(dc));
  const hty = { errors: eng().checks.filter(c => c.severity === 'error').length, warns: eng().checks.filter(c => c.severity === 'warn').length };
  expect('tally: error count matches computed checks', new RegExp(hty.errors + ' ERROR').test(dc));
  expect('tally: warning count matches computed checks', new RegExp(hty.warns + ' WARNING').test(dc));

  // ---- 3. board-pack export gate ----
  // the demo model carries open check flags, so the gate should engage
  await nav('dashboard');
  lastDownload = null;
  click('#btnExpBoard'); await flush(250);
  const gated = $('#askModal').classList.contains('open') && /open flags/i.test($('#askBody').textContent);
  expect('gate: board pack asks before exporting with open flags', gated);
  if (gated) {
    expect('gate: confirm copy itemizes the open flags', /error|warning|challenged/i.test($('#askBody').textContent));
    click('#askCancel'); await flush(250);
    expect('gate: cancel means no download', lastDownload === null);
    click('#btnExpBoard'); await okAsk(); await flush(400);
    expect('gate: "Export anyway" downloads the pack', !!lastDownload && /board/.test(lastDownload.name));
  }

  // ---- 4. backup nudge ----
  // not shown while demo banner is up
  await nav('dashboard');
  const sb0 = $('#sampleBanner').textContent;
  expect('nudge: demo banner takes precedence on a fresh model', /DEMO DATA/.test(sb0) && !/LOCAL DATA ONLY/.test(sb0));
  // dismiss demo -> nudge appears (never exported)
  click('#btnDismissSample'); await flush(300);
  const sb1 = $('#sampleBanner').textContent;
  expect('nudge: appears after demo dismissed, says "never"', /LOCAL DATA ONLY/.test(sb1) && /never/.test(sb1));
  // export clears it
  lastDownload = null;
  click('#btnBackupNow'); await flush(400);
  expect('nudge: export-now button downloads the model JSON', !!lastDownload && /gtm-capacity-model/.test(lastDownload.name));
  await flush(300);
  expect('nudge: gone after a fresh export', !/LOCAL DATA ONLY/.test($('#sampleBanner').textContent));
  // stale date brings it back
  w.localStorage.setItem('ro_last_export', new Date(Date.now() - 9 * 86400000).toISOString());
  await nav('drivers'); await nav('dashboard');
  expect('nudge: returns when the last export is 9 days old', /LOCAL DATA ONLY/.test($('#sampleBanner').textContent) && /9 days ago/.test($('#sampleBanner').textContent));

  expect('no script errors through whole suite', errs.length === 0);
  console.log('script errors:', errs.length ? errs.join(' | ') : 'none');
  console.log(fails ? `${fails} FAILURES` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
