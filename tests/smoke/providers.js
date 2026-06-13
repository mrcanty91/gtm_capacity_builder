/* Multi-provider LLM layer: protocol shapes, provider config UI, web-search degradation, legacy key migration. */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const dir = require('path').resolve(__dirname, '..', '..');
const dom = new JSDOM(fs.readFileSync(dir + '/index.html', 'utf8'), { runScripts: 'outside-only', url: 'http://localhost/', pretendToBeVisual: true });
const w = dom.window;
const fetchCalls = [];
w.fetch = (url, init) => {
  fetchCalls.push({ url, init: init || {}, body: init && init.body ? JSON.parse(init.body) : null });
  const isAnthropic = /api\.anthropic\.com/.test(url);
  const payload = isAnthropic
    ? { content: [{ type: 'text', text: '{"ok":true,"via":"anthropic"}' }], usage: { input_tokens: 100, output_tokens: 50 } }
    : { choices: [{ message: { content: '{"ok":true,"via":"openai"}' } }], usage: { prompt_tokens: 100, completion_tokens: 50 } };
  return Promise.resolve({ ok: true, json: () => Promise.resolve(payload), text: () => Promise.resolve('') });
};
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
const nav = async p => { click($(`.nav-tab[data-page=${p}]`)); await flush(); };
const A = () => w.eval('Agents');

(async () => {
  await flush(300);
  const Ag = w.Agents;

  // ---- catalog & config resolution ----
  expect('prov: 5 providers exported (anthropic/openai/openrouter/ollama/custom)', Ag.PROVIDERS.length === 5 && Ag.PROVIDERS[0].id === 'anthropic');
  // legacy migration: old settings.apiKey becomes the anthropic key
  let p = Ag.providerCfg({ apiKey: 'sk-ant-legacy' });
  expect('prov: legacy settings.apiKey maps to anthropic provider', p.id === 'anthropic' && p.apiKey === 'sk-ant-legacy' && p.webSearch === true);
  p = Ag.providerCfg({ provider: { id: 'ollama' } });
  expect('prov: ollama is key-optional with localhost base', p.keyOptional === true && /localhost:11434/.test(p.baseUrl));
  p = Ag.providerCfg({ provider: { id: 'custom', baseUrl: 'https://my-llm.corp/v1/', apiKey: 'k' } });
  expect('prov: custom base URL respected, trailing slash stripped', p.baseUrl === 'https://my-llm.corp/v1');

  // ---- protocol: anthropic ----
  fetchCalls.length = 0;
  const sAnth = { provider: { id: 'anthropic', apiKey: 'sk-ant-x', baseUrl: 'https://api.anthropic.com', defaultModel: '' } };
  const r1 = await Ag.callLLM('cfo', sAnth, 'review this');
  let c = fetchCalls[0];
  expect('anthropic: posts to /v1/messages with x-api-key + version headers', /api\.anthropic\.com\/v1\/messages/.test(c.url) && c.init.headers['x-api-key'] === 'sk-ant-x' && !!c.init.headers['anthropic-version']);
  expect('anthropic: uses the agent\'s Anthropic default model', c.body.model === 'claude-sonnet-4-6');
  expect('anthropic: system prompt + single user message', typeof c.body.system === 'string' && c.body.messages.length === 1 && c.body.messages[0].role === 'user');
  expect('anthropic: response text parsed', r1.text.includes('anthropic'));

  // ---- protocol: openai-compatible ----
  fetchCalls.length = 0;
  const sOAI = { provider: { id: 'openai', apiKey: 'sk-oai', baseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4o' } };
  const r2 = await Ag.callLLM('cfo', sOAI, 'review this');
  c = fetchCalls[0];
  expect('openai: posts to /chat/completions with Bearer auth', /\/chat\/completions$/.test(c.url) && c.init.headers.authorization === 'Bearer sk-oai');
  expect('openai: provider default model used (not the Claude id)', c.body.model === 'gpt-4o');
  expect('openai: system + user roles in messages array', c.body.messages[0].role === 'system' && c.body.messages[1].role === 'user');
  expect('openai: response text parsed from choices', r2.text.includes('openai'));
  expect('openai: no web_search tools attached', !c.body.tools);

  // per-agent model override beats provider default
  fetchCalls.length = 0;
  await Ag.callLLM('cfo', { provider: { id: 'openai', apiKey: 'k', baseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4o' }, agents: { cfo: { model: 'o3-mini' } } }, 'x');
  expect('override: per-agent model wins', fetchCalls[0].body.model === 'o3-mini');

  // ---- web-search degradation ----
  fetchCalls.length = 0;
  await Ag.callLLM('comp-research', sOAI, 'research bands');
  c = fetchCalls[0];
  expect('degrade: research agent on non-search provider gets the low-confidence instruction', /web search is NOT available/i.test(c.body.messages[0].content));
  fetchCalls.length = 0;
  await Ag.callLLM('comp-research', sAnth, 'research bands');
  c = fetchCalls[0];
  expect('degrade: on anthropic the web_search tool IS attached', Array.isArray(c.body.tools) && c.body.tools[0].name === 'web_search');
  expect('degrade: no low-confidence note when search exists', !/web search is NOT available/i.test(c.body.system));

  // ---- guards ----
  let threw = '';
  try { await Ag.callLLM('cfo', { provider: { id: 'openai', baseUrl: 'https://api.openai.com/v1' } }, 'x'); } catch (e) { threw = e.message; }
  expect('guard: missing key throws clear error (non-optional provider)', /No API key/.test(threw));
  threw = '';
  try { await Ag.callLLM('cfo', { provider: { id: 'custom', apiKey: 'k', baseUrl: '', defaultModel: 'some-model' } }, 'x'); } catch (e) { threw = e.message; }
  expect('guard: missing base URL throws clear error', /base URL/i.test(threw));
  // ollama: no key needed
  fetchCalls.length = 0;
  await Ag.callLLM('cfo', { provider: { id: 'ollama', defaultModel: 'llama3.3' } }, 'x');
  expect('guard: ollama runs without a key, no auth header', fetchCalls.length === 1 && !fetchCalls[0].init.headers.authorization);

  // ---- UI: provider config on Agents tab ----
  await nav('agents');
  expect('ui: provider select present with 5 options', !!$('#agProvider') && $$('#agProvider option').length === 5);
  expect('ui: base URL prefilled for anthropic', $('#agBaseUrl').value.includes('anthropic.com'));

  // curated provider (Anthropic): real dropdowns with the full catalog + Custom escape hatch
  const gSel = $('[data-seldefmodel="g"]');
  expect('ui: anthropic default model is a dropdown', !!gSel && gSel.tagName === 'SELECT');
  const gOpts = Array.from(gSel.options).map(o => o.value);
  expect('ui: dropdown lists ALL Claude models (sonnet, haiku, opus, fable)',
    ['claude-sonnet-4-6', 'claude-haiku-4-5-20251001', 'claude-opus-4-8', 'claude-fable-5'].every(m => gOpts.includes(m)));
  expect('ui: dropdown has a Custom escape hatch', gOpts.includes('__custom__'));
  const agSel = $$('#agentCfgList select[data-selagmodel]');
  expect('ui: every agent gets a model dropdown on anthropic', agSel.length === Ag.AGENT_DEFS.length);
  expect('ui: per-agent dropdown includes provider-default blank + all models',
    Array.from(agSel[0].options).map(o => o.value).filter(v => v.startsWith('claude-')).length === 4 && agSel[0].options[0].value === '');
  // pick Opus for the CFO via the dropdown
  change(agSel.find(x => x.getAttribute('data-selagmodel') === 'cfo'), 'claude-opus-4-8'); await flush(300);
  expect('ui: dropdown choice persists per agent', (JSON.parse(w.localStorage.getItem('ro_capacity_settings')).agents.cfo || {}).model === 'claude-opus-4-8');
  // custom hatch reveals a text input
  const agSel2 = $$('#agentCfgList select[data-selagmodel]').find(x => x.getAttribute('data-selagmodel') === 'coo');
  change(agSel2, '__custom__'); await flush(200);
  const cooInp = $('#agentCfgList input[data-agmodel="coo"]');
  expect('ui: Custom… reveals a free-text field', !!cooInp && cooInp.style.display !== 'none');
  change(cooInp, 'claude-experimental-x'); await flush(300);
  expect('ui: custom model id persists', (JSON.parse(w.localStorage.getItem('ro_capacity_settings')).agents.coo || {}).model === 'claude-experimental-x');

  change('#agProvider', 'openrouter'); await flush(300);
  expect('ui: switching provider re-prefills base URL', $('#agBaseUrl').value.includes('openrouter.ai'));
  expect('ui: no-web-search notice shows for non-anthropic provider', /NO LIVE WEB SEARCH/.test($('#agentGlobalCard').textContent));
  expect('ui: model suggestions datalist populated', $$('#agModelSugg option').length > 0);
  expect('ui: open-catalog provider keeps free-text default model', !!$('input[data-defmodel="g"]') && !$('[data-seldefmodel="g"]'));
  // save full provider config
  change($('input[data-defmodel="g"]'), 'anthropic/claude-sonnet-4.6'); change('#agApiKey', 'sk-or-test');
  click('#agSave'); await flush(300);
  const saved = JSON.parse(w.localStorage.getItem('ro_capacity_settings'));
  expect('ui: provider config persists (id, key, model)', saved.provider.id === 'openrouter' && saved.provider.apiKey === 'sk-or-test' && saved.provider.defaultModel === 'anthropic/claude-sonnet-4.6');
  // per-agent model is free text on open-catalog providers
  expect('ui: per-agent model is free text on openrouter', $$('#agentCfgList input[data-agmodel]').length === Ag.AGENT_DEFS.length && $$('#agentCfgList select[data-selagmodel]').length === 0);
  // back to anthropic: notice gone
  change('#agProvider', 'anthropic'); await flush(300);
  expect('ui: anthropic restores web-search capability (no notice)', !/NO LIVE WEB SEARCH/.test($('#agentGlobalCard').textContent));

  expect('no script errors through whole suite', errs.length === 0);
  console.log('script errors:', errs.length ? errs.join(' | ') : 'none');
  console.log(fails ? `${fails} FAILURES` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
