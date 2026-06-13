/* First-run experience: a fresh install (empty localStorage) boots a clean blank
   model — no preloaded plan — and the demo loads only via the explicit dashboard
   action. This suite deliberately does NOT seed the demo like the others do. */
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
const flush = (ms = 250) => new Promise(r => setTimeout(r, ms));
let fails = 0;
const expect = (n, c) => { console.log((c ? 'PASS' : 'FAIL'), n); if (!c) fails++; };
const okAsk = async () => { await flush(80); if (!$('#askModal').classList.contains('open')) return false; click('#askOk'); await flush(300); return true; };

(async () => {
  await flush(400);

  // ---- clean boot: nothing preloaded ----
  expect('boot: app renders with no script errors on an empty profile', errs.length === 0);
  const sub = $('#dashSub').textContent;
  expect('boot: zero teams on a fresh install', /\b0 teams\b/.test(sub));
  const banner = $('#sampleBanner').textContent;
  expect('boot: no demo-data banner (nothing was preloaded)', !/DEMO DATA/.test(banner));
  expect('boot: setup checklist greets the new user', /SETUP CHECKLIST/.test(banner));
  expect('boot: checklist starts at zero done', /0 OF 5 DONE/.test(banner));
  const blank = w.eval("(() => { const m = localStorage.getItem('ro_capacity_model_v2'); return m ? JSON.parse(m) : null; })()");
  expect('boot: localStorage untouched or blank (no demo persisted)', blank === null || ((blank.teams || []).length === 0 && (blank.config.startingARR || 0) === 0));

  // ---- demo on demand ----
  expect('demo: load action present on the dashboard', !!$('#btnDashReset') && /Load demo data/.test($('#btnDashReset').textContent));
  click('#btnDashReset');
  expect('demo: load confirms first', await okAsk());
  await flush(400);
  expect('demo: sample plan loads with its banner', /DEMO DATA/.test($('#sampleBanner').textContent));
  expect('demo: teams populated after load', !/\b0 teams\b/.test($('#dashSub').textContent));
  expect('demo: checklist yields to the demo banner', !/SETUP CHECKLIST/.test($('#sampleBanner').textContent));

  // ---- demo profile: Series B @ $15M, and it passes its own checks ----
  const demo = w.eval('Engine.demoModel()');
  expect('demo: profile is the $15M Series B plan', demo.config.startingARR === 15000000 && demo.config.arrGoals[1] === 30000000);
  const dr = w.eval('(() => { const r = Engine.compute(Engine.demoModel()); return { e: r.checks.filter(c => c.severity === "error").length, w: r.checks.filter(c => c.severity === "warn").length, end: r.summary.totals.endingARR, hc: r.summary.totals.endingHeadcount }; })()');
  expect('demo: zero check errors and zero warnings', dr.e === 0 && dr.w === 0);
  expect('demo: hits the $30M ending-ARR goal', Math.abs(dr.end - 30000000) < 50000);
  expect('demo: GTM headcount lands in a credible Series B range', dr.hc >= 30 && dr.hc <= 45);

  // ---- back to blank ----
  click('#btnStartBlank'); await okAsk(); await flush(400);
  click($('.nav-tab[data-page=dashboard]')); await flush();
  expect('blank: start-blank returns the clean state', /\b0 teams\b/.test($('#dashSub').textContent) && /SETUP CHECKLIST/.test($('#sampleBanner').textContent));

  // ---- wipe everything: the only control that clears ALL stored keys ----
  click('#btnDashReset'); await okAsk(); await flush(300); // get some data in place
  w.eval("localStorage.setItem('ro_capacity_versions', JSON.stringify([{ name: 'x', json: '{}' }]))");
  w.eval("localStorage.setItem('ro_capacity_settings', JSON.stringify({ provider: { id: 'anthropic', apiKey: 'sk-test' } }))");
  click($('.nav-tab[data-page=agents]')); await flush(300);
  expect('wipe: control lives on the Agents page', !!$('#btnWipeAll'));
  click('#btnWipeAll');
  expect('wipe: confirms first', await okAsk());
  await flush(400);
  const left = ['ro_capacity_model_v2', 'ro_capacity_versions', 'ro_capacity_settings', 'ro_last_export']
    .map(k => w.eval(`localStorage.getItem('${k}')`)).filter(v => v !== null);
  expect('wipe: every stored key removed (model, versions, settings/keys, backup marker)', left.length === 0);
  click($('.nav-tab[data-page=dashboard]')); await flush();
  expect('wipe: app lands on the clean first-run state', /\b0 teams\b/.test($('#dashSub').textContent) && /SETUP CHECKLIST/.test($('#sampleBanner').textContent));

  expect('no script errors through whole suite', errs.length === 0);
  console.log('script errors:', errs.length ? errs.join(' | ') : 'none');
  console.log(fails ? `${fails} FAILURES` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
