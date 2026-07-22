// charts.js — wrappers do Chart.js + alguns componentes de gráfico em HTML/CSS puro
// (barrasAgrupadas, mapaCalor).
//
// Padrão de uso:
//   1. As funções de gráfico retornam um <canvas id="..."> como parte do HTML
//      e registram a config em _graficosPendentes.
//   2. Depois de cada innerHTML, renderizarGraficosPendentes() instancia todos os gráficos pendentes.
//   3. Instâncias anteriores são destruídas antes de recriar (evita o erro
//      "Canvas already in use").

import { calcularPercentual } from './utils/helpers.js';
import { paraRotuloAnoMes } from './utils/date.js';

// Fila de configs esperando pra serem inicializadas depois da injeção de HTML
let _graficosPendentes = [];

// Instâncias ativas do Chart.js, indexadas pelo id do canvas
const _instanciasGraficos = {};

// Contador pra gerar ids únicos de canvas a cada ciclo de renderização
let _seqGrafico = 0;
export function _gerarIdGrafico(prefix) { return `ch-${prefix}-${++_seqGrafico}`; }

// registrarGrafico(id, config) — enfileira uma config crua do Chart.js pra ser
// instanciada no próximo renderizarGraficosPendentes(). Usado por módulos (ex: o gráfico de
// evolução de views/mel.js) que precisam de um gráfico/plugin sob medida,
// fora do que os wrappers graficoRosca/barrasHorizontais/graficoLinha/etc. já cobrem.
export function registrarGrafico(id, config) { _graficosPendentes.push({ id, config }); }

// reiniciarGraficos() — destrói toda instância viva do Chart.js e zera o contador de id.
// Chamado uma vez por gerarDashboard() (main.js) no início de cada regeneração do
// dashboard, pra evitar o erro "Canvas already in use".
export function reiniciarGraficos() {
  Object.values(_instanciasGraficos).forEach(ch => { try { ch.destroy(); } catch(_){} });
  Object.keys(_instanciasGraficos).forEach(k => delete _instanciasGraficos[k]);
  _seqGrafico = 0;
}

// renderizarGraficosPendentes() — instancia todos os gráficos pendentes.
// Chamar logo depois de cada atribuição de innerHTML.
export function renderizarGraficosPendentes() {
  _graficosPendentes.forEach(({ id, config }) => {
    const el = document.getElementById(id);
    if (!el) return;
    try {
      if (_instanciasGraficos[id]) _instanciasGraficos[id].destroy();
      _instanciasGraficos[id] = new Chart(el, config);
    } catch (e) {
      console.error(`renderizarGraficosPendentes: falha ao criar gráfico ${id}`, e);
    }
  });
  _graficosPendentes = [];

  // Anima os KPIs recém-renderizados (o atributo data-an evita animar de novo)
  document.querySelectorAll('.knum:not([data-an])').forEach(el => {
    el.dataset.an = '1';
    _animarNumero(el);
  });
}

// _animarNumero(el) — conta do 0 até o valor exibido em ~850ms.
// Extrai o número do texto (inteiro ou float), anima com um ease-out cúbico,
// e no final restaura o texto original exato. Valores menores que 2 são
// ignorados (0 e 1 não precisam de animação).
export function _animarNumero(el) {
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
    const eased = 1 - Math.pow(1 - progress, 3); // ease-out cúbico: começa rápido, desacelera
    el.textContent = (isFloat ? (target * eased).toFixed(1) : Math.round(target * eased)) + suffix;
    if (progress < 1) requestAnimationFrame(frame);
    else el.textContent = raw; // restaura o texto exato (evita arredondamento residual)
  })(start);
}

// Defaults globais do Chart.js
Chart.defaults.font.family = "'Inter', system-ui, sans-serif";
Chart.defaults.font.size   = 11;
Chart.defaults.color       = '#6B7280';

// Paleta Saint-Gobain em hex (variáveis CSS não funcionam dentro do Chart.js)
export const CORES_GRAFICO = {
  brand:  '#0F5299',  // azul escuro
  accent: '#0195D6',  // azul vivo
  teal:   '#4DB1B3',  // verde-azulado
  orange: '#E66407',  // laranja
  red:    '#E83430',  // vermelho
  ok:     '#0d8f91',  // verde-azulado escuro (texto ok)
  warn:   '#C55800',  // laranja escuro (texto warn)
  err:    '#C5284C',  // vermelho-rosa
  ink:    '#111827',
  ink2:   '#374151',
  ink3:   '#6B7280',
  ink4:   '#9CA3AF',
  rule:   'rgba(15,82,153,0.07)',
};

// Resolve variáveis CSS de tema pra hex — necessário pra passar cores pro Chart.js
export function resolverCor(color) {
  const map = {
    'var(--brand)':  CORES_GRAFICO.brand,
    'var(--accent)': CORES_GRAFICO.accent,
    'var(--ok)':     CORES_GRAFICO.ok,
    'var(--warn)':   CORES_GRAFICO.warn,
    'var(--err)':    CORES_GRAFICO.err,
    'var(--info)':   CORES_GRAFICO.brand,
    'var(--neu)':    '#9CA3AF',
    'var(--ink)':    CORES_GRAFICO.ink,
    'var(--ink2)':   CORES_GRAFICO.ink2,
    'var(--ink3)':   CORES_GRAFICO.ink3,
    'var(--ink4)':   CORES_GRAFICO.ink4,
  };
  return map[color] || color;
}

// graficoRosca(data, opts) — gráfico de rosca (donut) via Chart.js
// data: array de { label, value, color }
export function graficoRosca(data, opts = {}) {
  const filtered   = data.filter(d => d.value > 0);
  const total      = filtered.reduce((s, d) => s + d.value, 0);
  const totalLabel = opts.total != null ? opts.total : total; // total exibido no centro (pode ser sobrescrito)
  if (!total) return '<div style="font-size:12px;color:var(--ink4)">Sem dados</div>';

  const id = _gerarIdGrafico('donut');

  _graficosPendentes.push({
    id,
    config: {
      type: 'doughnut',
      data: {
        labels: filtered.map(d => d.label),
        datasets: [{
          data:            filtered.map(d => d.value),
          backgroundColor: filtered.map(d => resolverCor(d.color)),
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
              label: ctx => ` ${ctx.label}: ${ctx.parsed}  (${calcularPercentual(ctx.parsed, total)}%)`
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
      <span class="dpct">${calcularPercentual(d.value, total)}%</span>
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

// barrasHorizontais(entries, opts) — barras horizontais via Chart.js
// entries: array de [label, value]
// opts: { max, tot, color, showTotal, totLabel, lw }
// lw: largura mínima do eixo Y (calculada automaticamente; opts.lw serve como mínimo extra).
export function barrasHorizontais(entries, opts = {}) {
  const items = entries.slice(0, opts.max || 10);
  if (!items.length) return '<div style="font-size:12px;color:var(--ink4)">Sem dados</div>';

  const id  = _gerarIdGrafico('hbar');
  const col = resolverCor(opts.color || 'var(--accent)');
  const tot = opts.tot || null;

  // Separa os rótulos no separador "  ·  " pra mostrar bot e área em duas linhas
  const splitLabel = l => {
    const parts = String(l).split(/\s+·\s+/);
    return parts.length > 1 ? parts : l;
  };

  // Pra rótulos com separador "·" (bot  ·  área): calcula o mínimo necessário pra não cortar o texto.
  // Pros demais rótulos: usa opts.lw exatamente, sem expansão automática.
  const hasMultiline = items.some(([l]) => String(l).includes('·'));
  const minLwDots = hasMultiline ? Math.ceil(Math.max(...items.map(([l]) => {
    const parts = String(l).split(/\s+·\s+/);
    return Math.max(...parts.map(p => p.length));
  })) * 6.5) + 24 : 0;
  const lw = opts.lw ? Math.max(opts.lw, minLwDots) : (minLwDots || undefined);

  _graficosPendentes.push({
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
            grid:   { color: CORES_GRAFICO.rule },
            border: { display: false },
            ticks:  { display: false }
          },
          y: {
            grid:   { display: false },
            border: { display: false },
            ticks:  { color: CORES_GRAFICO.ink2, font: { size: 11 } },
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
          ctx.fillStyle    = CORES_GRAFICO.ink2;
          ctx.font         = `500 11px 'Inter', system-ui, sans-serif`;
          ctx.textAlign    = 'left';
          ctx.textBaseline = 'middle';
          // Todos os rótulos ficam alinhados na mesma coluna X (logo depois da barra mais longa)
          // evita que rótulos de barras curtas fiquem no meio do gráfico
          const xBase = chartArea.right + 6;
          data.datasets[0].data.forEach((value, i) => {
            const bar   = meta.data[i];
            const label = tot
              ? `${value}  (${calcularPercentual(value, tot)}%)`
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
 * barrasAgrupadas(groups, series) — gráfico de barras agrupadas.
 * Cada GRUPO (ex: uma fase) vira um bloco com título; dentro dele há uma
 * BARRA fina pra cada série (ex: tipo de problema), colorida pela série.
 * Todas as barras compartilham a mesma escala (maxVal global) pra comparação.
 * groups: array de { label, color, valores: {serieKey: n} }
 * series: array ordenado de { key, label, color }
 * Barras com valor 0 são omitidas dentro do grupo, pra não poluir.
 */
export function barrasAgrupadas(groups, series){
  if(!groups.length) return '<div style="font-size:12px;color:var(--ink4)">Sem dados</div>';
  // escala global: maior valor entre todas as barras de todos os grupos
  let maxVal = 1;
  groups.forEach(g => series.forEach(s => { maxVal = Math.max(maxVal, g.valores[s.key]||0); }));
  const corpo = groups.map(g => {
    const totGrupo = series.reduce((acc,s)=>acc+(g.valores[s.key]||0),0);
    const barras = series.map(s => {
      const value = g.valores[s.key]||0;
      if(!value) return ''; // omite série zerada dentro do grupo
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
 * graficoLinha(points, opts) — gráfico de linha via Chart.js
 * points: array de { label, value }
 * opts: { pctAxis, max, min, fmt }
 *
 * OBS: o gráfico só plota meses até o mês atual.
 * Se o último ponto for Abr/26, é porque não há conclusões mais recentes
 * na planilha — avança sozinho assim que a base for atualizada.
 */
export function graficoLinha(points, opts = {}) {
  if (points.length < 2)
    return '<div style="font-size:12px;color:var(--ink4)">Dados insuficientes para tendência</div>';

  const id = _gerarIdGrafico('line');

  _graficosPendentes.push({
    id,
    config: {
      type: 'line',
      data: {
        labels: points.map(p => p.label),
        datasets: [{
          data:                 points.map(p => p.value),
          borderColor:          CORES_GRAFICO.brand,
          backgroundColor:      'rgba(15,82,153,0.07)',
          borderWidth:          2,
          pointRadius:          3,
          pointBackgroundColor: '#fff',
          pointBorderColor:     CORES_GRAFICO.brand,
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
            ticks:  { color: CORES_GRAFICO.ink4, font: { size: 9 }, maxTicksLimit: 8 }
          },
          y: {
            min:    opts.min ?? 0,
            max:    opts.max,
            grid:   { color: CORES_GRAFICO.rule },
            border: { display: false },
            ticks: {
              color:    CORES_GRAFICO.ink4,
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
 * graficoBarrasVerticais(meses, porMes, porMesV) — barras verticais empilhadas do volume mensal.
 * Dois datasets: chamados normais (azul da marca) e vencidos (vermelho), empilhados.
 * meses: array de chaves "YYYY-MM" ordenadas
 * porMes / porMesV: objetos { "YYYY-MM": contagem }
 */
export function graficoBarrasVerticais(meses, porMes, porMesV) {
  const id      = _gerarIdGrafico('vbar');
  const labels  = meses.map(m => paraRotuloAnoMes(m));
  const totais  = meses.map(m => porMes[m]  || 0);
  const vencArr = meses.map(m => porMesV[m] || 0);
  const normais = totais.map((t, i) => t - vencArr[i]);

  _graficosPendentes.push({
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
              color: CORES_GRAFICO.ink4, padding: 14,
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
            ticks:   { color: CORES_GRAFICO.ink4, font: { size: 9 } }
          },
          y: {
            stacked: true,
            grid:    { color: CORES_GRAFICO.rule },
            border:  { display: false },
            ticks:   { color: CORES_GRAFICO.ink4 }
          }
        }
      }
    }
  });

  return `<div style="position:relative;height:200px"><canvas id="${id}"></canvas></div>`;
}

/*
 * mapaCalor(matrix, rowLabels, colLabels) — tabela de mapa de calor
 * matrix[r][c] = valor numérico
 * A intensidade da cor vai de quase branco (valor baixo) até vermelho (valor máximo).
 * Usa rgba() com opacidade variável (funciona em qualquer navegador).
 * Valores zero recebem um fundo neutro (sem cor de calor).
 */
export function mapaCalor(matrix, rowLabels, colLabels, opts={}){
  const flat = matrix.flat().filter(v => v > 0);
  const mx = flat.length ? Math.max(...flat) : 1;
  const HEATMAP_MIN_OPACITY   = 0.12;
  const HEATMAP_OPACITY_RANGE = 0.78; // min + range = 0.90 (intensidade máxima)
  const color = v => {
    if(!v) return 'var(--neu-bg)';
    const op = (HEATMAP_MIN_OPACITY + (v / mx) * HEATMAP_OPACITY_RANGE).toFixed(2);
    return `rgba(1, 149, 214, ${op})`; // azul de destaque Saint-Gobain
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
