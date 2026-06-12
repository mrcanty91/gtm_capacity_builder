/* Renegade Ops — minimal sharp-edged SVG charts. No dependencies, no curves,
   no gradients. Brand: accent + greys only. */
(function (root) {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const GREYS = ['#FAFAFA', '#A3A3A3', '#737373', '#525252', '#404040', '#2E2E2E'];
  const ACCENT = '#FF3D00';

  const fmtShort = v => {
    const a = Math.abs(v);
    if (a >= 1e6) return (v / 1e6).toFixed(a >= 1e7 ? 0 : 1) + 'M';
    if (a >= 1e3) return (v / 1e3).toFixed(0) + 'K';
    return String(Math.round(v));
  };

  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  // value formatting for tooltips — ratios get decimals, money gets K/M
  const fmtVal = v => {
    const a = Math.abs(v);
    if (a >= 1000) return fmtShort(v);
    if (a >= 100) return String(Math.round(v));
    if (a >= 10) return (Math.round(v * 10) / 10).toString();
    return (Math.round(v * 100) / 100).toString();
  };

  // one tooltip div per chart container, positioned on hover
  function hoverTip(container) {
    container.style.position = 'relative';
    let tip = container.querySelector('.chart-tip');
    if (!tip) {
      tip = document.createElement('div');
      tip.className = 'chart-tip';
      tip.style.cssText = 'position:absolute;display:none;pointer-events:none;z-index:6;background:#161616;border:1px solid #404040;padding:.35rem .6rem;font-family:Inter Tight,Arial,sans-serif;font-size:11px;color:#FAFAFA;white-space:pre;line-height:1.55;max-width:260px';
      container.appendChild(tip);
    }
    return {
      show(evt, text) {
        tip.textContent = text;
        tip.style.display = 'block';
        const r = container.getBoundingClientRect();
        const cw = container.clientWidth || 720;
        let x = (evt.clientX || 0) - r.left + 14, y = (evt.clientY || 0) - r.top + 14;
        if (x > cw - 190) x = Math.max(0, x - 210);
        tip.style.left = x + 'px'; tip.style.top = y + 'px';
      },
      hide() { tip.style.display = 'none'; }
    };
  }

  // invisible vertical hover bands, one per month — textFor(m) builds the tooltip body
  function monthBands(svg, plot, container, labels, textFor) {
    const tip = hoverTip(container);
    const n = labels.length;
    for (let m = 0; m < n; m++) {
      const band = el('rect', { x: plot.x + plot.w * m / n, y: plot.y, width: plot.w / n, height: plot.h, fill: 'transparent', 'data-band': m }, svg);
      band.addEventListener('mousemove', e => tip.show(e, textFor(m)));
      band.addEventListener('mouseleave', tip.hide);
    }
  }

  function frame(W, H, P) {
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'xMidYMid meet' });
    return { svg, plot: { x: P.l, y: P.t, w: W - P.l - P.r, h: H - P.t - P.b } };
  }

  function axes(svg, plot, labels, maxV, minV = 0) {
    // y gridlines (4)
    for (let i = 0; i <= 4; i++) {
      const y = plot.y + plot.h - (plot.h * i / 4);
      el('line', { x1: plot.x, y1: y, x2: plot.x + plot.w, y2: y, stroke: '#262626', 'stroke-width': 1 }, svg);
      const v = minV + (maxV - minV) * i / 4;
      const t = el('text', { x: plot.x - 8, y: y + 3, 'text-anchor': 'end', fill: '#737373', 'font-size': 10, 'font-family': 'Inter Tight, Arial, sans-serif' }, svg);
      t.textContent = fmtShort(v);
    }
    // x labels — about 8
    const step = Math.max(1, Math.ceil(labels.length / 8));
    labels.forEach((lb, i) => {
      if (i % step !== 0) return;
      const x = plot.x + plot.w * (i + 0.5) / labels.length;
      const t = el('text', { x, y: plot.y + plot.h + 16, 'text-anchor': 'middle', fill: '#737373', 'font-size': 9, 'font-family': 'Inter Tight, Arial, sans-serif' }, svg);
      t.textContent = lb.toUpperCase();
    });
  }

  // stacked bars: series = [{name, data[]}]
  function stackedBars(container, labels, series, opts = {}) {
    const W = 720, H = 300, P = { l: 52, r: 8, t: 12, b: 28 };
    const { svg, plot } = frame(W, H, P);
    const n = labels.length;
    const totals = labels.map((_, m) => series.reduce((s, sr) => s + (sr.data[m] || 0), 0));
    const maxV = Math.max(1, ...totals) * 1.05;
    axes(svg, plot, labels, maxV);
    const bw = plot.w / n * 0.66;
    for (let m = 0; m < n; m++) {
      let acc = 0;
      const x = plot.x + plot.w * (m + 0.5) / n - bw / 2;
      series.forEach((sr, si) => {
        const v = sr.data[m] || 0; if (v <= 0) { return; }
        const h = plot.h * v / maxV;
        const y = plot.y + plot.h - plot.h * acc / maxV - h;
        el('rect', { x, y, width: bw, height: Math.max(0.5, h), fill: sr.color || (si === 0 ? ACCENT : GREYS[si % GREYS.length]) }, svg);
        acc += v;
      });
    }
    render(container, svg, series.map((sr, si) => ({ name: sr.name, color: sr.color || (si === 0 ? ACCENT : GREYS[si % GREYS.length]) })), opts.title);
    monthBands(svg, plot, container, labels, m => {
      const rows = series.filter(sr => (sr.data[m] || 0) > 0).map(sr => `${sr.name}  ${fmtVal(sr.data[m])}`);
      return `${labels[m].toUpperCase()}\n${rows.join('\n')}\nTOTAL  ${fmtVal(totals[m])}`;
    });
  }

  // multi-line chart: series = [{name, data[], accent?}]
  function lines(container, labels, series, opts = {}) {
    const W = 720, H = 300, P = { l: 52, r: 8, t: 12, b: 28 };
    const { svg, plot } = frame(W, H, P);
    const all = series.flatMap(s => s.data).filter(v => v != null && !Number.isNaN(v));
    const maxV = Math.max(1, ...all) * 1.05;
    const minV = Math.min(0, ...all);
    axes(svg, plot, labels, maxV, minV);
    const X = i => plot.x + plot.w * (i + 0.5) / labels.length;
    const Y = v => plot.y + plot.h - plot.h * (v - minV) / (maxV - minV);
    series.forEach((sr, si) => {
      const color = sr.accent ? ACCENT : (sr.color || GREYS[si % GREYS.length]);
      let d = '', pen = false;
      sr.data.forEach((v, i) => {
        if (v == null || Number.isNaN(v)) { pen = false; return; }
        d += `${pen ? 'L' : 'M'}${X(i)},${Y(v)} `;
        pen = true;
      });
      el('path', { d, fill: 'none', stroke: color, 'stroke-width': sr.accent ? 2.5 : 1.5, 'stroke-dasharray': sr.dashed ? '6 5' : 'none' }, svg);
      if (sr.dots) sr.data.forEach((v, i) => { if (v != null && !Number.isNaN(v)) el('circle', { cx: X(i), cy: Y(v), r: 3.5, fill: color }, svg); });
    });
    if (opts.threshold != null) {
      el('line', { x1: plot.x, y1: Y(opts.threshold), x2: plot.x + plot.w, y2: Y(opts.threshold), stroke: ACCENT, 'stroke-width': 1, 'stroke-dasharray': '6 4' }, svg);
    }
    render(container, svg, series.map((sr, si) => ({ name: sr.name, color: sr.accent ? ACCENT : (sr.color || GREYS[si % GREYS.length]) })), opts.title);
    monthBands(svg, plot, container, labels, m => {
      const rows = series.filter(sr => sr.data[m] != null && !Number.isNaN(sr.data[m])).map(sr => `${sr.name}  ${fmtVal(sr.data[m])}`);
      return `${labels[m].toUpperCase()}\n${rows.join('\n')}`;
    });
  }

  // step area for headcount
  function steps(container, labels, series, opts = {}) {
    const W = 720, H = 300, P = { l: 52, r: 8, t: 12, b: 28 };
    const { svg, plot } = frame(W, H, P);
    const totals = labels.map((_, m) => series.reduce((s, sr) => s + (sr.data[m] || 0), 0));
    const maxV = Math.max(1, ...totals) * 1.1;
    axes(svg, plot, labels, maxV);
    const n = labels.length;
    const X = i => plot.x + plot.w * i / n;
    const Y = v => plot.y + plot.h - plot.h * v / maxV;
    // stacked step areas
    const acc = zerosN(n);
    series.forEach((sr, si) => {
      const color = sr.color || (si === 0 ? ACCENT : GREYS[si % GREYS.length]);
      let d = '';
      for (let i = 0; i < n; i++) d += `${i ? 'L' : 'M'}${X(i)},${Y(acc[i] + sr.data[i])} L${X(i + 1)},${Y(acc[i] + sr.data[i])} `;
      for (let i = n - 1; i >= 0; i--) d += `L${X(i + 1)},${Y(acc[i])} L${X(i)},${Y(acc[i])} `;
      el('path', { d: d + 'Z', fill: color, 'fill-opacity': si === 0 ? 0.9 : 0.85, stroke: 'none' }, svg);
      for (let i = 0; i < n; i++) acc[i] += sr.data[i];
    });
    render(container, svg, series.map((sr, si) => ({ name: sr.name, color: sr.color || (si === 0 ? ACCENT : GREYS[si % GREYS.length]) })), opts.title);
    monthBands(svg, plot, container, labels, m => {
      const rows = series.filter(sr => (sr.data[m] || 0) > 0).map(sr => `${sr.name}  ${fmtVal(sr.data[m])}`);
      return `${labels[m].toUpperCase()}\n${rows.join('\n')}\nTOTAL  ${fmtVal(totals[m])}`;
    });
  }

  function zerosN(n) { return new Array(n).fill(0); }

  function render(container, svg, legend, title) {
    container.innerHTML = '';
    if (title) {
      const t = document.createElement('div');
      t.className = 'mono-label'; t.style.marginBottom = '.75rem';
      t.textContent = title;
      container.appendChild(t);
    }
    container.appendChild(svg);
    if (legend && legend.length > 1) {
      const lg = document.createElement('div'); lg.className = 'chart-legend';
      legend.forEach(l => {
        const li = document.createElement('span'); li.className = 'li';
        li.innerHTML = `<span class="sw" style="background:${l.color}"></span>${l.name}`;
        lg.appendChild(li);
      });
      container.appendChild(lg);
    }
  }

  // sensitivity tornado: items = [{label, low, high}] — deltas vs base
  function tornado(container, items, opts = {}) {
    const rowH = 34, P = { l: 240, r: 70, t: 8, b: 26 };
    const W = 760, Hh = P.t + P.b + items.length * rowH;
    const svg = el('svg', { viewBox: `0 0 ${W} ${Hh}`, preserveAspectRatio: 'xMidYMid meet' });
    const span = (W - P.l - P.r) / 2;
    const maxAbs = Math.max(1e-9, ...items.flatMap(it => [Math.abs(it.low), Math.abs(it.high)]));
    const cx = P.l + span;
    items.forEach((it, i) => {
      const y = P.t + i * rowH + rowH / 2;
      const t = el('text', { x: P.l - 10, y: y + 4, 'text-anchor': 'end', fill: '#FAFAFA', 'font-size': 12, 'font-family': 'Inter Tight, sans-serif' }, svg);
      t.textContent = it.label;
      [[it.low, '#737373'], [it.high, ACCENT]].forEach(([v, color], vi) => {
        const wpx = Math.abs(v) / maxAbs * span * 0.95;
        const x = v < 0 ? cx - wpx : cx;
        const bar = el('rect', { x, y: y - 9, width: Math.max(1, wpx), height: 18, fill: color }, svg);
        bar.addEventListener('mousemove', e => hoverTip(container).show(e, `${it.label}\n${vi === 0 ? 'DOWNSIDE' : 'UPSIDE'}  ${(v >= 0 ? '+' : '−')}${fmtVal(Math.abs(v))}`));
        bar.addEventListener('mouseleave', () => hoverTip(container).hide());
        const lx = v < 0 ? cx - wpx - 6 : cx + wpx + 6;
        const tv = el('text', { x: lx, y: y + 4, 'text-anchor': v < 0 ? 'end' : 'start', fill: '#A6A6A6', 'font-size': 10, 'font-family': 'Inter Tight, Arial, sans-serif' }, svg);
        tv.textContent = (v >= 0 ? '+' : '−') + fmtShort(Math.abs(v));
      });
    });
    el('line', { x1: cx, y1: P.t, x2: cx, y2: Hh - P.b, stroke: '#404040', 'stroke-width': 1 }, svg);
    const cap = el('text', { x: cx, y: Hh - 8, 'text-anchor': 'middle', fill: '#737373', 'font-size': 10, 'font-family': 'Inter Tight, Arial, sans-serif' }, svg);
    cap.textContent = (opts.baseLabel || 'BASE').toUpperCase();
    render(container, svg, null, opts.title);
  }

  // revenue-bridge waterfall: steps = [{name, value, kind:'start'|'up'|'down'|'end'}]
  // opts: {title, goal} — goal draws a dashed target line against the final bar
  function waterfall(container, steps, opts = {}) {
    const W = 720, H = 280, P = { l: 56, r: 10, t: 16, b: 40 };
    const { svg, plot } = frame(W, H, P);
    // running levels
    let run = 0;
    const bars = steps.map(s => {
      if (s.kind === 'start') { run = s.value; return { ...s, y0: 0, y1: s.value }; }
      if (s.kind === 'end') return { ...s, y0: 0, y1: s.value };
      const y0 = run; run += (s.kind === 'down' ? -1 : 1) * Math.abs(s.value);
      return { ...s, y0: Math.min(y0, run), y1: Math.max(y0, run) };
    });
    const maxV = Math.max(...bars.map(b => b.y1), opts.goal || 0) * 1.08 || 1;
    const yPix = v => plot.y + plot.h - (plot.h * v / maxV);
    // gridlines
    for (let i = 0; i <= 4; i++) {
      const gy = plot.y + plot.h - (plot.h * i / 4);
      el('line', { x1: plot.x, y1: gy, x2: plot.x + plot.w, y2: gy, stroke: '#262626', 'stroke-width': 1 }, svg);
      const t = el('text', { x: plot.x - 8, y: gy + 3, 'text-anchor': 'end', fill: '#737373', 'font-size': 10, 'font-family': 'Inter Tight, Arial, sans-serif' }, svg);
      t.textContent = fmtShort(maxV * i / 4);
    }
    const n = bars.length, slot = plot.w / n, bw = Math.min(64, slot * 0.6);
    bars.forEach((b, i) => {
      const x = plot.x + slot * i + (slot - bw) / 2;
      const fill = b.kind === 'down' ? ACCENT : (b.kind === 'start' ? GREYS[3] : (b.kind === 'end' ? GREYS[0] : GREYS[2]));
      const bar = el('rect', { x, y: yPix(b.y1), width: bw, height: Math.max(1, yPix(b.y0) - yPix(b.y1)), fill, 'data-wf': i }, svg);
      const runLevel = b.kind === 'down' ? b.y0 : b.y1;
      bar.addEventListener('mousemove', e => hoverTip(container).show(e, `${b.name.toUpperCase()}\n${b.kind === 'down' ? '−' : (b.kind === 'up' ? '+' : '')}${fmtVal(Math.abs(b.value))}${b.kind === 'up' || b.kind === 'down' ? `\nRUNNING  ${fmtVal(runLevel)}` : ''}`));
      bar.addEventListener('mouseleave', () => hoverTip(container).hide());
      // connector to next bar
      if (i < n - 1) {
        const lvl = b.kind === 'down' ? b.y0 : b.y1;
        const lvlNext = bars[i + 1].kind === 'end' ? bars[i + 1].y1 : (bars[i + 1].kind === 'down' ? bars[i + 1].y1 : bars[i + 1].y0);
        el('line', { x1: x + bw, y1: yPix(lvl), x2: plot.x + slot * (i + 1) + (slot - bw) / 2, y2: yPix(lvlNext), stroke: '#525252', 'stroke-width': 1, 'stroke-dasharray': '3 3' }, svg);
      }
      // value label
      const vt = el('text', { x: x + bw / 2, y: yPix(b.y1) - 5, 'text-anchor': 'middle', fill: b.kind === 'down' ? ACCENT : '#A3A3A3', 'font-size': 10, 'font-family': 'Inter Tight, Arial, sans-serif' }, svg);
      vt.textContent = (b.kind === 'down' ? '−' : (b.kind === 'up' ? '+' : '')) + fmtShort(Math.abs(b.value));
      // name label
      const nt = el('text', { x: x + bw / 2, y: plot.y + plot.h + 16, 'text-anchor': 'middle', fill: '#737373', 'font-size': 9, 'font-family': 'Inter Tight, Arial, sans-serif' }, svg);
      nt.textContent = b.name.toUpperCase();
    });
    // goal line
    if (opts.goal) {
      const gy = yPix(opts.goal);
      el('line', { x1: plot.x, y1: gy, x2: plot.x + plot.w, y2: gy, stroke: ACCENT, 'stroke-width': 1.5, 'stroke-dasharray': '6 4' }, svg);
      const gt = el('text', { x: plot.x + plot.w - 4, y: gy - 5, 'text-anchor': 'end', fill: ACCENT, 'font-size': 10, 'font-family': 'Inter Tight, Arial, sans-serif' }, svg);
      gt.textContent = 'GOAL ' + fmtShort(opts.goal);
    }
    render(container, svg, null, opts.title);
  }

  root.Charts = { stackedBars, lines, steps, tornado, waterfall, GREYS, ACCENT, fmtShort, fmtVal };
})(window);
