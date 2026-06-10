import { pct } from './utils/helpers.js';

// ─── Todos os gráficos são SVG/HTML puro, sem bibliotecas externas ────────────
// Gerados como strings HTML e injetados via innerHTML. Isso mantém zero
// dependências externas (além do SheetJS para leitura de Excel).

// ─── Donut ────────────────────────────────────────────────────────────────────
// data: array de { label, value, color }
// Usa <circle> com stroke-dasharray para desenhar cada segmento;
// stroke-dashoffset acumula a posição de início de cada arco.
export function donut(data, opts = {}) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (!total) return '<div style="font-size:12px;color:var(--ink4)">Sem dados</div>';
  const R = 54, C = 2 * Math.PI * R, sw = 22;
  let off = 0;
  const segs = data.filter(d => d.value > 0).map(d => {
    const frac = d.value / total, len = frac * C;
    const s = `<circle r="${R}" cx="64" cy="64" fill="none" stroke="${d.color}" stroke-width="${sw}"
      stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-off}" transform="rotate(-90 64 64)"/>`;
    off += len;
    return s;
  }).join('');
  const legend = data.filter(d => d.value > 0).map(d =>
    `<div class="dleg"><span class="dleg-dot" style="background:${d.color}"></span>${d.label}
     <b>${d.value}</b><span class="dpct">${pct(d.value, total)}%</span></div>`).join('');
  return `<div class="donut-wrap">
    <svg width="128" height="128" viewBox="0 0 128 128" style="flex-shrink:0">${segs}
      <text x="64" y="60" text-anchor="middle" font-family="Syne" font-size="26" font-weight="600" fill="var(--ink)">${total}</text>
      <text x="64" y="78" text-anchor="middle" font-size="9" fill="var(--ink4)" letter-spacing="1">TOTAL</text>
    </svg>
    <div class="donut-legend">${legend}</div></div>`;
}

// ─── Barras horizontais simples ───────────────────────────────────────────────
// entries: array de [label, value]
// opts: { max, lw (largura mínima do label), tot (para % lateral), color, fixedLabel, showTotal }
export function hbars(entries, opts = {}) {
  const items = entries.slice(0, opts.max || 10);
  const mx = items.length ? Math.max(...items.map(e => e[1])) : 1;
  const lw = opts.lw || 90;
  const labelStyle = opts.fixedLabel
    ? `width:${lw}px;min-width:${lw}px;max-width:${lw}px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap`
    : `min-width:${lw}px`;
  const h = items.map(([l, v]) => {
    const w = Math.round(v / mx * 100);
    const p = opts.tot ? `<span class="hbar-pct">${pct(v, opts.tot)}%</span>` : '';
    const col = opts.color || 'var(--accent)';
    return `<div class="hbar-row"><span class="hbar-lbl" style="${labelStyle}" title="${String(l).replace(/"/g, '')}">${l}</span>
      <div class="hbar-track"><div class="hbar-fill" style="width:${w}%;background:${col}"></div></div>
      <span class="hbar-val">${v}</span>${p}</div>`;
  }).join('');
  if (!h) return '<div style="font-size:12px;color:var(--ink4)">Sem dados</div>';
  const header = opts.showTotal
    ? `<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid var(--rule)">
    <span style="font-size:11px;color:var(--ink4)">${opts.totLabel || 'Total'}</span>
    <span style="font-family:'Syne';font-size:18px;font-weight:600;color:var(--ink)">${opts.showTotal}</span></div>`
    : '';
  return header + h;
}

// ─── Barras empilhadas finas ──────────────────────────────────────────────────
// rows: array de { label, valores: {chaveSeg: n} }
// segDefs: array ordenado de { key, label, color }
// A barra mostra a proporção em cores; os números de cada segmento ficam ao lado.
export function stackedBars(rows, segDefs) {
  if (!rows.length) return '<div style="font-size:12px;color:var(--ink4)">Sem dados</div>';
  const totais = rows.map(r => segDefs.reduce((s, d) => s + (r.valores[d.key] || 0), 0));
  const maxTot = Math.max(...totais, 1);
  const corpo = rows.map((r, idx) => {
    const tot = totais[idx];
    const larguraBarra = Math.round(tot / maxTot * 100);
    const segs = segDefs.map(d => {
      const n = r.valores[d.key] || 0;
      if (!n) return '';
      return `<div class="sbar-seg" style="flex:0 0 ${(n / tot * 100).toFixed(2)}%;background:${d.color}" title="${d.label}: ${n}"></div>`;
    }).join('');
    const nums = segDefs.map(d => {
      const n = r.valores[d.key] || 0;
      return `<span class="sn${n ? '' : ' sn-z'}" title="${d.label}"><span class="sn-dot" style="background:${d.color}"></span>${n}</span>`;
    }).join('');
    return `<div class="sbar-row">
      <span class="sbar-lbl" title="${String(r.label).replace(/"/g, '')}">${r.label}</span>
      <div class="sbar-track" style="max-width:${larguraBarra}%">${segs}</div>
      <span class="sbar-nums">${nums}</span>
      <span class="sbar-tot">${tot}</span>
    </div>`;
  }).join('');
  const legenda = segDefs.map(d =>
    `<div class="sbar-leg"><span class="sbar-leg-dot" style="background:${d.color}"></span>${d.label}</div>`
  ).join('');
  return corpo + `<div class="sbar-legend">${legenda}</div>`;
}

// ─── Barras clusterizadas ─────────────────────────────────────────────────────
// groups: array de { label, color, valores: {serieKey: n} }
// series: array ordenado de { key, label, color }
// Cada grupo = um bloco com título; dentro há uma barra fina por série.
// Escala global: todas as barras compartilham o mesmo máximo.
export function clusteredBars(groups, series) {
  if (!groups.length) return '<div style="font-size:12px;color:var(--ink4)">Sem dados</div>';
  let maxVal = 1;
  groups.forEach(g => series.forEach(s => { maxVal = Math.max(maxVal, g.valores[s.key] || 0); }));
  const corpo = groups.map(g => {
    const totGrupo = series.reduce((acc, s) => acc + (g.valores[s.key] || 0), 0);
    const barras = series.map(s => {
      const n = g.valores[s.key] || 0;
      if (!n) return '';
      return `<div class="clu-bar-row">
        <span class="clu-bar-lbl" title="${String(s.label).replace(/"/g, '')}">${s.label}</span>
        <div class="clu-bar-track"><div class="clu-bar-fill" style="width:${Math.round(n / maxVal * 100)}%;background:${s.color}"></div></div>
        <span class="clu-bar-val">${n}</span>
      </div>`;
    }).join('');
    return `<div class="clu-group">
      <div class="clu-group-title"><span class="clu-gt-dot" style="background:${g.color || 'var(--ink3)'}"></span>${g.label}<span class="clu-gt-tot">${totGrupo} no total</span></div>
      ${barras || '<div class="clu-bar-row"><span style="font-size:11px;color:var(--ink4);padding-left:17px">nenhum chamado nesta fase</span></div>'}
    </div>`;
  }).join('');
  const legenda = series.map(s =>
    `<div class="clu-leg"><span class="clu-leg-dot" style="background:${s.color}"></span>${s.label}</div>`
  ).join('');
  return corpo + `<div class="clu-legend">${legenda}</div>`;
}

// ─── Gráfico de linha SVG ─────────────────────────────────────────────────────
// points: array de { label, value }
// O gráfico só plota meses até o mês atual (não projeta futuro).
// Labels do eixo X: exibidos a cada N passos para evitar sobreposição.
export function lineChart(points, opts = {}) {
  if (points.length < 2) return '<div style="font-size:12px;color:var(--ink4)">Dados insuficientes para tendência</div>';
  const W = opts.w || 560, H = opts.h || 140, pad = { l: 32, r: 12, t: 12, b: 24 };
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  const max = opts.max != null ? opts.max : Math.max(...points.map(p => p.value), 1);
  const min = opts.min != null ? opts.min : 0;
  const x = i => pad.l + (i / (points.length - 1)) * iw;
  const y = v => pad.t + ih - ((v - min) / (max - min || 1)) * ih;
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(' ');
  const area = `${path} L${x(points.length - 1)} ${pad.t + ih} L${pad.l} ${pad.t + ih} Z`;
  const dots = points.map((p, i) => {
    const step = Math.ceil(points.length / 7);
    const showVal = points.length <= 7 || i % step === 0 || i === points.length - 1;
    return `<circle cx="${x(i)}" cy="${y(p.value)}" r="3" fill="var(--surface)" stroke="var(--info)" stroke-width="2"/>
    ${showVal ? `<text x="${x(i)}" y="${y(p.value) - 9}" text-anchor="middle" font-size="9" font-weight="600" fill="var(--ink2)">${opts.fmt ? opts.fmt(p.value) : p.value}</text>` : ''}`;
  }).join('');
  const xl = points.map((p, i) => {
    const step = Math.ceil(points.length / 7);
    const isShown = points.length <= 7 || i % step === 0;
    const isLast = i === points.length - 1;
    const lastShownByStep = Math.floor((points.length - 1) / step) * step;
    const lastTooClose = isLast && (points.length - 1 - lastShownByStep) < step * 0.6;
    if (!isShown && !(isLast && !lastTooClose)) return '';
    if (isLast && lastTooClose) return '';
    return `<text x="${x(i)}" y="${H - 6}" text-anchor="middle" font-size="9" fill="var(--ink4)">${p.label}</text>`;
  }).join('');
  const grid = [0, .25, .5, .75, 1].map(f => {
    const yy = pad.t + ih - f * ih;
    const val = Math.round(min + f * (max - min));
    return `<line x1="${pad.l}" y1="${yy}" x2="${W - pad.r}" y2="${yy}" stroke="var(--rule)" stroke-width="1"/>
      <text x="${pad.l - 6}" y="${yy + 3}" text-anchor="end" font-size="8" fill="var(--ink4)">${opts.pctAxis ? val + '%' : val}</text>`;
  }).join('');
  return `<svg width="100%" viewBox="0 0 ${W} ${H}" style="overflow:visible">
    ${grid}<path d="${area}" fill="var(--info)" opacity="0.08"/>
    <path d="${path}" fill="none" stroke="var(--info)" stroke-width="2" stroke-linejoin="round"/>${dots}${xl}</svg>`;
}

// ─── Heatmap ──────────────────────────────────────────────────────────────────
// matrix[r][c] = valor numérico
// Intensidade da cor: rgba() com opacidade variável (de quase branco ao vermelho).
export function heatmap(matrix, rowLabels, colLabels, opts = {}) {
  const flat = matrix.flat().filter(v => v > 0);
  const mx = flat.length ? Math.max(...flat) : 1;
  const color = v => {
    if (!v) return 'var(--neu-bg)';
    const op = (0.12 + (v / mx) * 0.78).toFixed(2);
    return `rgba(199, 93, 93, ${op})`;
  };
  let html = '<table class="hm"><thead><tr><th class="rh"></th>' + colLabels.map(c => `<th>${c}</th>`).join('') + '</tr></thead><tbody>';
  matrix.forEach((row, r) => {
    html += `<tr><td class="rl">${rowLabels[r]}</td>` + row.map(v =>
      `<td><div class="cell" style="background:${color(v)};color:${v / mx > 0.55 ? '#fff' : 'var(--ink2)'}">${v || ''}</div></td>`
    ).join('') + '</tr>';
  });
  html += '</tbody></table>';
  return html;
}
