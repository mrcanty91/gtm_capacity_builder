/* Renegade Ops — Capacity Model app: state, rendering, ledger, board review. */
(function () {
  'use strict';

  // ============================== STATE ==============================
  const LS_MODEL = 'ro_capacity_model_v2';
  const LS_SETTINGS = 'ro_capacity_settings';

  let model = loadModel();
  let computed = Engine.compute(model);
  let currentPage = 'dashboard';
  let boardResults = {}; // personaId -> result
  let lastSynthesis = null; // CHAIR output — embedded in the board pack when present

  function loadModel() {
    try {
      const raw = localStorage.getItem(LS_MODEL);
      if (raw) { const m = JSON.parse(raw); if (m && m.config && m.teams) return m; }
    } catch (e) { /* fresh */ }
    return Engine.defaultModel();
  }
  // ---- undo: snapshot stack fed by saveModel ----
  const undoStack = [];
  let lastSerialized = null;
  function saveModel() {
    model.meta.savedAt = new Date().toISOString();
    const s = JSON.stringify(model);
    if (lastSerialized !== null && s !== lastSerialized) {
      undoStack.push(lastSerialized);
      if (undoStack.length > 15) undoStack.shift();
    }
    lastSerialized = s;
    localStorage.setItem(LS_MODEL, s);
    updateUndoBtn();
  }
  function undo() {
    if (!undoStack.length) { toast('Nothing to undo'); return; }
    lastSerialized = undoStack.pop();
    model = JSON.parse(lastSerialized);
    localStorage.setItem(LS_MODEL, lastSerialized);
    try { computed = Engine.compute(model); } catch (e) { console.error(e); }
    render(); toast('Undone');
  }
  function updateUndoBtn() {
    const b = $('#btnUndo');
    if (b) b.disabled = !undoStack.length;
  }
  function settings() { try { return JSON.parse(localStorage.getItem(LS_SETTINGS) || '{}'); } catch (e) { return {}; } }
  function saveSettings(s) { localStorage.setItem(LS_SETTINGS, JSON.stringify(s)); }

  function recompute() {
    try { computed = Engine.compute(model); }
    catch (e) { console.error(e); toast('Compute error: ' + e.message); }
    saveModel();
  }

  // ---- scheduled rendering: lets the browser settle focus (Tab) before we rebuild,
  //      then restores focus + caret + any uncommitted keystrokes ----
  const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (cb => setTimeout(cb, 16));
  let renderQueued = false;
  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    raf(() => { renderQueued = false; render(true); });
  }

  // ============================== HELPERS ==============================
  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));
  const fmt$ = v => '$' + (v || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
  const fmtShort = Charts.fmtShort;
  const fmtPct = v => (v * 100).toFixed(0) + '%';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.style.display = 'block';
    clearTimeout(toast._t); toast._t = setTimeout(() => t.style.display = 'none', 2600);
  }

  // branded replacements for native prompt()/confirm()
  function ask(opts) {
    return new Promise(res => {
      const back = $('#askModal'), box = $('#askBody');
      box.innerHTML = `<h3>${esc(opts.title || '')}</h3>
        ${opts.message ? `<p class="small" style="margin:.5rem 0 0">${esc(opts.message)}</p>` : ''}
        ${opts.input ? `<label class="field mt-2"><span class="lbl mono-label">${esc(opts.label || '')}</span><input type="text" id="askInput" value="${esc(opts.value || '')}"></label>` : ''}
        <div class="row mt-3">
          <button class="btn ${opts.danger ? 'btn-danger' : 'btn-secondary'}" id="askOk">${esc(opts.okText || 'OK')}</button>
          <button class="btn btn-ghost" id="askCancel">Cancel</button>
        </div>`;
      back.classList.add('open');
      let settled = false;
      const done = v => { if (settled) return; settled = true; back.classList.remove('open'); res(v); };
      $('#askOk').onclick = () => done(opts.input ? $('#askInput').value.trim() : true);
      $('#askCancel').onclick = () => done(opts.input ? null : false);
      back.onclick = e => { if (e.target === back) done(opts.input ? null : false); };
      if (opts.input) {
        const i = $('#askInput');
        i.focus(); i.select();
        i.onkeydown = e => { if (e.key === 'Enter') $('#askOk').click(); if (e.key === 'Escape') $('#askCancel').click(); };
      }
    });
  }
  const uiPrompt = (title, label, value) => ask({ title, label, value, input: true });

  // "5M", "750k", "12.5m", "$1,200,000" -> number. Plain numbers pass through.
  function parseNumShorthand(raw) {
    if (raw == null || raw === '') return 0;
    const s = String(raw).trim().replace(/[$,\s]/g, '');
    const m = s.match(/^(-?\d*\.?\d+)([kKmMbB])$/);
    if (m) return parseFloat(m[1]) * ({ k: 1e3, m: 1e6, b: 1e9 })[m[2].toLowerCase()];
    const f = parseFloat(s);
    return isNaN(f) ? 0 : f;
  }
  const uiConfirm = (title, message, okText) => ask({ title, message, okText: okText || 'Confirm', danger: true });

  function download(filename, text, mime) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: mime || 'text/plain' }));
    a.download = filename; a.click(); URL.revokeObjectURL(a.href);
  }

  // generic model mutation from input elements: data-path="teams.0.asp" etc.
  function setByPath(obj, path, value) {
    const parts = path.split('.');
    let o = obj;
    for (let i = 0; i < parts.length - 1; i++) o = o[isNaN(+parts[i]) ? parts[i] : +parts[i]];
    o[isNaN(+parts.at(-1)) ? parts.at(-1) : +parts.at(-1)] = value;
  }
  function getByPath(obj, path) {
    return path.split('.').reduce((o, p) => o == null ? o : o[isNaN(+p) ? p : +p], obj);
  }

  // ============================== LEDGER CORE ==============================
  // path identifies an assumption, e.g. "Sales (AE) · ASP" — display path, stable per team-id+key
  function ledgerKey(teamId, key) { return teamId + '::' + key; }
  function ledgerEntry(k) { return (model.ledger || {})[k]; }
  function ledgerChipHTML(k, label) {
    const e = ledgerEntry(k);
    const status = e ? e.status : null;
    const cls = status ? status.toLowerCase() : '';
    const txt = status ? status[0] : '+';
    const title = status ? `${label}: ${status}${e.owner ? ' · owner ' + e.owner : ''}` : 'Add to assumption ledger';
    return `<span class="ledger-chip ${cls}" data-ledger="${esc(k)}" data-label="${esc(label)}" title="${esc(title)}">${txt}</span>`;
  }

  function openLedgerModal(key, label, currentValue) {
    const e = model.ledger[key] || { owner: '', status: 'PROPOSED', comments: [], label, value: currentValue };
    model.ledger[key] = e;
    e.label = label; e.value = currentValue;
    const body = $('#ledgerModalBody');
    body.innerHTML = `
      <h3>${esc(label)}</h3>
      <div class="mono-label mb-2">Current value: <span style="color:var(--accent)">${esc(String(currentValue))}</span></div>
      <div class="grid cols-2 mb-2">
        <label class="field"><span class="lbl mono-label">Owner — set once, works like a tag</span>
          <select id="lmOwnerSel">
            <option value="">— unowned —</option>
            ${[...new Set(Object.values(model.ledger).map(x => x.owner).filter(Boolean))].map(o => `<option ${o === e.owner ? 'selected' : ''}>${esc(o)}</option>`).join('')}
            <option value="__new__">+ New owner tag…</option>
          </select>
          <input type="text" id="lmOwnerNew" class="hidden" placeholder="e.g. VP Sales" style="margin-top:.4rem">
          <span class="muted" style="font-size:11px;display:block;margin-top:.25rem">Tags group the Ledger — reuse one when it fits.</span></label>
        <label class="field"><span class="lbl mono-label">Status</span>
          <select id="lmStatus">${['PROPOSED', 'CHALLENGED', 'AGREED'].map(s => `<option ${s === e.status ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
      </div>
      <div class="mb-2">
        <div class="mono-label mb-2">Discussion</div>
        <div id="lmComments">${(e.comments || []).map(c => `<div class="comment"><span class="who">${esc(c.who)}</span>${esc(c.text)}<span class="when">${new Date(c.ts).toLocaleDateString()}</span></div>`).join('') || '<span class="muted small">No comments yet.</span>'}</div>
      </div>
      <label class="field mb-2"><span class="lbl mono-label">Add comment — evidence, pushback, or rationale</span>
        <textarea id="lmComment" placeholder="e.g. 18% win rate matches our trailing-4-quarter close rate on marketing-sourced opps (see Q1 board pack p.12)"></textarea></label>
      <div class="row">
        <button class="btn btn-secondary" id="lmSave">Save</button>
        <button class="btn btn-ghost" id="lmClose">Close</button>
        <span style="flex:1"></span>
        <button class="btn btn-danger" id="lmRemove">Remove from ledger</button>
      </div>`;
    $('#ledgerModal').classList.add('open');
    $('#lmOwnerSel').onchange = () => {
      const isNew = $('#lmOwnerSel').value === '__new__';
      $('#lmOwnerNew').classList.toggle('hidden', !isNew);
      if (isNew) $('#lmOwnerNew').focus();
    };
    $('#lmSave').onclick = () => {
      const selV = $('#lmOwnerSel').value;
      e.owner = selV === '__new__' ? $('#lmOwnerNew').value.trim() : selV;
      e.status = $('#lmStatus').value;
      const txt = $('#lmComment').value.trim();
      if (txt) e.comments.push({ who: ($('#userName') && $('#userName').value.trim()) || 'Anonymous', text: txt, ts: Date.now() });
      saveModel(); $('#ledgerModal').classList.remove('open'); render();
      toast('Ledger updated');
    };
    $('#lmClose').onclick = () => $('#ledgerModal').classList.remove('open');
    $('#lmRemove').onclick = () => { delete model.ledger[key]; saveModel(); $('#ledgerModal').classList.remove('open'); render(); };
  }

  // ============================== FIELD BUILDERS ==============================
  // numeric/percent field with optional ledger chip
  function fld(opts) {
    // opts: {path, label, type:'num'|'pct'|'int'|'text'|'month', step, ledger:{teamId,key,label}, min}
    const v = getByPath(model, opts.path);
    const disp = opts.type === 'pct' ? Math.round((v || 0) * 10000) / 100 : v;
    const chip = opts.ledger ? ledgerChipHTML(ledgerKey(opts.ledger.teamId, opts.ledger.key), opts.ledger.label) : '';
    // 'num' fields are text inputs so shorthand works ("5M", "750k"); pct/int stay numeric
    const inputType = opts.type === 'text' ? 'text' : (opts.type === 'month' ? 'month' : (opts.type === 'num' ? 'text' : 'number'));
    const step = opts.step != null ? opts.step : (opts.type === 'pct' ? 1 : 'any');
    const suffix = opts.type === 'pct' && !opts.label.includes('%') ? ' %' : '';
    const echo = opts.type === 'num' && Math.abs(v || 0) >= 1000 ? `<span class="num-echo">${fmt$(v)}</span>` : '';
    return `<label class="field"><span class="lbl mono-label"><span class="lbl-txt">${esc(opts.label)}${suffix}</span>${chip}</span>
      <input type="${inputType}" ${opts.type === 'num' ? 'inputmode="decimal" class="num-input" title="Shorthand works: 5M, 750k, 12.5m"' : ''} data-path="${esc(opts.path)}" data-kind="${opts.type}" value="${esc(disp == null ? '' : disp)}" ${inputType === 'number' ? `step="${step}"` : ''} ${opts.min != null ? `min="${opts.min}"` : ''}>${echo}</label>`;
  }

  function bindFields(container) {
    container.querySelectorAll('input[data-path], select[data-path]').forEach(inp => {
      inp.addEventListener('change', () => {
        const kind = inp.dataset.kind || 'num';
        let val;
        if (kind === 'pct') val = (parseFloat(inp.value) || 0) / 100;
        else if (kind === 'int') val = Math.max(0, Math.round(parseFloat(inp.value) || 0));
        else if (kind === 'text' || kind === 'month' || kind === 'sel') val = inp.value;
        else val = parseNumShorthand(inp.value);
        setByPath(model, inp.dataset.path, val);
        recompute(); scheduleRender();
      });
    });
    container.querySelectorAll('[data-ledger]').forEach(chip => {
      chip.addEventListener('click', (ev) => {
        ev.preventDefault(); ev.stopPropagation();
        // resolve current value from the sibling input if present
        const lbl = chip.dataset.label;
        const input = chip.closest('label') ? chip.closest('label').querySelector('input,select') : null;
        openLedgerModal(chip.dataset.ledger, lbl, input ? input.value : '');
      });
    });
  }

  // ============================== NAV ==============================
  $$('#navTabs .nav-tab').forEach(b => b.addEventListener('click', () => {
    currentPage = b.dataset.page;
    $$('#navTabs .nav-tab').forEach(x => x.classList.toggle('active', x === b));
    $$('.page').forEach(p => p.classList.toggle('active', p.id === 'page-' + currentPage));
    render();
  }));

  // scenario selector
  function renderScenarioSel() {
    const sel = $('#scenarioSel');
    sel.innerHTML = Object.keys(model.config.scenarios).map(s => `<option ${s === model.config.scenario ? 'selected' : ''}>${esc(s)}</option>`).join('');
    sel.onchange = () => { model.config.scenario = sel.value; recompute(); render(); toast('Scenario: ' + sel.value); };
  }

  // export / import / settings
  $('#btnExport').onclick = () => {
    download(`gtm-capacity-model-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(model, null, 2), 'application/json');
    localStorage.setItem('ro_last_export', new Date().toISOString());
    scheduleRender(); // refresh the backup nudge
  };
  $('#btnImport').onclick = () => $('#fileImport').click();
  $('#fileImport').onchange = (e) => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const m = JSON.parse(r.result);
        if (!m.config || !m.teams) throw new Error('Not a capacity model file');
        model = m; recompute(); render(); toast('Model imported');
      } catch (err) { toast('Import failed: ' + err.message); }
    };
    r.readAsText(f); e.target.value = '';
  };
  // ============================== AGENTS CONFIG PAGE ==============================
  // limit sizing: comp research per role + FX refresh + board runs, with padding
  function recommendedLimits() {
    const R = Math.max(15, model.rateCard.roles.length);   // full GTM org baseline: 15+ roles
    const S = Math.max(4, model.fx.length);                // 4+ sites
    const calls = Math.ceil((R + 1 + 2 * 5) * 1.4);        // R comp runs + 1 FX + two 5-call board reviews, +40% padding for retries/reruns
    const usd = Math.ceil((R * 0.20 + 0.10 + 10 * 0.15) * 2); // Sonnet estimates, ×2 padding (covers an Opus board pass)
    return { calls, usd, R, S };
  }
  function limitRecommendationHTML() {
    const rec = recommendedLimits();
    const lim = Agents.limits(settings());
    const matches = lim.maxCallsPerDay >= rec.calls && lim.maxUSDPerDay >= rec.usd;
    return `<div class="field-notice info mt-2"><div class="fn-head">// RECOMMENDED LIMITS FOR A FULL-DAY CONFIG SESSION</div>
      <div class="fn-detail">Sized for your model today (${rec.R} roles × ${rec.S} sites): researching comp for every role ≈ ${rec.R} calls, an FX refresh ≈ 1, and two full board reviews ≈ 10 — padded ~40% for retries and re-runs.
      Recommendation: <b>${rec.calls} calls/day · $${rec.usd}/day</b> on Sonnet (the $ cap already covers one Opus board pass). Running board reviews on Fable? Triple the spend cap.
      ${matches ? '<span class="badge ok">YOUR CAPS COVER THIS</span>' : `<button class="btn btn-ghost" id="btnApplyRecLimits">Apply ${rec.calls} / $${rec.usd}</button>`}</div></div>`;
  }

  // model picker: curated providers (Anthropic, OpenAI) get a real dropdown with a
  // Custom… escape hatch; open catalogs (OpenRouter, Ollama, custom) stay free-text.
  function modelPickerHTML(prov, attr, current, blankLabel) {
    const curated = prov.models && prov.models.length;
    if (!curated) {
      const ph = blankLabel || ('e.g. ' + (prov.suggestions[0] || 'model-id'));
      return `<input type="text" ${attr} value="${esc(current)}" placeholder="${esc(ph)}" list="agModelSugg">`;
    }
    const inList = !current || prov.models.some(m => m.id === current);
    const custom = current && !inList;
    return `<select ${attr.replace('data-', 'data-sel')}>
        ${blankLabel ? `<option value="" ${!current ? 'selected' : ''}>${esc(blankLabel)}</option>` : ''}
        ${prov.models.map(m => `<option value="${esc(m.id)}" ${m.id === current ? 'selected' : ''}>${esc(m.label)}</option>`).join('')}
        <option value="__custom__" ${custom ? 'selected' : ''}>Custom — type a model ID…</option>
      </select>
      <input type="text" ${attr} value="${custom ? esc(current) : ''}" placeholder="model-id" style="${custom ? '' : 'display:none;'}margin-top:.35rem">`;
  }
  function bindModelPicker(scope, selAttr, inpAttr, onValue) {
    scope.querySelectorAll(`[${selAttr}]`).forEach(sel => sel.addEventListener('change', () => {
      const inp = scope.querySelector(`[${inpAttr}="${sel.getAttribute(selAttr)}"]`) || scope.querySelector(`[${inpAttr}]`);
      if (sel.value === '__custom__') { if (inp) { inp.style.display = ''; inp.focus(); } return; }
      if (inp) inp.style.display = 'none';
      onValue(sel.getAttribute(selAttr), sel.value);
    }));
    scope.querySelectorAll(`[${inpAttr}]`).forEach(inp => inp.addEventListener('change', () => {
      onValue(inp.getAttribute(inpAttr), inp.value.trim());
    }));
  }

  function renderAgents() {
    const s = settings();
    const lim = Agents.limits(s);
    const u = Agents.usageToday();
    const g = $('#agentGlobalCard');
    const prov = Agents.providerCfg(s);
    g.innerHTML = `
      <div class="section-marker">GLOBAL — PROVIDER, KEY &amp; SPEND PROTECTION</div>
      <div class="assumption-grid">
        <label class="field"><span class="lbl mono-label"><span class="lbl-txt">LLM provider</span></span>
          <select id="agProvider">${Agents.PROVIDERS.map(p => `<option value="${p.id}" ${p.id === prov.id ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}</select></label>
        <label class="field" style="grid-column: span 2"><span class="lbl mono-label"><span class="lbl-txt">Base URL</span></span>
          <input type="text" id="agBaseUrl" value="${esc(prov.baseUrl)}" placeholder="https://…"></label>
        <label class="field"><span class="lbl mono-label"><span class="lbl-txt">Default model</span></span>
          ${modelPickerHTML(prov, 'data-defmodel="g"', ((s.provider || {}).defaultModel) || prov.defaultModel || '', '')}</label>
        <label class="field" style="grid-column: span 2"><span class="lbl mono-label"><span class="lbl-txt">API key (stored in this browser only)</span></span>
          <input type="password" id="agApiKey" value="${esc(prov.apiKey || '')}" placeholder="${esc(prov.keyHint)}"></label>
        <label class="field"><span class="lbl mono-label"><span class="lbl-txt">Max agent calls / day</span></span>
          <input type="number" id="agMaxCalls" min="1" value="${lim.maxCallsPerDay}"></label>
        <label class="field"><span class="lbl mono-label"><span class="lbl-txt">Max est. spend / day $</span></span>
          <input type="number" id="agMaxUSD" min="0" step="1" value="${lim.maxUSDPerDay}"></label>
        <label class="field"><span class="lbl mono-label"><span class="lbl-txt">Confirm before multi-agent runs</span></span>
          <select id="agConfirm"><option value="yes" ${lim.confirmRuns ? 'selected' : ''}>Yes — ask first</option><option value="no" ${!lim.confirmRuns ? 'selected' : ''}>No</option></select></label>
      </div>
      <datalist id="agModelSugg">${prov.suggestions.map(m => `<option value="${esc(m)}"></option>`).join('')}</datalist>
      ${prov.webSearch ? '' : `<div class="field-notice warn mt-2"><div class="fn-head">// NO LIVE WEB SEARCH ON THIS PROVIDER</div>
        <div class="fn-detail">BANDS (comp research) and TICKER (FX research) need web search, which only the Anthropic provider offers here. On ${esc(prov.label)} they still run, but return knowledge-based estimates marked LOW confidence — verify before applying. Board personas (MARGIN, FOREMAN, QUOTA, BENCH, CHAIR) work fully on any provider.</div></div>`}
      <div class="row mt-2">
        <span class="mono-label">USED TODAY: ${u.calls} CALL${u.calls === 1 ? '' : 'S'} · ~$${u.cost.toFixed(2)} EST.</span>
        <span style="flex:1"></span>
        <button class="btn btn-secondary" id="agSave">Save global settings</button>
        <button class="btn btn-danger" id="btnResetModel">Reset model to defaults</button>
      </div>
      <p class="muted small mt-2">Limits are hard stops, not warnings — when a cap is hit, agent calls fail with a clear message instead of spending. Cost is estimated from token counts at list prices; treat it as a guardrail, not an invoice.</p>
      ${limitRecommendationHTML()}`;
    const applyRec = $('#btnApplyRecLimits');
    if (applyRec) applyRec.onclick = () => {
      const rec = recommendedLimits();
      const st = settings();
      st.limits = Object.assign({}, Agents.limits(st), { maxCallsPerDay: rec.calls, maxUSDPerDay: rec.usd });
      saveSettings(st); toast('Recommended limits applied'); renderAgents();
    };
    bindModelPicker(g, 'data-seldefmodel', 'data-defmodel', () => { /* committed on Save */ });
    $('#agProvider').onchange = () => {
      const st = settings();
      const pid = $('#agProvider').value;
      const base = Agents.PROVIDERS.find(x => x.id === pid);
      st.provider = { id: pid, baseUrl: base.baseUrl, apiKey: ((st.provider || {}).id === pid ? (st.provider || {}).apiKey : '') || '', defaultModel: base.defaultModel };
      saveSettings(st); renderAgents();
    };
    $('#agSave').onclick = () => {
      const st = settings();
      const dmSel = $('[data-seldefmodel="g"]'), dmInp = $('[data-defmodel="g"]');
      const dm = dmSel ? (dmSel.value === '__custom__' ? (dmInp ? dmInp.value.trim() : '') : dmSel.value) : (dmInp ? dmInp.value.trim() : '');
      st.provider = {
        id: $('#agProvider').value,
        baseUrl: $('#agBaseUrl').value.trim(),
        apiKey: $('#agApiKey').value.trim(),
        defaultModel: dm
      };
      st.apiKey = st.provider.id === 'anthropic' ? st.provider.apiKey : st.apiKey; // legacy field
      st.limits = {
        maxCallsPerDay: Math.max(1, parseInt($('#agMaxCalls').value) || 25),
        maxUSDPerDay: Math.max(0, parseFloat($('#agMaxUSD').value) || 10),
        confirmRuns: $('#agConfirm').value === 'yes'
      };
      saveSettings(st); toast('Agent settings saved'); render();
    };
    $('#btnResetModel').onclick = async () => {
      if (!(await uiConfirm('Reset to workbook defaults?', 'Your ledger and edits will be lost. Undo can bring back the last 15 states.', 'Reset'))) return;
      model = Engine.defaultModel(); recompute(); render(); toast('Model reset');
    };

    const list = $('#agentCfgList');
    list.innerHTML = Agents.AGENT_DEFS.map(def => {
      const cfg = Agents.agentCfg(s, def.id);
      const overridden = !!(((s.agents || {})[def.id] || {}).prompt);
      return `<div class="card mb-2 ${cfg.enabled ? '' : ''}">
        <div class="row">
          <h3 style="font-size:var(--text-xl)">${esc(def.callsign)}</h3>
          <span class="mono-label">${esc(def.role.toUpperCase())} · ${esc(def.kind.toUpperCase())}${def.webSearch ? ' · WEB SEARCH' : ''}</span>
          <span style="flex:1"></span>
          <label class="row small muted" style="gap:.4rem"><input type="checkbox" data-agen="${def.id}" ${cfg.enabled ? 'checked' : ''} style="width:auto">enabled</label>
        </div>
        <p class="muted small" style="margin:.25rem 0 .75rem">${esc(def.mandate)}</p>
        <div class="assumption-grid">
          <label class="field"><span class="lbl mono-label"><span class="lbl-txt">Model (blank = provider default)</span></span>
            ${modelPickerHTML(Agents.providerCfg(s), `data-agmodel="${def.id}"`, cfg.model, `Provider default — ${esc(Agents.providerCfg(s).id === 'anthropic' ? cfg.anthropicDefault : (Agents.providerCfg(s).defaultModel || 'set on this page'))}`)}</label>
          <label class="field"><span class="lbl mono-label"><span class="lbl-txt">Max output tokens</span></span>
            <input type="number" min="256" step="256" data-agtok="${def.id}" value="${cfg.maxTokens}"></label>
        </div>
        ${/fable/i.test(cfg.model) ? `<div class="field-notice warn mt-2"><div class="fn-head">// TOKEN BURN WARNING</div>
          <div class="fn-detail">Fable is a frontier-tier model at roughly <b>8–10× Sonnet cost per run</b> (est. $25/M in · $125/M out). A full board review on Fable can cost $3–5 by itself. Make sure the daily spend cap reflects that; prefer Sonnet for routine runs and save Fable for the final pre-board pass.</div></div>` : ''}
        <div class="row mt-2">
          <span class="mono-label">SYSTEM PROMPT ${overridden ? '<span class="badge warn">CUSTOMIZED</span>' : '<span class="badge ok">DEFAULT</span>'}</span>
          <button class="btn btn-ghost" data-agshow="${def.id}">${agentPromptOpen[def.id] ? 'Hide prompt' : 'View / edit prompt'}</button>
        </div>
        ${agentPromptOpen[def.id] ? `
        <textarea data-agprompt="${def.id}" style="min-height:140px;font-family:var(--font-mono);font-size:var(--text-xs)">${esc(cfg.prompt)}</textarea>
        <div class="row mt-2"><span class="muted small">Edits save when you click away.</span><span style="flex:1"></span><button class="btn btn-ghost" data-agreset="${def.id}">Reset prompt to default</button></div>` : ''}
      </div>`;
    }).join('');
    const upd = (id, patch) => { const st = settings(); st.agents = st.agents || {}; st.agents[id] = Object.assign({}, st.agents[id], patch); saveSettings(st); };
    list.querySelectorAll('[data-agshow]').forEach(el => el.onclick = () => { agentPromptOpen[el.dataset.agshow] = !agentPromptOpen[el.dataset.agshow]; renderAgents(); });
    list.querySelectorAll('[data-agen]').forEach(el => el.onchange = () => upd(el.dataset.agen, { enabled: el.checked }));
    bindModelPicker(list, 'data-selagmodel', 'data-agmodel', (id, val) => {
      upd(id, { model: val });
      toast(/fable/i.test(val) ? '⚠ Fable selected — heavy token burn, check your daily caps' : 'Model updated');
      renderAgents();
    });
    list.querySelectorAll('[data-agtok]').forEach(el => el.onchange = () => upd(el.dataset.agtok, { maxTokens: Math.max(256, parseInt(el.value) || 2000) }));
    list.querySelectorAll('[data-agprompt]').forEach(el => el.onchange = () => { upd(el.dataset.agprompt, { prompt: el.value }); toast('Prompt saved'); renderAgents(); });
    list.querySelectorAll('[data-agreset]').forEach(el => el.onclick = () => { upd(el.dataset.agreset, { prompt: null }); toast('Prompt reset to default'); renderAgents(); });
  }

  // ============================== DASHBOARD ==============================
  function renderDashboard() {
    const sb = $('#sampleBanner');
    if (sb) {
      // build all banner content first, assign once, THEN bind — innerHTML += would destroy earlier listeners
      const parts = [];
      if (model.meta && model.meta.sample) parts.push(`<div class="field-notice warn mb-3">
        <div class="fn-head">// DEMO DATA</div>
        <div class="fn-title">These numbers are the sample plan from the reference workbook — not yours yet.</div>
        <div class="fn-detail">Targets, rates, teams and hiring plans below are placeholders. Work Step 1 (Rates &amp; FX) and Step 2 (Plan Builder) to make it your plan — then dismiss this so nobody presents demo numbers.</div>
        <div class="row mt-2"><button class="btn btn-secondary" id="btnDismissSample">It's our plan now — dismiss</button></div>
      </div>`);
      // setup checklist: guides a new (esp. blank-start) model through the numbered IA
      const steps = [
        { label: 'Geography, roles & pay', done: model.fx.length > 0 && model.rateCard.roles.length > 0, page: 'rates' },
        { label: 'Teams with role lines', done: model.teams.some(x => (x.roles || []).length > 0), page: 'rates' },
        { label: 'Drivers: starting ARR + goals', done: (model.config.startingARR || 0) > 0 && (model.config.arrGoals || []).some(g => g > 0), page: 'drivers' },
        { label: 'Hiring plan drafted', done: model.teams.some(x => (x.roles || []).some(l => (l.hires || []).some(h => h > 0))), page: 'drivers' },
        { label: 'Error flags cleared', done: computed.checks.filter(c => c.severity === 'error').length === 0, page: 'readiness' }
      ];
      const doneN = steps.filter(s => s.done).length;
      const showChecklist = doneN < steps.length && !(model.meta && model.meta.sample) && !(model.meta && model.meta.checklistDismissed);
      if (showChecklist) parts.push(`<div class="field-notice mb-3">
          <div class="fn-head">// SETUP CHECKLIST — ${doneN} OF ${steps.length} DONE</div>
          <div class="row mt-2" style="gap:.4rem;flex-wrap:wrap">
            ${steps.map((s, i) => `<button class="btn btn-ghost" data-clstep="${s.page}" style="padding:.3rem .6rem;${s.done ? 'color:var(--muted-foreground);text-decoration:line-through' : ''}">${s.done ? '✓' : '○'} ${i + 1} · ${esc(s.label)}</button>`).join('')}
            <span style="flex:1"></span>
            <button class="btn btn-ghost" id="btnClDismiss" title="Hide this checklist for this model">✕</button>
          </div></div>`);
      // backup nudge: everything lives in this browser — remind when the last export is stale
      let showNudge = false;
      if (!(model.meta && model.meta.sample)) {
        const last = localStorage.getItem('ro_last_export');
        const days = last ? Math.floor((Date.now() - new Date(last).getTime()) / 86400000) : null;
        showNudge = days === null || days >= 7;
        if (showNudge) parts.push(`<div class="field-notice mb-3">
            <div class="fn-head">// LOCAL DATA ONLY</div>
            <div class="fn-title">This plan lives in this browser — last backup: ${days === null ? 'never' : days + ' day' + (days === 1 ? '' : 's') + ' ago'}.</div>
            <div class="fn-detail">A cleared browser profile loses the model, versions and ledger. Export a JSON copy somewhere safe.</div>
            <div class="row mt-2"><button class="btn btn-secondary" id="btnBackupNow">⤓ Export model now</button></div>
          </div>`);
      }
      sb.innerHTML = parts.join('');
      const d = $('#btnDismissSample');
      if (d) d.onclick = () => { model.meta.sample = false; saveModel(); render(); toast('Marked as your plan'); };
      sb.querySelectorAll('[data-clstep]').forEach(b => b.onclick = () => $(`.nav-tab[data-page=${b.dataset.clstep}]`).click());
      const cd = $('#btnClDismiss');
      if (cd) cd.onclick = () => { model.meta = model.meta || {}; model.meta.checklistDismissed = true; saveModel(); render(); };
      const bn = $('#btnBackupNow');
      if (bn) bn.onclick = () => $('#btnExport').click();
    }
    const t = computed.summary.totals;
    const H = computed.H;
    $('#dashSub').textContent = `${H}-month plan · start ${model.config.startMonth} · scenario ${model.config.scenario} · ${model.teams.filter(x => x.enabled !== false).length} teams · every figure recalculates live.`;

    const errs = computed.checks.filter(c => c.severity === 'error').length;
    const S = computed.summary;
    const cumSM = (S.cumSM || [])[H - 1] || 0, cumBooked = (S.cumBooked || [])[H - 1] || 0;
    const churnTot = (S.churn || []).reduce((a, v) => a + v, 0);
    const kpis = [
      { label: `${H}-mo GTM run-cost`, value: fmtShort(t.cost), sub: fmt$(t.cost),
        math: `Every team's monthly loaded cost, summed over ${H} months. Loaded cost per head = base × (1 + country burden) + variable × attainment, priced at the FX budget rate (max(spot, trailing) × (1 + buffer)), plus one-time hire costs (recruiting share × agency fee + onboarding). Total = ${fmt$(t.cost)}.` },
      { label: `${H}-mo net-new ARR`, value: fmtShort(t.revenue), sub: `booked ${fmtShort(t.booked)} + expansion ${fmtShort(t.expansion)}`,
        math: `New business ${fmt$(t.booked)} (monthly targets with seasonality) + expansion ${fmt$(t.expansion)}${(model.config.expTargetPct || 0) > 0 ? ` (target ${Math.round(model.config.expTargetPct * 100)}% of book/yr)` : ' (AM capacity-driven)'} + renewal escalator ${fmt$(t.builtIn)} on the retained base = ${fmt$(t.revenue)}. This is ARR ADDED in the window — not recognized (GAAP) revenue, which lags as contracts are delivered.` },
      { label: 'Ending GTM headcount', value: t.endingHeadcount, sub: `${t.hires} hires · ${t.attrition} lost to attrition`,
        math: `Starting bench + ${t.hires} planned hires − ${t.attrition} expected attrition (each role line's annual % applied monthly, rounded to whole heads) = ${t.endingHeadcount} at month ${H}.` },
      { label: 'New-business CAC ratio', value: t.finalCAC.toFixed(2), sub: 'cumulative S&M ÷ booked ARR', accent: t.finalCAC > 1,
        math: `Cumulative S&M cost ${fmt$(cumSM)} ÷ cumulative booked new-business ARR ${fmt$(cumBooked)} = ${t.finalCAC.toFixed(2)}. S&M only — CS and AM costs are deliberately excluded, so this is a clean new-business CAC. Below 1.0 means $1 of S&M buys more than $1 of new ARR. Payback (Readiness page) applies your ${Math.round((model.guardrails.grossMargin || 0.8) * 100)}% gross-margin guardrail on top.` },
      { label: 'Ending ARR base', value: fmtShort(t.endingARR), sub: fmt$(t.endingARR),
        math: `Start ${fmt$(model.config.startingARR || 0)} + new business ${fmt$(t.booked)} + expansion ${fmt$(t.expansion)} + escalator ${fmt$(t.builtIn)} − churn ${fmt$(churnTot)} (${Math.round((model.config.grossRetention != null ? model.config.grossRetention : 0.9) * 100)}% GRR) = ${fmt$(t.endingARR)}. Capacity-feasible (staffed) version: ${fmt$(t.feasibleEndingARR)}.` }
    ];
    $('#kpiRow').innerHTML = kpis.map((k, i) => `
      <div class="card stat-block">
        <div class="stat-value ${k.accent ? 'accent' : ''}">${k.value}</div>
        <div class="stat-label mono-label">${esc(k.label)}${k.math ? ` <button class="kpi-info" data-mathi="${i}" title="How this number is computed">ⓘ</button>` : ''}</div>
        <div class="stat-sub">${esc(k.sub)}</div>
      </div>`).join('');
    $$('#kpiRow [data-mathi]').forEach(b => b.onclick = () => {
      const k = kpis[+b.dataset.mathi];
      ask({ title: k.label + ' — the math', message: k.math, okText: 'Got it' });
    });

    // charts
    const teams = computed.teams;
    Charts.stackedBars($('#chCost'), computed.labels, teams.map((tm, i) => ({ name: tm.name, data: tm.cost })), { title: 'MONTHLY RUN-COST BY TEAM ($)' });
    Charts.lines($('#chRev'), computed.labels, [
      { name: 'Net-new ARR', data: computed.summary.totalRevenue, accent: true },
      { name: 'GTM cost', data: computed.summary.totalCost }
    ], { title: 'NET-NEW ARR VS COST ($/MO) — SPEND LEADS BOOKINGS BY ' + model.config.salesCycleLag + ' MO' });
    Charts.steps($('#chHeads'), computed.labels, teams.map(tm => ({ name: tm.name, data: tm.headcount })), { title: 'GTM HEADCOUNT (ENDING, STACKED)' });
    Charts.lines($('#chCac'), computed.labels, [
      { name: 'CAC ratio', data: computed.summary.cac, accent: true },
      { name: 'GTM cost % of net-new ARR', data: computed.summary.costPctRevenue }
    ], { title: 'UNIT ECONOMICS — CAC RATIO & COST % OF REVENUE', threshold: model.guardrails.costPctCeiling });

    renderScenarioCompare();
    renderActuals();

    // checks digest
    const top = computed.checks.slice(0, 4);
    const hty = healthTally();
    const tallyHTML = `<div class="row mb-2" style="gap:.5rem;flex-wrap:wrap">
      <span class="mono-label">DEFENDABILITY:</span>
      <span class="badge ${hty.errors ? 'bad' : 'ok'}">${hty.errors} ERROR${hty.errors === 1 ? '' : 'S'}</span>
      <span class="badge ${hty.warns ? 'warn' : 'ok'}">${hty.warns} WARNING${hty.warns === 1 ? '' : 'S'}</span>
      <span class="badge ${hty.challenged ? 'warn' : 'ok'}">${hty.challenged} CHALLENGED</span>
      <span class="badge ok">${hty.agreed} AGREED · ${hty.proposed} PROPOSED</span>
      <span class="muted small">${hty.open ? 'the board pack will ask before exporting with these open' : 'clean — board-pack ready'}</span>
    </div>`;
    $('#dashChecks').innerHTML = tallyHTML + (top.length
      ? `<div class="section-marker">FLAGS (${computed.checks.length} total — full list under Readiness)</div>` + top.map(checkHTML).join('')
      : `<div class="field-notice info"><div class="fn-head">// CLEAR</div><div class="fn-title">No flags. Either the plan is tight or the guardrails are loose.</div></div>`);
  }

  // ---- side-by-side scenario comparison ----
  function scenarioRows() {
    return Object.keys(model.config.scenarios).map(name => {
      const clone = JSON.parse(JSON.stringify(model));
      clone.config.scenario = name;
      const r = name === model.config.scenario ? computed : Engine.compute(clone);
      const shorts = r.teams.reduce((a, tm) => a + tm.coverageFlag.filter(f => f === 'SHORT').length, 0);
      const ahead = r.readiness.hiringHealth.filter(h => h === 'AHEAD OF SUPPORT').length;
      return { name, t: r.summary.totals, shorts, ahead };
    });
  }
  function renderScenarioCompare() {
    const elc = $('#scenCompare');
    if (!elc) return;
    const rows = scenarioRows();
    elc.innerHTML = `<div class="section-marker">SCENARIO COMPARE — SAME PLAN, THREE WEATHERS</div>
      <div class="tbl-wrap"><table><thead><tr><th>Scenario</th><th>GTM cost</th><th>Feasible ARR (staffed)</th><th>vs goal ARR</th><th>CAC ratio</th><th>Months SHORT</th><th>Months AHEAD</th></tr></thead><tbody>
      ${rows.map(r => { const gap = r.t.endingARR > 0 ? (r.t.feasibleEndingARR - r.t.endingARR) / r.t.endingARR : 0; return `<tr ${r.name === model.config.scenario ? 'style="background:rgba(255,61,0,.07)"' : ''}>
        <td class="lbl">${esc(r.name)}${r.name === model.config.scenario ? ' <span class="badge bad">ACTIVE</span>' : ''}</td>
        <td>${fmtShort(r.t.cost)}</td><td>${fmtShort(r.t.feasibleEndingARR)}</td>
        <td>${gap < -0.005 ? `<span class="cellflag-bad">${(gap * 100).toFixed(0)}%</span>` : `<span class="cellflag-ok">${gap > 0.005 ? '+' + (gap * 100).toFixed(0) + '%' : 'ON GOAL'}</span>`}</td>
        <td>${r.t.finalCAC.toFixed(2)}</td>
        <td>${r.shorts ? `<span class="cellflag-bad">${r.shorts}</span>` : '<span class="cellflag-ok">0</span>'}</td>
        <td>${r.ahead ? `<span class="cellflag-bad">${r.ahead}</span>` : '<span class="cellflag-ok">0</span>'}</td>
      </tr>`; }).join('')}</tbody></table></div>
      <p class="muted small mt-2">Targets are the plan — they don't move across scenarios. Feasible ARR shows what scenario-adjusted capacity actually supports; the gap column is the honest exposure. Conservative is what your CFO will pressure-test: conversion −15%, ramp −15%, productivity −5%, cost +5%.</p>`;
  }

  // ---- plan vs actuals (vendor-agnostic CSV) ----
  const ACTUAL_METRICS = {
    headcount: { label: 'GTM headcount', plan: () => computed.summary.totalHeadcount },
    cost: { label: 'GTM cost $/mo', plan: () => computed.summary.totalCost },
    bookings: { label: 'New business booked $/mo', plan: () => computed.summary.bookedRevenue },
    revenue: { label: 'Net-new ARR $/mo', plan: () => computed.summary.totalRevenue },
    arr: { label: 'Ending ARR $', plan: () => computed.summary.endingARR }
  };

  function monthIndexOf(str) {
    const t = String(str).trim();
    let mm = t.match(/^(\d{4})-(\d{1,2})$/);
    if (mm) {
      const [y0, m0] = model.config.startMonth.split('-').map(Number);
      return (Number(mm[1]) - y0) * 12 + (Number(mm[2]) - m0);
    }
    const idx = computed.labels.findIndex(l => l.toLowerCase() === t.toLowerCase());
    return idx >= 0 ? idx : -1;
  }

  function parseActualsCSV(text) {
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (!lines.length) throw new Error('Empty file');
    const split = l => l.match(/("[^"]*"|[^,]+)/g).map(x => x.replace(/^"|"$/g, '').trim());
    let start = 0, cols = { month: 0, metric: 1, value: 2 };
    const head = split(lines[0]).map(h => h.toLowerCase());
    if (head.includes('month')) {
      cols = { month: head.indexOf('month'), metric: head.indexOf('metric'), value: head.indexOf('value') };
      if (cols.metric < 0 || cols.value < 0) throw new Error('Header must include month, metric, value');
      start = 1;
    }
    const rows = [];
    for (let i = start; i < lines.length; i++) {
      const p = split(lines[i]);
      if (p.length < 3) continue;
      const metric = p[cols.metric].toLowerCase().replace(/[^a-z]/g, '');
      if (!ACTUAL_METRICS[metric]) throw new Error(`Row ${i + 1}: unknown metric "${p[cols.metric]}" — use ${Object.keys(ACTUAL_METRICS).join(', ')}`);
      const idx = monthIndexOf(p[cols.month]);
      if (idx < 0 || idx >= computed.H) throw new Error(`Row ${i + 1}: month "${p[cols.month]}" is outside the plan window (use YYYY-MM or e.g. "${computed.labels[0]}")`);
      const value = parseFloat(p[cols.value].replace(/[$,\s]/g, ''));
      if (Number.isNaN(value)) throw new Error(`Row ${i + 1}: value "${p[cols.value]}" is not a number`);
      rows.push({ m: idx, metric, value });
    }
    if (!rows.length) throw new Error('No data rows found');
    return rows;
  }

  let actualsMetricSel = '';
  function renderActuals() {
    const elc = $('#actualsSection');
    if (!elc) return;
    const acts = model.actuals || [];
    const present = [...new Set(acts.map(a => a.metric))];
    if (!present.includes(actualsMetricSel)) actualsMetricSel = present[0] || '';
    let html = `<div class="row"><span class="section-marker" style="margin:0">PLAN VS ACTUALS</span>
      <span class="muted small">System-agnostic — export a CSV from whatever you run (HRIS, CRM, ERP) into month, metric, value.</span>
      <span style="flex:1"></span>
      <button class="btn btn-ghost" id="btnActTemplate">⤓ Template</button>
      <button class="btn btn-ghost" id="btnActImport">⇪ Import actuals CSV</button>
      ${acts.length ? '<button class="btn btn-ghost" id="btnOpReport" title="Print-ready plan-vs-actuals variance report">⤓ Operating report</button>' : ''}
      ${acts.length ? '<button class="btn btn-danger" id="btnActClear">Clear</button>' : ''}</div>`;
    if (acts.length) {
      html += `<div class="row mt-2"><label class="field" style="width:240px"><span class="lbl mono-label">Metric</span>
        <select id="actMetric">${present.map(mt => `<option value="${mt}" ${mt === actualsMetricSel ? 'selected' : ''}>${esc(ACTUAL_METRICS[mt].label)}</option>`).join('')}</select></label></div>
        <div class="chart-card mt-2" id="chActuals"></div>
        <div class="tbl-wrap mt-2" id="actVariance"></div>`;
    }
    elc.innerHTML = html;
    $('#btnActTemplate').onclick = () => {
      const tpl = ['month,metric,value', `${computed.labels[0]},headcount,14`, `${computed.labels[0]},cost,310000`, `2026-08,bookings,0`, '# metrics: headcount · cost · bookings · revenue · arr  (months: YYYY-MM or the label shown on charts)'];
      download('actuals-template.csv', tpl.join('\n'), 'text/csv');
    };
    $('#btnActImport').onclick = () => $('#actualsFile').click();
    const opBtn = $('#btnOpReport');
    if (opBtn) opBtn.onclick = exportOpReport;
    const clearBtn = $('#btnActClear');
    if (clearBtn) clearBtn.onclick = async () => {
      if (!(await uiConfirm('Clear imported actuals?', 'The plan itself is untouched.', 'Clear'))) return;
      delete model.actuals; saveModel(); render();
    };
    const ms = $('#actMetric');
    if (ms) ms.onchange = () => { actualsMetricSel = ms.value; renderActuals(); };
    if (acts.length && actualsMetricSel) {
      const def = ACTUAL_METRICS[actualsMetricSel];
      const plan = def.plan();
      const actual = new Array(computed.H).fill(NaN);
      acts.filter(a => a.metric === actualsMetricSel).forEach(a => { actual[a.m] = a.value; });
      Charts.lines($('#chActuals'), computed.labels, [
        { name: 'Plan', data: plan, accent: true },
        { name: 'Actual', data: actual, dashed: true, dots: true, color: '#FAFAFA' }
      ], { title: ('PLAN VS ACTUAL — ' + def.label).toUpperCase() });
      const rows = acts.filter(a => a.metric === actualsMetricSel).sort((a, b) => a.m - b.m);
      $('#actVariance').innerHTML = `<table><thead><tr><th>Month</th><th>Plan</th><th>Actual</th><th>Δ</th><th>Δ%</th></tr></thead><tbody>
        ${rows.map(a => {
          const p = plan[a.m]; const d = a.value - p;
          return `<tr><td class="lbl">${esc(computed.labels[a.m])}</td><td>${fmtShort(p)}</td><td>${fmtShort(a.value)}</td>
            <td class="${d < 0 ? 'dim' : ''}" style="${Math.abs(d) > Math.abs(p) * 0.1 ? 'color:var(--accent)' : ''}">${d >= 0 ? '+' : ''}${fmtShort(d)}</td>
            <td>${p ? ((d / p) * 100).toFixed(1) + '%' : '—'}</td></tr>`;
        }).join('')}</tbody></table>`;
    }
  }

  function checkHTML(c) {
    const cls = c.severity === 'error' ? '' : (c.severity === 'warn' ? 'warn' : 'info');
    return `<div class="field-notice ${cls}">
      <div class="fn-head">// ${esc(c.severity.toUpperCase())} · ${esc(c.team.toUpperCase())}</div>
      <div class="fn-title">${esc(c.title)}</div>
      ${c.detail ? `<div class="fn-detail">${esc(c.detail)}</div>` : ''}
    </div>`;
  }

  // ============================== PLAN BUILDER ==============================
  let selectedTeamId = null;
  let configOpen = false;

  function renderDrivers() {
    renderConfigCard();
    renderChannelCard();
    renderBuildCta();
  }

  function renderBuilder() {
    renderDriverStrip();
    if (!model.teams.find(t => t.id === selectedTeamId)) selectedTeamId = model.teams.length ? model.teams[0].id : null;
    renderTeamRail();
    renderTeamDetail();
  }

  // one-click first pass: implied targets + drafted hiring, then validate in the Builder
  function renderBuildCta() {
    const elc = $('#buildCta');
    if (!elc) return;
    const staffable = model.teams.filter(t => ['sales', 'prospecting', 'demand-funnel', 'pipeline-channel'].includes(t.type) || (t.type === 'expansion' && (model.config.expTargetPct || 0) > 0));
    const plannedHires = staffable.reduce((a, t) => a + (t.roles || []).reduce((x, l) => x + (l.hires || []).reduce((y, h) => y + h, 0), 0), 0);
    const fresh = plannedHires === 0;
    elc.innerHTML = `<div class="row">
      <div>
        <div class="section-marker" style="margin:0">LET THE MODEL BUILD THE FIRST PASS</div>
        <p class="muted small" style="margin:.4rem 0 0;max-width:46rem">${fresh
          ? 'No hiring planned yet. One click sets the implied targets from your goals and drafts ramp-aware hiring across the revenue teams — then you validate and adjust, team by team, in the Builder.'
          : `${plannedHires} hires already planned. Re-drafting adds hires only where coverage falls short of the drivers — it never removes what's been placed, and Undo reverts the lot.`}</p>
      </div>
      <span style="flex:1"></span>
      <button class="btn btn-stencil" id="btnBuildPlan" style="padding:.8rem 1.6rem;font-size:var(--text-base)">⚙ ${fresh ? 'Build the plan' : 'Re-draft the gaps'}</button>
    </div>`;
    $('#btnBuildPlan').onclick = staffToGoal;
  }

  // read-only context strip at the top of the Builder
  function renderDriverStrip() {
    const elc = $('#driverStrip');
    if (!elc) return;
    const br = bridgeYears();
    const expT = model.config.expTargetPct || 0;
    elc.innerHTML = `<div class="row" style="flex-wrap:wrap">
      <span class="mono-label">DRIVERS:</span>
      ${br.map(b => {
        const short = b.goal > 0 && b.end < b.goal * 0.995;
        const feas = b.feas < b.end * 0.995;
        return `<span class="small">Y${b.y + 1} goal <b>${fmtShort(b.goal)}</b> → target ${fmtShort((model.config.annualTargets || [])[b.y] || 0)} ${short ? '<span class="badge bad">Δ SHORT</span>' : '<span class="badge ok">ON GOAL</span>'}${feas ? ' <span class="badge warn">FEASIBILITY</span>' : ''}</span>`;
      }).join('')}
      <span class="small muted">expansion ${expT > 0 ? Math.round(expT * 100) + '%/yr of book' : 'capacity-driven'} · ${esc(model.config.scenario)} scenario</span>
      <span style="flex:1"></span>
      <button class="btn btn-ghost" id="btnEditDrivers">Edit drivers →</button>
    </div>`;
    $('#btnEditDrivers').onclick = () => $('.nav-tab[data-page=drivers]').click();
  }

  function bridgeYears() {
    const yrs = Math.ceil(computed.H / 12);
    const S = computed.summary;
    const out = [];
    for (let y = 0; y < yrs; y++) {
      const a = y * 12, b = Math.min(computed.H, (y + 1) * 12);
      const slice = arr => arr.slice(a, b).reduce((x, v) => x + v, 0);
      out.push({
        y, start: y === 0 ? (model.config.startingARR || 0) : S.endingARR[a - 1],
        nb: slice(S.bookedRevenue), exp: slice(S.expansion),
        esc: slice(S.builtInGrowth || []), churn: slice(S.churn),
        end: S.endingARR[b - 1], feas: (S.feasibleARR || S.endingARR)[b - 1],
        goal: (model.config.arrGoals || [])[y] || 0
      });
    }
    return out;
  }

  // local replica of the engine's per-line headcount/ramp math (incl. ROUND attrition)
  function simLine(start, hires, attrAnnual, ramp, H) {
    const monthlyAttr = (attrAnnual || 0) / 12;
    const r = ramp && ramp.length ? ramp : null;
    const ending = new Array(H).fill(0), ramped = new Array(H).fill(0);
    let prev = start || 0;
    for (let m = 0; m < H; m++) {
      const attr = Math.round(prev * monthlyAttr);
      ending[m] = prev + (hires[m] || 0) - attr;
      prev = ending[m];
    }
    for (let m = 0; m < H; m++) {
      let unprod = 0;
      if (r) for (let k = 0; k < r.length; k++) { const hm = m - k; if (hm >= 0) unprod += (hires[hm] || 0) * (1 - Math.min(1, r[k])); }
      ramped[m] = ending[m] - unprod;
    }
    return { ending, ramped };
  }

  // "what it takes": implied targets + drafted hiring across the pipeline-producing teams
  async function staffToGoal() {
    const yrs = Math.ceil(model.config.horizon / 12);
    const goals = model.config.arrGoals.slice(0, yrs);
    if (!goals.some(g => g > 0)) { toast('Set ending-ARR goals first'); return; }
    const maxPerMo = Math.max(1, Math.round(model.config.maxStartsPerMonth || 3));
    if (!(await uiConfirm('Build the plan from the drivers?', `Sets the implied new-business targets and drafts ramp-aware hiring across the revenue teams (max ${maxPerMo} starts per team per month — a Model Driver). Drafts land in the editable hiring plans; one Undo reverts everything.`, 'Build it'))) return;

    // 1. targets from goals
    const sol = Engine.solveTargets(model, goals);
    goals.forEach((g, y) => { if (g > 0) model.config.annualTargets[y] = sol.targets[y]; });

    // 2. snapshot demand under the new targets, then fill each team's primary line greedily
    const snap = Engine.compute(JSON.parse(JSON.stringify(model)));
    const H = snap.H, mult = snap.mult;
    const added = [];
    let saturated = [];
    model.teams.filter(t => ['sales', 'prospecting', 'demand-funnel', 'pipeline-channel'].includes(t.type) || (t.type === 'expansion' && (model.config.expTargetPct || 0) > 0)).forEach(team => {
      const r = snap.teams.find(x => x.id === team.id);
      const lines = team.roles || [];
      if (!r || !lines.length || !r.extras.lines) return;
      const isAnnual = team.type === 'sales' || team.type === 'expansion';
      const isSales = team.type === 'sales';
      const policy = isSales ? Math.max(1, team.targetCoverage || 1) : 1;
      const req = r.demand.map(d => d * policy);
      if (!req.some(v => v > 0)) return;
      // primary line = biggest at horizon end
      let pi = 0, best = -1;
      r.extras.lines.forEach((l, i) => { if (l.ending[H - 1] > best) { best = l.ending[H - 1]; pi = i; } });
      const line = lines[pi];
      const pk = Engine.PROD_KEY[team.type];
      const prod = line[pk] || 0;
      if (prod <= 0) return;
      const perRamped = (isAnnual ? prod / 12 : prod) * mult.prod; // capacity per fully-ramped head
      // fixed capacity from the other lines (already computed)
      const fixedCap = new Array(H).fill(0);
      r.extras.lines.forEach((l, i) => {
        if (i === pi) return;
        for (let m = 0; m < H; m++) fixedCap[m] += l.ramped[m] * (isAnnual ? l.prod / 12 : l.prod) * mult.prod;
      });
      const overlay = isSales ? padToH(team.judgmentOverlay, H) : new Array(H).fill(0);
      const ramp = line.ramp || Engine.DEFAULT_RAMP[team.type] || null;
      const lead = ramp ? ramp.length - 1 : 0;
      const hires = padToH(line.hires, H);
      let sim = simLine(line.start || 0, hires, line.annualAttrition || 0, ramp, H);
      const capAt = m => fixedCap[m] + sim.ramped[m] * perRamped + overlay[m];
      let count = 0, guard = 0, capped = false;
      for (let m = 0; m < H && guard < 600; m++) {
        while (capAt(m) < req[m] - 1e-6 && guard++ < 600) {
          let placed = false;
          for (let h = Math.max(0, m - lead); h <= m; h++) {
            if (hires[h] < maxPerMo) { hires[h]++; placed = true; break; }
          }
          if (!placed) { capped = true; break; } // guardrail binds — leave the SHORT flag honest
          sim = simLine(line.start || 0, hires, line.annualAttrition || 0, ramp, H);
          count++;
        }
      }
      if (count) { line.hires = hires; added.push(`${team.name} +${count}`); }
      if (capped) saturated.push(team.name);
    });

    recompute();
    const msg = added.length ? `Drafted: ${added.join(', ')}` : 'No additional hires needed — capacity already covers the goal';
    const satNote = saturated.length ? ` ${saturated.join(', ')} hit the ${maxPerMo}/mo guardrail (some months stay SHORT).` : '';
    $('.nav-tab[data-page=builder]').click(); // validate the draft where it lives
    const flags = computed.checks.filter(c => c.severity === 'error' || c.severity === 'warn');
    if (added.length && flags.length) {
      // the drafter optimizes goal coverage — disclose the checks it trips instead of leaving them for the dashboard
      await ask({
        title: `Drafted — ${flags.length} check${flags.length === 1 ? '' : 's'} to review`,
        message: `${msg}.${satNote} The draft currently trips: ${flags.slice(0, 4).map(c => `${c.team} — ${c.title}`).join(' · ')}${flags.length > 4 ? ` · +${flags.length - 4} more on the dashboard` : ''}. Staff-to-goal fills capacity to the target; trim early starts or accept the flags deliberately. One Undo reverts the whole draft.`,
        okText: 'Review in builder'
      });
    } else {
      toast(msg + satNote + ' · review & edit, Undo reverts');
    }
  }
  function padToH(arr, H) { const a = (arr || []).slice(0, H); while (a.length < H) a.push(0); return a; }

  // defendability tally: open flags + unresolved ledger items, used by the dashboard strip and the board-pack gate
  function healthTally() {
    const errors = computed.checks.filter(c => c.severity === 'error').length;
    const warns = computed.checks.filter(c => c.severity === 'warn').length;
    const entries = Object.values(model.ledger || {});
    const challenged = entries.filter(e => e.status === 'CHALLENGED').length;
    const proposed = entries.filter(e => !e.status || e.status === 'PROPOSED').length;
    const agreed = entries.filter(e => e.status === 'AGREED').length;
    return { errors, warns, challenged, proposed, agreed, open: errors + warns + challenged };
  }

  function csGrrLabel() {
    return Math.round((model.config.grossRetention != null ? model.config.grossRetention : 0.9) * 100) + '% GRR';
  }

  // -------- channel mix — agreed up front, drives every team's requirement --------
  function renderChannelCard() {
    const card = $('#channelCard');
    const sales = model.teams.find(t => t.type === 'sales' && t.enabled !== false);
    if (!sales) { card.innerHTML = '<div class="section-marker">REVENUE CHANNEL MIX</div><p class="muted small">Add a Sales team to set the channel mix.</p>'; return; }
    const sIdx = model.teams.indexOf(sales);
    const mixSum = sales.channels.reduce((s, c) => s + c.mixPct, 0);
    const mixOk = Math.abs(mixSum - 1) <= 0.001;
    const allAgreed = sales.channels.every(ch => {
      const m = ledgerEntry(ledgerKey(sales.id, 'ch_' + ch.id + '_mix'));
      const w = ledgerEntry(ledgerKey(sales.id, 'ch_' + ch.id + '_win'));
      return m && m.status === 'AGREED' && w && w.status === 'AGREED';
    });
    const collapsed = mixOk && allAgreed && channelOpen !== true;
    if (collapsed) {
      card.innerHTML = `<div class="row">
        <span class="section-marker" style="margin:0">REVENUE CHANNEL MIX</span>
        <span class="badge ok">MIX = 100%</span><span class="badge good">ALL AGREED</span>
        <span class="muted small">${sales.channels.map(c => `${esc(c.name)} ${Math.round(c.mixPct * 100)}%`).join(' · ')}</span>
        <span style="flex:1"></span>
        <button class="btn btn-ghost" id="btnChOpen">Expand</button>
      </div>`;
      $('#btnChOpen').onclick = () => { channelOpen = true; renderDrivers(); };
      return;
    }
    let html = `<div class="row">
      <span class="section-marker" style="margin:0">REVENUE CHANNEL MIX — AGREE THIS FIRST</span>
      ${mixOk ? '<span class="badge ok">MIX = 100%</span>' : `<span class="badge bad">SUMS TO ${(mixSum * 100).toFixed(1)}% — FIX</span>`}
      ${allAgreed ? '<span class="badge good">ALL AGREED</span>' : '<span class="badge warn">NOT YET AGREED</span>'}
      <span style="flex:1"></span>
      ${!mixOk ? '<button class="btn btn-ghost" id="btnBalanceChannels">⚖ Balance to 100%</button>' : ''}
      ${mixOk && allAgreed ? '<button class="btn btn-ghost" id="btnChCollapse">Collapse</button>' : ''}
    </div>
    <p class="muted small" style="max-width:52rem;margin:.5rem 0 0">Where does the revenue come from? Each channel's share of the target becomes a pipeline requirement (share ÷ win rate) that its generating team must deliver — change the mix and every team's demand moves. Use the chips to put each number through the ledger until the group has AGREED it.</p>
    <div class="tbl-wrap mb-2 mt-2"><table><thead><tr><th>Channel</th><th>% of plan</th><th>Win rate %</th><th>Pipeline required (plan total)</th><th>Generated by</th><th></th></tr></thead><tbody>`;
    const salesRes = computed.teams.find(x => x.id === sales.id);
    sales.channels.forEach((ch, ci) => {
      const servers = model.teams.filter(t => t.servesChannel === ch.id && t.enabled !== false).map(t => t.name).join(', ');
      const chRes = salesRes && salesRes.extras.channels.find(c => c.id === ch.id);
      const pipeTotal = chRes ? chRes.pipelineReq.reduce((a, b) => a + b, 0) : 0;
      html += `<tr>
        <td><input type="text" data-path="teams.${sIdx}.channels.${ci}.name" data-kind="text" value="${esc(ch.name)}"></td>
        <td><input type="number" data-path="teams.${sIdx}.channels.${ci}.mixPct" data-kind="pct" value="${Math.round(ch.mixPct * 1000) / 10}"> ${ledgerChipHTML(ledgerKey(sales.id, 'ch_' + ch.id + '_mix'), `Channel mix · ${ch.name}`)}</td>
        <td><input type="number" data-path="teams.${sIdx}.channels.${ci}.winRate" data-kind="pct" value="${Math.round(ch.winRate * 1000) / 10}"> ${ledgerChipHTML(ledgerKey(sales.id, 'ch_' + ch.id + '_win'), `Win rate · ${ch.name}`)}</td>
        <td class="dim">${fmtShort(pipeTotal)}</td>
        <td>${(() => {
          const eligible = model.teams.filter(t => ['demand-funnel', 'pipeline-channel', 'prospecting', 'custom'].includes(t.type));
          const serving = eligible.filter(t => t.servesChannel === ch.id);
          return `<select data-chteam="${ci}" style="width:auto;min-width:160px">
            <option value="">— no team —</option>
            ${eligible.map(t => `<option value="${esc(t.id)}" ${serving[0] && serving[0].id === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}
          </select>${serving.length > 1 ? ` <span class="mono-label">+${serving.length - 1} MORE</span>` : ''}`;
        })()}</td>
        <td><button class="btn btn-ghost" data-chdel="${ci}">✕</button></td></tr>`;
    });
    html += `</tbody></table></div><button class="btn btn-ghost" id="btnAddChannel">+ Add channel</button>`;
    card.innerHTML = html;
    bindFields(card);
    card.querySelectorAll('[data-chdel]').forEach(b => b.onclick = () => { sales.channels.splice(+b.dataset.chdel, 1); recompute(); render(); });
    card.querySelectorAll('[data-chteam]').forEach(slt => slt.onchange = () => {
      const ch = sales.channels[+slt.dataset.chteam];
      if (slt.value === '') {
        model.teams.forEach(t => { if (t.servesChannel === ch.id) t.servesChannel = ''; });
      } else {
        const t = model.teams.find(x => x.id === slt.value);
        if (t) t.servesChannel = ch.id;
      }
      recompute(); render();
      toast('Channel assignment updated');
    });
    const balCh = $('#btnBalanceChannels');
    if (balCh) balCh.onclick = () => {
      const keys = sales.channels.map((_, i) => i);
      const shares = {}; keys.forEach(i => shares[i] = sales.channels[i].mixPct);
      normalizeShares(shares, keys);
      keys.forEach(i => sales.channels[i].mixPct = shares[i]);
      recompute(); render(); toast('Channel mix balanced to 100%');
    };
    const colCh = $('#btnChCollapse');
    if (colCh) colCh.onclick = () => { channelOpen = false; renderDrivers(); };
    $('#btnAddChannel').onclick = () => { sales.channels.push({ id: 'ch-' + Math.random().toString(36).slice(2, 6), name: 'New Channel', mixPct: 0, winRate: 0.15 }); recompute(); render(); };
  }

  function renderConfigCard() {
    const c = $('#configCard');
    const yrs = Math.ceil(model.config.horizon / 12);
    model.config.arrGoals = model.config.arrGoals || [];
    while (model.config.arrGoals.length < yrs) model.config.arrGoals.push(0);
    const targetsHTML = Array.from({ length: yrs }, (_, y) => fld({
      path: `config.annualTargets.${y}`, label: `Year ${y + 1} new-business target $`, type: 'num',
      ledger: { teamId: 'config', key: 'target_y' + (y + 1), label: `Year ${y + 1} new-business target` }
    })).join('');
    const goalsHTML = Array.from({ length: yrs }, (_, y) => fld({
      path: `config.arrGoals.${y}`, label: `Year ${y + 1} ending-ARR goal $`, type: 'num',
      ledger: { teamId: 'config', key: 'arrgoal_y' + (y + 1), label: `Year ${y + 1} ending-ARR goal` }
    })).join('');
    // ----- revenue bridge: where the ending number actually comes from, per year -----
    let goalNotice = '';
    const br = bridgeYears();
    if (!model.config.arrGoals.slice(0, yrs).some(g => g > 0)) {
      // auto-seed: the bridge needs a destination, but a seeded goal is a placeholder until someone owns it
      br.forEach(b => { model.config.arrGoals[b.y] = Math.round(b.end / 100000) * 100000; });
      model.config.goalsSeeded = true;
      saveModel();
    }
    const goals = model.config.arrGoals.slice(0, yrs);
    const anyGoal = goals.some(g => g > 0);
    const bridgeRows = br.map(b => {
      const delta = b.goal > 0 ? b.end - b.goal : null;
      return `<tr>
        <td class="lbl">Year ${b.y + 1}</td>
        <td>${fmtShort(b.start)}</td>
        <td>+${fmtShort(b.nb)}</td>
        <td>+${fmtShort(b.exp)}</td>
        <td>+${fmtShort(b.esc)}</td>
        <td style="color:var(--accent)">−${fmtShort(b.churn)}</td>
        <td><b>${fmtShort(b.end)}</b></td>
        <td title="What the org AS STAFFED can actually produce — bookings capped by sales capacity">${b.feas < b.end * 0.995 ? `<span class="cellflag-bad">${fmtShort(b.feas)}</span>` : `<span class="dim">${fmtShort(b.feas)}</span>`}</td>
        <td>${b.goal > 0 ? fmtShort(b.goal) : '<span class="dim">— set goal —</span>'}</td>
        <td>${delta == null ? '' : (Math.abs(delta) < b.goal * 0.005 ? '<span class="cellflag-ok">ON GOAL</span>' : `<span class="${delta < 0 ? 'cellflag-bad' : 'cellflag-ok'}">${delta > 0 ? '+' : ''}${fmtShort(delta)}</span>`)}</td>
      </tr>`;
    }).join('');
    let bridgeActions = '';
    const seedBadge = model.config.goalsSeeded ? `<div class="row mt-2"><span class="badge warn">SEEDED — NOT YET A COMMITMENT</span>
      <span class="muted small">These goals just mirror the current trajectory (Δ ≈ 0 by construction). Type the real ambition into the goal fields — the bridge only earns its keep once goal ≠ plan.</span></div>` : '';
    if (anyGoal) {
      try {
        const sol = Engine.solveTargets(model, goals);
        const shortYears = br.filter(b => b.goal > 0 && b.end < b.goal * 0.995);
        const solverRows = goals.map((g, y) => {
          if (!g) return null;
          const cur = model.config.annualTargets[y] || 0;
          const imp = sol.targets[y];
          return `Year ${y + 1}: implied new business <b>${fmt$(imp)}</b> vs Sales' ${fmt$(cur)} <span style="color:var(--accent)">(${imp - cur >= 0 ? '+' : ''}${fmtShort(imp - cur)})</span>`;
        }).filter(Boolean).join('<br>');
        const feasGap = br.filter(b => b.feas < b.end * 0.995);
        bridgeActions = `${feasGap.length ? `<p class="small mt-2" style="color:var(--accent)">⚠ The org as staffed can't produce the plan: ${feasGap.map(b => `Year ${b.y + 1} feasible ${fmtShort(b.feas)} vs ${fmtShort(b.end)} planned`).join(' · ')}. Targets without hires are wishes.</p>` : ''}
        <div class="row mt-2" style="align-items:flex-start">
          <div class="small" style="flex:1">${solverRows}</div>
          <button class="btn btn-secondary" id="btnApplyImplied">Use implied targets</button>
          <button class="btn btn-secondary" id="btnStaffGoal" title="Implied targets + a drafted hiring plan: ramp-aware starts across Sales and the pipeline teams">⚙ Draft the org for this goal</button>
        </div>
        ${shortYears.length ? `<p class="small" style="margin:.5rem 0 0">Or the base picks it up: ${shortYears.map(b => `Year ${b.y + 1} needs <b>${fmtShort(b.goal - b.end)}</b> more from expansion/retention (AM expansion now ${fmtShort(b.exp)}, capacity-limited — add AM hires or raise quota; or lift GRR/escalator)`).join(' · ')}.</p>` : ''}`;
      } catch (e) { bridgeActions = `<p class="muted small">Goal solver unavailable: ${esc(e.message)}</p>`; }
    }
    goalNotice = `<div class="field-notice mt-2"><div class="fn-head">// REVENUE BRIDGE — WHO BRINGS WHAT (the argument happens here)</div>
      <div class="tbl-wrap mt-2"><table><thead><tr><th></th><th>Start</th><th>New business</th><th>Expansion (AM)</th><th>Escalator</th><th>Churn</th><th>Ending (plan)</th><th>Feasible (staffed)</th><th>Goal</th><th>Δ</th></tr></thead>
      <tbody>${bridgeRows}</tbody></table></div>
      <div id="bridgeWaterfall" class="mt-2"></div>${seedBadge}${bridgeActions}
      <p class="muted small" style="margin:.5rem 0 0">Starting base ${fmtShort(model.config.startingARR || 0)} · GRR ${csGrrLabel()} · escalator ${((model.config.renewalEscalator || 0) * 100).toFixed(1)}%/yr on the retained base · ${(model.config.expTargetPct || 0) > 0 ? `expansion target ${Math.round(model.config.expTargetPct * 100)}%/yr of book` : 'expansion is AM capacity, not a wish — commit a target % of book above to make it one'}. <button class="btn btn-ghost" id="btnReseedGoals" style="padding:.1rem .4rem">↺ Re-seed from trajectory</button> <button class="btn btn-ghost" id="btnBridgeMath" style="padding:.1rem .4rem">ⓘ The math</button></p></div>`;
    c.innerHTML = `
      <div class="row">
        <span class="section-marker" style="margin:0">MODEL DRIVERS</span>
        <span class="muted small">Company-level dials, grouped by what they govern. Team operating assumptions live with each team in the Builder.</span>
        <span style="flex:1"></span>
        <button class="btn btn-ghost" id="btnToggleLevers">${configOpen ? 'Hide' : 'Show'} scenario levers</button>
      </div>
      <div class="mono-label mt-2 mb-2">TIMELINE</div>
      <div class="assumption-grid">
        ${fld({ path: 'config.startMonth', label: 'Start month', type: 'month' })}
        <label class="field"><span class="lbl mono-label"><span class="lbl-txt">Planning horizon</span></span>
          <select id="horizonSel">
            ${[12, 18, 24, 30, 36].map(h => `<option value="${h}" ${model.config.horizon === h ? 'selected' : ''}>${h} months${h % 12 === 0 ? ` (${h / 12} year${h > 12 ? 's' : ''})` : ''}</option>`).join('')}
            ${[12, 18, 24, 30, 36].includes(model.config.horizon) ? '' : `<option value="${model.config.horizon}" selected>${model.config.horizon} months (custom)</option>`}
          </select></label>
      </div>
      <div class="mono-label mt-3 mb-2">GOALS — WHERE THE COMPANY MUST LAND</div>
      <div class="assumption-grid">
        ${goalsHTML}
      </div>
      <div class="mono-label mt-3 mb-2">EXISTING REVENUE — THE BASE YOU ALREADY HAVE</div>
      <div class="assumption-grid">
        ${fld({ path: 'config.startingARR', label: 'Starting ARR base $', type: 'num', ledger: { teamId: 'config', key: 'startingARR', label: 'Starting ARR base' } })}
        ${fld({ path: 'config.renewalEscalator', label: 'Renewal escalator (COL / price uplift)', type: 'pct', ledger: { teamId: 'config', key: 'escalator', label: 'Renewal escalator / built-in growth' } })}
        ${fld({ path: 'config.grossRetention', label: 'Gross retention (annual)', type: 'pct', ledger: { teamId: 'config', key: 'grr', label: 'Gross revenue retention' } })}
      </div>
      <div class="mono-label mt-3 mb-2">NEW BUSINESS</div>
      <div class="assumption-grid" id="nbGrid">
        ${targetsHTML}
        ${fld({ path: 'config.salesCycleLag', label: 'Sales-cycle lag (mo, pipeline → booking)', type: 'int', ledger: { teamId: 'config', key: 'lag', label: 'Sales-cycle lag' } })}
        <label class="field"><span class="lbl mono-label"><span class="lbl-txt">Bookings seasonality ${ledgerChipHTML(ledgerKey('config', 'seasonality'), 'Bookings seasonality')}</span></span>
          <select id="seasMode">
            <option value="even" ${(model.config.seasonality || {}).mode !== 'backloaded' && (model.config.seasonality || {}).mode !== 'custom' ? 'selected' : ''}>Even (÷12)</option>
            <option value="backloaded" ${(model.config.seasonality || {}).mode === 'backloaded' ? 'selected' : ''}>Back-loaded (20/24/26/30)</option>
            <option value="custom" ${(model.config.seasonality || {}).mode === 'custom' ? 'selected' : ''}>Custom quarterly %</option>
          </select></label>
        ${(model.config.seasonality || {}).mode === 'custom' ? [0, 1, 2, 3].map(q => fld({ path: `config.seasonality.q.${q}`, label: `Q${q + 1} share`, type: 'pct' })).join('') : ''}
      </div>
      <div class="mono-label mt-3 mb-2">EXPANSION — THE BASE GROWING ITSELF</div>
      <div class="assumption-grid">
        ${fld({ path: 'config.expTargetPct', label: 'Expansion TARGET, % of book / yr', type: 'pct', ledger: { teamId: 'config', key: 'expTarget', label: 'Expansion target (% of book)' } })}
        <label class="field"><span class="lbl mono-label"><span class="lbl-txt">How it behaves</span></span>
          <div style="padding:.55rem 0" class="muted small">${(model.config.expTargetPct || 0) > 0 ? 'Target mode — AM commits this number; their coverage flags what the bench can\'t deliver.' : '0% = capacity-driven: expansion is whatever the AM bench produces, capped by their ceiling.'}</div></label>
      </div>
      <div class="mono-label mt-3 mb-2">HIRING ECONOMICS</div>
      <div class="assumption-grid">
        ${fld({ path: 'config.timeToFillDays', label: 'Time-to-fill (days, for req dates)', type: 'int', ledger: { teamId: 'config', key: 'ttf', label: 'Time-to-fill assumption' } })}
        ${fld({ path: 'config.recruitingPct', label: 'Agency fee, % of loaded comp (when used)', type: 'pct', ledger: { teamId: 'config', key: 'recruiting', label: 'Agency fee per agency hire' } })}
        ${fld({ path: 'config.agencyHirePct', label: 'Share of hires via agency', type: 'pct', ledger: { teamId: 'config', key: 'agencyshare', label: 'Share of hires via agency' } })}
        ${fld({ path: 'config.onboardingPerHire', label: 'Onboarding & equipment $ / hire', type: 'num', ledger: { teamId: 'config', key: 'onboarding', label: 'Onboarding cost per hire' } })}
        ${fld({ path: 'config.maxStartsPerMonth', label: 'Max starts / team / month (build guardrail)', type: 'int', min: 1, ledger: { teamId: 'config', key: 'maxstarts', label: 'Max starts per team per month' } })}
      </div>
      <p class="muted small" style="margin:.5rem 0 0">Per-hire one-time cost = agency fee × agency share (an <b>expected value</b> across all hires — referrals and direct sourcing dilute the fee) + onboarding. E.g. 20% fee × 40% via agency = 8% of loaded comp per hire on average.</p>
      ${goalNotice}
      <div id="leversWrap" class="${configOpen ? '' : 'hidden'}">
        <div class="mono-label mb-2 mt-3">SCENARIO LEVERS (multipliers applied across the model)</div>
        <div class="tbl-wrap"><table><thead><tr><th>Scenario</th><th>Conversion ×</th><th>Ramp ×</th><th>Productivity ×</th><th>Cost ×</th></tr></thead>
        <tbody>${Object.entries(model.config.scenarios).map(([name, s]) => `<tr>
          <td class="lbl">${esc(name)}${name === model.config.scenario ? ' <span class="badge bad">ACTIVE</span>' : ''}</td>
          ${['conv', 'ramp', 'prod', 'cost'].map(k => `<td><input type="number" step="0.05" data-path="config.scenarios.${esc(name)}.${k}" value="${s[k]}"></td>`).join('')}
        </tr>`).join('')}</tbody></table></div>
      </div>`;
    bindFields(c);
    const seasSel = $('#seasMode');
    if (seasSel) seasSel.onchange = () => {
      model.config.seasonality = model.config.seasonality || { q: [0.25, 0.25, 0.25, 0.25] };
      model.config.seasonality.mode = seasSel.value;
      if (!Array.isArray(model.config.seasonality.q)) model.config.seasonality.q = [0.25, 0.25, 0.25, 0.25];
      recompute(); render();
    };
    if ((model.config.seasonality || {}).mode === 'custom') {
      const qsum = (model.config.seasonality.q || []).reduce((a, b) => a + b, 0);
      if (Math.abs(qsum - 1) > 0.001) {
        const note = document.createElement('p');
        note.className = 'small'; note.style.color = 'var(--accent)';
        note.textContent = `Quarterly shares sum to ${(qsum * 100).toFixed(0)}% — they must sum to 100% or targets will be over/under-stated.`;
        c.querySelector('#nbGrid').after(note);
      }
    }
    c.querySelectorAll('input[data-path^="config.arrGoals"]').forEach(inp =>
      inp.addEventListener('change', () => { model.config.goalsSeeded = false; saveModel(); }));
    const wfEl = $('#bridgeWaterfall');
    if (wfEl) {
      const ys = bridgeYears();
      if (ys.length) {
        const sum = k => ys.reduce((a, b) => a + (b[k] || 0), 0);
        const last = ys[ys.length - 1];
        Charts.waterfall(wfEl, [
          { name: 'Start', value: ys[0].start, kind: 'start' },
          { name: 'Churn', value: sum('churn'), kind: 'down' },
          { name: 'Escalator', value: sum('esc'), kind: 'up' },
          { name: 'New biz', value: sum('nb'), kind: 'up' },
          { name: 'Expansion', value: sum('exp'), kind: 'up' },
          { name: 'Ending', value: last.end, kind: 'end' }
        ], { title: `ARR BRIDGE — FULL ${computed.H}-MONTH HORIZON`, goal: last.goal || 0 });
      }
    }
    const bm = $('#btnBridgeMath');
    if (bm) bm.onclick = () => {
      const b = bridgeYears()[0] || {};
      const grrPct = Math.round((model.config.grossRetention != null ? model.config.grossRetention : 0.9) * 100);
      ask({
        title: 'Revenue bridge — the math (Year 1)',
        message: `Start ${fmt$(b.start || 0)} → churn −${fmt$(b.churn || 0)} (${grrPct}% gross retention on the renewing base) → escalator +${fmt$(b.esc || 0)} (${((model.config.renewalEscalator || 0) * 100).toFixed(1)}%/yr on what's retained) → new business +${fmt$(b.nb || 0)} (the bookings targets) → expansion +${fmt$(b.exp || 0)} = ending ${fmt$(b.end || 0)}. "Feasible (staffed)" ${fmt$(b.feas || 0)} re-runs the same bridge but caps bookings at what the hired sales bench can actually produce and expansion at AM capacity — the gap between the two columns is the staffing argument. Churn convention: ${grrPct}% gross retention is applied as a monthly rate compounding on the FULL prior-month base, including in-year bookings — deliberately conservative versus annual-contract reality, where new logos can't churn before first renewal.`,
        okText: 'Got it'
      });
    };
    const seedG = $('#btnReseedGoals');
    if (seedG) seedG.onclick = () => {
      bridgeYears().forEach(b => { model.config.arrGoals[b.y] = Math.round(b.end / 100000) * 100000; });
      model.config.goalsSeeded = true;
      recompute(); render(); toast('Goals re-seeded from current trajectory');
    };
    const applyImp = $('#btnApplyImplied');
    if (applyImp) applyImp.onclick = () => {
      const sol = Engine.solveTargets(model, model.config.arrGoals.slice(0, yrs));
      model.config.arrGoals.forEach((g, y) => { if (g > 0) model.config.annualTargets[y] = sol.targets[y]; });
      recompute(); render(); toast('Targets set from ARR goals');
    };
    const staffBtn = $('#btnStaffGoal');
    if (staffBtn) staffBtn.onclick = staffToGoal;
    $('#btnToggleLevers').onclick = () => { configOpen = !configOpen; renderConfigCard(); };
    const hSel = $('#horizonSel');
    if (hSel) hSel.onchange = () => {
      model.config.horizon = Math.max(12, Math.min(36, parseInt(hSel.value) || 24));
      const y2 = Math.ceil(model.config.horizon / 12);
      while (model.config.annualTargets.length < y2) model.config.annualTargets.push(model.config.annualTargets.at(-1) || 0);
      while ((model.config.arrGoals = model.config.arrGoals || []).length < y2) model.config.arrGoals.push(0);
      recompute(); render();
    };
  }

  function renderTeamRail() {
    const rail = $('#teamRail');
    let html = `<div class="rail-head mono-label">TEAMS — PICK ONE TO WORK ON</div>`;
    model.teams.forEach(team => {
      const r = computed.teams.find(x => x.id === team.id);
      const shorts = r ? r.coverageFlag.filter(f => f === 'SHORT').length : 0;
      const cost = r ? r.cost.reduce((a, b) => a + b, 0) : 0;
      const hc = r ? r.headcount[computed.H - 1] : 0;
      const flag = shorts ? `<span class="badge bad">${shorts} SHORT</span>` : (r ? '<span class="badge ok">COVERED</span>' : '');
      html += `<button class="rail-item ${team.id === selectedTeamId ? 'active' : ''}" data-sel="${esc(team.id)}">
        <span class="rail-top"><span class="rail-name">${esc(team.name)}</span></span>
        <span class="rail-meta"><span>${TYPE_LABELS[team.type] || team.type}</span></span>
        <span class="rail-meta"><span>${fmtShort(cost)} · ${hc} HC</span>${flag}</span>
      </button>`;
    });
    html += `<div class="rail-add"><button class="btn btn-secondary" id="btnAddTeam">+ Add team</button></div>`;
    rail.innerHTML = html;
    rail.querySelectorAll('[data-sel]').forEach(b => b.onclick = () => { selectedTeamId = b.dataset.sel; render(); });
    $('#btnAddTeam').onclick = openAddTeamModal;
  }

  const ARCHETYPES = [
    { type: 'demand-funnel', name: 'Demand funnel', eg: 'e.g. Marketing / Demand Gen' },
    { type: 'prospecting', name: 'Prospecting', eg: 'e.g. SDR / BDR' },
    { type: 'pipeline-channel', name: 'Pipeline channel', eg: 'e.g. Partnerships / Alliances' },
    { type: 'expansion', name: 'Expansion', eg: 'e.g. Account Management' },
    { type: 'retention', name: 'Retention', eg: 'e.g. Customer Success' },
    { type: 'custom', name: 'Custom cost team', eg: 'e.g. Sales Ops, Enablement, SE' }
  ];

  function openAddTeamModal() {
    $('#archetypeList').innerHTML = ARCHETYPES.map(a => `
      <button class="rail-item" style="border:1px solid var(--border);margin-bottom:.5rem" data-arch="${a.type}">
        <span class="rail-top"><span class="rail-name" style="font-size:var(--text-base)">${esc(a.name)}</span>
        <span class="mono-label">${esc(a.eg)}</span></span>
        <span class="rail-meta"><span style="text-transform:none;letter-spacing:0;font-family:var(--font-sans);font-size:12px">${esc(TYPE_EXPLAIN[a.type] || '')}</span></span>
      </button>`).join('');
    $('#addTeamModal').classList.add('open');
    $$('#archetypeList [data-arch]').forEach(b => b.onclick = async () => {
      const t = newTeam(b.dataset.arch);
      const nm = await uiPrompt('Name this team', 'As your org calls it', t.name);
      if (nm === null) return; // cancelled
      t.name = uniqueTeamName(nm || t.name, t.id);
      model.teams.push(t);
      selectedTeamId = t.id;
      $('#addTeamModal').classList.remove('open');
      recompute(); render(); toast(t.name + ' added — add its roles and hiring plan');
    });
    $('#btnCloseAddTeam').onclick = () => $('#addTeamModal').classList.remove('open');
  }

  function newRoleLine(teamType, rateRole, name, prodVal) {
    const H = model.config.horizon;
    const pk = Engine.PROD_KEY[teamType];
    const line = {
      id: 'r-' + Math.random().toString(36).slice(2, 7),
      name: name || rateRole || 'New Role', rateRole: rateRole || (model.rateCard.roles[0] || {}).name || '',
      start: 0, hires: new Array(H).fill(0), annualAttrition: 0.2
    };
    if (pk) line[pk] = prodVal != null ? prodVal : 0;
    const dr = Engine.DEFAULT_RAMP[teamType];
    if (dr) line.ramp = dr.slice();
    return line;
  }

  function newTeam(type) {
    const id = type + '-' + Math.random().toString(36).slice(2, 7);
    const base = { id, type, enabled: true, mgrSpan: 6, toolingSeatAnnual: 2500, toolingFixedMonthly: 0 };
    const salesChannels = (model.teams.find(t => t.type === 'sales') || {}).channels || [];
    const firstCh = salesChannels[0] ? salesChannels[0].id : '';
    switch (type) {
      case 'demand-funnel': return { ...base, name: 'New Demand Team', roleMgr: 'Marketing Manager', servesChannel: firstCh, costPerMQL: 1000, mqlToSql: 0.35, sqlToOpp: 0.5, mgrSpan: 5, platformFixedMonthly: 0, roles: [newRoleLine(type, 'Demand Gen Specialist', 'Demand Gen Specialist', 60)] };
      case 'prospecting': return { ...base, name: 'New Prospecting Team', roleMgr: 'SDR Manager', servesChannel: firstCh, sqlToOpp: 0.4, pctMarketingWorked: 0, roles: [newRoleLine(type, 'SDR', 'SDR', 10)] };
      case 'pipeline-channel': return { ...base, name: 'New Channel Team', roleMgr: 'Partnerships Lead', servesChannel: firstCh, mdfPct: 0.05, mgrSpan: 5, fixedProgramMonthly: 0, partnerTypes: [{ name: 'Referral', mix: 1, ticket: 350000, close: 0.3 }], roles: [newRoleLine(type, 'Partner Manager', 'Partner Manager', 8)] };
      case 'expansion': return { ...base, name: 'New Expansion Team', roleMgr: 'CS Manager', maxExpansionPct: 0.15, roles: [newRoleLine(type, 'Account Manager', 'Account Manager', 750000)] };
      case 'retention': return { ...base, name: 'New Retention Team', roleIC: 'Customer Success Manager', roleMgr: 'CS Manager', startingARR: 0, grossRetention: 0.9, arrPerCSM: 4000000, platformFixedMonthly: 0 };
      default: return { ...base, name: 'New Team', roleMgr: '', unitName: 'units', manualDemand: new Array(model.config.horizon).fill(0), roles: [newRoleLine(type, (model.rateCard.roles[0] || {}).name, 'New Role', 0)] };
    }
  }

  const TYPE_LABELS = {
    sales: 'SALES ENGINE — TARGET-DRIVEN', 'demand-funnel': 'DEMAND FUNNEL', prospecting: 'PROSPECTING',
    'pipeline-channel': 'PIPELINE CHANNEL', retention: 'RETENTION — AUTO-SIZED', expansion: 'EXPANSION', custom: 'CUSTOM COST TEAM'
  };

  function ledg(team, key, label) { return { teamId: team.id, key, label: `${team.name} · ${label}` }; }

  // archetype explainers — plain-language "how this team makes its number"
  const TYPE_EXPLAIN = {
    sales: 'Target-driven. The revenue target divides across channels; reps carry the close. Capacity = ramped reps × monthly productivity.',
    prospecting: 'Feeds the outbound channel and works a share of marketing-sourced opportunities. Capacity = ramped reps × opps/rep/month.',
    'demand-funnel': 'Owns its channel\'s pipeline requirement through the MQL → SQL → Opp funnel. Spend = MQLs needed × cost per MQL. No ramp — productive on hire.',
    'pipeline-channel': 'Owns its channel\'s pipeline through partner motions. Each partner type has its own mix, ticket and close rate.',
    retention: 'Auto-sized — CSM headcount follows the ARR base (Starting ARR is set in Model Drivers). Tune retention and book size.',
    expansion: 'Set an expansion TARGET as % of the current book (the bridge commitment) — coverage then flags months AM capacity can\'t deliver it. At 0% target, expansion is capacity-driven, capped by the ceiling. Optionally route a share of expansion pipeline through Marketing/SDR.',
    custom: 'Generic hire-planned team. Give it roles and a hiring plan; optionally set units-per-rep capacity and a monthly demand row to get coverage checks.'
  };

  function renderTeamDetail() {
    const detail = $('#teamDetail');
    const team = model.teams.find(t => t.id === selectedTeamId);
    if (!team) { detail.innerHTML = '<p class="muted">Add a team to get started.</p>'; return; }
    const idx = model.teams.indexOf(team);
    const r = computed.teams.find(x => x.id === team.id);
    detail.className = 'team-detail' + (team.type === 'sales' ? ' featured' : '');

    let html = `
      <div class="detail-head">
        <input class="team-name" type="text" data-path="teams.${idx}.name" data-kind="text" value="${esc(team.name)}" title="Click to rename">
        <span class="mono-label">${TYPE_LABELS[team.type] || team.type}</span>
        <span style="flex:1"></span>
        ${team.type !== 'sales' ? '<button class="btn btn-danger" data-act="remove">Remove team</button>' : ''}
      </div>
      <p class="muted small" style="max-width:46rem;margin:.25rem 0 0">${TYPE_EXPLAIN[team.type] || ''}</p>
      <div class="detail-roles">
        ${team.type === 'retention' ? roleSelectHTML(`teams.${idx}.roleIC`, 'CSM role (drives comp)', team.roleIC, team, 'ic') : ''}
        ${team.roleMgr !== undefined ? roleSelectHTML(`teams.${idx}.roleMgr`, 'Manager role', team.roleMgr, team, 'manager') : ''}
        ${team.servesChannel !== undefined ? channelSelectHTML(idx, team.servesChannel) : ''}
      </div>`;

    html += `<div class="detail-section"><div class="section-marker">A / TEAM SETTINGS</div>${assumptionsHTML(team, idx)}</div>`;
    if (team.type === 'pipeline-channel') html += `<div class="detail-section"><div class="section-marker">B / PARTNER TYPES</div>${partnerTypesHTML(team, idx)}</div>`;

    if (team.type !== 'retention') {
      html += `<div class="detail-section"><div class="section-marker">${team.type === 'pipeline-channel' ? 'C' : 'B'} / ROLES &amp; HIRING PLAN</div>${rolesSectionHTML(team, idx, r)}</div>`;
    } else if (r) {
      html += `<div class="detail-section"><div class="section-marker">B / AUTO-SIZED HEADCOUNT — CSMs FOLLOW THE ARR BASE</div>${computedTableHTML(team, r)}</div>`;
    }

    html += `<div class="detail-section"><div class="section-marker accent">SANITY CHECK — THIS TEAM</div><div id="teamSanity">${sanityHTML(team, r)}</div></div>`;

    detail.innerHTML = html;
    bindFields(detail);
    bindRoleSelects(detail, team, idx);
    bindTeamExtras(detail, team, idx);
    drawTeamChart(team, r);
  }

  // dependent role picklists: only roles of the right KIND (ic/manager) for the right TEAM TYPE
  function rolePickOpts(team, mode, sel) {
    const kindOf = r => r.kind || 'ic';
    const fit = model.rateCard.roles.filter(r => kindOf(r) === mode && (!r.dept || r.dept === team.type)).map(r => r.name);
    const other = model.rateCard.roles.filter(r => kindOf(r) === mode && r.dept && r.dept !== team.type).map(r => r.name);
    if (sel && !fit.includes(sel) && !other.includes(sel)) fit.unshift(sel); // never hide the current assignment
    let html = `<optgroup label="${mode === 'manager' ? 'Manager roles for this team' : 'Roles for this team'}">${fit.map(n => `<option ${n === sel ? 'selected' : ''}>${esc(n)}</option>`).join('')}</optgroup>`;
    if (other.length) html += `<optgroup label="Other teams (reuse)">${other.map(n => `<option ${n === sel ? 'selected' : ''}>${esc(n)}</option>`).join('')}</optgroup>`;
    return html;
  }

  function roleSelectHTML(path, label, sel, team, mode) {
    const rate = computed.rates[sel];
    return `<label class="field"><span class="lbl mono-label"><span class="lbl-txt">${esc(label)}</span></span>
      <select data-roleselect="${esc(path)}" data-rolemode="${mode}" data-roleteam="${esc(team.id)}">${rolePickOpts(team, mode, sel)}<option value="__new__">+ Create new role…</option></select>
      ${rate != null ? `<span class="mono-label" style="display:block;margin-top:.3rem">${fmt$(rate)}/yr loaded</span>` : ''}</label>`;
  }

  function channelSelectHTML(idx, sel) {
    const sales = model.teams.find(t => t.type === 'sales');
    const opts = ((sales && sales.channels) || []).map(c => `<option value="${esc(c.id)}" ${c.id === sel ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
    return `<label class="field"><span class="lbl mono-label"><span class="lbl-txt">Serves revenue channel</span></span>
      <select data-path="teams.${idx}.servesChannel" data-kind="text">${opts}</select></label>`;
  }

  function bindRoleSelects(container, team, idx) {
    container.querySelectorAll('[data-roleselect]').forEach(sel => {
      sel.addEventListener('change', async () => {
        const path = sel.dataset.roleselect;
        const prevRole = getByPath(model, path);
        // auto-sync: a role line named after its rate role follows a re-assignment
        const lineSync = () => {
          const m = path.match(/^(teams\.\d+\.roles\.\d+)\.rateRole$/);
          if (!m) return;
          const line = getByPath(model, m[1]);
          if (line && (!line.name || line.name === prevRole)) line.name = line.rateRole;
        };
        if (sel.value === '__new__') {
          const name = (await uiPrompt('Create new role', 'Role name (e.g. Solutions Engineer)', '')) || '';
          if (!name) { render(); return; }
          if (model.rateCard.roles.some(r => r.name === name)) { toast('That role already exists'); render(); return; }
          const tm = model.teams.find(t => t.id === sel.dataset.roleteam);
          ensureRateRole(name, prevRole, { kind: sel.dataset.rolemode || 'ic', dept: tm ? tm.type : null });
          setByPath(model, path, name);
          lineSync();
          recompute(); render();
          toast(`"${name}" created from ${prevRole || 'scratch'} — tune comp in Rates & FX`);
        } else {
          setByPath(model, path, sel.value);
          lineSync();
          recompute(); render();
        }
      });
    });
  }

  function assumptionsHTML(team, idx) {
    const p = `teams.${idx}`;
    const F = (key, label, type, extra = {}) => fld({ path: `${p}.${key}`, label, type, ledger: ledg(team, key, label), ...extra });
    let a = '<p class="muted small">Team-wide settings. Per-role productivity, attrition and ramp live with each role below.</p><div class="assumption-grid">';
    switch (team.type) {
      case 'sales':
        a += F('asp', 'Average sales price $', 'num') + F('targetCoverage', 'Quota over-assignment policy ×', 'num', { step: 0.05 }) +
          F('mgrSpan', 'Reps per manager', 'int') +
          F('toolingSeatAnnual', 'Tooling / seat / yr $', 'num') + F('toolingFixedMonthly', 'Fixed tooling / mo $', 'num');
        break;
      case 'prospecting':
        a += F('sqlToOpp', 'SQL → Opportunity', 'pct') + F('pctMarketingWorked', 'Share of marketing opps worked', 'pct') +
          F('mgrSpan', 'Reps per manager', 'int') + F('toolingSeatAnnual', 'Tooling / seat / yr $', 'num');
        break;
      case 'demand-funnel':
        a += F('costPerMQL', 'Cost per MQL $', 'num') + F('mqlToSql', 'MQL → SQL', 'pct') + F('sqlToOpp', 'SQL → Opportunity', 'pct') +
          F('mgrSpan', 'Specialists per manager', 'int') + F('toolingSeatAnnual', 'Tooling / seat / yr $', 'num') +
          F('platformFixedMonthly', 'Platform fixed / mo $', 'num');
        break;
      case 'pipeline-channel':
        a += F('mdfPct', 'MDF, share of sourced rev', 'pct') + F('mgrSpan', 'Reps per lead', 'int') +
          F('toolingSeatAnnual', 'Tooling / seat / yr $', 'num') + F('fixedProgramMonthly', 'Fixed program / mo $', 'num');
        break;
      case 'retention':
        a += F('arrPerCSM', 'ARR book per CSM $', 'num') + F('mgrSpan', 'CSMs per manager', 'int') +
          F('toolingSeatAnnual', 'Tooling / seat / yr $', 'num') + F('platformFixedMonthly', 'Platform fixed / mo $', 'num');
        a += `</div><p class="small muted" style="margin:.5rem 0 0">Gross retention (${Math.round((model.config.grossRetention != null ? model.config.grossRetention : 0.9) * 100)}%/yr) is a Model Driver — this team services the base it implies.</p><div class="assumption-grid" style="display:none">`;
        break;
      case 'expansion': {
        const tgtPct = model.config.expTargetPct || 0;
        a += (tgtPct > 0 ? '' : F('maxExpansionPct', 'Max expansion ceiling, % of base', 'pct')) +
          F('mktSourcedPct', 'Expansion sourced by Marketing', 'pct') + F('expWinRate', 'Expansion win rate', 'pct') +
          F('mgrSpan', 'Reps per manager', 'int') + F('toolingSeatAnnual', 'Tooling / seat / yr $', 'num');
        a += `</div><p class="small" style="margin:.5rem 0 0;${tgtPct > 0 ? 'color:var(--accent)' : ''}">${tgtPct > 0
          ? `TARGET MODE — this team is committed to ${Math.round(tgtPct * 100)}% of book per year (a Model Driver). Coverage flags the months the bench can't deliver; the bridge's Feasible column tells the truth.`
          : 'Capacity-driven: expansion is whatever this bench produces, capped by the ceiling. Commit to a % of book in Model Drivers to turn it into a target.'}</p><div class="assumption-grid" style="display:none">`;
        break;
      }
      default:
        a += `<label class="field"><span class="lbl mono-label"><span class="lbl-txt">Unit name</span></span><input type="text" data-path="${p}.unitName" data-kind="text" value="${esc(team.unitName || 'units')}"></label>` +
          F('mgrSpan', 'Reps per manager', 'int') + F('toolingSeatAnnual', 'Tooling / seat / yr $', 'num');
    }
    return a + '</div>';
  }

  // -------- roles & hiring: one block per role line --------
  function rolesSectionHTML(team, idx, r) {
    const H = computed.H;
    const pk = Engine.PROD_KEY[team.type];
    const prodLabel = Engine.PROD_LABEL[team.type] || 'Productivity';
    let html = `<p class="muted small" style="max-width:46rem">Add the roles this team actually hires — e.g. Enterprise AE and Mid-Market AE as separate lines with their own quota, comp, attrition and hiring plan. Each role prices off the rate card.</p>`;
    (team.roles || []).forEach((line, li) => {
      const lp = `teams.${idx}.roles.${li}`;
      const lr = r && r.extras.lines ? r.extras.lines.find(x => x.id === line.id) : null;
      const totHires = (line.hires || []).slice(0, H).reduce((a, b) => a + b, 0);
      const totAttr = lr ? lr.attrition.reduce((a, b) => a + b, 0) : 0;
      while ((line.hires = line.hires || []).length < H) line.hires.push(0);
      html += `<div class="role-line">
        <div class="row">
          <input type="text" class="role-name" data-path="${lp}.name" data-kind="text" value="${esc(line.name)}" title="Role name as your org calls it">
          <span class="mono-label">${esc(prodLabel)}</span>
          <span style="flex:1"></span>
          <span class="mono-label">${lr ? `${lr.ending[H - 1]} ENDING HC` : ''}</span>
          <button class="btn btn-secondary" data-fullgrid="${li}" title="Everything about this role on one screen — assumptions, ramp, and the hiring grid laid out by year">⛶ Edit full screen</button>
          ${(team.roles.length > 1) ? `<button class="btn btn-danger" data-act="del-line" data-li="${li}">✕ Remove role</button>` : ''}
        </div>
        <div class="assumption-grid">
          ${roleSelectHTML(`${lp}.rateRole`, 'Comp from rate card', line.rateRole, team, 'ic')}
          ${pk ? fld({ path: `${lp}.${pk}`, label: prodLabel, type: 'num', ledger: { teamId: team.id, key: `line_${line.id}_prod`, label: `${team.name} · ${line.name} · ${prodLabel}` } }) : ''}
          ${fld({ path: `${lp}.start`, label: 'Starting heads (mo 0)', type: 'int' })}
          ${fld({ path: `${lp}.annualAttrition`, label: 'Annual attrition', type: 'pct', ledger: { teamId: team.id, key: `line_${line.id}_attr`, label: `${team.name} · ${line.name} · attrition` } })}
        </div>
        ${line.ramp ? `<div class="mono-label mt-2 mb-2">RAMP — % PRODUCTIVE BY MONTH IN SEAT</div>
        <div class="ramp-row">${line.ramp.map((v, i) => `<label class="field"><span class="lbl mono-label"><span class="lbl-txt">M${i + 1}</span></span><input class="mcell" type="number" min="0" max="100" data-path="${lp}.ramp.${i}" data-kind="pct" value="${Math.round(v * 100)}"></label>`).join('')}
        <span class="muted small">month 7+ = 100%</span></div>` : `<p class="muted small" style="margin:.5rem 0 0">No ramp — productive on hire.</p>`}
        <div class="mono-label mt-2 mb-2">HIRING PLAN — NEW STARTS ${ledgerChipHTML(ledgerKey(team.id, `line_${line.id}_hires`), `${team.name} · ${line.name} · hiring plan`)}
          <span class="muted" style="letter-spacing:0;text-transform:none"> · ${totHires} hires · <span style="color:var(--accent)">${totAttr} expected attrition (${Math.round((line.annualAttrition || 0) * 100)}%/yr)</span> · net ${totHires - totAttr}</span></div>
        <div class="tbl-wrap"><table><thead><tr><th>Row</th>${computed.labels.map(l => `<th>${esc(l)}</th>`).join('')}<th>Total</th></tr></thead><tbody>
          <tr><td class="lbl"><b>Hires →</b></td>${Array.from({ length: H }, (_, m) =>
            `<td><input class="mcell ${line.hires[m] > 0 ? 'has-val' : ''}" type="number" min="0" data-path="${lp}.hires.${m}" data-kind="int" value="${line.hires[m] || 0}"></td>`).join('')}<td><b>${totHires}</b></td></tr>
          ${lr ? `<tr><td class="lbl">Attrition (expected)</td>${lr.attrition.map(v => `<td class="dim">${v || '·'}</td>`).join('')}<td>${totAttr}</td></tr>
          <tr><td class="lbl">Ending heads</td>${lr.ending.map(v => `<td class="dim">${v}</td>`).join('')}<td>${lr.ending[H - 1]}</td></tr>
          <tr><td class="lbl">Ramped equiv.</td>${lr.ramped.map(v => `<td class="dim">${Math.round(v * 100) / 100}</td>`).join('')}<td></td></tr>` : ''}
        </tbody></table></div>
      </div>`;
    });
    html += `<button class="btn btn-secondary mt-2" data-act="add-line">+ Add a role to this team</button>`;
    if (team.type === 'custom') {
      team.manualDemand = team.manualDemand || [];
      while (team.manualDemand.length < H) team.manualDemand.push(0);
      const totD = team.manualDemand.slice(0, H).reduce((a, b) => a + b, 0);
      html += `<div class="mono-label mt-3 mb-2">DEMAND — ${esc((team.unitName || 'units').toUpperCase())} REQUIRED BY MONTH <span class="muted" style="letter-spacing:0;text-transform:none">· leave at 0 for a pure cost team (no coverage check)</span></div>
      <div class="tbl-wrap"><table><thead><tr><th>Row</th>${computed.labels.map(l => `<th>${esc(l)}</th>`).join('')}<th>Total</th></tr></thead><tbody>
        <tr><td class="lbl"><b>Demand →</b></td>${Array.from({ length: H }, (_, m) =>
          `<td><input class="mcell ${team.manualDemand[m] > 0 ? 'has-val' : ''}" type="number" min="0" data-path="teams.${idx}.manualDemand.${m}" data-kind="int" value="${team.manualDemand[m] || 0}"></td>`).join('')}<td><b>${totD}</b></td></tr>
      </tbody></table></div>`;
    }
    if (r) {
      html += `<div class="mono-label mt-3 mb-2">TEAM TOTALS — WHAT THE PLAN DOES</div><div class="tbl-wrap"><table><thead><tr><th>Row</th>${computed.labels.map(l => `<th>${esc(l)}</th>`).join('')}<th>Total</th></tr></thead><tbody>${computedRowsHTML(team, r)}</tbody></table></div>`;
    }
    return html;
  }

  function partnerTypesHTML(team, idx) {
    const p = `teams.${idx}`;
    const mixSum = (team.partnerTypes || []).reduce((s, c) => s + c.mix, 0);
    let a = `<p class="muted small">Each partner motion carries its own deal size and close rate. ${Math.abs(mixSum - 1) > 0.001 ? `<span class="badge bad">MIX SUMS TO ${(mixSum * 100).toFixed(0)}% — FIX</span> <button class="btn btn-ghost" data-act="bal-pt">⚖ Balance to 100%</button>` : '<span class="badge ok">MIX = 100%</span>'}</p>
    <div class="tbl-wrap mb-2 mt-2"><table><thead><tr><th>Type</th><th>Mix %</th><th>Avg ticket $</th><th>Close %</th><th></th></tr></thead><tbody>`;
    (team.partnerTypes || []).forEach((pt, pi) => {
      a += `<tr>
        <td><input type="text" data-path="${p}.partnerTypes.${pi}.name" data-kind="text" value="${esc(pt.name)}"></td>
        <td><input type="number" data-path="${p}.partnerTypes.${pi}.mix" data-kind="pct" value="${Math.round(pt.mix * 100)}"></td>
        <td><input type="number" data-path="${p}.partnerTypes.${pi}.ticket" value="${pt.ticket}"></td>
        <td><input type="number" data-path="${p}.partnerTypes.${pi}.close" data-kind="pct" value="${Math.round(pt.close * 100)}"></td>
        <td><button class="btn btn-ghost" data-act="del-pt" data-pi="${pi}">✕</button></td></tr>`;
    });
    return a + `</tbody></table></div><button class="btn btn-ghost" data-act="add-pt">+ Add partner type</button>`;
  }

  function computedRowsHTML(team, r) {
    const H = computed.H;
    const isMoney = ['sales', 'expansion'].includes(team.type);
    const rows = [];
    rows.push(['Hires (all roles)', r.hires.map(v => v || '·'), String(r.hires.reduce((a, b) => a + b, 0))]);
    rows.push(['Attrition', r.attrition.map(v => v || '·'), String(r.attrition.reduce((a, b) => a + b, 0))]);
    rows.push(['Ending ICs', r.ics.map(v => v), String(r.ics[H - 1])]);
    rows.push(['Managers', r.mgrs.map(v => v || '·'), String(r.mgrs[H - 1] || 0)]);
    rows.push(['Capacity' + (isMoney ? ' $' : ''), r.capacity.map(v => fmtShort(v)), fmtShort(r.capacity.reduce((a, b) => a + b, 0))]);
    rows.push(['Demand' + (isMoney ? ' $' : ''), r.demand.map(v => fmtShort(v)), fmtShort(r.demand.reduce((a, b) => a + b, 0))]);
    rows.push(['Coverage flag', r.coverageFlag.map(f => f === 'OK' ? '<span class="cellflag-ok">OK</span>' : '<span class="cellflag-bad">SHORT</span>'), '']);
    rows.push(['Team cost $', r.cost.map(v => fmtShort(v)), fmtShort(r.cost.reduce((a, b) => a + b, 0))]);
    if (r.extras && r.extras.expansion) rows.push(['Expansion revenue $', r.extras.expansion.map(v => fmtShort(v)), fmtShort(r.extras.expansion.reduce((a, b) => a + b, 0))]);
    if (r.extras && r.extras.sourcedRev) rows.push(['Sourced revenue $', r.extras.sourcedRev.map(v => fmtShort(v)), fmtShort(r.extras.sourcedRev.reduce((a, b) => a + b, 0))]);
    return rows.map(([lbl, cells, tot]) => `<tr><td class="lbl">${lbl}</td>${cells.map(c => `<td class="dim">${c}</td>`).join('')}<td>${tot}</td></tr>`).join('');
  }

  function computedTableHTML(team, r) {
    const H = computed.H;
    let html = `<div class="tbl-wrap"><table><thead><tr><th>Row</th>${computed.labels.map(l => `<th>${esc(l)}</th>`).join('')}<th>End</th></tr></thead><tbody>`;
    const rows = [
      ['Ending ARR $', r.extras.endingARR.map(fmtShort), fmtShort(r.extras.endingARR[H - 1])],
      ['New ARR (lag-adj) $', r.extras.newARRBooked.map(fmtShort), ''],
      ['Expansion inflow $', r.extras.expansionInflow.map(fmtShort), ''],
      ['Churn $', r.extras.churn.map(v => fmtShort(-v)), ''],
      ['CSMs', r.ics.map(v => v), String(r.ics[H - 1])],
      ['Managers', r.mgrs.map(v => v), ''],
      ['Team cost $', r.cost.map(fmtShort), fmtShort(r.cost.reduce((a, b) => a + b, 0))]
    ];
    html += rows.map(([lbl, cells, tot]) => `<tr><td class="lbl">${lbl}</td>${cells.map(c => `<td class="dim">${c}</td>`).join('')}<td>${tot}</td></tr>`).join('');
    return html + '</tbody></table></div>';
  }

  function sanityHTML(team, r) {
    if (!r) return '<p class="muted small">Enable the team to see checks.</p>';
    const H = computed.H;
    const cost = r.cost.reduce((a, b) => a + b, 0);
    const shorts = r.coverageFlag.filter(f => f === 'SHORT').length;
    const totHires = r.hires.reduce((a, b) => a + b, 0);
    const totAttr = r.attrition.reduce((a, b) => a + b, 0);
    const sfRows = computed.readiness.selfFunding.filter(x => x.teamId === team.id);
    const sf = sfRows.length ? sfRows.reduce((w, x) => x.payback > w.payback ? x : w) : null;
    const stats = [
      { v: fmtShort(cost), l: `${H}-mo team cost`, sub: fmt$(cost) },
      { v: `${r.ics[H - 1]} + ${r.mgrs[H - 1] || 0}`, l: 'Ending ICs + managers', sub: `${totHires} hires · ${totAttr} attrition` },
      { v: shorts || '0', l: 'Months under capacity', sub: shorts ? 'capacity below demand' : 'demand covered all months', accent: shorts > 0 },
      sf ? { v: sf.payback === Infinity ? '∞' : sf.payback.toFixed(1) + 'mo', l: sfRows.length > 1 ? 'Slowest role payback' : 'Role payback', sub: sfRows.length > 1 ? `${sf.role.split(' (')[0]} · ${sf.verdict}` : sf.verdict, accent: sf.verdict !== 'SELF-FUNDING' } : null
    ].filter(Boolean);
    const teamChecks = computed.checks.filter(c => c.team === team.name);
    return `<div class="grid cols-4 mt-2 mb-2">${stats.map(s => `
      <div class="card stat-block">
        <div class="stat-value ${s.accent ? 'accent' : ''}" style="font-size:var(--text-3xl)">${s.v}</div>
        <div class="stat-label mono-label">${esc(s.l)}</div>
        <div class="stat-sub">${esc(s.sub)}</div>
      </div>`).join('')}</div>
      <div class="chart-card mb-2" id="chTeam"></div>
      ${teamChecks.length ? teamChecks.map(checkHTML).join('') : '<div class="field-notice info"><div class="fn-head">// CLEAR</div><div class="fn-title">No flags on this team right now.</div></div>'}`;
  }

  function drawTeamChart(team, r) {
    const elc = $('#chTeam');
    if (!elc || !r) return;
    if (team.type === 'retention') {
      Charts.lines(elc, computed.labels, [{ name: 'Ending ARR base', data: r.extras.endingARR, accent: true }], { title: 'ARR BASE THIS TEAM SERVICES ($)' });
    } else if (team.type === 'expansion') {
      const tm = r.extras.targetMode;
      Charts.lines(elc, computed.labels, [
        { name: 'Expansion capacity', data: r.extras.expCapacity, accent: true },
        { name: tm ? 'Expansion target' : 'Max expansion (cap)', data: r.demand }
      ], { title: tm ? 'EXPANSION CAPACITY VS TARGET ($/MO) — GAPS = SHORT MONTHS' : 'EXPANSION CAPACITY VS CAP ($/MO)' });
    } else {
      const money = team.type === 'sales';
      Charts.lines(elc, computed.labels, [
        { name: 'Capacity', data: r.capacity, accent: true },
        { name: 'Demand', data: r.demand }
      ], { title: money ? 'CAPACITY VS TARGET ($/MO) — GAPS = SHORT MONTHS' : 'CAPACITY VS DEMAND (UNITS/MO) — GAPS = SHORT MONTHS' });
    }
  }

  // -------- fullscreen role editor: assumptions + ramp + hiring plan, no scroll fight --------
  function openGridModal(team, li) {
    const body = $('#gridModalBody');
    const line = team.roles[li];
    const H = computed.H;
    const isoAll = monthsISO();
    const qcls = m => { const mm = +(isoAll[m] || '0-1').split('-')[1]; return Math.floor((mm - 1) / 3) % 2 ? 'qband' : ''; };
    const pk = Engine.PROD_KEY[team.type];
    const range = (a, b) => Array.from({ length: b - a }, (_, i) => a + i);

    const refresh = () => {
      recompute();
      const r2 = computed.teams.find(x => x.id === team.id);
      const lr2 = r2 && r2.extras.lines ? r2.extras.lines.find(x => x.id === line.id) : null;
      if (!lr2) return;
      body.querySelectorAll('[data-attr]').forEach(td => td.textContent = lr2.attrition[+td.dataset.attr] || '·');
      body.querySelectorAll('[data-end]').forEach(td => td.textContent = lr2.ending[+td.dataset.end]);
      body.querySelectorAll('[data-ramp]').forEach(td => td.textContent = Math.round(lr2.ramped[+td.dataset.ramp] * 100) / 100);
      const th = line.hires.slice(0, H).reduce((a, b) => a + b, 0), ta = lr2.attrition.reduce((a, b) => a + b, 0);
      $('#gmStats').textContent = `${th} HIRES · ${ta} EXPECTED ATTRITION (${Math.round((line.annualAttrition || 0) * 100)}%/YR) · NET ${th - ta}`;
    };

    const build = () => {
      const r = computed.teams.find(x => x.id === team.id);
      const lr = r && r.extras.lines ? r.extras.lines.find(x => x.id === line.id) : null;
      const totHires = line.hires.slice(0, H).reduce((a, b) => a + b, 0);
      const totAttr = lr ? lr.attrition.reduce((a, b) => a + b, 0) : 0;
      let html = `<div class="row mb-2">
        <h3>${esc(team.name)} · ${esc(line.name)}</h3>
        <span class="mono-label" id="gmStats">${totHires} HIRES · ${totAttr} EXPECTED ATTRITION (${Math.round((line.annualAttrition || 0) * 100)}%/YR) · NET ${totHires - totAttr}</span>
        <span style="flex:1"></span>
        <button class="btn btn-stencil" id="gridClose" style="padding:.6rem 1.4rem;font-size:var(--text-base)">Done</button>
      </div>
      <p class="muted small">Everything about this role in one place — assumptions on top, hires below. Tab moves across; the rows update live so you can watch each hire land, ramp, and (statistically) leave.</p>
      <div class="assumption-grid" style="max-width:980px">
        <label class="field"><span class="lbl mono-label"><span class="lbl-txt">Comp from rate card</span></span>
          <select id="gmRole">${rolePickOpts(team, 'ic', line.rateRole)}</select>
          <span class="mono-label" style="display:block;margin-top:.3rem" id="gmLoaded">${fmt$(computed.rates[line.rateRole] || 0)}/yr loaded</span></label>
        ${pk ? `<label class="field"><span class="lbl mono-label"><span class="lbl-txt">${esc(Engine.PROD_LABEL[team.type] || 'Productivity')}</span></span>
          <input type="number" id="gmProd" value="${line[pk] != null ? line[pk] : ''}"></label>` : ''}
        <label class="field"><span class="lbl mono-label"><span class="lbl-txt">Starting heads (mo 0)</span></span>
          <input type="number" id="gmStart" min="0" value="${line.start || 0}"></label>
        <label class="field"><span class="lbl mono-label"><span class="lbl-txt">Annual attrition %</span></span>
          <input type="number" id="gmAttr" min="0" value="${Math.round((line.annualAttrition || 0) * 100)}"></label>
      </div>`;
      if (line.ramp) {
        html += `<div class="mono-label mt-2 mb-2">RAMP — % PRODUCTIVE BY MONTH IN SEAT</div>
        <div class="ramp-row">${line.ramp.map((v, i) => `<label class="field"><span class="lbl mono-label"><span class="lbl-txt">M${i + 1}</span></span><input class="mcell" type="number" data-rampin="${i}" min="0" max="100" value="${Math.round(v * 100)}"></label>`).join('')}
        <span class="muted small">month 7+ = 100%</span></div>`;
      }
      for (let y = 0; y * 12 < H; y++) {
        const m0 = y * 12, m1 = Math.min(H, m0 + 12);
        const ms = range(m0, m1);
        html += `<div class="mono-label mt-3 mb-2">YEAR ${y + 1}</div>
        <table class="grid-year"><thead><tr><th style="width:130px"></th>${ms.map(m => `<th class="${qcls(m)}">${esc(computed.labels[m])}</th>`).join('')}</tr></thead><tbody>
        <tr><td class="lbl"><b>Hires →</b></td>${ms.map(m => `<td class="${qcls(m)}"><input class="mcell mcell-lg ${line.hires[m] > 0 ? 'has-val' : ''}" data-m="${m}" type="number" min="0" value="${line.hires[m] || 0}"></td>`).join('')}</tr>
        <tr><td class="lbl">Attrition</td>${ms.map(m => `<td class="dim ${qcls(m)}" data-attr="${m}">${lr ? (lr.attrition[m] || '·') : ''}</td>`).join('')}</tr>
        <tr><td class="lbl">Ending heads</td>${ms.map(m => `<td class="dim ${qcls(m)}" data-end="${m}">${lr ? lr.ending[m] : ''}</td>`).join('')}</tr>
        <tr><td class="lbl">Ramped equiv.</td>${ms.map(m => `<td class="dim ${qcls(m)}" data-ramp="${m}">${lr ? Math.round(lr.ramped[m] * 100) / 100 : ''}</td>`).join('')}</tr>
        </tbody></table>`;
      }
      body.innerHTML = html;
      body.querySelectorAll('input[data-m]').forEach(inp => {
        inp.addEventListener('change', () => {
          const m = +inp.dataset.m;
          line.hires[m] = Math.max(0, Math.round(parseFloat(inp.value) || 0));
          inp.value = line.hires[m];
          inp.classList.toggle('has-val', line.hires[m] > 0);
          refresh();
        });
        // paste a row straight from Excel/Sheets: values fill months left-to-right from this cell
        inp.addEventListener('paste', e => {
          const txt = ((e.clipboardData || window.clipboardData) || {}).getData ? (e.clipboardData || window.clipboardData).getData('text') : '';
          const parts = (txt || '').trim().split(/[\t,;\s]+/).filter(x => x !== '');
          if (parts.length < 2) return; // single value: let the normal input handle it
          e.preventDefault();
          const start = +inp.dataset.m;
          let filled = 0;
          parts.forEach((p, i) => {
            const m = start + i;
            if (m >= H) return;
            line.hires[m] = Math.max(0, Math.round(parseNumShorthand(p)));
            filled++;
          });
          recompute();
          build();
          toast(`Pasted ${filled} month${filled === 1 ? '' : 's'} of hires`);
        });
      });
      body.querySelectorAll('input[data-rampin]').forEach(inp => {
        inp.addEventListener('change', () => {
          line.ramp[+inp.dataset.rampin] = Math.max(0, Math.min(100, parseFloat(inp.value) || 0)) / 100;
          refresh();
        });
      });
      const gmRole = $('#gmRole');
      gmRole.addEventListener('change', () => {
        const prev = line.rateRole;
        line.rateRole = gmRole.value;
        if (!line.name || line.name === prev) line.name = line.rateRole;
        refresh();
        $('#gmLoaded').textContent = fmt$(computed.rates[line.rateRole] || 0) + '/yr loaded';
      });
      const gmProd = $('#gmProd');
      if (gmProd) gmProd.addEventListener('change', () => { line[pk] = parseNumShorthand(gmProd.value); refresh(); });
      $('#gmStart').addEventListener('change', () => { line.start = Math.max(0, Math.round(parseFloat($('#gmStart').value) || 0)); refresh(); });
      $('#gmAttr').addEventListener('change', () => { line.annualAttrition = Math.max(0, parseFloat($('#gmAttr').value) || 0) / 100; refresh(); });
      $('#gridClose').onclick = () => { $('#gridModal').classList.remove('open'); render(); };
    };
    build();
    $('#gridModal').classList.add('open');
  }

  function bindTeamExtras(body, team, idx) {
    body.querySelectorAll('[data-fullgrid]').forEach(btn => btn.addEventListener('click', () => openGridModal(team, +btn.dataset.fullgrid)));
    body.querySelectorAll('[data-act]').forEach(btn => btn.addEventListener('click', async () => {
      const act = btn.dataset.act;
      if (act === 'remove') {
        if (!(await uiConfirm(`Remove ${team.name}?`, `Its cost and capacity drop out of the rollups; any channel it served becomes unowned (you'll get a flag).`, 'Remove team'))) return;
        model.teams = model.teams.filter(t => t.id !== team.id);
      } else if (act === 'add-line') {
        const first = (team.roles || [])[0];
        const pk = Engine.PROD_KEY[team.type];
        team.roles.push(newRoleLine(team.type, first ? first.rateRole : null, 'New Role', first && pk ? first[pk] : 0));
      } else if (act === 'del-line') {
        const line = team.roles[+btn.dataset.li];
        if (!(await uiConfirm(`Remove "${line.name}"?`, 'Its heads, cost and capacity drop out of the team.', 'Remove role'))) return;
        team.roles.splice(+btn.dataset.li, 1);
      } else if (act === 'bal-pt') {
        const keys = team.partnerTypes.map((_, i) => i);
        const shares = {}; keys.forEach(i => shares[i] = team.partnerTypes[i].mix);
        normalizeShares(shares, keys);
        keys.forEach(i => team.partnerTypes[i].mix = shares[i]);
      } else if (act === 'add-pt') {
        team.partnerTypes.push({ name: 'New type', mix: 0, ticket: 300000, close: 0.2 });
      } else if (act === 'del-pt') {
        team.partnerTypes.splice(+btn.dataset.pi, 1);
      }
      recompute(); render();
    }));
  }

  // ============================== RATES & FX ==============================
  let fxGuideOpen = false;
  let rateGuideOpen = true;

  const FX_GUIDE = [
    ['Spot (USD/local)', 'What 1 unit of the local currency costs in USD today. Pull from your treasury or a public source on the day you lock the plan. USD row stays 1.'],
    ['Trailing-12mo avg', 'The average rate over the last 12 months. Smooths one-off spikes so a temporarily weak currency doesn’t flatter the plan.'],
    ['Buffer %', 'A deliberate safety margin on the exchange rate itself. Foreign salaries are a future cost in a currency that can move against you — the buffer prices them slightly high on purpose (+3% developed markets, +4–5% emerging, 0% USD). If the currency strengthens mid-year you were already covered; if it weakens you bank a favourable variance. It protects the plan, it never blocks it.'],
    ['Employer burden %', 'Employer-side costs on top of base salary: payroll taxes, statutory benefits, insurance, equipment. Set once per country — it applies to every role hired there. Typical: US ~25%, Canada ~22%, UK ~20%, Poland ~21%, India ~18%. Applied to base only, not variable.'],
    ['Budget rate (computed)', 'MAX(spot, trailing) × (1 + buffer). Locked for the whole planning cycle — all non-USD comp converts at this rate, so daily FX moves never disturb the plan. If Treasury hedges, enter the hedged rate as both spot and trailing with 0% buffer.']
  ];
  const RATE_GUIDE = [
    ['Base salary (local)', 'Annual gross base in the country’s own currency (PLN in Poland, INR in India). Enter your actual band midpoint for the role — not the offer floor.'],
    ['OTE variable (local)', 'Annual on-target commission or bonus at 100% attainment, in local currency. Enter 0 for roles with no variable.'],
    ['Planned attainment', 'How much of variable comp you budget to actually pay out. Set once as a default (90% is standard planning prudence); per-band overrides are hidden behind the toggle for the rare role that needs one.'],
    ['Fully-loaded USD (computed)', 'Base × (1 + country burden, from the FX table) × budget rate + variable × attainment × budget rate. The true annual cost of one head in that country.'],
    ['Location mix %', 'Where this role’s headcount sits, as a % per country. Must sum to 100%. This is your location strategy lever — shifting mix to lower-cost geographies is often the biggest cost decision in the plan.'],
    ['Blended rate (computed)', 'The location-weighted fully-loaded USD/yr the plan charges for every head in this role (× the scenario Cost multiplier). This is the number that flows into team costs in the Plan Builder.']
  ];

  function guideHTML(rows, open, toggleId, title) {
    return `<div class="field-notice info" style="margin-top:1rem">
      <div class="row"><div class="fn-head" style="margin:0">// ${title}</div><span style="flex:1"></span>
      <button class="btn btn-ghost" id="${toggleId}">${open ? 'Hide' : 'What do these fields mean?'}</button></div>
      ${open ? `<table style="margin-top:.75rem"><tbody>${rows.map(([f, d]) => `<tr><td class="lbl" style="white-space:nowrap;vertical-align:top;width:200px"><b>${esc(f)}</b></td><td style="text-align:left;font-family:var(--font-sans);font-size:var(--text-sm);color:var(--muted-foreground);white-space:normal">${esc(d)}</td></tr>`).join('')}</tbody></table>` : ''}
    </div>`;
  }

  let researchOut = { fx: null, fxRunning: false, roles: {}, rolesRunning: {} };
  let ratesUI = { teams: {}, roles: {}, libOpen: false, showAttain: false }; // collapse state — everything starts collapsed
  let channelOpen = null; // null = auto (collapse once fully agreed)
  let agentPromptOpen = {};

  const TEAM_TEMPLATES = [
    { type: 'sales', name: 'Sales', desc: 'Closes the number. Target-driven — the engine of the model.', ics: ['Enterprise Account Executive', 'Mid-Market Account Executive', 'SMB Account Executive', 'Senior AE'], mgrs: ['Sales Manager', 'Sales Director'] },
    { type: 'prospecting', name: 'SDR / BDR', desc: 'Prospecting — sources outbound pipeline and works inbound.', ics: ['Inbound SDR', 'Outbound SDR'], mgrs: ['SDR Manager'] },
    { type: 'demand-funnel', name: 'Marketing', desc: 'Demand generation — owns the MQL → SQL → opportunity funnel.', ics: ['Demand Gen Specialist', 'Content Marketing Manager', 'Field Marketing Manager'], mgrs: ['Marketing Manager'] },
    { type: 'pipeline-channel', name: 'Partnerships', desc: 'Partner-sourced pipeline, by partner motion.', ics: ['Partner Manager', 'Channel Account Manager'], mgrs: ['Partnerships Lead'] },
    { type: 'retention', name: 'Customer Success', desc: 'Retention — renewals and churn. Headcount auto-sizes to the ARR base.', ics: ['Customer Success Manager', 'Senior CSM'], mgrs: ['CS Manager'] },
    { type: 'expansion', name: 'Account Management', desc: 'Expansion revenue on the installed base.', ics: ['Account Manager', 'Senior Account Manager'], mgrs: ['AM Manager'] }
  ];
  const SEED_ROLE = { sales: 'Account Executive', prospecting: 'SDR', 'demand-funnel': 'Demand Gen Specialist', 'pipeline-channel': 'Partner Manager', retention: 'Customer Success Manager', expansion: 'Account Manager' };
  const DEFAULT_PROD = { sales: 1800000, prospecting: 10, 'demand-funnel': 60, 'pipeline-channel': 8, expansion: 750000, custom: 0 };

  // proportionally rescale shares so they sum to 1 (equal split if all zero)
  function normalizeShares(obj, keys) {
    const total = keys.reduce((a, k) => a + (obj[k] || 0), 0);
    keys.forEach(k => { obj[k] = total > 0 ? (obj[k] || 0) / total : 1 / keys.length; });
    // round to 3dp and push remainder onto the largest share
    let acc = 0; let maxK = keys[0];
    keys.forEach(k => { obj[k] = Math.round(obj[k] * 1000) / 1000; acc += obj[k]; if (obj[k] > obj[maxK]) maxK = k; });
    obj[maxK] = Math.round((obj[maxK] + 1 - acc) * 1000) / 1000;
  }

  function uniqueTeamName(name, excludeId) {
    const base = (name || 'Team').trim() || 'Team';
    let n = base, i = 2;
    while (model.teams.some(t => t.name === n && t.id !== excludeId)) n = base + ' ' + (i++);
    if (n !== base) toast(`"${base}" is taken — saved as "${n}"`);
    return n;
  }

  function teamRoleNames(team) {
    const names = [];
    (team.roles || []).forEach(l => { if (l.rateRole && !names.includes(l.rateRole)) names.push(l.rateRole); });
    if (team.type === 'retention' && team.roleIC && !names.includes(team.roleIC)) names.push(team.roleIC);
    if (team.roleMgr && !names.includes(team.roleMgr)) names.push(team.roleMgr);
    return names;
  }

  function ensureRateRole(name, seedName, meta) {
    let role = model.rateCard.roles.find(r => r.name === name);
    if (role) return role;
    const seed = model.rateCard.roles.find(r => r.name === seedName) || null;
    if (seed) role = { name, bands: JSON.parse(JSON.stringify(seed.bands)), mix: { ...seed.mix } };
    else {
      const c0 = model.fx[0].country;
      role = { name, bands: { [c0]: { base: 0, ote: 0 } }, mix: { [c0]: 1 } };
    }
    role.kind = (meta && meta.kind) || (seed && seed.kind) || 'ic';
    role.dept = (meta && meta.dept !== undefined) ? meta.dept : (seed ? seed.dept : null);
    model.rateCard.roles.push(role);
    return role;
  }

  function addRoleLineToTeam(team, roleName) {
    if (team.type === 'retention') { team.roleIC = roleName; return; }
    team.roles = team.roles || [];
    const pk = Engine.PROD_KEY[team.type];
    const inherit = team.roles[0] && pk && team.roles[0][pk] != null ? team.roles[0][pk] : (DEFAULT_PROD[team.type] || 0);
    team.roles.push(newRoleLine(team.type, roleName, roleName, inherit));
  }

  // -------- team configurator popout --------
  function openTeamCfgModal(teamId) {
    const team = model.teams.find(t => t.id === teamId);
    if (!team) return;
    const body = $('#teamCfgBody');
    const build = () => {
      const tpl = TEAM_TEMPLATES.find(t => t.type === team.type);
      const existingLineRoles = (team.roles || []).map(l => l.rateRole);
      const recIcs = (tpl ? tpl.ics : []).filter(n => !existingLineRoles.includes(n));
      const recMgrs = (tpl ? tpl.mgrs : []).filter(n => n !== team.roleMgr);
      const pickIc = sel => rolePickOpts(team, 'ic', sel);
      const pickMgr = sel => rolePickOpts(team, 'manager', sel);
      body.innerHTML = `
        <h3>Configure ${esc(team.name)}</h3>
        <p class="muted small">${esc(TYPE_EXPLAIN[team.type] || '')}</p>
        <div class="grid cols-2 mb-2 mt-2">
          <label class="field"><span class="lbl mono-label">Team name</span><input type="text" id="tcName" value="${esc(team.name)}"></label>
          <label class="field"><span class="lbl mono-label">Manager role (managers only)</span><select id="tcMgr">${pickMgr(team.roleMgr)}<option value="__new__">+ Create new manager role…</option></select></label>
        </div>
        <div class="mono-label mb-2 mt-2">ROLES ON THIS TEAM</div>
        ${team.type === 'retention'
          ? `<label class="field mb-2"><span class="lbl mono-label">CSM role (headcount auto-sizes to the ARR base)</span><select id="tcCsm">${pickIc(team.roleIC)}</select></label>`
          : (team.roles || []).map((l, li) => `
          <div class="row mb-2" style="border:1px solid var(--border);padding:.6rem .9rem">
            <input type="text" data-tcline="${li}" value="${esc(l.name)}" style="width:220px" title="What your org calls this role line">
            <span class="mono-label">PAYS AS</span>
            <select data-tclinerole="${li}" style="width:240px">${pickIc(l.rateRole)}<option value="__new__">+ Create new role…</option></select>
            <span style="flex:1"></span>
            ${team.roles.length > 1 ? `<button class="btn btn-danger" data-tcdel="${li}">✕</button>` : ''}
          </div>`).join('')}
        ${team.type !== 'retention' ? `
          ${(recIcs.length || recMgrs.length) ? `<div class="mono-label mb-2 mt-2">RECOMMENDED FOR ${esc((tpl ? tpl.name : team.type).toUpperCase())}</div>
          <div class="row mb-2" style="flex-wrap:wrap">
            ${recIcs.map(n => `<button class="btn btn-ghost" data-tcrec="${esc(n)}" style="border:1px dashed var(--border-hover)">+ ${esc(n)}</button>`).join('')}
            ${recMgrs.map(n => `<button class="btn btn-ghost" data-tcrecmgr="${esc(n)}" style="border:1px dashed var(--accent)">+ ${esc(n)} · SET AS MANAGER</button>`).join('')}
          </div>` : ''}
          <div class="row mb-2">
            <select id="tcLibPick" style="width:240px">${pickIc('')}</select>
            <button class="btn btn-ghost" id="tcAddFromLib">+ Add from library</button>
            <button class="btn btn-ghost" id="tcNewRole">+ Create new role</button>
          </div>` : ''}
        <hr class="divider-thin">
        <div class="row">
          <span class="muted small">Pay bands are set on the Rates page (expand the team). Hiring plans live in the Plan Builder.</span>
          <span style="flex:1"></span>
          ${team.type !== 'sales'
            ? '<button class="btn btn-danger" id="tcRemove">Remove team</button>'
            : '<span class="muted small" title="The model is target-driven and needs one sales engine">Sales can\'t be removed</span>'}
          <button class="btn btn-secondary" id="tcDone">Done</button>
        </div>`;
      $('#tcName').onchange = () => { team.name = uniqueTeamName($('#tcName').value.trim() || team.name, team.id); build(); };
      $('#tcMgr').onchange = async () => {
        if ($('#tcMgr').value === '__new__') {
          const nm = (await uiPrompt('Create manager role', 'Role name', '')) || '';
          if (nm) { ensureRateRole(nm, team.roleMgr, { kind: 'manager', dept: team.type }); team.roleMgr = nm; }
        } else team.roleMgr = $('#tcMgr').value;
        build();
      };
      const csm = $('#tcCsm');
      if (csm) csm.onchange = () => { team.roleIC = csm.value; build(); };
      body.querySelectorAll('[data-tcline]').forEach(i => i.onchange = () => { const li = +i.dataset.tcline; team.roles[li].name = i.value.trim() || team.roles[li].name; });
      body.querySelectorAll('[data-tclinerole]').forEach(slt => slt.onchange = async () => {
        const li = +slt.dataset.tclinerole;
        const prevRole = team.roles[li].rateRole;
        if (slt.value === '__new__') {
          const nm = (await uiPrompt('Create new role', 'Role name', '')) || '';
          if (nm) { ensureRateRole(nm, prevRole || SEED_ROLE[team.type], { kind: 'ic', dept: team.type }); team.roles[li].rateRole = nm; }
        } else team.roles[li].rateRole = slt.value;
        // auto-sync the line label unless the org renamed it deliberately
        if (!team.roles[li].name || team.roles[li].name === prevRole) team.roles[li].name = team.roles[li].rateRole;
        build();
      });
      body.querySelectorAll('[data-tcdel]').forEach(b => b.onclick = async () => {
        if (!(await uiConfirm('Remove role line?', 'Its hiring plan goes with it.', 'Remove'))) return;
        team.roles.splice(+b.dataset.tcdel, 1); build();
      });
      body.querySelectorAll('[data-tcrec]').forEach(b => b.onclick = () => {
        const n = b.dataset.tcrec;
        ensureRateRole(n, SEED_ROLE[team.type] || (team.roles[0] || {}).rateRole, { kind: 'ic', dept: team.type });
        addRoleLineToTeam(team, n);
        build(); toast(`${n} added — set its pay bands after closing`);
      });
      body.querySelectorAll('[data-tcrecmgr]').forEach(b => b.onclick = () => {
        const n = b.dataset.tcrecmgr;
        ensureRateRole(n, team.roleMgr || SEED_ROLE[team.type], { kind: 'manager', dept: team.type });
        team.roleMgr = n;
        build(); toast(`${n} set as this team's manager role`);
      });
      const fromLib = $('#tcAddFromLib');
      if (fromLib) fromLib.onclick = () => { addRoleLineToTeam(team, $('#tcLibPick').value); build(); };
      const newR = $('#tcNewRole');
      if (newR) newR.onclick = async () => {
        const nm = (await uiPrompt('Create new role', 'Role name', '')) || '';
        if (!nm) return;
        ensureRateRole(nm, SEED_ROLE[team.type] || (team.roles[0] || {}).rateRole, { kind: 'ic', dept: team.type });
        addRoleLineToTeam(team, nm);
        build();
      };
      const tcRm = $('#tcRemove');
      if (tcRm) tcRm.onclick = async () => {
        if (!(await uiConfirm(`Remove ${team.name}?`, 'Its cost, headcount and capacity drop out of the rollups; any channel it served becomes unowned (you\'ll get a flag). Undo can bring it back.', 'Remove team'))) return;
        model.teams = model.teams.filter(t => t.id !== team.id);
        $('#teamCfgModal').classList.remove('open');
        recompute(); render(); toast(team.name + ' removed');
      };
      $('#tcDone').onclick = () => { $('#teamCfgModal').classList.remove('open'); recompute(); render(); };
    };
    build();
    $('#teamCfgModal').classList.add('open');
  }

  // -------- bulk templates: download a CSV prefilled with your data, edit in Excel, re-import --------
  function csvEsc(v) {
    const isNum = typeof v === 'number';
    v = v == null ? '' : String(v);
    // CSV formula-injection guard (CWE-1236): a cell starting with = + @ or tab/CR — or a
    // non-numeric cell starting with "-" — would execute as a formula when the CSV opens in
    // a spreadsheet. Shared run/model files make names attacker-controllable, so neutralize
    // with a leading apostrophe. Real numbers pass through untouched.
    if (!isNum && /^[=+@\t\r]/.test(v)) v = "'" + v;
    else if (!isNum && v[0] === '-' && !/^-(\d|\.)/.test(v)) v = "'" + v;
    return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }
  function parseCSVRows(text) {
    const rows = []; let row = [], cur = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
      else if (ch === '"') q = true;
      else if (ch === ',') { row.push(cur); cur = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); if (row.some(c => c !== '')) rows.push(row); row = []; cur = ''; }
      else cur += ch;
    }
    row.push(cur); if (row.some(c => c !== '')) rows.push(row);
    return rows;
  }
  function monthsISO() {
    const parts = (model.config.startMonth || '2026-01').split('-').map(Number);
    const H = model.config.horizon || 12;
    return Array.from({ length: H }, (_, i) => {
      const y = parts[0] + Math.floor((parts[1] - 1 + i) / 12), m = (parts[1] - 1 + i) % 12 + 1;
      return y + '-' + String(m).padStart(2, '0');
    });
  }
  function tplFxCSV() {
    const out = ['country,currency,usd_per_unit_spot,usd_per_unit_trailing12mo,buffer_pct,burden_pct'];
    model.fx.forEach(f => out.push([f.country, f.currency, f.spot, f.trailing, Math.round((f.buffer || 0) * 1000) / 10, Math.round((f.burden || 0) * 1000) / 10].map(csvEsc).join(',')));
    return out.join('\n');
  }
  function tplRolesCSV() {
    const out = ['role,kind,dept,country,currency,base_local,ote_variable_local,mix_pct'];
    model.rateCard.roles.forEach(r => Object.keys(r.bands || {}).forEach(c => {
      const fxr = model.fx.find(f => f.country === c);
      out.push([r.name, r.kind || 'ic', r.dept || '', c, fxr ? fxr.currency : '', (r.bands[c] || {}).base || 0, (r.bands[c] || {}).ote || 0, Math.round(((r.mix || {})[c] || 0) * 1000) / 10].map(csvEsc).join(','));
    }));
    if (out.length === 1) out.push(['Account Executive', 'ic', 'sales', (model.fx[0] || {}).country || 'United States', (model.fx[0] || {}).currency || 'USD', 120000, 120000, 100].map(csvEsc).join(','));
    return out.join('\n');
  }
  function tplTeamsCSV() {
    const iso = monthsISO();
    const out = [['team', 'archetype', 'role_line', 'pays_as', 'start_heads', 'annual_attrition_pct'].concat(iso).join(',')];
    model.teams.filter(t => t.enabled !== false).forEach(t => (t.roles || []).forEach(l =>
      out.push([t.name, t.type, l.name, l.rateRole, l.start || 0, Math.round((l.annualAttrition || 0) * 1000) / 10].concat(iso.map((_, i) => (l.hires || [])[i] || 0)).map(csvEsc).join(','))));
    if (out.length === 1) out.push(['Sales', 'sales', 'Mid-Market AE', (model.rateCard.roles[0] || {}).name || 'Account Executive', 3, 15].concat(iso.map(() => 0)).map(csvEsc).join(','));
    return out.join('\n');
  }
  function salesTeamShell(name) {
    const d = Engine.migrate(Engine.defaultModel()).teams.find(t => t.type === 'sales');
    d.id = 'sales-' + Math.random().toString(36).slice(2, 7);
    d.name = name; d.roles = [];
    if (Array.isArray(d.judgmentOverlay)) d.judgmentOverlay = d.judgmentOverlay.map(() => 0);
    return d;
  }
  function importTemplateCSV(text) {
    const rep = { kind: '', created: [], updated: [], errors: [], notes: [] };
    const rows = parseCSVRows(text);
    if (rows.length < 2) { rep.errors.push('No data rows found'); return rep; }
    const header = rows[0].map(h => String(h).trim().toLowerCase());
    const col = {}; header.forEach((h, i) => { if (!(h in col)) col[h] = i; });
    const get = (r, name) => { const i = col[name]; return i == null ? '' : String(r[i] == null ? '' : r[i]).trim(); };

    if (header.includes('usd_per_unit_spot')) {
      rep.kind = 'Geography & FX';
      rows.slice(1).forEach((r, rn) => {
        const c = get(r, 'country');
        if (!c) { rep.errors.push(`Row ${rn + 2}: country is required`); return; }
        let row = model.fx.find(f => f.country.toLowerCase() === c.toLowerCase());
        if (!row) { row = { country: c, currency: 'USD', spot: 1, trailing: 1, buffer: 0.03, burden: 0.2 }; model.fx.push(row); rep.created.push(c); }
        else rep.updated.push(c);
        const cur = get(r, 'currency'); if (cur) row.currency = cur.toUpperCase();
        ['spot|usd_per_unit_spot', 'trailing|usd_per_unit_trailing12mo'].forEach(p => {
          const parts = p.split('|'); const v = get(r, parts[1]);
          if (v !== '') row[parts[0]] = parseNumShorthand(v);
        });
        const bf = get(r, 'buffer_pct'); if (bf !== '') row.buffer = parseNumShorthand(bf) / 100;
        const bd = get(r, 'burden_pct'); if (bd !== '') row.burden = parseNumShorthand(bd) / 100;
      });
    } else if (header.includes('base_local')) {
      rep.kind = 'Roles & comp bands';
      const touched = {};
      rows.slice(1).forEach((r, rn) => {
        const name = get(r, 'role'), country = get(r, 'country');
        if (!name || !country) { rep.errors.push(`Row ${rn + 2}: role and country are required`); return; }
        const fxr = model.fx.find(f => f.country.toLowerCase() === country.toLowerCase());
        if (!fxr) { rep.errors.push(`Row ${rn + 2}: country "${country}" is not in Geography & FX — add it (or import the FX template) first`); return; }
        const existed = model.rateCard.roles.some(x => x.name === name);
        const kindV = get(r, 'kind').toLowerCase();
        const role = ensureRateRole(name, null, { kind: kindV === 'manager' ? 'manager' : 'ic', dept: get(r, 'dept') || null });
        if (kindV === 'manager') role.kind = 'manager'; else if (kindV === 'ic') role.kind = 'ic';
        const dept = get(r, 'dept'); if (dept) role.dept = dept;
        role.bands = role.bands || {}; role.mix = role.mix || {};
        role.bands[fxr.country] = { base: parseNumShorthand(get(r, 'base_local')), ote: parseNumShorthand(get(r, 'ote_variable_local')) };
        const mx = get(r, 'mix_pct'); if (mx !== '') role.mix[fxr.country] = parseNumShorthand(mx) / 100;
        touched[name] = true;
        (existed ? rep.updated : rep.created).push(`${name} · ${fxr.country}`);
      });
      let rebal = 0;
      Object.keys(touched).forEach(n => {
        const role = model.rateCard.roles.find(x => x.name === n);
        const cs = model.fx.map(f => f.country).filter(c => role.bands[c]);
        const sum = cs.reduce((a, c) => a + (role.mix[c] || 0), 0);
        if (cs.length && Math.abs(sum - 1) > 0.02) { normalizeShares(role.mix, cs); rebal++; }
      });
      if (rebal) rep.notes.push(`${rebal} role mix${rebal === 1 ? '' : 'es'} auto-balanced to 100%`);
    } else if (header.includes('role_line')) {
      rep.kind = 'Teams & hiring plan';
      const iso = monthsISO(); const isoIdx = {}; iso.forEach((m, i) => { isoIdx[m] = i; });
      const monthCols = header.map((h, i) => ({ h, i })).filter(x => /^\d{4}-\d{2}$/.test(x.h));
      const outside = monthCols.filter(c => !(c.h in isoIdx)).length;
      if (outside) rep.notes.push(`${outside} month column${outside === 1 ? '' : 's'} outside the current ${model.config.horizon}-month horizon ignored`);
      const validArch = ['prospecting', 'demand-funnel', 'pipeline-channel', 'expansion', 'retention', 'custom'];
      rows.slice(1).forEach((r, rn) => {
        const tName = get(r, 'team'), arch = get(r, 'archetype').toLowerCase(), lineName = get(r, 'role_line'), pays = get(r, 'pays_as');
        if (!tName || !lineName) { rep.errors.push(`Row ${rn + 2}: team and role_line are required`); return; }
        let team = model.teams.find(t => t.name.toLowerCase() === tName.toLowerCase());
        if (!team) {
          if (arch === 'sales') {
            if (model.teams.some(t => t.type === 'sales')) { rep.errors.push(`Row ${rn + 2}: a Sales team already exists — use its exact name to update it`); return; }
            team = salesTeamShell(tName);
          } else if (validArch.includes(arch)) {
            team = newTeam(arch); team.name = uniqueTeamName(tName, team.id); team.roles = [];
          } else { rep.errors.push(`Row ${rn + 2}: unknown archetype "${arch || '(blank)'}" for new team "${tName}" — use sales, ${validArch.join(', ')}`); return; }
          model.teams.push(team); rep.created.push('team ' + team.name);
        }
        if (!pays || !model.rateCard.roles.some(x => x.name === pays)) { rep.errors.push(`Row ${rn + 2}: pays_as role "${pays || '(blank)'}" is not in the catalog — import the roles template first`); return; }
        team.roles = team.roles || [];
        let line = team.roles.find(l => (l.name || '').toLowerCase() === lineName.toLowerCase());
        if (!line) { line = newRoleLine(team.type, pays, lineName, undefined); team.roles.push(line); rep.created.push(`${team.name} · ${lineName}`); }
        else rep.updated.push(`${team.name} · ${lineName}`);
        line.rateRole = pays;
        const sh = get(r, 'start_heads'); if (sh !== '') line.start = Math.max(0, Math.round(parseNumShorthand(sh)));
        const at = get(r, 'annual_attrition_pct'); if (at !== '') line.annualAttrition = Math.max(0, parseNumShorthand(at)) / 100;
        line.hires = padToH(line.hires, model.config.horizon);
        monthCols.forEach(c => {
          const idx = isoIdx[c.h]; if (idx == null) return;
          const v = String(r[c.i] == null ? '' : r[c.i]).trim(); if (v === '') return;
          line.hires[idx] = Math.max(0, Math.round(parseNumShorthand(v)));
        });
      });
      model = Engine.migrate(model); // new teams get any schema defaults they're missing
    } else {
      rep.errors.push('Unrecognized template — the header row must come from one of the downloaded templates (FX, Roles, or Teams)');
    }
    return rep;
  }

  function renderRates() {
    // ---------- FX ----------
    const fx = $('#fxSection');
    let html = `<div class="row mb-2"><h3>Geography &amp; FX</h3><span style="flex:1"></span>
      <button class="btn btn-primary" id="btnFxResearch" ${researchOut.fxRunning ? 'disabled' : ''} title="TICKER researches current spot and trailing-12-mo rates for your currencies (web search)">${researchOut.fxRunning ? 'TICKER researching…' : '⌕ Ask TICKER — research rates (AI)'}</button>
      <button class="btn btn-secondary" id="btnAddCountry">+ Add country</button></div>
    <div class="tbl-wrap mb-2"><table><thead><tr><th>Country</th><th>Currency</th><th title="USD per 1 unit of local currency, today">Spot (USD/local)</th><th title="Average rate over the last 12 months">Trailing-12mo</th><th title="Safety margin on the rate — foreign costs planned slightly high so currency moves can't break the plan">FX buffer %</th><th title="Employer costs on top of base salary (payroll tax, benefits). Set once per country, applies to every role hired there.">Employer burden %</th><th title="MAX(spot, trailing) × (1+buffer) — the locked rate the model uses">Budget rate</th><th></th></tr></thead><tbody>`;
    model.fx.forEach((row, i) => {
      html += `<tr>
        <td><input type="text" data-path="fx.${i}.country" data-kind="text" value="${esc(row.country)}"></td>
        <td><input type="text" data-path="fx.${i}.currency" data-kind="text" value="${esc(row.currency)}"></td>
        <td><input type="number" step="0.0001" data-path="fx.${i}.spot" value="${row.spot}"></td>
        <td><input type="number" step="0.0001" data-path="fx.${i}.trailing" value="${row.trailing}"></td>
        <td><input type="number" step="0.5" data-path="fx.${i}.buffer" data-kind="pct" value="${Math.round(row.buffer * 1000) / 10}"></td>
        <td><input type="number" step="1" data-path="fx.${i}.burden" data-kind="pct" value="${Math.round((row.burden != null ? row.burden : 0.2) * 100)}"></td>
        <td><b>${Engine.budgetRate(row).toFixed(4)}</b></td>
        <td>${i > 0 ? `<button class="btn btn-ghost" data-delfx="${i}">✕</button>` : ''}</td></tr>`;
    });
    html += `</tbody></table></div><div id="fxResearchOut">${fxResearchHTML()}</div>` + guideHTML(FX_GUIDE, fxGuideOpen, 'btnFxGuide', 'FX FIELD GUIDE');
    html += `<div class="row mt-3" style="border-top:1px solid var(--border);padding-top:.75rem">
      <span class="mono-label" title="Download a CSV prefilled with your current data, bulk-edit it in Excel/Sheets, then re-import. Rows match on names: existing entries update, new ones are created.">BULK EDIT — TEMPLATES:</span>
      <button class="btn btn-ghost" id="btnTplFx" title="country, currency, rates, buffer, burden">⤓ Geography &amp; FX</button>
      <button class="btn btn-ghost" id="btnTplRoles" title="role, country, base, variable, mix — one row per role × country">⤓ Roles &amp; comp bands</button>
      <button class="btn btn-ghost" id="btnTplTeams" title="team, role line, starting heads, attrition + a column per month of hires">⤓ Teams &amp; hiring plan</button>
      <span style="flex:1"></span>
      <button class="btn btn-secondary" id="btnTplImport">⇪ Import filled template</button>
    </div>`;
    fx.innerHTML = html;
    bindFields(fx);
    const tplBtns = { btnTplFx: ['geography-fx', tplFxCSV], btnTplRoles: ['roles-comp-bands', tplRolesCSV], btnTplTeams: ['teams-hiring-plan', tplTeamsCSV] };
    Object.keys(tplBtns).forEach(id => {
      const el = $('#' + id);
      if (el) el.onclick = () => download(`template-${tplBtns[id][0]}-${new Date().toISOString().slice(0, 10)}.csv`, tplBtns[id][1](), 'text/csv');
    });
    const tplImp = $('#btnTplImport');
    if (tplImp) tplImp.onclick = () => $('#tplFile').click();
    fx.querySelectorAll('[data-delfx]').forEach(b => b.onclick = async () => {
      const row = model.fx[+b.dataset.delfx];
      const holders = model.rateCard.roles.filter(r => r.bands[row.country]);
      if (!(await uiConfirm(`Remove ${row.country}?`, `${holders.length} role${holders.length === 1 ? ' has' : 's have'} pay bands there — they'll be deleted and each affected role's location mix rebalances automatically across its remaining countries.`, 'Remove country'))) return;
      holders.forEach(r => { delete r.bands[row.country]; delete r.mix[row.country]; });
      model.fx.splice(+b.dataset.delfx, 1);
      const remaining = model.fx.map(f => f.country);
      let rebal = 0;
      holders.forEach(r => {
        const cs = remaining.filter(c => r.bands[c]);
        if (cs.length) { normalizeShares(r.mix, cs); rebal++; }
      });
      recompute(); render();
      toast(`${row.country} removed${rebal ? ` · ${rebal} role mix${rebal === 1 ? '' : 'es'} rebalanced to 100%` : ''}`);
    });
    $('#btnAddCountry').onclick = () => {
      model.fx.push({ country: 'New Country', currency: 'XXX', spot: 1, trailing: 1, buffer: 0.03, burden: 0.2 });
      recompute(); render();
      toast('Country added — attach it to specific roles in the rate card below');
    };
    $('#btnFxGuide').onclick = () => { fxGuideOpen = !fxGuideOpen; renderRates(); };
    $('#btnFxResearch').onclick = async () => {
      const s = settings();
      if (!s.apiKey) { toast('Add your API key in the Agents tab first'); return; }
      const tickerDef = Agents.AGENT_DEFS.find(d => d.id === 'fx-research');
      if (!(await confirmAgentRun(tickerDef, 1, `Currencies: ${model.fx.filter(f => f.currency !== 'USD').map(f => f.currency).join(', ')}.`))) return;
      researchOut.fxRunning = true; renderRates();
      try { researchOut.fx = await Agents.researchFX(model.fx, s); }
      catch (e) { researchOut.fx = { error: e.message }; }
      researchOut.fxRunning = false; renderRates();
    };
    bindFxApply(fx);

    // ---------- teams & roles: library → my teams → role library ----------
    const rs = $('#rateSection');
    const usage = {};
    const addUse = (roleName, team, use) => {
      if (!roleName) return;
      (usage[roleName] = usage[roleName] || []).push({ team, use });
    };
    model.teams.forEach(t => {
      (t.roles || []).forEach(l => addUse(l.rateRole, t, `pays role line “${l.name}”`));
      if (t.type === 'retention' && t.roleIC) addUse(t.roleIC, t, 'pays CSMs (auto-sized)');
      if (t.roleMgr) addUse(t.roleMgr, t, 'pays managers');
    });

    let rc = guideHTML(RATE_GUIDE, rateGuideOpen, 'btnRateGuide', 'RATE CARD FIELD GUIDE');
    rc += `<div class="row mb-2 mt-2">
      <label class="field" style="width:230px"><span class="lbl mono-label"><span class="lbl-txt">Planned attainment default %</span></span>
        <input type="number" step="5" data-path="rateCard.defaultAttain" data-kind="pct" value="${Math.round((model.rateCard.defaultAttain != null ? model.rateCard.defaultAttain : 0.9) * 100)}" title="Share of variable comp you budget to pay out. Applies to every role unless overridden."></label>
      <label class="row small muted" style="gap:.4rem;padding-top:1.1rem"><input type="checkbox" id="chkAttain" ${ratesUI.showAttain ? 'checked' : ''} style="width:auto">Show per-band attainment overrides</label>
    </div>`;

    // -------- 1. TEAM LIBRARY --------
    rc += `<div class="detail-section"><div class="section-marker">1 — TEAM LIBRARY · START HERE</div>
      <p class="muted small" style="max-width:52rem">Add the GTM teams your org actually runs. Templates carry recommended roles you can pull in with one click; anything that doesn't fit, build custom.</p>
      <div class="grid cols-3 mt-2">`;
    TEAM_TEMPLATES.forEach(tt => {
      const count = model.teams.filter(t => t.type === tt.type).length;
      const preview = tt.ics.slice(0, 3);
      const more = (tt.ics.length + tt.mgrs.length) - preview.length;
      rc += `<div class="card card-fixed">
        <div class="row"><h3 style="font-size:var(--text-xl)">${esc(tt.name)}</h3>${count ? `<span class="badge ok">${count} ADDED</span>` : ''}</div>
        <p class="muted small" style="margin:.25rem 0">${esc(tt.desc)}</p>
        <p class="mono-label" style="margin:.25rem 0 .75rem">${preview.map(esc).join(' · ')}${more > 0 ? ` +${more} MORE` : ''}</p>
        <div class="card-cta"><button class="btn btn-secondary" data-addtemplate="${tt.type}">+ Add team</button></div>
      </div>`;
    });
    rc += `<div class="card card-fixed">
      <h3 style="font-size:var(--text-xl)">Custom team</h3>
      <p class="muted small" style="margin:.25rem 0 .75rem">Doesn't fit a template? Pick the archetype that matches how the team makes its number.</p>
      <div class="card-cta"><button class="btn btn-secondary" id="btnCustomTeam">+ Create custom</button></div>
    </div></div></div>`;

    // -------- 2. ROLE CATALOG (slim — names & classification only; pay lives in My Teams) --------
    const allRoles = model.rateCard.roles.map(x => x.name);
    rc += `<div class="detail-section"><div class="section-marker">2 — ROLE CATALOG · ${allRoles.length} ROLES</div>
      <p class="muted small">The single source of role <b>names</b> and classification (IC vs manager, team type). Renaming here updates every team that uses the role. <b>Pay is set in My Teams below</b>, where each role is priced in context.</p>
      <div class="row clps mb-2" data-libclps="1" style="cursor:pointer"><span class="mono-label accent">${ratesUI.libOpen ? '▾ COLLAPSE CATALOG' : '▸ EXPAND CATALOG'}</span></div>
      ${ratesUI.libOpen ? allRoles.map(n => roleCardHTML(n, usage, { editableName: true })).join('') + `<button class="btn btn-secondary mt-2" id="btnAddRole">+ Add role to catalog</button>` : ''}
    </div>`;

    // -------- 3. MY TEAMS --------
    rc += `<div class="detail-section"><div class="row"><div class="section-marker" style="margin:0">3 — MY TEAMS · CONFIGURE &amp; PRICE</div>
      <span style="flex:1"></span>
      <button class="btn btn-primary" id="btnResearchAll" title="BANDS researches comp for every role used by every team (one call per role)">⌕ Ask BANDS — all teams</button></div>
      <p class="muted small">Configure roles in the popout; expand a team to set pay bands for the roles it uses. Hiring plans live in the Plan Builder.</p>`;
    if (!model.teams.length) rc += `<p class="muted small">No teams yet — add one from the library above.</p>`;
    model.teams.forEach(team => {
      const open = !!ratesUI.teams[team.id];
      const roleNames = teamRoleNames(team);
      rc += `<div class="card mb-2" style="padding:1rem 1.5rem">
        <div class="row clps" data-teamclps="${esc(team.id)}" title="Click to ${open ? 'collapse' : 'expand'} pay bands">
          <span class="mono-label accent">${open ? '▾' : '▸'}</span>
          <h3 style="font-size:var(--text-xl)">${esc(team.name)}</h3>
          <span class="mono-label">${TYPE_LABELS[team.type] || team.type}</span>
          <span class="mono-label">${roleNames.length} ROLE${roleNames.length === 1 ? '' : 'S'}${team.roleMgr ? ` · MGR “${esc(team.roleMgr.toUpperCase())}”` : ''}</span>
          <span style="flex:1"></span>
          <button class="btn btn-primary" data-teamresearch="${esc(team.id)}" title="BANDS researches comp for every role this team uses (one call per role)">⌕ Ask BANDS — team</button>
          <button class="btn btn-secondary" data-teamcfg="${esc(team.id)}">Configure team</button>
        </div>
        ${open ? `<div class="mt-2">${roleNames.map(n => roleCardHTML(n, usage, { editableName: false })).join('') || '<p class="muted small">No roles yet — Configure team to add them.</p>'}</div>` : ''}
      </div>`;
    });
    rc += `</div>`;

    rs.innerHTML = rc;
    bindFields(rs);
    $('#btnRateGuide').onclick = () => { rateGuideOpen = !rateGuideOpen; renderRates(); };
    // collapse toggles (ignore clicks on inner controls)
    const clpsGuard = e => !!e.target.closest('button, input, select, textarea, [data-ledger]');
    rs.querySelectorAll('[data-teamclps]').forEach(el => el.addEventListener('click', e => {
      if (clpsGuard(e)) return;
      ratesUI.teams[el.dataset.teamclps] = !ratesUI.teams[el.dataset.teamclps]; renderRates();
    }));
    rs.querySelectorAll('[data-roleclps]').forEach(el => el.addEventListener('click', e => {
      if (clpsGuard(e)) return;
      ratesUI.roles[el.dataset.roleclps] = !ratesUI.roles[el.dataset.roleclps]; renderRates();
    }));
    rs.querySelectorAll('[data-libclps]').forEach(el => el.addEventListener('click', () => { ratesUI.libOpen = !ratesUI.libOpen; renderRates(); }));
    const chk = $('#chkAttain');
    if (chk) chk.onchange = () => { ratesUI.showAttain = chk.checked; renderRates(); };
    rs.querySelectorAll('[data-balmix]').forEach(b => b.onclick = () => {
      const role = model.rateCard.roles[+b.dataset.balmix];
      const cs = model.fx.map(f => f.country).filter(c => role.bands[c]);
      normalizeShares(role.mix, cs);
      recompute(); render(); toast('Mix balanced to 100%');
    });
    // team creation
    rs.querySelectorAll('[data-addtemplate]').forEach(b => b.onclick = async () => {
      const tpl = TEAM_TEMPLATES.find(t => t.type === b.dataset.addtemplate);
      const t = newTeam(tpl.type);
      const nm = await uiPrompt('Name this team', 'As your org calls it', tpl.name);
      if (nm === null) return;
      t.name = uniqueTeamName(nm || t.name, t.id);
      model.teams.push(t);
      ratesUI.teams[t.id] = true;
      recompute(); render();
      openTeamCfgModal(t.id);
    });
    const customBtn = $('#btnCustomTeam');
    if (customBtn) customBtn.onclick = openAddTeamModal;
    rs.querySelectorAll('[data-teamcfg]').forEach(b => b.onclick = () => openTeamCfgModal(b.dataset.teamcfg));
    // safe rename: catalog renames propagate to every team reference
    rs.querySelectorAll('[data-rolerename]').forEach(inp => inp.addEventListener('change', () => {
      const role = model.rateCard.roles[+inp.dataset.rolerename];
      const oldName = role.name;
      const newName = inp.value.trim();
      if (!newName || newName === oldName) { inp.value = oldName; return; }
      if (model.rateCard.roles.some(r => r !== role && r.name === newName)) {
        toast(`"${newName}" already exists — names must be unique`); inp.value = oldName; return;
      }
      role.name = newName;
      model.teams.forEach(t => {
        if (t.roleMgr === oldName) t.roleMgr = newName;
        if (t.roleIC === oldName) t.roleIC = newName;
        (t.roles || []).forEach(l => { if (l.rateRole === oldName) l.rateRole = newName; });
      });
      recompute(); render();
      toast(`Renamed everywhere: ${oldName} → ${newName}`);
    }));
    // comp research at team / all-team level
    rs.querySelectorAll('[data-teamresearch]').forEach(b => b.onclick = () => {
      const team = model.teams.find(t => t.id === b.dataset.teamresearch);
      if (team) researchRoles(teamRoleNames(team), team.name);
    });
    const allBtn = $('#btnResearchAll');
    if (allBtn) allBtn.onclick = () => {
      const names = [...new Set(model.teams.flatMap(t => teamRoleNames(t)))];
      researchRoles(names, 'all teams');
    };
    // role library management
    rs.querySelectorAll('[data-delrole]').forEach(b => b.onclick = () => {
      const role = model.rateCard.roles[+b.dataset.delrole];
      const used = model.teams.some(t => t.roleIC === role.name || t.roleMgr === role.name || (t.roles || []).some(l => l.rateRole === role.name));
      if (used) { toast('Role is in use by a team — repoint the team in its configurator first'); return; }
      model.rateCard.roles.splice(+b.dataset.delrole, 1); recompute(); render();
    });
    const addRoleBtn = $('#btnAddRole');
    if (addRoleBtn) addRoleBtn.onclick = async () => {
      const nm = (await uiPrompt('Add role to library', 'Role name', '')) || '';
      if (!nm) return;
      if (model.rateCard.roles.some(r => r.name === nm)) { toast('That role already exists'); return; }
      ensureRateRole(nm, null);
      ratesUI.roles['lib:' + nm] = true;
      recompute(); render();
    };
    // per-role country add / remove
    rs.querySelectorAll('[data-delband]').forEach(b => b.onclick = async () => {
      const [ri, country] = b.dataset.delband.split(':');
      const role = model.rateCard.roles[+ri];
      if (!(await uiConfirm(`Remove ${country} from ${role.name}?`, 'Its band and location-mix share go with it.', 'Remove'))) return;
      delete role.bands[country]; delete role.mix[country];
      recompute(); render();
    });
    rs.querySelectorAll('[data-addband]').forEach(b => b.onclick = () => {
      const ri = +b.dataset.addband;
      const role = model.rateCard.roles[ri];
      const country = rs.querySelector(`[data-addbandsel="${ri}"]`).value;
      role.bands[country] = { base: 0, ote: 0 };
      role.mix[country] = 0;
      recompute(); render();
      toast(`${country} added to ${role.name} — set its band and rebalance the mix to 100%`);
    });
    // comp research per role
    rs.querySelectorAll('[data-research]').forEach(b => b.onclick = async () => {
      const s = settings();
      if (!s.apiKey) { toast('Add your API key in the Agents tab first'); return; }
      const role = model.rateCard.roles[+b.dataset.research];
      const bandsDef = Agents.AGENT_DEFS.find(d => d.id === 'comp-research');
      if (!(await confirmAgentRun(bandsDef, 1, `Role: "${role.name}" across ${Object.keys(role.bands).length} countries.`))) return;
      researchOut.rolesRunning[role.name] = true; renderRates();
      try { researchOut.roles[role.name] = await Agents.researchComp(role, model.fx, s); }
      catch (e) { researchOut.roles[role.name] = { error: e.message }; }
      researchOut.rolesRunning[role.name] = false; renderRates();
    });
    rs.querySelectorAll('[data-compapply]').forEach(b => b.onclick = () => {
      const [ri, i] = b.dataset.compapply.split(':').map(Number);
      applyCompRec(ri, i); recompute(); render(); toast('Band applied');
    });
    rs.querySelectorAll('[data-compapplyall]').forEach(b => b.onclick = () => {
      const ri = +b.dataset.compapplyall;
      const role = model.rateCard.roles[ri];
      ((researchOut.roles[role.name] || {}).recommendations || []).forEach((_, i) => applyCompRec(ri, i));
      recompute(); render(); toast('All bands applied');
    });
    const go = $('#btnGoBuilder');
    if (go) go.onclick = () => $('.nav-tab[data-page=drivers]').click();
  }

  // run comp research for a set of roles, one call at a time
  async function researchRoles(names, label) {
    const sUI = settings();
    if (!sUI.apiKey) { toast('Add your API key in the Agents tab first'); return; }
    const lim = Agents.limits(sUI);
    const u = Agents.usageToday();
    if (!(await uiConfirm(`Run BANDS — Comp Band Researcher on ${label}?`, `BANDS researches market comp with web search, one call per role: ${names.length} roles = ${names.length} calls (~$${(names.length * 0.2).toFixed(2)} est). Today so far: ${u.calls} calls, ~$${u.cost.toFixed(2)} of your $${lim.maxUSDPerDay}/day cap. Results land on each role with Apply buttons.`, 'Run BANDS'))) return;
    let done = 0, failed = 0;
    for (const n of names) {
      const role = model.rateCard.roles.find(r => r.name === n);
      if (!role) continue;
      researchOut.rolesRunning[n] = true; renderRates();
      try { researchOut.roles[n] = await Agents.researchComp(role, model.fx, settings()); done++; }
      catch (e) {
        researchOut.roles[n] = { error: e.message }; failed++;
        if (/limit|cap/i.test(e.message)) { researchOut.rolesRunning[n] = false; toast(e.message); break; }
      }
      researchOut.rolesRunning[n] = false; renderRates();
    }
    renderRates();
    toast(`Comp research: ${done} role${done === 1 ? '' : 's'} done${failed ? `, ${failed} failed` : ''} — expand the teams to review & apply`);
  }

  function applyCompRec(ri, i) {
    const role = model.rateCard.roles[ri];
    const rec = ((researchOut.roles[role.name] || {}).recommendations || [])[i];
    if (!rec) return;
    const existing = role.bands[rec.country] || {};
    role.bands[rec.country] = { base: rec.base_local, ote: rec.ote_variable_local };
    if (existing.attain != null) role.bands[rec.country].attain = existing.attain;
    if (role.mix[rec.country] == null) role.mix[rec.country] = 0;
  }

  function roleCardHTML(roleName, usage, opts = {}) {
    const ri = model.rateCard.roles.findIndex(r => r.name === roleName);
    if (ri < 0) return '';
    const role = model.rateCard.roles[ri];
    const key = (opts.editableName ? 'lib:' : 'team:') + roleName;
    const open = !!ratesUI.roles[key];
    // only the countries this role actually has, in FX-table order
    const countries = model.fx.map(f => f.country).filter(c => role.bands[c]);
    const missing = model.fx.map(f => f.country).filter(c => !role.bands[c]);
    const mixSum = countries.reduce((s, c) => s + (role.mix[c] || 0), 0);
    const uses = usage[roleName] || [];
    const running = researchOut.rolesRunning[role.name];
    // catalog context: slim single-row card — identity & classification only; pay lives in My Teams
    if (opts.editableName) {
      return `<div class="card mb-2" style="padding:.9rem 1.25rem">
        <div class="row">
          <input type="text" data-rolerename="${ri}" value="${esc(role.name)}" style="width:240px;font-weight:600" title="Rename — updates every team that uses this role">
          ${role.kind === 'manager' ? '<span class="badge ok">MGR</span>' : ''}
          <label class="row small muted" style="gap:.4rem">Kind
            <select data-path="rateCard.roles.${ri}.kind" data-kind="text" style="width:120px">
              <option value="ic" ${role.kind !== 'manager' ? 'selected' : ''}>IC / line</option>
              <option value="manager" ${role.kind === 'manager' ? 'selected' : ''}>Manager</option>
            </select></label>
          <label class="row small muted" style="gap:.4rem">Team type
            <select data-path="rateCard.roles.${ri}.dept" data-kind="text" style="width:150px">
              <option value="">Any</option>
              ${TEAM_TEMPLATES.map(tt => `<option value="${tt.type}" ${role.dept === tt.type ? 'selected' : ''}>${esc(tt.name)}</option>`).join('')}
            </select></label>
          <span class="mono-label">${uses.length ? [...new Set(uses.map(u => u.team.name))].map(esc).join(' · ').toUpperCase() : 'UNUSED'}</span>
          <span style="flex:1"></span>
          <span class="mono-label dim">${fmt$(computed.rates[role.name] || 0)}/yr</span>
          <button class="btn btn-danger" data-delrole="${ri}">Remove</button>
        </div>
      </div>`;
    }
    let rc = `<div class="card mb-2" style="padding:.9rem 1.25rem">
      <div class="row clps" data-roleclps="${esc(key)}" title="Click to ${open ? 'collapse' : 'expand'} pay bands">
        <span class="mono-label accent">${open ? '▾' : '▸'}</span>
        <b>${esc(role.name)}</b>
        ${role.kind === 'manager' ? '<span class="badge ok">MANAGER</span>' : ''}
        <span class="mono-label">BLENDED: <span style="color:var(--accent)">${fmt$(computed.rates[role.name] || 0)}/yr</span></span>
        ${Math.abs(mixSum - 1) > 0.001 ? `<span class="badge bad">MIX ${(mixSum * 100).toFixed(0)}% — FIX</span>` : '<span class="badge ok">MIX 100%</span>'}
        <span class="mono-label">${countries.length} SITE${countries.length === 1 ? '' : 'S'}</span>
        <span style="flex:1"></span>
        ${open ? `<button class="btn btn-primary" data-research="${ri}" ${running ? 'disabled' : ''} title="BANDS researches market comp for this role across its countries (web search)">${running ? 'BANDS researching…' : '⌕ Ask BANDS (AI)'}</button>` : ''}
      </div>`;
    if (!open) return rc + '</div>';
    rc += `${uses.length ? `<p class="muted small" style="margin:.5rem 0 .75rem">${uses.map(u => `<b>${esc(u.team.name)}</b> ${esc(u.use)}`).join(' · ')}</p>` : '<p class="muted small" style="margin:.5rem 0 .75rem">Not yet used by any team.</p>'}
      <div class="tbl-wrap"><table><thead><tr>
        <th>Country</th>
        <th title="Annual gross base in local currency — your band midpoint">Base (local)</th>
        <th title="Annual on-target commission/bonus at 100% attainment, local currency. 0 if no variable.">OTE variable (local)</th>
        ${ratesUI.showAttain ? '<th title="Override of the planned-attainment default for this role in this country">Attain % (override)</th>' : ''}
        <th title="base×(1+country burden)×FX + OTE×attain×FX — burden comes from the Geography & FX table">Fully-loaded USD</th>
        <th title="Share of this role's heads in each country. Rows must sum to 100%.">Location mix %</th><th></th></tr></thead><tbody>`;
    countries.forEach(c => {
      const b = role.bands[c];
      const fxRow = model.fx.find(f => f.country === c);
      const rate = fxRow ? Engine.budgetRate(fxRow) : 1;
      const burden = fxRow && fxRow.burden != null ? fxRow.burden : 0.2;
      const attain = b.attain != null ? b.attain : (model.rateCard.defaultAttain != null ? model.rateCard.defaultAttain : 0.9);
      const loaded = b.base * (1 + burden) * rate + (b.ote || 0) * attain * rate;
      rc += `<tr><td class="lbl">${esc(c)} <span class="dim" title="Country burden, from Geography & FX">+${Math.round(burden * 100)}%</span></td>
        <td><input type="number" data-path="rateCard.roles.${ri}.bands.${esc(c)}.base" value="${b.base}"></td>
        <td><input type="number" data-path="rateCard.roles.${ri}.bands.${esc(c)}.ote" value="${b.ote || 0}"></td>
        ${ratesUI.showAttain ? `<td><input type="number" step="5" data-path="rateCard.roles.${ri}.bands.${esc(c)}.attain" data-kind="pct" value="${Math.round(attain * 100)}"></td>` : ''}
        <td><b>${fmt$(loaded)}</b></td>
        <td><input type="number" step="5" data-path="rateCard.roles.${ri}.mix.${esc(c)}" data-kind="pct" value="${Math.round((role.mix[c] || 0) * 100)}"></td>
        <td><button class="btn btn-ghost" data-delband="${ri}:${esc(c)}" title="This role doesn't hire here — remove the country">✕</button></td></tr>`;
    });
    rc += '</tbody></table></div>';
    rc += `<div class="row mt-2">
      ${missing.length ? `<select data-addbandsel="${ri}" style="width:auto">${missing.map(c => `<option>${esc(c)}</option>`).join('')}</select>
      <button class="btn btn-ghost" data-addband="${ri}">+ Add country to this role</button>` : ''}
      ${Math.abs(mixSum - 1) > 0.001 ? `<button class="btn btn-ghost" data-balmix="${ri}">⚖ Balance mix to 100%</button>` : ''}
    </div>`;
    rc += roleResearchHTML(role.name, ri);
    return rc + '</div>';
  }

  // ---------- research result rendering & apply ----------
  function fxResearchHTML() {
    const o = researchOut.fx;
    if (!o) return '';
    if (o.error) return `<div class="field-notice warn mb-2"><div class="fn-head">// FX RESEARCH</div><div class="fn-detail">${esc(o.error)}</div></div>`;
    const recs = o.recommendations || [];
    return `<div class="field-notice mb-2"><div class="fn-head">// FX RESEARCH — RECOMMENDATIONS${o.as_of ? ' · AS OF ' + esc(o.as_of) : ''}</div>
      <div class="tbl-wrap mt-2"><table><thead><tr><th>Currency</th><th>Spot</th><th>Trailing-12mo</th><th>Buffer %</th><th>Rationale</th><th></th></tr></thead><tbody>
      ${recs.map((r, i) => {
        const cur = model.fx.find(f => f.currency === r.currency);
        return `<tr><td class="lbl">${esc(r.currency)} ${cur ? '' : '<span class="badge warn">NOT IN MODEL</span>'}</td>
          <td>${r.spot}${cur ? ` <span class="dim">(now ${cur.spot})</span>` : ''}</td>
          <td>${r.trailing12mo}${cur ? ` <span class="dim">(now ${cur.trailing})</span>` : ''}</td>
          <td>${r.buffer_pct}%</td>
          <td style="text-align:left;white-space:normal;font-family:var(--font-sans)">${esc(r.rationale || '')} ${(r.sources || []).map(esc).join(' · ')}</td>
          <td>${cur ? `<button class="btn btn-ghost" data-fxapply="${i}">Apply</button>` : ''}</td></tr>`;
      }).join('')}</tbody></table></div>
      <div class="row mt-2"><button class="btn btn-secondary" data-fxapplyall="1">Apply all</button>
      <span class="muted small">Review before applying — rates feed every non-USD cost. Sources are the agent's citations, verify anything that moves the plan materially.</span></div></div>`;
  }

  function bindFxApply(container) {
    const apply = i => {
      const r = (researchOut.fx.recommendations || [])[i];
      const row = model.fx.find(f => f.currency === r.currency);
      if (!row) return;
      row.spot = r.spot; row.trailing = r.trailing12mo; row.buffer = (r.buffer_pct || 0) / 100;
    };
    container.querySelectorAll('[data-fxapply]').forEach(b => b.onclick = () => { apply(+b.dataset.fxapply); recompute(); render(); toast('Rate applied'); });
    container.querySelectorAll('[data-fxapplyall]').forEach(b => b.onclick = () => {
      (researchOut.fx.recommendations || []).forEach((_, i) => apply(i));
      recompute(); render(); toast('All rates applied');
    });
  }

  function roleResearchHTML(roleName, ri) {
    const o = researchOut.roles[roleName];
    if (!o) return '';
    if (o.error) return `<div class="field-notice warn mt-2"><div class="fn-head">// COMP RESEARCH</div><div class="fn-detail">${esc(o.error)}</div></div>`;
    const recs = o.recommendations || [];
    return `<div class="field-notice mt-2"><div class="fn-head">// COMP RESEARCH — ${esc(roleName.toUpperCase())}</div>
      <div class="tbl-wrap mt-2"><table><thead><tr><th>Country</th><th>Base (local)</th><th>OTE variable (local)</th><th>Burden %</th><th>Conf.</th><th>Rationale &amp; sources</th><th></th></tr></thead><tbody>
      ${recs.map((r, i) => {
        const role = model.rateCard.roles[ri];
        const cur = role && role.bands[r.country];
        return `<tr><td class="lbl">${esc(r.country)}</td>
          <td>${fmtShort(r.base_local)}${cur ? ` <span class="dim">(now ${fmtShort(cur.base)})</span>` : ''}</td>
          <td>${fmtShort(r.ote_variable_local)}${cur ? ` <span class="dim">(now ${fmtShort(cur.ote)})</span>` : ''}</td>
          <td>${r.burden_pct}%</td><td>${esc(r.confidence || '')}</td>
          <td style="text-align:left;white-space:normal;font-family:var(--font-sans)">${esc(r.rationale || '')} ${(r.sources || []).map(esc).join(' · ')}</td>
          <td><button class="btn btn-ghost" data-compapply="${ri}:${i}">Apply</button></td></tr>`;
      }).join('')}</tbody></table></div>
      ${o.notes ? `<p class="muted small mt-2">${esc(o.notes)}</p>` : ''}
      <div class="row mt-2"><button class="btn btn-secondary" data-compapplyall="${ri}">Apply all</button>
      <span class="muted small">Recommendations are market research, not your comp philosophy — sanity-check against your bands before applying.</span></div></div>`;
  }

  // ============================== READINESS ==============================
  function renderReadiness() {
    const g = $('#guardrailCard');
    g.innerHTML = `<div class="section-marker">GOVERNING GUARDRAILS</div>
      <div class="assumption-grid">
        ${fld({ path: 'guardrails.grossMargin', label: 'Gross margin', type: 'pct', ledger: { teamId: 'guardrails', key: 'gm', label: 'Guardrail · gross margin' } })}
        ${fld({ path: 'guardrails.paybackMonths', label: 'Target payback (months)', type: 'int', ledger: { teamId: 'guardrails', key: 'payback', label: 'Guardrail · target payback' } })}
        ${fld({ path: 'guardrails.arrPerHeadFloor', label: 'ARR per GTM head — floor $', type: 'num', ledger: { teamId: 'guardrails', key: 'arrfloor', label: 'Guardrail · ARR/head floor' } })}
        ${fld({ path: 'guardrails.costPctCeiling', label: 'GTM cost % of net-new ARR — ceiling', type: 'pct', ledger: { teamId: 'guardrails', key: 'costceil', label: 'Guardrail · cost % ceiling' } })}
      </div>`;
    bindFields(g);

    Charts.lines($('#chArrHead'), computed.labels, [
      { name: 'ARR / GTM head', data: computed.readiness.arrPerHead, accent: true }
    ], { title: 'ARR PER GTM HEAD VS FLOOR', threshold: model.guardrails.arrPerHeadFloor });
    Charts.lines($('#chCostPct'), computed.labels, [
      { name: 'GTM cost % of net-new ARR', data: computed.readiness.costPctRevenue, accent: true },
      { name: 'GTM cost % of run-rate revenue', data: computed.summary.totalCost.map((c, m) => { const rr = (computed.summary.endingARR[m] || 0) / 12; return rr > 0 ? c / rr : 0; }), dashed: true }
    ], { title: 'GTM COST % OF REVENUE VS CEILING', threshold: model.guardrails.costPctCeiling });

    renderSensitivity();

    // self-funding
    const sf = computed.readiness.selfFunding;
    $('#selfFundingSection').innerHTML = `<h3 class="mb-2">Role self-funding — does each revenue role pay for itself?</h3>
    <div class="tbl-wrap"><table><thead><tr><th>Role</th><th>Loaded $/yr</th><th>Output ARR/yr</th><th>Gross profit/yr</th><th>Payback (mo)</th><th>Verdict</th></tr></thead><tbody>
    ${sf.map(x => `<tr><td class="lbl">${esc(x.role)}</td><td>${fmt$(x.loaded)}</td><td>${fmt$(x.outputARR)}</td><td>${fmt$(x.grossProfit)}</td>
      <td>${x.payback === Infinity ? '∞' : x.payback.toFixed(1)}</td>
      <td>${x.verdict === 'SELF-FUNDING' ? '<span class="badge good">SELF-FUNDING</span>' : '<span class="badge bad">LONG PAYBACK</span>'}</td></tr>`).join('')}
    </tbody></table></div>
    <p class="muted small mt-2">Attributed roles (SDR / Partner) credit sourced ARR that the closing rep shares — read as "the sourcing covers the role", not literal P&amp;L.</p>`;

    // health strip
    const hh = computed.readiness.hiringHealth;
    $('#healthStrip').innerHTML = `<h3 class="mb-2">Monthly hiring health</h3>
    <div class="tbl-wrap"><table><thead><tr><th>Month</th>${computed.labels.map(l => `<th>${esc(l)}</th>`).join('')}</tr></thead><tbody>
    <tr><td class="lbl">Planned hires gate</td>${hh.map(h => `<td>${h === '-' ? '<span class="dim">·</span>' : (h === 'OK' ? '<span class="cellflag-ok">OK</span>' : '<span class="cellflag-bad">AHEAD</span>')}</td>`).join('')}</tr>
    <tr><td class="lbl">ARR / head $</td>${computed.readiness.arrPerHead.map(v => `<td class="dim">${fmtShort(v)}</td>`).join('')}</tr>
    <tr><td class="lbl">Cost % revenue</td>${computed.readiness.costPctRevenue.map(v => `<td class="dim">${v === 0 ? '·' : fmtPct(v)}</td>`).join('')}</tr>
    </tbody></table></div>
    <p class="muted small mt-2">AHEAD = heads added in a month where ARR/head is below the floor or GTM cost is above the ceiling. Advisory, not a block — but every AHEAD month needs a story for the CFO.</p>`;

    // all checks
    $('#checksList').innerHTML = computed.checks.length
      ? computed.checks.map(checkHTML).join('')
      : '<p class="muted">No flags raised.</p>';
  }

  // ============================== SENSITIVITY ==============================
  const SENS_ITEMS = [
    ['ASP ±20%', (m, d) => { const t = m.teams.find(x => x.type === 'sales'); if (t) t.asp *= 1 + 0.2 * d; }],
    ['Rep productivity ±20%', (m, d) => { const t = m.teams.find(x => x.type === 'sales'); if (t) t.roles.forEach(l => l.annualProdPerRep *= 1 + 0.2 * d); }],
    ['Channel win rates ±20%', (m, d) => { const t = m.teams.find(x => x.type === 'sales'); if (t) t.channels.forEach(ch => ch.winRate *= 1 + 0.2 * d); }],
    ['Gross retention ±2pts', (m, d) => { m.config.grossRetention = Math.min(1, Math.max(0, (m.config.grossRetention != null ? m.config.grossRetention : 0.9) + 0.02 * d)); }],
    ['Expansion quota ±20%', (m, d) => { const t = m.teams.find(x => x.type === 'expansion'); if (t) t.roles.forEach(l => l.quotaAnnual *= 1 + 0.2 * d); }],
    ['Expansion target ±2pts', (m, d) => { if ((m.config.expTargetPct || 0) > 0) m.config.expTargetPct = Math.max(0, m.config.expTargetPct + 0.02 * d); }],
    ['Comp costs ±10%', (m, d) => { m.config.scenarios[m.config.scenario].cost *= 1 + 0.1 * d; }],
    ['Attrition ±10pts', (m, d) => { m.teams.forEach(t => (t.roles || []).forEach(l => { l.annualAttrition = Math.max(0, (l.annualAttrition || 0) + 0.1 * d); })); }]
  ];
  const SENS_METRICS = {
    endingARR: { label: 'Ending ARR', get: r => r.summary.totals.endingARR },
    revenue: { label: 'Net-new ARR', get: r => r.summary.totals.revenue },
    cost: { label: 'GTM cost', get: r => r.summary.totals.cost },
    cac: { label: 'CAC ratio (×100)', get: r => r.summary.totals.finalCAC * 100 }
  };
  let sensResult = null, sensMetric = 'endingARR', sensRunning = false;

  function renderSensitivity() {
    const card = $('#sensCard');
    if (!card) return;
    card.innerHTML = `<div class="row">
      <span class="section-marker" style="margin:0">SENSITIVITY — WHAT ACTUALLY MOVES THE NUMBER</span>
      <span style="flex:1"></span>
      <label class="field" style="width:200px"><span class="lbl mono-label">Output</span>
        <select id="sensMetric">${Object.entries(SENS_METRICS).map(([k, v]) => `<option value="${k}" ${k === sensMetric ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}</select></label>
      <button class="btn btn-secondary" id="btnRunSens" ${sensRunning ? 'disabled' : ''}>${sensRunning ? 'Running…' : sensResult ? 'Re-run' : 'Run sensitivity'}</button>
    </div>
    <p class="muted small" style="margin:.5rem 0 0">Each assumption flexed both ways (grey = downside, vermillion = upside), everything else held. The longest bars are where the plan's risk lives — and where the ledger evidence matters most.</p>
    <div class="mt-2" id="sensChart">${sensResult ? '' : '<p class="muted small">Not run yet for this state.</p>'}</div>`;
    $('#sensMetric').onchange = () => { sensMetric = $('#sensMetric').value; sensResult = null; renderSensitivity(); };
    $('#btnRunSens').onclick = runSensitivity;
    if (sensResult) Charts.tornado($('#sensChart'), sensResult.items, { title: `Δ ${SENS_METRICS[sensMetric].label.toUpperCase()} VS BASE ${fmtShort(sensResult.base)}`, baseLabel: 'base ' + fmtShort(sensResult.base) });
  }

  function runSensitivity() {
    sensRunning = true; renderSensitivity();
    setTimeout(() => {
      const get = SENS_METRICS[sensMetric].get;
      const base = get(computed);
      const items = SENS_ITEMS.map(([label, mutate]) => {
        const ev = d => {
          const clone = JSON.parse(JSON.stringify(model));
          mutate(clone, d);
          return get(Engine.compute(clone)) - base;
        };
        return { label, high: ev(1), low: ev(-1) };
      }).sort((a, b) => Math.max(Math.abs(b.low), Math.abs(b.high)) - Math.max(Math.abs(a.low), Math.abs(a.high)));
      sensResult = { base, items };
      sensRunning = false;
      renderSensitivity();
    }, 30);
  }

  // ============================== LEDGER PAGE ==============================
  function renderLedger() {
    const s = settings();
    if (s.userName && !$('#userName').value) $('#userName').value = s.userName;
    $('#userName').onchange = () => { const st = settings(); st.userName = $('#userName').value.trim(); saveSettings(st); };

    const entries = Object.entries(model.ledger || {});
    const counts = { PROPOSED: 0, CHALLENGED: 0, AGREED: 0 };
    entries.forEach(([, e]) => counts[e.status] = (counts[e.status] || 0) + 1);
    $('#ledgerStats').innerHTML = `
      <div class="card stat-block"><div class="stat-value">${entries.length}</div><div class="stat-label mono-label">Tracked assumptions</div></div>
      <div class="card stat-block"><div class="stat-value">${counts.PROPOSED || 0}</div><div class="stat-label mono-label">Proposed</div></div>
      <div class="card stat-block"><div class="stat-value accent">${counts.CHALLENGED || 0}</div><div class="stat-label mono-label">Challenged — needs answer</div></div>
      <div class="card stat-block"><div class="stat-value">${counts.AGREED || 0}</div><div class="stat-label mono-label">Agreed — defendable</div></div>`;

    const filter = $('#ledgerFilter').value;
    const ownerSel = $('#ledgerOwnerFilter');
    const owners = [...new Set(entries.map(([, e]) => e.owner || 'UNOWNED'))].sort();
    const prevOwner = ownerSel.value;
    ownerSel.innerHTML = '<option value="">All</option>' + owners.map(o => `<option ${o === prevOwner ? 'selected' : ''}>${esc(o)}</option>`).join('');
    $('#ledgerFilter').onchange = () => renderLedger();
    ownerSel.onchange = () => renderLedger();

    const list = $('#ledgerList');
    const rows = entries.filter(([, e]) =>
      (!filter || e.status === filter) && (!ownerSel.value || (e.owner || 'UNOWNED') === ownerSel.value));
    if (!rows.length) {
      list.innerHTML = `<div class="field-notice info"><div class="fn-head">// EMPTY</div>
      <div class="fn-title">Nothing in the ledger${filter || ownerSel.value ? ' matching those filters' : ' yet'}.</div>
      <div class="fn-detail">Click the small <span class="ledger-chip">+</span> chip beside any assumption in the Plan Builder or Rates pages to track it, or run a Board Review and push challenges here.</div></div>`;
      $('#btnBrief').onclick = exportBrief;
      return;
    }
    // group by owner tag
    const byOwner = {};
    rows.forEach(([key, e]) => { const o = e.owner || 'UNOWNED'; (byOwner[o] = byOwner[o] || []).push([key, e]); });
    const order = { CHALLENGED: 0, PROPOSED: 1, AGREED: 2 };
    list.innerHTML = Object.keys(byOwner).sort((a, b) => (a === 'UNOWNED') - (b === 'UNOWNED') || a.localeCompare(b)).map(owner => {
      const group = byOwner[owner].sort((a, b) => order[a[1].status] - order[b[1].status]);
      const open = group.filter(([, e]) => e.status !== 'AGREED').length;
      return `<div class="detail-section" style="margin-top:1.5rem">
        <div class="section-marker">${esc(owner.toUpperCase())} — ${group.length} ASSUMPTION${group.length > 1 ? 'S' : ''}${open ? ` · <span style="color:var(--accent)">${open} OPEN</span>` : ' · ALL AGREED'}</div>
        ${group.map(([key, e]) => `
        <div class="ledger-row">
          <div class="lr-head">
            <span class="ledger-chip ${e.status.toLowerCase()}" data-open="${esc(key)}">${esc(e.status)}</span>
            <b>${esc(e.label || key)}</b>
            <span class="lr-path">value: ${esc(String(e.value != null ? e.value : '—'))}</span>
            <span style="flex:1"></span>
            <button class="btn btn-ghost" data-open="${esc(key)}">Open</button>
          </div>
          ${(e.comments || []).length ? `<div class="lr-comments">${e.comments.map(c => `<div class="comment"><span class="who">${esc(c.who)}</span>${esc(c.text)}<span class="when">${new Date(c.ts).toLocaleDateString()}</span></div>`).join('')}</div>` : ''}
        </div>`).join('')}
      </div>`;
    }).join('');
    list.querySelectorAll('[data-open]').forEach(b => b.onclick = () => {
      const e = model.ledger[b.dataset.open];
      openLedgerModal(b.dataset.open, e.label || b.dataset.open, e.value);
    });

    $('#btnBrief').onclick = exportBrief;
  }

  function exportBrief() {
    const t = computed.summary.totals;
    const entries = Object.entries(model.ledger || {});
    const lines = [];
    lines.push(`# GTM Capacity Plan — Defendability Brief`);
    lines.push(`Generated ${new Date().toISOString().slice(0, 10)} · scenario **${model.config.scenario}** · ${computed.H}-month horizon from ${model.config.startMonth}\n`);
    lines.push(`## The ask in one view`);
    lines.push(`| Metric | Value |\n|---|---|`);
    lines.push(`| ${computed.H}-mo GTM run-cost | ${fmt$(t.cost)} |`);
    lines.push(`| ${computed.H}-mo net-new ARR | ${fmt$(t.revenue)} (booked ${fmt$(t.booked)} + expansion ${fmt$(t.expansion)}) |`);
    lines.push(`| Ending GTM headcount | ${t.endingHeadcount} (${t.hires} hires, ${t.attrition} attrition) |`);
    lines.push(`| New-business CAC ratio | ${t.finalCAC.toFixed(2)} |`);
    lines.push(`| Ending ARR base | ${fmt$(t.endingARR)} |\n`);
    lines.push(`## Teams`);
    computed.teams.forEach(tm => {
      const team = model.teams.find(x => x.id === tm.id) || {};
      lines.push(`- **${tm.name}** (${tm.type}) — ${computed.H}-mo cost ${fmt$(tm.cost.reduce((a, b) => a + b, 0))}, ending HC ${tm.headcount[computed.H - 1]}, hires ${tm.hires.reduce((a, b) => a + b, 0)}, attrition ${tm.attrition.reduce((a, b) => a + b, 0)}${team.annualAttrition != null ? ` (${Math.round(team.annualAttrition * 100)}%/yr assumed)` : ''}`);
    });
    lines.push(`\n## Guardrails & readiness`);
    lines.push(`- Gross margin ${fmtPct(model.guardrails.grossMargin)} · target payback ${model.guardrails.paybackMonths} mo · ARR/head floor ${fmt$(model.guardrails.arrPerHeadFloor)} · cost ceiling ${fmtPct(model.guardrails.costPctCeiling)}`);
    computed.readiness.selfFunding.forEach(x => lines.push(`- ${x.role}: payback ${x.payback === Infinity ? '∞' : x.payback.toFixed(1)} mo — ${x.verdict}`));
    const ahead = computed.readiness.hiringHealth.map((h, m) => h === 'AHEAD OF SUPPORT' ? computed.labels[m] : null).filter(Boolean);
    lines.push(`- Hiring-health flags: ${ahead.length ? ahead.join(', ') : 'none'}\n`);
    lines.push(`## Open flags (${computed.checks.length})`);
    computed.checks.forEach(c => lines.push(`- [${c.severity.toUpperCase()}] **${c.team}** — ${c.title}${c.detail ? ` · ${c.detail}` : ''}`));
    lines.push(`\n## Assumption ledger (${entries.length} tracked)`);
    const order = { CHALLENGED: 0, PROPOSED: 1, AGREED: 2 };
    entries.sort((a, b) => order[a[1].status] - order[b[1].status]).forEach(([key, e]) => {
      lines.push(`\n### ${e.label || key}`);
      lines.push(`- Status: **${e.status}** · Owner: ${e.owner || '—'} · Value: ${e.value != null ? e.value : '—'}`);
      (e.comments || []).forEach(c => lines.push(`  - ${c.who} (${new Date(c.ts).toLocaleDateString()}): ${c.text}`));
    });
    lines.push(`\n---\n*Built with the Renegade Ops GTM Capacity Model. Status discipline: a number is defendable when it is AGREED with an owner and evidence in the trail.*`);
    download(`defendability-brief-${new Date().toISOString().slice(0, 10)}.md`, lines.join('\n'), 'text/markdown');
    toast('Brief exported');
  }

  // ============================== BOARD REVIEW ==============================
  function renderBoard() {
    const s = settings();
    const provN = Agents.providerCfg(s);
    $('#apiNotice').classList.toggle('hidden', !!provN.apiKey || !!provN.keyOptional);
    $('#btnRunBoard').disabled = !s.apiKey;
    const grid = $('#agentGrid');
    grid.innerHTML = Agents.PERSONAS.map(p => {
      const res = boardResults[p.id];
      let out = '';
      if (res === 'running') out = `<div class="agent-output"><span class="spin">// INTERROGATING…</span></div>`;
      else if (res && res.error) out = `<div class="agent-output"><span class="badge bad">ERROR</span> <span class="small muted">${esc(res.error)}</span></div>`;
      else if (res) {
        const vClass = res.verdict === 'APPROVE' ? 'good' : (res.verdict === 'NOT DEFENDABLE' ? 'bad' : 'warn');
        out = `<div class="agent-output">
          <span class="badge ${vClass}">${esc(res.verdict || '?')}</span>
          <p class="small mt-2">${esc(res.summary || '')}</p>
          ${(res.challenges || []).map((ch, ci) => `
            <div class="challenge">
              <div class="c-title">${esc(ch.title)} <span class="mono-label">[${esc(ch.severity || 'med')}]</span></div>
              <div class="c-why"><b>${esc(ch.target || '')}</b> — ${esc(ch.why || '')}</div>
              <div class="c-why">Ask: ${esc(ch.ask || '')}</div>
              <div class="c-actions"><button class="btn btn-ghost" data-push="${p.id}:${ci}">→ Push to ledger as CHALLENGED</button></div>
            </div>`).join('')}
          ${(res.strengths || []).length ? `<p class="small muted mt-2">Solid: ${res.strengths.map(esc).join(' · ')}</p>` : ''}
        </div>`;
      }
      const cfg = Agents.agentCfg(s, p.id);
      const provB = Agents.providerCfg(s);
      const mResolved = cfg.model || (provB.id === 'anthropic' ? cfg.anthropicDefault : provB.defaultModel) || 'provider default';
      const mShort = (Agents.MODELS.find(m => m.id === mResolved) || {}).label || mResolved;
      return `<div class="agent-card ${res === 'running' ? 'running' : ''}">
        <div class="mono-label accent">// AI AGENT</div>
        <div class="agent-role">${esc(p.callsign)}</div>
        <div class="mono-label" style="margin:.1rem 0 0">${esc(p.role.toUpperCase())}</div>
        <p class="agent-mandate">${esc(p.mandate)}</p>
        <p class="mono-label" style="margin:.4rem 0 0">${esc(mShort.split(' (')[0].toUpperCase())}${cfg.enabled ? '' : ' · <span style="color:var(--accent)">DISABLED</span>'}</p>
        <div class="row mt-2"><button class="btn btn-primary" data-run="${p.id}" ${cfg.enabled ? '' : 'disabled'}>Run ${esc(p.callsign)}</button></div>
        ${out}
      </div>`;
    }).join('');

    grid.querySelectorAll('[data-run]').forEach(b => b.onclick = () => runOne(b.dataset.run));
    grid.querySelectorAll('[data-push]').forEach(b => b.onclick = () => {
      const [pid, ci] = b.dataset.push.split(':');
      const ch = boardResults[pid].challenges[+ci];
      const persona = Agents.PERSONAS.find(x => x.id === pid);
      const key = 'board::' + pid + '::' + ch.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60);
      model.ledger[key] = model.ledger[key] || { comments: [] };
      const e = model.ledger[key];
      e.label = ch.target || ch.title;
      e.status = 'CHALLENGED';
      e.owner = e.owner || '';
      e.value = '';
      e.comments.push({ who: persona.role + ' (AI)', text: `${ch.title}: ${ch.why} ASK: ${ch.ask}`, ts: Date.now() });
      saveModel(); toast('Pushed to ledger'); render();
    });

    $('#btnRunBoard').onclick = runAll;
  }

  // every agent invocation: the user knows WHO they're invoking and confirms before spend
  async function confirmAgentRun(def, calls, extra) {
    const u = Agents.usageToday();
    const lim = Agents.limits(settings());
    return uiConfirm(`Run ${def.callsign} — ${def.role}?`,
      `${def.mandate}${extra ? ' ' + extra : ''} This run: ${calls} API call${calls > 1 ? 's' : ''}${def.webSearch ? ' with web search' : ''}. Today so far: ${u.calls} calls, ~$${u.cost.toFixed(2)} of your $${lim.maxUSDPerDay}/day cap.`,
      `Run ${def.callsign}`);
  }

  async function runOne(pid) {
    const s = settings();
    if (!s.apiKey) { toast('Add your API key in the Agents tab first'); return; }
    const def = Agents.AGENT_DEFS.find(d => d.id === pid);
    if (!(await confirmAgentRun(def, 1))) return;
    boardResults[pid] = 'running'; renderBoard();
    try {
      boardResults[pid] = await Agents.runPersona(pid, model, computed, s);
    } catch (e) { boardResults[pid] = { error: e.message }; }
    renderBoard();
  }

  async function runAll() {
    const s = settings();
    if (!s.apiKey) { toast('Add your API key in the Agents tab first'); return; }
    const lim = Agents.limits(s);
    const enabled = Agents.PERSONAS.filter(p => Agents.agentCfg(s, p.id).enabled);
    if (!enabled.length) { toast('All board agents are disabled — enable them in the Agents tab'); return; }
    const names = enabled.map(p => p.callsign).join(', ');
    if (!(await uiConfirm('Convene the board?', `This runs ${names} in parallel, then CHAIR consolidates — ${enabled.length + 1} API calls total. Today so far: ${Agents.usageToday().calls} calls, ~$${Agents.usageToday().cost.toFixed(2)} of $${lim.maxUSDPerDay}/day.`, 'Convene'))) return;
    $('#boardStatus').textContent = 'Running reviews in parallel…';
    enabled.forEach(p => boardResults[p.id] = 'running');
    renderBoard();
    await Promise.all(enabled.map(async p => {
      try { boardResults[p.id] = await Agents.runPersona(p.id, model, computed, s); }
      catch (e) { boardResults[p.id] = { error: e.message }; }
    }));
    renderBoard();
    const ok = Agents.PERSONAS.map(p => boardResults[p.id]).filter(r => r && !r.error && r !== 'running');
    if (ok.length >= 2) {
      $('#boardStatus').textContent = 'Synthesizing…';
      try {
        const syn = await Agents.synthesize(boardResults, model, computed, s);
        lastSynthesis = syn;
        const cls = syn.readiness === 'BOARD-READY' ? 'good' : (syn.readiness === 'NOT DEFENDABLE' ? 'bad' : 'warn');
        $('#boardSynthesis').innerHTML = `
          <div class="card featured">
            <div class="mono-label accent mb-2">// CHAIR — CHIEF OF STAFF SYNTHESIS</div>
            <span class="badge ${cls}">${esc(syn.readiness)}</span>
            <p class="mt-2">${esc(syn.narrative)}</p>
            ${(syn.top_actions || []).length ? `<div class="mono-label mb-2 mt-2">TOP ACTIONS</div><ol class="small">${syn.top_actions.map(a => `<li><b>${esc(a.action)}</b> <span class="muted">— ${esc(a.owner_role)}</span></li>`).join('')}</ol>` : ''}
            ${(syn.agreements || []).length ? `<p class="small muted">Aligned across reviewers: ${syn.agreements.map(esc).join(' · ')}</p>` : ''}
          </div>`;
      } catch (e) { $('#boardSynthesis').innerHTML = `<p class="muted small">Synthesis failed: ${esc(e.message)}</p>`; }
    }
    const u = Agents.usageToday();
    $('#boardStatus').textContent = `Done. Today: ${u.calls} calls, ~$${u.cost.toFixed(2)} est.`;
  }

  // ============================== RENDER ROUTER ==============================
  function render(fromEdit) {
    // capture focus so a rebuild doesn't eat the field the user just tabbed into
    const ae = document.activeElement;
    let restore = null;
    if (ae && ae !== document.body && ae.matches && ae.matches('input, select, textarea') && $('#app').contains(ae)) {
      let sel = null;
      if (ae.dataset && ae.dataset.path) sel = `[data-path="${ae.dataset.path}"]`;
      else if (ae.id) sel = '#' + ae.id;
      if (sel) restore = { sel, value: ae.value, ss: ae.selectionStart, se: ae.selectionEnd, isInput: ae.tagName === 'INPUT', type: ae.type || '' };
    }
    renderScenarioSel();
    if (currentPage === 'dashboard') renderDashboard();
    else if (currentPage === 'builder') renderBuilder();
    else if (currentPage === 'rates') renderRates();
    else if (currentPage === 'readiness') renderReadiness();
    else if (currentPage === 'ledger') renderLedger();
    else if (currentPage === 'board') renderBoard();
    else if (currentPage === 'agents') renderAgents();
    else if (currentPage === 'drivers') renderDrivers();
    $('#stencilNum').textContent = String(computed.summary.totals.endingHeadcount).padStart(2, '0');
    updateUndoBtn();
    if (restore) {
      const el = document.querySelector(restore.sel);
      if (el) {
        el.focus();
        if (fromEdit && restore.isInput && /^(text|number|password|month|search)$/.test(restore.type)) {
          try {
            el.value = restore.value; // keep uncommitted keystrokes mid-typing
            if (restore.type === 'text' && restore.ss != null) el.setSelectionRange(restore.ss, restore.se);
          } catch (e) { /* selection unsupported on this type */ }
        }
      }
    }
  }

  // ---- named local versions (saved runs) ----
  const LS_VERSIONS = 'ro_capacity_versions';
  function loadVersions() { try { return JSON.parse(localStorage.getItem(LS_VERSIONS) || '[]'); } catch (e) { return []; } }
  // diff two saved runs (or a run vs the current plan): KPIs, changed drivers, team deltas
  const DRIVER_LABELS = {
    startMonth: 'Start month', horizon: 'Horizon (months)', startingARR: 'Starting ARR',
    grossRetention: 'Gross retention', renewalEscalator: 'Renewal escalator', expTargetPct: 'Expansion target % of book',
    salesCycleLag: 'Sales-cycle lag (mo)', timeToFillDays: 'Time to fill (days)', recruitingPct: 'Recruiting cost %',
    agencyHirePct: 'Agency-hire share', onboardingPerHire: 'Onboarding per hire', maxStartsPerMonth: 'Max starts/mo', scenario: 'Active scenario'
  };
  function diffRuns(mA, mB, nameA, nameB) {
    const cA = Engine.compute(Engine.migrate(JSON.parse(JSON.stringify(mA))));
    const cB = Engine.compute(Engine.migrate(JSON.parse(JSON.stringify(mB))));
    const tA = cA.summary.totals, tB = cB.summary.totals;
    const dRow = (label, a, b, fmt) => {
      const d = b - a;
      return `<tr><td class="lbl">${esc(label)}</td><td>${fmt(a)}</td><td>${fmt(b)}</td><td class="${Math.abs(d) < 1e-9 ? 'dim' : ''}">${d === 0 ? '—' : (d > 0 ? '+' : '−') + fmt(Math.abs(d))}</td></tr>`;
    };
    const money = v => fmtShort(v), plain = v => String(Math.round(v * 100) / 100);
    let html = `<div class="tbl-wrap mt-2"><table><thead><tr><th></th><th>${esc(nameA)}</th><th>${esc(nameB)}</th><th>Δ</th></tr></thead><tbody>
      ${dRow('GTM cost', tA.cost, tB.cost, money)}
      ${dRow('Net-new ARR', tA.revenue, tB.revenue, money)}
      ${dRow('Ending ARR', tA.endingARR, tB.endingARR, money)}
      ${dRow('Feasible ARR (staffed)', tA.feasibleEndingARR, tB.feasibleEndingARR, money)}
      ${dRow('Ending headcount', tA.endingHeadcount, tB.endingHeadcount, plain)}
      ${dRow('Hires', tA.hires, tB.hires, plain)}
      ${dRow('Final CAC ratio', tA.finalCAC, tB.finalCAC, plain)}
    </tbody></table></div>`;
    // drivers that changed
    const drv = [];
    Object.keys(DRIVER_LABELS).forEach(k => {
      const a = (mA.config || {})[k], b = (mB.config || {})[k];
      if (JSON.stringify(a) !== JSON.stringify(b)) drv.push(`${DRIVER_LABELS[k]}: <b>${esc(String(a != null ? a : '—'))}</b> → <b>${esc(String(b != null ? b : '—'))}</b>`);
    });
    const arrJoin = x => ((x || []).map(v => fmtShort(v || 0)).join(' / '));
    if (JSON.stringify(mA.config.arrGoals) !== JSON.stringify(mB.config.arrGoals)) drv.push(`ARR goals: <b>${arrJoin(mA.config.arrGoals)}</b> → <b>${arrJoin(mB.config.arrGoals)}</b>`);
    if (JSON.stringify(mA.config.annualTargets) !== JSON.stringify(mB.config.annualTargets)) drv.push(`NB targets: <b>${arrJoin(mA.config.annualTargets)}</b> → <b>${arrJoin(mB.config.annualTargets)}</b>`);
    const sA = ((mA.config.seasonality || {}).mode || 'even'), sB = ((mB.config.seasonality || {}).mode || 'even');
    if (sA !== sB) drv.push(`Seasonality: <b>${esc(sA)}</b> → <b>${esc(sB)}</b>`);
    html += `<div class="mono-label mt-3 mb-1">DRIVERS THAT CHANGED</div>` + (drv.length ? `<ul class="small" style="margin:.25rem 0">${drv.map(d => `<li>${d}</li>`).join('')}</ul>` : '<p class="muted small">None — same dials, different org.</p>');
    // team deltas
    const names = [...new Set([...cA.teams.map(x => x.name), ...cB.teams.map(x => x.name)])];
    const tRows = names.map(n => {
      const a = cA.teams.find(x => x.name === n), b = cB.teams.find(x => x.name === n);
      if (!a) return `<tr><td class="lbl">${esc(n)}</td><td colspan="3"><span class="badge warn">ADDED in ${esc(nameB)}</span></td></tr>`;
      if (!b) return `<tr><td class="lbl">${esc(n)}</td><td colspan="3"><span class="badge warn">REMOVED in ${esc(nameB)}</span></td></tr>`;
      const ca = a.cost.reduce((x, v) => x + v, 0), cb = b.cost.reduce((x, v) => x + v, 0);
      const ha = a.headcount[a.headcount.length - 1], hb = b.headcount[b.headcount.length - 1];
      if (Math.abs(ca - cb) < 1 && ha === hb) return '';
      return `<tr><td class="lbl">${esc(n)}</td><td>${fmtShort(ca)} → ${fmtShort(cb)}</td><td>${ha} → ${hb} HC</td><td>${(cb - ca) >= 0 ? '+' : '−'}${fmtShort(Math.abs(cb - ca))}</td></tr>`;
    }).filter(Boolean);
    html += `<div class="mono-label mt-3 mb-1">TEAMS THAT MOVED</div>` + (tRows.length ? `<div class="tbl-wrap"><table><thead><tr><th>Team</th><th>Cost</th><th>Ending HC</th><th>Δ cost</th></tr></thead><tbody>${tRows.join('')}</tbody></table></div>` : '<p class="muted small">No team-level differences.</p>');
    return html;
  }

  function openVersionsModal() {
    const body = $('#versionsBody');
    const build = () => {
      const versions = loadVersions();
      body.innerHTML = `<h3>Saved runs</h3>
        <p class="muted small">Named snapshots of the whole model, stored in this browser. Save before big what-ifs; open one to keep working from it (your current state stays one Undo away).</p>
        <div class="row mb-2 mt-2">
          <input type="text" id="vName" placeholder="e.g. Base plan v2 — pre-board" style="flex:1">
          <button class="btn btn-secondary" id="vSave">Save current run</button>
          <button class="btn btn-ghost" id="vImportFile" title="Add a run file from a teammate or another machine to this list — your current plan is untouched">⇪ Import run file</button>
          <input type="file" id="vFile" accept=".json,application/json" style="display:none">
        </div>
        ${versions.length ? versions.slice().reverse().map(v => `
          <div class="ledger-row"><div class="lr-head">
            <b>${esc(v.name)}</b>
            <span class="lr-path">${new Date(v.ts).toLocaleString()} · ${esc(v.summary || '')}</span>
            <span style="flex:1"></span>
            <button class="btn btn-ghost" data-vopen="${esc(v.id)}">Open</button>
            <button class="btn btn-ghost" data-vfile="${esc(v.id)}" title="Download this run as a file — share it or store it outside the browser">⤓ File</button>
            <button class="btn btn-danger" data-vdel="${esc(v.id)}">Delete</button>
          </div></div>`).join('') : '<p class="muted small">No saved runs yet.</p>'}
        ${versions.length ? `<hr class="divider-thin">
        <div class="mono-label mb-1">COMPARE RUNS — WHAT CHANGED BETWEEN TWO SCENARIOS</div>
        <div class="row mb-2">
          <select id="vA">${versions.slice().reverse().map(v => `<option value="${esc(v.id)}">${esc(v.name)}</option>`).join('')}<option value="">Current plan</option></select>
          <span class="muted small">vs</span>
          <select id="vB"><option value="">Current plan</option>${versions.slice().reverse().map(v => `<option value="${esc(v.id)}">${esc(v.name)}</option>`).join('')}</select>
          <button class="btn btn-secondary" id="vCompare">⇄ Compare</button>
        </div>
        <div id="vDiffOut"></div>` : ''}
        <div class="row mt-2"><span style="flex:1"></span><button class="btn btn-ghost" id="vClose">Close</button></div>`;
      $('#vSave').onclick = () => {
        const name = ($('#vName').value || '').trim() || ('Run ' + new Date().toLocaleString());
        const t = computed.summary.totals;
        const versions2 = loadVersions();
        versions2.push({
          id: 'v-' + Date.now().toString(36), name, ts: Date.now(),
          summary: `${model.config.scenario} · ${fmtShort(t.cost)} cost · ${t.endingHeadcount} HC · ${fmtShort(t.endingARR)} ARR`,
          json: JSON.stringify(model)
        });
        while (versions2.length > 25) versions2.shift();
        try { localStorage.setItem(LS_VERSIONS, JSON.stringify(versions2)); toast('Run saved'); }
        catch (e) { toast('Storage full — delete old runs first'); }
        build();
      };
      body.querySelectorAll('[data-vopen]').forEach(b => b.onclick = async () => {
        const v = loadVersions().find(x => x.id === b.dataset.vopen);
        if (!v) return;
        if (!(await uiConfirm(`Open "${v.name}"?`, 'It replaces what you are looking at now — your current state stays one Undo away.', 'Open run'))) return;
        model = JSON.parse(v.json);
        recompute(); render();
        $('#versionsModal').classList.remove('open');
        toast(`Opened "${v.name}"`);
      });
      body.querySelectorAll('[data-vfile]').forEach(b => b.onclick = () => {
        const v = loadVersions().find(x => x.id === b.dataset.vfile);
        if (!v) return;
        const fname = 'run-' + v.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) + '.json';
        download(fname, JSON.stringify({ kind: 'gtm-capacity-run', name: v.name, ts: v.ts, summary: v.summary, json: v.json }, null, 2), 'application/json');
        toast('Run exported — import it on any machine via "⇪ Import run file"');
      });
      const vif = $('#vImportFile');
      if (vif) vif.onclick = () => $('#vFile').click();
      const vf = $('#vFile');
      if (vf) vf.onchange = e => {
        const f = e.target.files[0];
        e.target.value = '';
        if (!f) return;
        const rd = new FileReader();
        rd.onload = () => {
          try {
            const data = JSON.parse(String(rd.result));
            let entry;
            if (data.kind === 'gtm-capacity-run' && data.json) {
              entry = { id: 'v-' + Date.now().toString(36), name: data.name || f.name, ts: data.ts || Date.now(), summary: data.summary || 'imported run', json: data.json };
            } else if (data.config && data.teams) {
              // a raw model export — wrap it as a run
              entry = { id: 'v-' + Date.now().toString(36), name: f.name.replace(/\.json$/i, ''), ts: Date.now(), summary: 'imported model file', json: JSON.stringify(data) };
            } else { toast('Not a run or model file'); return; }
            JSON.parse(entry.json); // validate before storing
            const vs = loadVersions();
            vs.push(entry);
            while (vs.length > 25) vs.shift();
            localStorage.setItem(LS_VERSIONS, JSON.stringify(vs));
            toast(`Run "${entry.name}" added to saved runs`);
            build();
          } catch (err) { toast('Could not read run file: ' + err.message); }
        };
        rd.readAsText(f);
      };
      body.querySelectorAll('[data-vdel]').forEach(b => b.onclick = async () => {
        const v = loadVersions().find(x => x.id === b.dataset.vdel);
        if (!(await uiConfirm(`Delete "${v.name}"?`, 'The snapshot is gone for good (your current model is unaffected).', 'Delete'))) return;
        localStorage.setItem(LS_VERSIONS, JSON.stringify(loadVersions().filter(x => x.id !== b.dataset.vdel)));
        build();
      });
      const vc = $('#vCompare');
      if (vc) vc.onclick = () => {
        const pick = id => {
          if (!id) return { m: model, name: 'Current plan' };
          const v = loadVersions().find(x => x.id === id);
          return v ? { m: JSON.parse(v.json), name: v.name } : null;
        };
        const A = pick($('#vA').value), B = pick($('#vB').value);
        if (!A || !B) return;
        try { $('#vDiffOut').innerHTML = diffRuns(A.m, B.m, A.name, B.name); }
        catch (e) { $('#vDiffOut').innerHTML = `<p class="muted small">Could not diff: ${esc(e.message)}</p>`; }
      };
      $('#vClose').onclick = () => $('#versionsModal').classList.remove('open');
    };
    build();
    $('#versionsModal').classList.add('open');
  }
  $('#btnVersions').onclick = openVersionsModal;

  // ============================== OUTPUTS — what fuels the next steps ==============================
  const csvCell = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const csvLine = arr => arr.map(csvCell).join(',');
  const today = () => new Date().toISOString().slice(0, 10);

  // req-level hiring plan for recruiting / ATS
  function exportHiringPlan() {
    const ttf = model.config.timeToFillDays || 60;
    const openOffset = Math.max(1, Math.round(ttf / 30));
    const oneTimePer = name => Math.round((computed.rates[name] || 0) * (model.config.recruitingPct || 0) * (model.config.agencyHirePct != null ? model.config.agencyHirePct : 1) + (model.config.onboardingPerHire || 0));
    const rows = [['Req ID', 'Team', 'Role line', 'Pays as (rate card)', 'Start month', 'Open req by', 'Annual loaded cost (USD)', 'Monthly cost (USD)', 'One-time cost (USD)', 'Location mix', 'Ramp months to full']];
    let i = 1;
    model.teams.forEach(team => (team.roles || []).forEach(line => {
      (line.hires || []).slice(0, computed.H).forEach((n, m) => {
        for (let k = 0; k < n; k++) {
          const openIdx = m - openOffset;
          const role = model.rateCard.roles.find(r => r.name === line.rateRole);
          const mix = role ? Object.entries(role.mix || {}).filter(([c, v]) => v > 0 && model.fx.some(f => f.country === c)).map(([c, v]) => `${c} ${Math.round(v * 100)}%`).join(' / ') : '';
          const rate = computed.rates[line.rateRole] || 0;
          rows.push([
            `REQ-${String(i++).padStart(3, '0')}`, team.name, line.name, line.rateRole,
            computed.labels[m], openIdx >= 0 ? computed.labels[openIdx] : `${ttf}d before plan start`,
            Math.round(rate), Math.round(rate / 12), oneTimePer(line.rateRole), mix, line.ramp ? line.ramp.length + 1 : 0
          ]);
        }
      });
    }));
    rows.push([]);
    rows.push(['Total planned reqs', i - 1]);
    rows.push(['Expected attrition over plan', computed.summary.totals.attrition + ' heads', 'Backfills are NOT listed as reqs — open them on trigger.']);
    rows.push(['Assumptions', `Time-to-fill ${ttf} days`, `Scenario ${model.config.scenario}`, `Generated ${today()}`]);
    download(`hiring-plan-${today()}.csv`, rows.map(csvLine).join('\n'), 'text/csv');
    toast('Hiring plan exported');
  }

  // monthly budget by team & category for FP&A
  function exportBudget() {
    const rows = [['Team', 'Category', ...computed.labels, 'Total']];
    const money = arr => arr.map(v => Math.round(v));
    computed.teams.forEach(r => {
      const cats = [
        ['IC comp', r.extras.icComp || r.extras.csmComp],
        ['Manager comp', r.extras.mgrComp || r.extras.csMgrComp],
        ['Tooling & platform', r.extras.tooling || r.extras.csTooling],
        ['Program / MDF', r.extras.programSpend || r.extras.mdf],
        ['One-time hire costs', r.extras.hireCost]
      ].filter(([, a]) => a && a.some(v => v > 0.005));
      cats.forEach(([cat, arr]) => rows.push([r.name, cat, ...money(arr), Math.round(arr.reduce((x, v) => x + v, 0))]));
      rows.push([r.name, 'TEAM TOTAL', ...money(r.cost), Math.round(r.cost.reduce((x, v) => x + v, 0))]);
    });
    const S = computed.summary;
    rows.push(['GTM', 'TOTAL RUN-COST', ...money(S.totalCost), Math.round(S.totals.cost)]);
    rows.push([]);
    rows.push(['Net-new ARR', 'New business booked (lag-adj)', ...money(S.bookedRevenue), Math.round(S.totals.booked)]);
    rows.push(['Net-new ARR', 'Expansion (AM)', ...money(S.expansion), Math.round(S.totals.expansion)]);
    rows.push(['Net-new ARR', 'Built-in growth (escalator)', ...money(S.builtInGrowth), Math.round(S.totals.builtIn || 0)]);
    rows.push(['Net-new ARR', 'TOTAL NET-NEW ARR', ...money(S.totalRevenue), Math.round(S.totals.revenue)]);
    exportFPNA(); // FP&A long-format + FX exposure ride along with the budget download
    rows.push(['Revenue', 'Ending ARR base', ...money(S.endingARR), '']);
    rows.push([]);
    rows.push(['Meta', `Scenario ${model.config.scenario}`, `Horizon ${computed.H} months from ${model.config.startMonth}`, `Generated ${today()}`]);
    download(`gtm-budget-${today()}.csv`, rows.map(csvLine).join('\n'), 'text/csv');
    toast('Budget exported');
  }

  // self-contained, print-ready board pack
  // FP&A workbook: long-format category lines + FX exposure (downloads alongside the monthly budget)
  function exportFPNA() {
    const parts = Engine.blendedRateParts(model);
    const iso = monthsISO();
    const H = computed.H;
    const rows = [['month', 'year', 'quarter', 'team', 'category', 'amount_usd']];
    const fxComp = {};
    let grand = 0;
    computed.teams.forEach(r => {
      const tm = model.teams.find(x => x.id === r.id) || {};
      const fixed = new Array(H).fill(0), vari = new Array(H).fill(0), tool = new Array(H).fill(0), prog = new Array(H).fill(0);
      const lines = (r.extras.lines || []).map(l => ({ ending: l.ending, role: l.rateRole }));
      if (tm.roleMgr && r.mgrs) lines.push({ ending: r.mgrs, role: tm.roleMgr });
      lines.forEach(l => {
        const p = parts[l.role] || { fixed: 0, variable: 0, byCountry: {} };
        let headYears = 0;
        for (let m = 0; m < H; m++) {
          fixed[m] += (l.ending[m] || 0) * p.fixed / 12;
          vari[m] += (l.ending[m] || 0) * p.variable / 12;
          headYears += (l.ending[m] || 0) / 12;
        }
        Object.entries(p.byCountry || {}).forEach(([c, usd]) => { fxComp[c] = (fxComp[c] || 0) + headYears * usd; });
      });
      const fixedMo = tm.toolingFixedMonthly != null ? tm.toolingFixedMonthly : (tm.platformFixedMonthly || tm.fixedProgramMonthly || 0);
      for (let m = 0; m < H; m++) {
        tool[m] = (r.ics[m] || 0) * (tm.toolingSeatAnnual || 0) / 12 + fixedMo;
        const ot = (r.extras.hireCost || [])[m] || 0;
        prog[m] = Math.max(0, (r.cost[m] || 0) - fixed[m] - vari[m] - tool[m] - ot);
      }
      [['Comp — fixed (base+burden)', fixed], ['Comp — variable (OTE)', vari], ['One-time hiring', r.extras.hireCost || []], ['Tooling & platform', tool], ['Program & other', prog]]
        .forEach(([cat, arr]) => {
          if (!arr.some(v => v > 0.005)) return;
          for (let m = 0; m < H; m++) {
            if (!(arr[m] > 0.005)) continue;
            const mm = +iso[m].split('-')[1];
            rows.push([iso[m], iso[m].split('-')[0], 'Q' + (Math.floor((mm - 1) / 3) + 1), r.name, cat, Math.round(arr[m])]);
            grand += arr[m];
          }
        });
    });
    rows.push([]);
    rows.push(['', '', '', 'GTM', 'ALL CATEGORIES (reconciliation)', Math.round(grand)]);
    rows.push(['', '', '', 'GTM', 'ENGINE TOTAL RUN-COST', Math.round(computed.summary.totals.cost)]);
    download(`budget-fpna-long-${today()}.csv`, rows.map(r2 => r2.map(csvEsc).join(',')).join('\n'), 'text/csv');

    const compTotal = Object.values(fxComp).reduce((a, v) => a + v, 0) || 1;
    const fxRows = [['country', 'currency', 'budget_rate_usd_per_unit', 'comp_usd_total', 'share_pct'],
      ...model.fx.map(f => [f.country, f.currency, Engine.budgetRate(f).toFixed(4), Math.round(fxComp[f.country] || 0), ((fxComp[f.country] || 0) / compTotal * 100).toFixed(1)]),
      [], ['note', 'Compensation only — one-time hiring, tooling and program costs are not FX-attributed', '', '', '']];
    download(`fx-exposure-${today()}.csv`, fxRows.map(r2 => r2.map(csvEsc).join(',')).join('\n'), 'text/csv');
  }

  // monthly operating report: plan vs imported actuals, print-ready
  function exportOpReport() {
    const acts = model.actuals || [];
    if (!acts.length) { toast('Import actuals first'); return; }
    const byMetric = {};
    acts.forEach(a => { (byMetric[a.metric] = byMetric[a.metric] || {})[a.m] = (byMetric[a.metric][a.m] || 0) + a.value; });
    const fmtM = v => '$' + (Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : Math.round(v / 1000) + 'K');
    const fmtBy = (metric, v) => metric === 'headcount' ? String(Math.round(v)) : fmtM(v);
    const FLOW = { cost: 1, bookings: 1, revenue: 1 };
    const worst = [];
    const sections = Object.keys(byMetric).map(metric => {
      const def = ACTUAL_METRICS[metric];
      const plan = def.plan();
      const ms = Object.keys(byMetric[metric]).map(Number).sort((a, b) => a - b);
      let sumP = 0, sumA = 0;
      const trs = ms.map(m => {
        const p = plan[m] || 0, a = byMetric[metric][m];
        sumP += p; sumA += a;
        const d = a - p, pct = p ? d / p * 100 : 0;
        const cls = Math.abs(pct) > 10 ? 'bad' : (Math.abs(pct) > 5 ? 'warn' : 'ok');
        worst.push({ metric: def.label, month: computed.labels[m], pct });
        return `<tr><td>${esc(computed.labels[m])}</td><td>${fmtBy(metric, p)}</td><td>${fmtBy(metric, a)}</td><td class="${cls}">${d >= 0 ? '+' : ''}${fmtBy(metric, Math.abs(d) < 1 ? 0 : d)}</td><td class="${cls}">${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%</td></tr>`;
      }).join('');
      const tot = FLOW[metric]
        ? `<tr style="border-top:2px solid #999"><td><b>Total (months with actuals)</b></td><td><b>${fmtBy(metric, sumP)}</b></td><td><b>${fmtBy(metric, sumA)}</b></td><td><b>${sumA - sumP >= 0 ? '+' : ''}${fmtBy(metric, sumA - sumP)}</b></td><td><b>${sumP ? ((sumA - sumP) / sumP * 100).toFixed(1) : '0.0'}%</b></td></tr>` : '';
      return `<h2>${esc(def.label)}</h2><table><thead><tr><th>Month</th><th>Plan</th><th>Actual</th><th>&Delta;</th><th>&Delta;%</th></tr></thead><tbody>${trs}${tot}</tbody></table>`;
    }).join('');
    worst.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
    const callouts = worst.slice(0, 3).filter(x => Math.abs(x.pct) > 5)
      .map(x => `${x.metric} in ${x.month} ran ${x.pct >= 0 ? '+' : ''}${x.pct.toFixed(1)}% vs plan`).join('; ');
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>GTM Operating Report</title>
<style>
  body{font-family:Georgia,'Times New Roman',serif;color:#111;margin:40px auto;max-width:860px;line-height:1.5}
  h1{font-family:Arial,Helvetica,sans-serif;font-size:24px;text-transform:uppercase;letter-spacing:.04em;border-bottom:4px solid #FF3D00;padding-bottom:8px}
  h2{font-family:Arial,Helvetica,sans-serif;font-size:14px;text-transform:uppercase;letter-spacing:.08em;color:#FF3D00;margin-top:28px}
  table{border-collapse:collapse;width:100%;font-size:13px;margin-top:6px}
  th{font-family:Arial,sans-serif;text-align:right;font-size:11px;text-transform:uppercase;color:#666;border-bottom:1px solid #999;padding:6px 8px}
  td{text-align:right;padding:6px 8px;border-bottom:1px solid #ddd;font-variant-numeric:tabular-nums}
  th:first-child,td:first-child{text-align:left}
  .meta{font-family:Arial,sans-serif;font-size:12px;color:#666}
  .bad{color:#C03000;font-weight:bold}.warn{color:#B07000}.ok{color:#2a7a2a}
  .note{font-size:12px;color:#666;font-style:italic}
  @media print{body{margin:12mm}}
</style></head><body>
<h1>GTM Operating Report — Plan vs Actuals</h1>
<p class="meta">Generated ${today()} · Scenario <b>${esc(model.config.scenario)}</b> · plan: ${computed.H}-month horizon from ${esc(model.config.startMonth)}</p>
${callouts ? `<p><b>Variance callouts:</b> ${esc(callouts)}.</p>` : '<p><b>No variance beyond ±5%</b> in the months reported.</p>'}
${sections}
<p class="note">&Delta;% colors: within ±5% green, ±5–10% amber, beyond ±10% red. Flow metrics ($/mo) total across reported months; headcount and ARR are point-in-time. Print to PDF for distribution.</p>
</body></html>`;
    download(`operating-report-${today()}.html`, html, 'text/html');
    toast('Operating report exported — open & print to PDF');
  }

  // render a chart offscreen and return its serialized SVG block (for HTML exports)
  function chartHTML(builder) {
    const div = document.createElement('div');
    builder(div);
    const tip = div.querySelector('.chart-tip'); if (tip) tip.remove();
    return div.innerHTML;
  }

  function exportBoardPack() {
    const t = computed.summary.totals;
    const br = bridgeYears();
    const fmtM = v => '$' + (Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : Math.round(v / 1000) + 'K');
    const yearsCost = computed.teams.map(r => {
      const cells = br.map(b => r.cost.slice(b.y * 12, Math.min(computed.H, (b.y + 1) * 12)).reduce((x, v) => x + v, 0));
      return { name: r.name, cells, total: r.cost.reduce((x, v) => x + v, 0), hc: r.headcount[computed.H - 1], hires: r.hires.reduce((x, v) => x + v, 0) };
    });
    const entries = Object.values(model.ledger || {});
    const agreed = entries.filter(e => e.status === 'AGREED').length;
    const open = entries.length - agreed;
    const ahead = computed.readiness.hiringHealth.map((h, m) => h === 'AHEAD OF SUPPORT' ? computed.labels[m] : null).filter(Boolean);
    const errs = computed.checks.filter(c => c.severity === 'error');
    const hty = healthTally();
    const lastBr = br[br.length - 1] || {};
    const goalY = lastBr.goal || 0;
    const startHC = computed.summary.totalHeadcount[0] || 0;
    const feas = t.feasibleEndingARR;
    const goalBit = goalY ? (t.endingARR >= goalY * 0.995 ? `, on the ${fmtM(goalY)} goal` : `, ${fmtM(goalY - t.endingARR)} short of the ${fmtM(goalY)} goal`) : '';
    const feasBit = feas >= t.endingARR * 0.99 ? 'the staffed organization supports the targets' : `the staffed organization supports ${fmtM(feas)} — below what the targets assume`;
    const execSummary = `This ${computed.H}-month plan grows ARR from ${fmtM(model.config.startingARR || 0)} to ${fmtM(t.endingARR)}${goalBit}. It invests ${fmtM(t.cost)} in go-to-market, growing the team from ${startHC} to ${t.endingHeadcount} (${t.hires} hires, ${t.attrition} expected losses to attrition), at a final new-business CAC ratio of ${t.finalCAC.toFixed(2)}. On capacity: ${feasBit}. Governance: ${hty.errors} error check${hty.errors === 1 ? '' : 's'}, ${hty.warns} warning${hty.warns === 1 ? '' : 's'}, ${hty.challenged} challenged assumption${hty.challenged === 1 ? '' : 's'} open${hty.open ? ' at time of export' : ' — clean'}.`;
    const ysum = k => br.reduce((a, b) => a + (b[k] || 0), 0);
    const waterfallSVG = chartHTML(div => Charts.waterfall(div, [
      { name: 'Start', value: br.length ? br[0].start : 0, kind: 'start' },
      { name: 'Churn', value: ysum('churn'), kind: 'down' },
      { name: 'Escalator', value: ysum('esc'), kind: 'up' },
      { name: 'New biz', value: ysum('nb'), kind: 'up' },
      { name: 'Expansion', value: ysum('exp'), kind: 'up' },
      { name: 'Ending', value: lastBr.end || 0, kind: 'end' }
    ], { goal: goalY }));
    const costRevSVG = chartHTML(div => Charts.lines(div, computed.labels, [
      { name: 'Net-new ARR', data: computed.summary.totalRevenue, accent: true },
      { name: 'GTM cost', data: computed.summary.totalCost }
    ], {}));
    const scRows = scenarioRows();
    const fmtPctGap = r => { const g = r.t.endingARR > 0 ? (r.t.feasibleEndingARR - r.t.endingARR) / r.t.endingARR * 100 : 0; return (g >= -0.5 ? (g > 0.5 ? '+' + g.toFixed(0) + '%' : 'on goal') : g.toFixed(0) + '%'); };
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>GTM Capacity Plan — Board Pack</title>
<style>
  body{font-family:Georgia,'Times New Roman',serif;color:#111;margin:40px auto;max-width:880px;line-height:1.5}
  h1{font-family:Arial,Helvetica,sans-serif;font-size:26px;text-transform:uppercase;letter-spacing:.04em;border-bottom:4px solid #FF3D00;padding-bottom:8px}
  h2{font-family:Arial,Helvetica,sans-serif;font-size:15px;text-transform:uppercase;letter-spacing:.08em;color:#FF3D00;margin-top:32px}
  table{border-collapse:collapse;width:100%;font-size:13px;margin-top:8px}
  th{font-family:Arial,sans-serif;text-align:right;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#666;border-bottom:1px solid #999;padding:6px 8px}
  td{text-align:right;padding:6px 8px;border-bottom:1px solid #ddd;font-variant-numeric:tabular-nums}
  th:first-child,td:first-child{text-align:left}
  .meta{font-family:Arial,sans-serif;font-size:12px;color:#666}
  .kpi{display:inline-block;margin:12px 28px 0 0}.kpi b{display:block;font-size:24px;font-family:Arial,sans-serif}
  .bad{color:#C03000;font-weight:bold}.ok{color:#2a7a2a}
  ul{font-size:13px} .note{font-size:12px;color:#666;font-style:italic}
  .mono-label{font-family:Arial,sans-serif;font-size:10px;letter-spacing:.1em;color:#999;text-transform:uppercase;margin-bottom:6px}
  .chart-legend{margin-top:6px}.chart-legend .li{font-family:Arial,sans-serif;font-size:10px;color:#999;text-transform:uppercase;letter-spacing:.06em;margin-right:14px}
  .chart-legend .sw{display:inline-block;width:9px;height:9px;margin-right:5px;vertical-align:baseline}
  svg{width:100%;height:auto;display:block}
  @media print{body{margin:12mm}}
</style></head><body>
<h1>GTM Capacity Plan</h1>
<p class="meta">Generated ${today()} · Scenario <b>${esc(model.config.scenario)}</b> · ${computed.H}-month horizon from ${esc(model.config.startMonth)} · Starting ARR ${fmtM(model.config.startingARR || 0)} · ${esc(String(model.teams.length))} teams</p>
<div>
  <span class="kpi"><b>${fmtM(t.cost)}</b>GTM run-cost (${computed.H}mo)</span>
  <span class="kpi"><b>${fmtM(t.revenue)}</b>Net-new ARR</span>
  <span class="kpi"><b>${t.endingHeadcount}</b>Ending headcount</span>
  <span class="kpi"><b>${t.finalCAC.toFixed(2)}</b>New-business CAC ratio</span>
  <span class="kpi"><b>${fmtM(t.endingARR)}</b>Ending ARR</span>
</div>
<h2>Executive summary</h2>
<p style="font-size:14px">${execSummary}</p>
<h2>Revenue bridge — who brings what</h2>
<div style="background:#141414;padding:16px 16px 8px;margin-top:8px">${waterfallSVG}</div>
<table><thead><tr><th></th><th>Start</th><th>New business</th><th>Expansion</th><th>Escalator</th><th>Churn</th><th>Ending</th><th>Goal</th><th>&Delta;</th></tr></thead><tbody>
${br.map(b => `<tr><td>Year ${b.y + 1}</td><td>${fmtM(b.start)}</td><td>+${fmtM(b.nb)}</td><td>+${fmtM(b.exp)}</td><td>+${fmtM(b.esc)}</td><td>−${fmtM(b.churn)}</td><td><b>${fmtM(b.end)}</b></td><td>${b.goal ? fmtM(b.goal) : '—'}</td><td>${b.goal ? `<span class="${b.end < b.goal * 0.995 ? 'bad' : 'ok'}">${b.end - b.goal >= 0 ? '+' : ''}${fmtM(b.end - b.goal)}</span>` : ''}</td></tr>`).join('')}
</tbody></table>
<h2>Spend vs net-new ARR — monthly</h2>
<div style="background:#141414;padding:16px 16px 8px;margin-top:8px">${costRevSVG}</div>
<p class="note">Spend leads bookings by the ${esc(String(model.config.salesCycleLag))}-month sales cycle; the crossover month is the cash-trough turn.</p>
<h2>Investment by team</h2>
<table><thead><tr><th>Team</th>${br.map(b => `<th>Year ${b.y + 1} cost</th>`).join('')}<th>Total</th><th>Ending HC</th><th>Hires</th></tr></thead><tbody>
${yearsCost.map(r => `<tr><td>${esc(r.name)}</td>${r.cells.map(v => `<td>${fmtM(v)}</td>`).join('')}<td><b>${fmtM(r.total)}</b></td><td>${r.hc}</td><td>${r.hires}</td></tr>`).join('')}
</tbody></table>
<h2>Scenarios — same plan, three weathers</h2>
<table><thead><tr><th>Scenario</th><th>GTM cost</th><th>Feasible ARR (staffed)</th><th>vs plan</th><th>CAC</th><th>Months short</th></tr></thead><tbody>
${scRows.map(r => `<tr><td>${esc(r.name)}${r.name === model.config.scenario ? ' (active)' : ''}</td><td>${fmtM(r.t.cost)}</td><td>${fmtM(r.t.feasibleEndingARR)}</td><td>${fmtPctGap(r)}</td><td>${r.t.finalCAC.toFixed(2)}</td><td>${r.shorts}</td></tr>`).join('')}
</tbody></table>
<p class="note">Targets are the plan and do not move across scenarios; feasible ARR shows what scenario-adjusted capacity supports.</p>
<h2>Readiness &amp; discipline</h2>
<ul>
  ${computed.readiness.selfFunding.map(x => `<li>${esc(x.role)}: payback ${x.payback === Infinity ? '∞' : x.payback.toFixed(1)} months — <span class="${x.verdict === 'SELF-FUNDING' ? 'ok' : 'bad'}">${esc(x.verdict)}</span></li>`).join('')}
  <li>Hiring ahead of revenue support: ${ahead.length ? `<span class="bad">${ahead.join(', ')}</span>` : '<span class="ok">no months flagged</span>'}</li>
  ${errs.length ? errs.map(c => `<li class="bad">${esc(c.team)}: ${esc(c.title)}</li>`).join('') : '<li class="ok">No blocking flags.</li>'}
</ul>
<h2>Assumption governance</h2>
<p style="font-size:13px">${entries.length} assumptions tracked · <b class="ok">${agreed} agreed</b> · ${open ? `<b class="bad">${open} still open</b>` : 'none open'} · defendability at export: ${hty.errors} errors / ${hty.warns} warnings / ${hty.challenged} challenged. Full trail in the defendability brief.</p>
${lastSynthesis ? `<h2>Board review — CHAIR synthesis</h2>
<p style="font-size:13px"><b>${esc(lastSynthesis.readiness || '')}</b> — ${esc(lastSynthesis.narrative || '')}</p>
${(lastSynthesis.top_actions || []).length ? `<ol style="font-size:13px">${lastSynthesis.top_actions.map(a => `<li><b>${esc(a.action)}</b> — ${esc(a.owner_role)}</li>`).join('')}</ol>` : ''}` : ''}
<p class="note">Built with the Renegade Ops GTM Capacity Model. Spend leads bookings by the sales-cycle lag; hires ramp before they produce; expansion is AM capacity, not a wish. Print this page to PDF for distribution.</p>
</body></html>`;
    download(`board-pack-${today()}.html`, html, 'text/html');
    toast('Board pack exported — open & print to PDF');
  }

  $('#tplFile').onchange = e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      saveModel(); // snapshot for undo
      let rep;
      try { rep = importTemplateCSV(String(rd.result)); }
      catch (err) { ask({ title: 'Import failed', message: 'Could not parse the file: ' + err.message, okText: 'OK' }); return; }
      recompute(); render();
      const bits = [];
      if (rep.created.length) bits.push(`created ${rep.created.length} (${rep.created.slice(0, 5).join(', ')}${rep.created.length > 5 ? '…' : ''})`);
      if (rep.updated.length) bits.push(`updated ${rep.updated.length}`);
      rep.notes.forEach(n => bits.push(n));
      const msg = (bits.length ? bits.join(' · ') + '. ' : 'Nothing imported. ')
        + (rep.errors.length ? `${rep.errors.length} error${rep.errors.length === 1 ? '' : 's'}: ${rep.errors.slice(0, 5).join(' · ')}${rep.errors.length > 5 ? ` · +${rep.errors.length - 5} more` : ''}. Fix those rows and re-import — successful rows are already in.` : 'One Undo reverts the whole import.');
      ask({ title: `${rep.kind || 'Template'} import ${rep.errors.length ? '— with errors' : 'complete'}`, message: msg, okText: 'OK' });
    };
    rd.readAsText(f);
  };

  $('#actualsFile').onchange = e => {
    const f = e.target.files[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      try {
        model.actuals = parseActualsCSV(rd.result);
        saveModel(); render();
        toast(`${model.actuals.length} actuals imported`);
      } catch (err) { toast('Import failed: ' + err.message); }
    };
    rd.readAsText(f); e.target.value = '';
  };

  $('#btnExpHiring').onclick = exportHiringPlan;
  $('#btnExpBudget').onclick = exportBudget;
  $('#btnExpBoard').onclick = async () => {
    const hty = healthTally();
    if (hty.open) {
      const bits = [];
      if (hty.errors) bits.push(`${hty.errors} error check${hty.errors === 1 ? '' : 's'}`);
      if (hty.warns) bits.push(`${hty.warns} warning${hty.warns === 1 ? '' : 's'}`);
      if (hty.challenged) bits.push(`${hty.challenged} challenged assumption${hty.challenged === 1 ? '' : 's'}`);
      if (!(await uiConfirm('Export the board pack with open flags?', `This plan currently carries ${bits.join(', ')}. A board pack is a commitment document — resolve them (Readiness page, Ledger) or export deliberately.`, 'Export anyway'))) return;
    }
    exportBoardPack();
  };

  // model data lifecycle — where a new user looks for it (dashboard), not buried in Agents
  function blankModel() {
    const m = Engine.defaultModel();
    m.teams = [];
    m.rateCard.roles = [];
    m.fx = m.fx.filter(f => f.country === 'United States');
    m.ledger = {};
    delete m.actuals;
    m.config.startingARR = 0;
    m.config.arrGoals = (m.config.arrGoals || []).map(() => 0);
    m.config.annualTargets = (m.config.annualTargets || []).map(() => 0);
    m.config.goalsSeeded = false;
    m.meta = m.meta || {};
    m.meta.sample = false; // a blank model is yours, not demo data — checklist guides instead
    return Engine.migrate(m);
  }
  $('#btnDashReset').onclick = async () => {
    if (!(await uiConfirm('Reset to demo defaults?', 'Your ledger and edits will be lost. Undo can bring back the last 15 states.', 'Reset'))) return;
    saveModel(); model = Engine.defaultModel(); recompute(); render(); toast('Model reset to demo defaults');
  };
  $('#btnStartBlank').onclick = async () => {
    if (!(await uiConfirm('Start with a blank model?', 'Clears the demo org: no teams, no roles, US-only geography, zeroed goals. You build from Team Setup up. Undo can bring back the last 15 states.', 'Start blank'))) return;
    saveModel(); model = blankModel(); recompute(); render();
    document.querySelector('.nav-tab[data-page=rates]').click();
    toast('Blank model — start with 1 · Team Setup');
  };

  $('#btnUndo').onclick = undo;
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
      const ae = document.activeElement;
      if (ae && ae.matches && ae.matches('input, textarea')) return; // let the field handle it
      e.preventDefault(); undo();
    }
  });

  // close modals on backdrop click
  $$('.modal-back').forEach(mb => mb.addEventListener('click', e => {
    if (e.target === mb) { mb.classList.remove('open'); if (mb.id === 'gridModal' || mb.id === 'teamCfgModal') { recompute(); render(); } }
  }));

  recompute();
  render();
})();
