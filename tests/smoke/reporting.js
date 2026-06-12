/* Reporting pass: chart hover tooltips, board pack v2, FP&A workbook, operating report. */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const dir = require('path').resolve(__dirname, '..', '..');
const dom = new JSDOM(fs.readFileSync(dir + '/index.html', 'utf8'), { runScripts: 'outside-only', url: 'http://localhost/', pretendToBeVisual: true });
const w = dom.window;
w.fetch = () => Promise.reject(new Error('no network'));
const errs = [];
w.addEventListener('error', e => errs.push(e.message));
const downloads = [];
let lastBlob = null;
w.URL.createObjectURL = b => { lastBlob = b; return 'blob:x'; };
w.URL.revokeObjectURL = () => {};
w.HTMLAnchorElement.prototype.click = function () { if (this.download) downloads.push({ name: this.download, blob: lastBlob }); };
async function dlText(name) { const d = downloads.filter(x => x.name.includes(name)).pop(); return d ? await d.blob.text() : null; }
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

  // ---- 1. chart hover tooltips ----
  await nav('dashboard');
  const costChart = $('#chCost');
  const band = costChart.querySelector('rect[data-band="3"]');
  expect('tip: month hover bands exist on stacked bars', !!band);
  band.dispatchEvent(new w.MouseEvent('mousemove', { bubbles: true, clientX: 100, clientY: 80 }));
  await flush(80);
  let tip = costChart.querySelector('.chart-tip');
  expect('tip: tooltip appears on hover with month + TOTAL', !!tip && tip.style.display === 'block' && /TOTAL/.test(tip.textContent));
  expect('tip: tooltip lists team values', /Sales/.test(tip.textContent));
  band.dispatchEvent(new w.MouseEvent('mouseleave', { bubbles: true }));
  await flush(60);
  expect('tip: tooltip hides on leave', tip.style.display === 'none');
  // lines chart (CAC) shows ratio decimals
  const cacBand = $('#chCac rect[data-band="6"]');
  cacBand.dispatchEvent(new w.MouseEvent('mousemove', { bubbles: true, clientX: 200, clientY: 90 }));
  await flush(60);
  const cacTip = $('#chCac .chart-tip');
  expect('tip: ratio chart shows decimal values', !!cacTip && /\d\.\d/.test(cacTip.textContent));
  // waterfall bars on drivers
  await nav('drivers');
  const wfBar = $('#bridgeWaterfall rect[data-wf="1"]');
  wfBar.dispatchEvent(new w.MouseEvent('mousemove', { bubbles: true, clientX: 150, clientY: 60 }));
  await flush(60);
  const wfTip = $('#bridgeWaterfall .chart-tip');
  expect('tip: waterfall bar shows name + running level', !!wfTip && /CHURN/.test(wfTip.textContent) && /RUNNING/.test(wfTip.textContent));

  // ---- 2. FP&A workbook rides with the budget export ----
  await nav('dashboard');
  downloads.length = 0;
  click('#btnExpBudget'); await flush(400); await okAsk(); await flush(300);
  expect('fpna: budget click produces 3 files (monthly, long, fx)', downloads.length === 3);
  const long = await dlText('fpna-long');
  expect('fpna: long format has month/year/quarter/team/category header', !!long && long.split('\n')[0] === 'month,year,quarter,team,category,amount_usd');
  expect('fpna: categories present', ['Comp — fixed (base+burden)', 'Comp — variable (OTE)'].every(c => long.includes(c)));
  // reconciliation: ALL CATEGORIES vs ENGINE TOTAL within 1%
  const recon = long.split('\n').filter(l => l.includes('ALL CATEGORIES') || l.includes('ENGINE TOTAL'));
  const nums = recon.map(l => +l.split(',').pop());
  expect('fpna: category total reconciles to engine cost (±1%)', nums.length === 2 && Math.abs(nums[0] - nums[1]) / nums[1] < 0.01);
  const fx = await dlText('fx-exposure');
  expect('fpna: fx exposure lists every country with share', !!fx && getModel().fx.every(f => fx.includes(f.country)) && fx.includes('share_pct'));
  const usShare = +(fx.split('\n').find(l => l.startsWith('United States')) || '').split(',')[4];
  expect('fpna: shares are sane (US largest, all ≤100)', usShare > 20 && usShare <= 100);

  // ---- 3. board pack v2 ----
  downloads.length = 0;
  click('#btnExpBoard'); await flush(300); await okAsk(); await flush(400);
  const pack = await dlText('board-pack');
  expect('pack: downloads', !!pack);
  expect('pack: executive summary auto-written with numbers', /Executive summary/.test(pack) && /grows ARR from \$/.test(pack));
  expect('pack: waterfall SVG embedded', /<svg/.test(pack) && /CHURN/.test(pack) && /ESCALATOR/.test(pack));
  expect('pack: spend-vs-revenue chart embedded', /Spend vs revenue/.test(pack) && (pack.match(/<svg/g) || []).length >= 2);
  expect('pack: scenario table with feasible ARR', /three weathers/.test(pack) && /Feasible ARR/.test(pack));
  expect('pack: defendability counts in governance', /defendability at export/.test(pack));
  expect('pack: no NaN/undefined anywhere', !/NaN|undefined/.test(pack));

  // ---- 4. operating report ----
  // import actuals first
  const iso = (() => { const p = getModel().config.startMonth.split('-').map(Number); return [0, 1].map(i => { const y = p[0] + Math.floor((p[1] - 1 + i) / 12), mm = (p[1] - 1 + i) % 12 + 1; return y + '-' + String(mm).padStart(2, '0'); }); })();
  const csv = `month,metric,value\n${iso[0]},headcount,20\n${iso[0]},cost,700000\n${iso[1]},headcount,21\n${iso[1]},cost,820000\n${iso[1]},bookings,300000\n`;
  const fileInp = $('#actualsFile');
  Object.defineProperty(fileInp, 'files', { value: [new w.File([csv], 'a.csv', { type: 'text/csv' })], configurable: true });
  fileInp.dispatchEvent(new w.Event('change', { bubbles: true }));
  await flush(700);
  expect('ops: actuals imported', (getModel().actuals || []).length === 5);
  expect('ops: operating-report button appears with actuals', !!$('#btnOpReport'));
  downloads.length = 0;
  click('#btnOpReport'); await flush(400);
  const op = await dlText('operating-report');
  expect('ops: report downloads', !!op);
  expect('ops: per-metric plan vs actual tables', /GTM headcount/.test(op) && /Plan/.test(op) && /Actual/.test(op));
  expect('ops: variance callouts or clean note present', /Variance callouts|No variance beyond/.test(op));
  expect('ops: flow metrics get a total row', /Total \(months with actuals\)/.test(op));
  expect('ops: no NaN/undefined', !/NaN|undefined/.test(op));
  // clear actuals
  click('#btnActClear'); await okAsk(); await flush(200);

  expect('no script errors through whole suite', errs.length === 0);
  console.log('script errors:', errs.length ? errs.join(' | ') : 'none');
  console.log(fails ? `${fails} FAILURES` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
