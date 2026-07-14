// ─── MODULE: charts.js ─────────────────────────────────────────────────────
// Chart.js wrappers + a couple of pure-HTML/CSS chart-like components
// (clusteredBars, heatmap).
//
// Usage pattern:
//   1. Chart functions return a <canvas id="..."> as part of the
//      HTML string and register the config in _pendingCharts.
//   2. After each innerHTML injection, flushCharts() instantiates
//      all pending charts.
//   3. Previous instances are destroyed before recreating
//      (avoids the "Canvas already in use" error).
// ─────────────────────────────────────────────────────────────────────────────

import { calculatePercentage } from './utils/helpers.js';
import { toYearMonthLabel } from './utils/date.js';

// Queue of configs waiting to be initialized after HTML injection
let _pendingCharts = [];

// Active Chart.js instances, indexed by canvas id
const _chartInstances = {};

// Counter for unique canvas ids per render cycle
let _chartSeq = 0;
export function _generateChartId(prefix) { return `ch-${prefix}-${++_chartSeq}`; }

/*
 * registerChart(id, config) — queues a raw Chart.js config for
 * instantiation on the next flushCharts() call. Used by modules (ex:
 * views/mel.js's construirGraficoEvolucaoMelhorias) that need a bespoke
 * chart/plugin setup not covered by the donut/horizontalBars/lineChart/etc.
 * wrappers below, without exposing the _pendingCharts queue itself.
 */
export function registerChart(id, config) { _pendingCharts.push({ id, config }); }

/*
 * resetCharts() — destroys every live Chart.js instance and resets the id
 * counter. Called once by main.js's generate() at the start of each
 * dashboard regeneration, to avoid the "Canvas already in use" error.
 */
export function resetCharts() {
  Object.values(_chartInstances).forEach(ch => { try { ch.destroy(); } catch(_){} });
  Object.keys(_chartInstances).forEach(k => delete _chartInstances[k]);
  _chartSeq = 0;
}

/*
 * flushCharts() — instantiates all pending charts.
 * Call right after every innerHTML assignment.
 */
export function flushCharts() {
  _pendingCharts.forEach(({ id, config }) => {
    const el = document.getElementById(id);
    if (!el) return;
    try {
      if (_chartInstances[id]) _chartInstances[id].destroy();
      _chartInstances[id] = new Chart(el, config);
    } catch (e) {
      console.error(`flushCharts: falha ao criar gráfico ${id}`, e);
    }
  });
  _pendingCharts = [];

  // Animates freshly rendered KPIs (the data-an attribute avoids re-animating)
  document.querySelectorAll('.knum:not([data-an])').forEach(el => {
    el.dataset.an = '1';
    _animateNumber(el);
  });
}

/*
 * _animateNumber(el) — counts the number from 0 up to the displayed value over ~850ms.
 * Extracts the number from the text (int or float), animates with a cubic
 * ease-out, and restores the exact original text at the end.
 * Values smaller than 2 are skipped (0 and 1 don't need animating).
 */
export function _animateNumber(el) {
  const raw   = el.textContent.trim();
  const match = raw.match(/^(\d+\.?\d*)(.*)/);
  if (!match) return;
  const target  = parseFloat(match[1]);
  const suffix  = match[2];
  const isFloat = match[1].includes('.');
  if (!target || target < 2) return;

  const duration = 850;
  const start    = performance.now();

  (function frame(now) {
    const progress = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3); // cubic ease-out: starts fast, decelerates
    el.textContent = (isFloat ? (target * eased).toFixed(1) : Math.round(target * eased)) + suffix;
    if (progress < 1) requestAnimationFrame(frame);
    else el.textContent = raw; // restores the exact text (avoids residual rounding)
  })(start);
}

// Global Chart.js defaults
Chart.defaults.font.family = "'Inter', system-ui, sans-serif";
Chart.defaults.font.size   = 11;
Chart.defaults.color       = '#6B7280';

// Saint-Gobain palette in hex (CSS vars don't work inside Chart.js)
export const CHART_COLORS = {
  brand:  '#0F5299',  // dark blue
  accent: '#0195D6',  // bright blue
  teal:   '#4DB1B3',  // teal
  orange: '#E66407',  // orange
  red:    '#E83430',  // red
  ok:     '#0d8f91',  // dark teal (ok text)
  warn:   '#C55800',  // dark orange (warn text)
  err:    '#C5284C',  // pink-red
  ink:    '#111827',
  ink2:   '#374151',
  ink3:   '#6B7280',
  ink4:   '#9CA3AF',
  rule:   'rgba(15,82,153,0.07)',
};

// Resolves theme CSS variables to hex — needed to pass colors to Chart.js
export function resolveColor(color) {
  const map = {
    'var(--brand)':  CHART_COLORS.brand,
    'var(--accent)': CHART_COLORS.accent,
    'var(--ok)':     CHART_COLORS.ok,
    'var(--warn)':   CHART_COLORS.warn,
    'var(--err)':    CHART_COLORS.err,
    'var(--info)':   CHART_COLORS.brand,
    'var(--neu)':    '#9CA3AF',
    'var(--ink)':    CHART_COLORS.ink,
    'var(--ink2)':   CHART_COLORS.ink2,
    'var(--ink3)':   CHART_COLORS.ink3,
    'var(--ink4)':   CHART_COLORS.ink4,
  };
  return map[color] || color;
}

/*
 * donut(data, opts) — donut chart via Chart.js
 * data: array of { label, value, color }
 */
export function donut(data, opts = {}) {
  const filtered   = data.filter(d => d.value > 0);
  const total      = filtered.reduce((s, d) => s + d.value, 0);
  const totalLabel = opts.total != null ? opts.total : total; // total shown in the center (can be overridden)
  if (!total) return '<div style="font-size:12px;color:var(--ink4)">Sem dados</div>';

  const id = _generateChartId('donut');

  _pendingCharts.push({
    id,
    config: {
      type: 'doughnut',
      data: {
        labels: filtered.map(d => d.label),
        datasets: [{
          data:            filtered.map(d => d.value),
          backgroundColor: filtered.map(d => resolveColor(d.color)),
          borderWidth:     0,
          hoverOffset:     4,
        }]
      },
      options: {
        cutout:     '68%',
        responsive: false,
        animation:  { duration: 400 },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: ctx => ` ${ctx.label}: ${ctx.parsed}  (${calculatePercentage(ctx.parsed, total)}%)`
            }
          }
        }
      }
    }
  });

  const legend = filtered.map(d =>
    `<div class="dleg">
      <span class="dleg-dot" style="background:${d.color}"></span>
      ${d.label}
      <b>${d.value}</b>
      <span class="dpct">${calculatePercentage(d.value, total)}%</span>
    </div>`
  ).join('');

  return `<div class="donut-wrap">
    <div style="position:relative;width:130px;height:130px;flex-shrink:0">
      <canvas id="${id}" width="130" height="130"></canvas>
      <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;pointer-events:none">
        <div style="font-family:'Syne',sans-serif;font-size:26px;font-weight:600;color:var(--ink);line-height:1">${totalLabel}</div>
        <div style="font-size:9px;color:var(--ink4);letter-spacing:1px;margin-top:2px">TOTAL</div>
      </div>
    </div>
    <div class="donut-legend">${legend}</div>
  </div>`;
}

/*
 * horizontalBars(entries, opts) — horizontal bars via Chart.js
 * entries: array of [label, value]
 * opts: { max, tot, color, showTotal, totLabel, lw }
 * lw: minimum Y-axis width (calculated automatically; opts.lw is used as an extra minimum).
 */
export function horizontalBars(entries, opts = {}) {
  const items = entries.slice(0, opts.max || 10);
  if (!items.length) return '<div style="font-size:12px;color:var(--ink4)">Sem dados</div>';

  const id  = _generateChartId('hbar');
  const col = resolveColor(opts.color || 'var(--accent)');
  const tot = opts.tot || null;

  // Splits labels on the "  ·  " separator to show bot and area on two lines
  const splitLabel = l => {
    const parts = String(l).split(/\s+·\s+/);
    return parts.length > 1 ? parts : l;
  };

  // For labels with a "·" separator (bot  ·  area): computes the minimum needed to avoid clipping.
  // For other labels: uses opts.lw exactly, with no automatic expansion.
  const hasMultiline = items.some(([l]) => String(l).includes('·'));
  const minLwDots = hasMultiline ? Math.ceil(Math.max(...items.map(([l]) => {
    const parts = String(l).split(/\s+·\s+/);
    return Math.max(...parts.map(p => p.length));
  })) * 6.5) + 24 : 0;
  const lw = opts.lw ? Math.max(opts.lw, minLwDots) : (minLwDots || undefined);

  _pendingCharts.push({
    id,
    config: {
      type: 'bar',
      data: {
        labels: items.map(([l]) => splitLabel(l)),
        datasets: [{
          data:            items.map(([, v]) => v),
          backgroundColor: col,
          borderRadius:    3,
          borderSkipped:   false,
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 300 },
        plugins: {
          legend:  { display: false },
          tooltip: { display: false },
        },
        layout: {
          padding: { right: tot ? 90 : 52 }
        },
        scales: {
          x: {
            grid:   { color: CHART_COLORS.rule },
            border: { display: false },
            ticks:  { display: false }
          },
          y: {
            grid:   { display: false },
            border: { display: false },
            ticks:  { color: CHART_COLORS.ink2, font: { size: 11 } },
            afterFit(scale) { if (lw) scale.width = lw; }
          }
        }
      },
      plugins: [{
        id: 'hbarLabels',
        afterDatasetsDraw(chart) {
          const { ctx, chartArea, data } = chart;
          const meta = chart.getDatasetMeta(0);
          ctx.save();
          ctx.fillStyle    = CHART_COLORS.ink2;
          ctx.font         = `500 11px 'Inter', system-ui, sans-serif`;
          ctx.textAlign    = 'left';
          ctx.textBaseline = 'middle';
          // All labels stay aligned in the same X column (right after the longest bar)
          // avoids labels of short bars ending up in the middle of the chart
          const xBase = chartArea.right + 6;
          data.datasets[0].data.forEach((value, i) => {
            const bar   = meta.data[i];
            const label = tot
              ? `${value}  (${calculatePercentage(value, tot)}%)`
              : String(value);
            ctx.fillText(label, xBase, bar.y);
          });
          ctx.restore();
        }
      }]
    }
  });

  const heightPerBar = hasMultiline ? 56 : (opts.lw ? 48 : 36);
  const height = Math.max(items.length * heightPerBar + 20, 70);
  const header = opts.showTotal
    ? `<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid var(--rule)">
        <span style="font-size:11px;color:var(--ink4)">${opts.totLabel || 'Total'}</span>
        <span style="font-family:'Syne';font-size:18px;font-weight:600;color:var(--ink)">${opts.showTotal}</span>
      </div>`
    : '';

  return `${header}<div style="position:relative;height:${height}px"><canvas id="${id}"></canvas></div>`;
}

/*
 * clusteredBars(groups, series) — clustered (grouped) bar chart.
 * Each GROUP (ex: a phase) becomes a block with a title; inside it there's a
 * thin BAR for each series (ex: problem type), colored by the series.
 * All bars share the same scale (global maxVal) for comparison.
 * groups: array of { label, color, valores: {serieKey: n} }
 * series: ordered array of { key, label, color }
 * Bars with a value of 0 are omitted within the group, to avoid clutter.
 */
export function clusteredBars(groups, series){
  if(!groups.length) return '<div style="font-size:12px;color:var(--ink4)">Sem dados</div>';
  // global scale: largest value across all bars of all groups
  let maxVal = 1;
  groups.forEach(g => series.forEach(s => { maxVal = Math.max(maxVal, g.valores[s.key]||0); }));
  const corpo = groups.map(g => {
    const totGrupo = series.reduce((acc,s)=>acc+(g.valores[s.key]||0),0);
    const barras = series.map(s => {
      const value = g.valores[s.key]||0;
      if(!value) return ''; // omits zeroed-out series within the group
      const widthPct = Math.round(value/maxVal*100);
      return `<div class="clu-bar-row">
        <span class="clu-bar-lbl" title="${String(s.label).replace(/"/g,'')}">${s.label}</span>
        <div class="clu-bar-track"><div class="clu-bar-fill" style="width:${widthPct}%;background:${s.color}"></div></div>
        <span class="clu-bar-val">${value}</span>
      </div>`;
    }).join('');
    return `<div class="clu-group">
      <div class="clu-group-title"><span class="clu-gt-dot" style="background:${g.color||'var(--ink3)'}"></span>${g.label}<span class="clu-gt-tot">${totGrupo} no total</span></div>
      ${barras || '<div class="clu-bar-row"><span style="font-size:11px;color:var(--ink4);padding-left:17px">nenhum chamado nesta fase</span></div>'}
    </div>`;
  }).join('');
  const legenda = series.map(s =>
    `<div class="clu-leg"><span class="clu-leg-dot" style="background:${s.color}"></span>${s.label}</div>`
  ).join('');
  return corpo + `<div class="clu-legend">${legenda}</div>`;
}

/*
 * lineChart(points, opts) — line chart via Chart.js
 * points: array of { label, value }
 * opts: { pctAxis, max, min, fmt }
 *
 * NOTE: the chart only plots months up to the current one.
 * If the last point is in Apr/26, it's because there are no more
 * recent completions in the spreadsheet — it advances automatically once the base is updated.
 */
export function lineChart(points, opts = {}) {
  if (points.length < 2)
    return '<div style="font-size:12px;color:var(--ink4)">Dados insuficientes para tendência</div>';

  const id = _generateChartId('line');

  _pendingCharts.push({
    id,
    config: {
      type: 'line',
      data: {
        labels: points.map(p => p.label),
        datasets: [{
          data:                 points.map(p => p.value),
          borderColor:          CHART_COLORS.brand,
          backgroundColor:      'rgba(15,82,153,0.07)',
          borderWidth:          2,
          pointRadius:          3,
          pointBackgroundColor: '#fff',
          pointBorderColor:     CHART_COLORS.brand,
          pointBorderWidth:     2,
          fill:                 true,
          tension:              0.3,
        }]
      },
      options: {
        responsive:          true,
        maintainAspectRatio: false,
        animation:           { duration: 400 },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: ctx => opts.fmt
                ? ` ${opts.fmt(ctx.parsed.y)}`
                : ` ${ctx.parsed.y}`
            }
          }
        },
        scales: {
          x: {
            grid:   { display: false },
            border: { display: false },
            ticks:  { color: CHART_COLORS.ink4, font: { size: 9 }, maxTicksLimit: 8 }
          },
          y: {
            min:    opts.min ?? 0,
            max:    opts.max,
            grid:   { color: CHART_COLORS.rule },
            border: { display: false },
            ticks: {
              color:    CHART_COLORS.ink4,
              font:     { size: 9 },
              callback: v => opts.pctAxis ? v + '%' : v
            }
          }
        }
      }
    }
  });

  return `<div style="position:relative;height:160px"><canvas id="${id}"></canvas></div>`;
}

/*
 * verticalBarsChart(meses, porMes, porMesV) — stacked vertical bars of monthly volume.
 * Two datasets: normal tickets (brand blue) and overdue (red), stacked.
 * meses: array of ordered "YYYY-MM" keys
 * porMes / porMesV: objects { "YYYY-MM": count }
 */
export function verticalBarsChart(meses, porMes, porMesV) {
  const id      = _generateChartId('vbar');
  const labels  = meses.map(m => toYearMonthLabel(m));
  const totais  = meses.map(m => porMes[m]  || 0);
  const vencArr = meses.map(m => porMesV[m] || 0);
  const normais = totais.map((t, i) => t - vencArr[i]);

  _pendingCharts.push({
    id,
    config: {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label:           'Chamados',
            data:            normais,
            backgroundColor: 'rgba(15,82,153,0.25)',
            borderRadius:    { topLeft: 3, topRight: 3 },
            stack:           'vol',
          },
          {
            label:           'Vencidos',
            data:            vencArr,
            backgroundColor: 'rgba(197,40,76,0.75)',
            borderRadius:    { topLeft: 3, topRight: 3 },
            stack:           'vol',
          }
        ]
      },
      options: {
        responsive:          true,
        maintainAspectRatio: false,
        animation:           { duration: 300 },
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              boxWidth: 10, boxHeight: 10,
              borderRadius: 2, useBorderRadius: true,
              color: CHART_COLORS.ink4, padding: 14,
            }
          },
          tooltip: {
            callbacks: {
              footer: items => `Total: ${items.reduce((s, i) => s + i.parsed.y, 0)}`
            }
          }
        },
        scales: {
          x: {
            stacked: true,
            grid:    { display: false },
            border:  { display: false },
            ticks:   { color: CHART_COLORS.ink4, font: { size: 9 } }
          },
          y: {
            stacked: true,
            grid:    { color: CHART_COLORS.rule },
            border:  { display: false },
            ticks:   { color: CHART_COLORS.ink4 }
          }
        }
      }
    }
  });

  return `<div style="position:relative;height:200px"><canvas id="${id}"></canvas></div>`;
}

/*
 * heatmap(matrix, rowLabels, colLabels) — heat map table
 * matrix[r][c] = numeric value
 * Color intensity goes from near-white (low value) to red (max value).
 * Uses rgba() with variable opacity (works in any browser).
 * Zero values get a neutral background (no heat color).
 */
export function heatmap(matrix, rowLabels, colLabels, opts={}){
  const flat = matrix.flat().filter(v => v > 0);
  const mx = flat.length ? Math.max(...flat) : 1;
  const HEATMAP_MIN_OPACITY   = 0.12;
  const HEATMAP_OPACITY_RANGE = 0.78; // min + range = 0.90 (maximum intensity)
  const color = v => {
    if(!v) return 'var(--neu-bg)';
    const op = (HEATMAP_MIN_OPACITY + (v / mx) * HEATMAP_OPACITY_RANGE).toFixed(2);
    return `rgba(1, 149, 214, ${op})`; // Saint-Gobain accent blue
  };
  let html = '<table class="hm"><thead><tr><th class="rh"></th>'+colLabels.map(c=>`<th>${c}</th>`).join('')+'</tr></thead><tbody>';
  matrix.forEach((row,r) => {
    html += `<tr><td class="rl">${rowLabels[r]}</td>` + row.map(v =>
      `<td><div class="cell" style="background:${color(v)};color:${v/mx>0.55?'#fff':'var(--ink2)'}">${v||''}</div></td>`
    ).join('') + '</tr>';
  });
  html += '</tbody></table>';
  return html;
}
