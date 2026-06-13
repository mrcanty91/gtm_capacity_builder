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

  // ---- back to blank ----
  click('#btnStartBlank'); await okAsk(); await flush(400);
  click($('.nav-tab[data-page=dashboard]')); await flush();
  expect('blank: start-blank returns the clean state', /\b0 teams\b/.test($('#dashSub').textContent) && /SETUP CHECKLIST/.test($('#sampleBanner').textContent));

  expect('no script errors through whole suite', errs.length === 0);
  console.log('script errors:', errs.length ? errs.join(' | ') : 'none');
  console.log(fails ? `${fails} FAILURES` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
