/* Visual regression: no two SVG text nodes may overlap on any chart.
   Renders every chart (demo model + an ending==goal stress case) and intersects
   approximate text bounding boxes — the programmatic version of squinting at screenshots. */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const dir = require('path').resolve(__dirname, '..', '..');
const dom = new JSDOM(fs.readFileSync(dir + '/index.html', 'utf8'), { runScripts: 'outside-only', url: 'http://localhost/', pretendToBeVisual: true });
const w = dom.window;
w.fetch = () => Promise.reject(new Error('no network'));
const errs = [];
w.addEventListener('error', e => errs.push(e.message));
for (const f of ['engine.js', 'charts.js', 'agents.js', 'app.js']) w.eval(fs.readFileSync(dir + '/js/' + f, 'utf8'));
const $ = s => w.document.querySelector(s);
const click = el => (typeof el === 'string' ? $(el) : el).dispatchEvent(new w.Event('click', { bubbles: true }));
const change = (el, v) => { const t = typeof el === 'string' ? $(el) : el; t.value = v; t.dispatchEvent(new w.Event('change', { bubbles: true })); };
const flush = (ms = 250) => new Promise(r => setTimeout(r, ms));
const nav = async p => { click($(`.nav-tab[data-page=${p}]`)); await flush(); };
let fails = 0;
const expect = (n, c) => { console.log((c ? 'PASS' : 'FAIL'), n); if (!c) fails++; };

function bbox(t) {
  const fsz = parseFloat(t.getAttribute('font-size') || 10);
  const x = parseFloat(t.getAttribute('x') || 0), y = parseFloat(t.getAttribute('y') || 0);
  const txt = t.textContent || '';
  const wpx = txt.length * fsz * 0.62;
  const anchor = t.getAttribute('text-anchor') || 'start';
  const x0 = anchor === 'middle' ? x - wpx / 2 : (anchor === 'end' ? x - wpx : x);
  return { x0, x1: x0 + wpx, y0: y - fsz, y1: y, txt };
}
function overlapRatio(a, b) {
  const ix = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const iy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  if (ix <= 1 || iy <= 1) return 0;
  return (ix * iy) / Math.min((a.x1 - a.x0) * (a.y1 - a.y0), (b.x1 - b.x0) * (b.y1 - b.y0));
}
function auditSvg(name, svg) {
  const texts = Array.from(svg.querySelectorAll('text')).map(bbox).filter(b => b.txt.trim());
  const hits = [];
  for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
    if (overlapRatio(texts[i], texts[j]) > 0.25) hits.push(`"${texts[i].txt}" × "${texts[j].txt}"`);
  }
  expect(`no text overlaps on ${name}${hits.length ? ' — ' + hits.join(', ') : ''}`, hits.length === 0);
}
async function auditPage(page, sels) {
  await nav(page);
  for (const sel of sels) {
    const c = $(sel);
    if (!c) { expect(`chart container ${sel} present on ${page}`, false); continue; }
    const svgs = c.querySelectorAll('svg');
    expect(`chart renders in ${sel} on ${page}`, svgs.length > 0);
    svgs.forEach((svg, i) => auditSvg(`${page} ${sel}${svgs.length > 1 ? '#' + i : ''}`, svg));
  }
}

(async () => {
  await flush(400);
  // demo model — every chart surface
  await auditPage('dashboard', ['#chCost', '#chRev', '#chHeads', '#chCac']);
  await auditPage('drivers', ['#bridgeWaterfall']);
  await nav('readiness');
  if ($('#btnRunSens')) { click('#btnRunSens'); await flush(800); }
  await auditPage('readiness', ['#chArrHead', '#chCostPct', '#sensCard']);

  // stress: ending ARR exactly on goal — the case where goal & ending labels used to collide
  await nav('drivers');
  change($('input[data-path="config.startingARR"]'), '8M'); await flush(300);
  let goals = w.document.querySelectorAll('#configCard input[data-path*="arrGoals"]');
  if (goals[0]) { change(goals[0], '15M'); await flush(300); }
  goals = w.document.querySelectorAll('#configCard input[data-path*="arrGoals"]');
  if (goals[1]) { change(goals[1], '30M'); await flush(300); }
  if ($('#btnApplyImplied')) { click('#btnApplyImplied'); await flush(400); }
  await auditPage('drivers', ['#bridgeWaterfall']);
  await auditPage('dashboard', ['#chCost', '#chRev', '#chHeads', '#chCac']);

  expect('no script errors through whole suite', errs.length === 0);
  console.log(fails ? `${fails} FAILURES` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
