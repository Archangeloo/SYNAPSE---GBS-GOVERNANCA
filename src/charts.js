import { pct } from './utils/helpers.js';

// ─── MÓDULO: charts.js ───────────────────────────────────────────────────────
// Componentes de gráfico: SVG/HTML puro, sem bibliotecas externas.
// Cada função retorna uma string HTML que pode ser injetada via innerHTML.
//
// Exporta:
//   donut(data, opts)                      — gráfico de rosca
//   hbars(entries, opts)                   — barras horizontais simples
//   stackedBars(rows, segDefs)             — barras empilhadas finas
//   clusteredBars(groups, series)          — barras clusterizadas (grupo × série)
//   lineChart(points, opts)               — linha com área preenchida
//   heatmap(matrix, rowLabels, colLabels) — tabela de calor com gradiente de cor
// ─────────────────────────────────────────────────────────────────────────────

// ─── Donut ────────────────────────────────────────────────────────────────────
// data: array de { label, value, color }
//
// COMO FUNCIONA O TRUQUE DO SVG:
//   Usamos um único <circle> por segmento, mas pintamos apenas uma parte da
//   borda (stroke) de cada círculo usando stroke-dasharray.
//
//   stroke-dasharray="comprimento_pintado  comprimento_vazio"
//     → pinta exatamente a fatia daquele segmento e deixa o resto transparente.
//
//   stroke-dashoffset  → rotaciona onde a fatia começa. Acumulamos o comprimento
//     de todos os segmentos anteriores para encadear as fatias sem gaps.
//
//   O círculo tem raio R=54, então sua circunferência total = 2π×54 ≈ 339px.
//   Uma fatia de 30% do total ocupa 30% × 339 ≈ 101px dessa linha.
//
//   transform="rotate(-90 64 64)"  → gira o início do traçado para as 12h
//     (por padrão SVG começa às 3h).
export function donut(data, opts = {}) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (!total) return '<div style="font-size:12px;color:var(--ink4)">Sem dados</div>';

  const R  = 54;                  // raio do círculo central
  const C  = 2 * Math.PI * R;    // circunferência total (≈ 339px)
  const sw = 22;                  // espessura do anel (stroke-width)

  let off = 0; // acumulador de comprimento já "ocupado" pelas fatias anteriores

  const segs = data.filter(d => d.value > 0).map(d => {
    const frac = d.value / total;  // fração desta fatia (0.0 a 1.0)
    const len  = frac * C;         // comprimento em pixels desta fatia no arco

    // stroke-dasharray: "len (C - len)" → pinta 'len' pixels e interrompe o resto
    // stroke-dashoffset: "-off" → começa a pintar onde o segmento anterior terminou
    const s = `<circle r="${R}" cx="64" cy="64" fill="none" stroke="${d.color}" stroke-width="${sw}"
      stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-off}" transform="rotate(-90 64 64)"/>`;

    off += len; // avança o ponteiro para o próximo segmento
    return s;
  }).join('');

  // Legenda: lista de itens com cor, rótulo, valor e percentual
  const legend = data.filter(d => d.value > 0).map(d =>
    `<div class="dleg"><span class="dleg-dot" style="background:${d.color}"></span>${d.label}
     <b>${d.value}</b><span class="dpct">${pct(d.value, total)}%</span></div>`).join('');

  // O número no centro (total) usa fonte Syne para destaque
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
//
// COMO FUNCIONA A LARGURA DA BARRA:
//   Primeiro achamos o maior valor entre os itens (mx). Cada barra recebe
//   uma largura CSS proporcional: (valor / mx) × 100%. Assim a maior barra
//   sempre ocupa 100% da trilha e as demais são proporcionais a ela.
export function hbars(entries, opts = {}) {
  const items = entries.slice(0, opts.max || 10);
  const mx    = items.length ? Math.max(...items.map(e => e[1])) : 1;
  const lw    = opts.lw || 90;

  // fixedLabel: trava a largura do label para alinhar barras (útil quando os rótulos são longos)
  const labelStyle = opts.fixedLabel
    ? `width:${lw}px;min-width:${lw}px;max-width:${lw}px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap`
    : `min-width:${lw}px`;

  const h = items.map(([l, v]) => {
    const w = Math.round(v / mx * 100);            // largura em % relativa ao maior valor
    const p = opts.tot ? `<span class="hbar-pct">${pct(v, opts.tot)}%</span>` : '';
    const col = opts.color || 'var(--accent)';
    return `<div class="hbar-row"><span class="hbar-lbl" style="${labelStyle}" title="${String(l).replace(/"/g, '')}">${l}</span>
      <div class="hbar-track"><div class="hbar-fill" style="width:${w}%;background:${col}"></div></div>
      <span class="hbar-val">${v}</span>${p}</div>`;
  }).join('');

  if (!h) return '<div style="font-size:12px;color:var(--ink4)">Sem dados</div>';

  // Cabeçalho opcional com total (ex: "Total de ações da equipe: 142")
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
//
// COMO FUNCIONA:
//   Cada linha tem uma barra que representa o TOTAL daquela categoria.
//   Dentro dessa barra, cada segmento (cor) representa a proporção de um status.
//   A barra do maior total ocupa 100% da largura disponível; as demais são proporcionais.
//
//   Exemplo: se "P2P" tem 50 chamados e "O2C" tem 30, a barra de P2P ocupa 100%
//   e a de O2C ocupa 60% da largura. Dentro de cada barra, as cores mostram
//   a distribuição de fases/status.
export function stackedBars(rows, segDefs) {
  if (!rows.length) return '<div style="font-size:12px;color:var(--ink4)">Sem dados</div>';

  // Calcula o total de cada linha somando todos os segmentos
  const totais  = rows.map(r => segDefs.reduce((s, d) => s + (r.valores[d.key] || 0), 0));
  const maxTot  = Math.max(...totais, 1); // maior total (escala de referência)

  const corpo = rows.map((r, idx) => {
    const tot         = totais[idx];
    const larguraBarra = Math.round(tot / maxTot * 100); // % da largura máxima

    // Gera os segmentos coloridos dentro da barra usando flex-basis
    const segs = segDefs.map(d => {
      const n = r.valores[d.key] || 0;
      if (!n) return '';
      // flex: 0 0 X% → cada segmento ocupa X% do comprimento da barra
      return `<div class="sbar-seg" style="flex:0 0 ${(n / tot * 100).toFixed(2)}%;background:${d.color}" title="${d.label}: ${n}"></div>`;
    }).join('');

    // Números individuais de cada segmento (os zeros ficam acinzentados com .sn-z)
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
//
// ESTRUTURA VISUAL:
//   Cada "group" é um bloco (ex: uma fase do chamado). Dentro do bloco há
//   uma barra fina por série (ex: por tipo de problema). Todas as barras
//   compartilham a mesma escala — o valor máximo de qualquer série em qualquer
//   grupo determina o comprimento de 100%.
export function clusteredBars(groups, series) {
  if (!groups.length) return '<div style="font-size:12px;color:var(--ink4)">Sem dados</div>';

  // Encontra o maior valor individual em toda a matriz (escala global)
  let maxVal = 1;
  groups.forEach(g => series.forEach(s => { maxVal = Math.max(maxVal, g.valores[s.key] || 0); }));

  const corpo = groups.map(g => {
    const totGrupo = series.reduce((acc, s) => acc + (g.valores[s.key] || 0), 0);

    const barras = series.map(s => {
      const n = g.valores[s.key] || 0;
      if (!n) return ''; // omite barras com zero para não poluir visualmente
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
//
// SISTEMA DE COORDENADAS:
//   O SVG tem dimensões W×H (padrão 560×140).
//   As bordas internas ("padding") reservam espaço para eixos e rótulos:
//     pad.l = 32px (eixo Y com números à esquerda)
//     pad.b = 24px (eixo X com meses na base)
//     pad.r e pad.t = margens menores
//
//   Após o padding, a área útil de desenho é:
//     largura útil iw = W - pad.l - pad.r
//     altura útil ih = H - pad.t - pad.b
//
//   Funções de conversão índice/valor → pixel:
//     x(i) = pad.l + (i / (n-1)) × iw
//       → espalha os pontos igualmente da esquerda até a direita
//     y(v) = pad.t + ih - ((v - min) / (max - min)) × ih
//       → valores mais altos ficam mais perto do topo (subtraímos porque
//          em SVG y cresce para baixo, mas queremos valores altos acima)
//
// RÓTULOS DO EIXO X:
//   Se houver muitos pontos, exibir todos os meses causaria sobreposição.
//   step = ceil(n / 7) → exibe 1 a cada 'step' pontos para ter ~7 rótulos visíveis.
//   Regra especial: se o último ponto ficaria muito perto do penúltimo rótulo
//   exibido (menos de 60% da distância normal), ele é suprimido para evitar colisão.
export function lineChart(points, opts = {}) {
  if (points.length < 2) return '<div style="font-size:12px;color:var(--ink4)">Dados insuficientes para tendência</div>';

  const W   = opts.w || 560;
  const H   = opts.h || 140;
  const pad = { l: 32, r: 12, t: 12, b: 24 }; // margens internas

  const iw  = W - pad.l - pad.r; // largura da área de dados
  const ih  = H - pad.t - pad.b; // altura da área de dados

  const max = opts.max != null ? opts.max : Math.max(...points.map(p => p.value), 1);
  const min = opts.min != null ? opts.min : 0;

  // Converte índice i → coordenada X em pixels (espaçamento uniforme entre pontos)
  const x = i => pad.l + (i / (points.length - 1)) * iw;

  // Converte valor v → coordenada Y em pixels (valores maiores ficam mais acima)
  const y = v => pad.t + ih - ((v - min) / (max - min || 1)) * ih;

  // Sequência de comandos SVG que traça a linha (M = mover, L = linha até)
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(' ');

  // Área preenchida sob a linha: segue o caminho e "fecha" pelo fundo do gráfico
  const area = `${path} L${x(points.length - 1)} ${pad.t + ih} L${pad.l} ${pad.t + ih} Z`;

  // Pontos (bolinhas) e valores numéricos sobre eles
  const dots = points.map((p, i) => {
    const step    = Math.ceil(points.length / 7); // quantos pontos pular entre rótulos
    const showVal = points.length <= 7 || i % step === 0 || i === points.length - 1;
    return `<circle cx="${x(i)}" cy="${y(p.value)}" r="3" fill="var(--surface)" stroke="var(--info)" stroke-width="2"/>
    ${showVal ? `<text x="${x(i)}" y="${y(p.value) - 9}" text-anchor="middle" font-size="9" font-weight="600" fill="var(--ink2)">${opts.fmt ? opts.fmt(p.value) : p.value}</text>` : ''}`;
  }).join('');

  // Rótulos do eixo X (meses). Evita colisão entre o último rótulo e o penúltimo.
  const xl = points.map((p, i) => {
    const step         = Math.ceil(points.length / 7);
    const isShown      = points.length <= 7 || i % step === 0; // pontos regulares
    const isLast       = i === points.length - 1;
    const lastShownByStep = Math.floor((points.length - 1) / step) * step;
    // se o último ponto está a menos de 60% de um passo do penúltimo rótulo, suprime
    const lastTooClose = isLast && (points.length - 1 - lastShownByStep) < step * 0.6;

    if (!isShown && !(isLast && !lastTooClose)) return '';
    if (isLast && lastTooClose) return '';
    return `<text x="${x(i)}" y="${H - 6}" text-anchor="middle" font-size="9" fill="var(--ink4)">${p.label}</text>`;
  }).join('');

  // Grade horizontal: 5 linhas nos níveis 0%, 25%, 50%, 75%, 100% do eixo Y
  const grid = [0, .25, .5, .75, 1].map(f => {
    const yy  = pad.t + ih - f * ih;
    const val = Math.round(min + f * (max - min));
    return `<line x1="${pad.l}" y1="${yy}" x2="${W - pad.r}" y2="${yy}" stroke="var(--rule)" stroke-width="1"/>
      <text x="${pad.l - 6}" y="${yy + 3}" text-anchor="end" font-size="8" fill="var(--ink4)">${opts.pctAxis ? val + '%' : val}</text>`;
  }).join('');

  return `<svg width="100%" viewBox="0 0 ${W} ${H}" style="overflow:visible">
    ${grid}<path d="${area}" fill="var(--info)" opacity="0.08"/>
    <path d="${path}" fill="none" stroke="var(--info)" stroke-width="2" stroke-linejoin="round"/>${dots}${xl}</svg>`;
}

// ─── Heatmap ──────────────────────────────────────────────────────────────────
// matrix[r][c] = valor numérico (frequência)
// rowLabels = rótulos das linhas (eixo Y), colLabels = rótulos das colunas (eixo X)
//
// GRADIENTE DE COR:
//   Células com zero ficam na cor de fundo neutro (var(--neu-bg)).
//   Células com valor > 0 recebem um rgba(vermelho) com opacidade proporcional:
//     opacidade = 0.12 + (valor / máximo) × 0.78
//     → o menor valor não-zero fica com opacidade ≈ 0.12 (quase transparente)
//     → o maior valor fica com opacidade ≈ 0.90 (quase sólido)
//   Cor do texto: branco quando o fundo é escuro (valor > 55% do máximo), senão escuro.
export function heatmap(matrix, rowLabels, colLabels, opts = {}) {
  const flat = matrix.flat().filter(v => v > 0);
  const mx   = flat.length ? Math.max(...flat) : 1; // maior valor (referência para escala)

  // Calcula a cor de fundo de uma célula com base no seu valor
  const color = v => {
    if (!v) return 'var(--neu-bg)'; // zero = fundo neutro
    const op = (0.12 + (v / mx) * 0.78).toFixed(2); // opacidade entre 0.12 e 0.90
    return `rgba(199, 93, 93, ${op})`; // vermelho com intensidade proporcional
  };

  let html = '<table class="hm"><thead><tr><th class="rh"></th>' + colLabels.map(c => `<th>${c}</th>`).join('') + '</tr></thead><tbody>';

  matrix.forEach((row, r) => {
    html += `<tr><td class="rl">${rowLabels[r]}</td>` + row.map(v =>
      // texto branco quando o fundo passa de 55% da intensidade máxima
      `<td><div class="cell" style="background:${color(v)};color:${v / mx > 0.55 ? '#fff' : 'var(--ink2)'}">${v || ''}</div></td>`
    ).join('') + '</tr>';
  });

  html += '</tbody></table>';
  return html;
}
