// ─── MODULE: views/mel.js ──────────────────────────────────────────────────
// ABA: MELHORIAS PIPEFY
// FILTRO DE DATA: usa DataConclusaoRealDesenvolvimento.
// A maioria das melhorias em backlog/planejamento NÃO tem essa data.
// Ao filtrar por período, elas ficam de fora — comportamento correto e documentado.
// Pra ver todas as melhorias, use o filtro de Status dentro da aba.
// ─────────────────────────────────────────────────────────────────────────────

import { App } from '../state.js';
import { STATUS_PT, STATUS_COLOR } from '../constants.js';
import { HOJE } from '../constants.js';
import { statusCounts, calculatePercentage, sortedCountEntries, isPipefyTeamMember, iconeKpi } from '../utils/helpers.js';
import { filtrarPorPeriodo, toYearMonthKey, toYearMonthLabel } from '../utils/date.js';
import { donut, horizontalBars, flushCharts, CHART_COLORS, _generateChartId, registerChart } from '../charts.js';
import { barraAnalise } from '../analysis.js';
import { setBadge } from '../nav.js';
import { renderizarSecaoAtividadesMelhorias } from './mel-activities.js';

/*
 * construirGraficoEvolucaoMelhorias(M) — gráfico de linha: Concluídas × Backlog × Previsão.
 *
 * Linha 1 — Concluídas/mês: itens com sc='done' agrupados por dtFim
 * Linha 2 — Backlog/mês: reconstruído historicamente como
 *           itens_backlog_hoje + itens_concluidos_depois_daquele_mes
 * Linha 3 — Previsão (futuro): média dos últimos 3 meses projetada adiante
 *
 * Linha vertical tracejada vermelha marca o mês atual (divisor passado/futuro).
 * Retorna '' se não houver dados suficientes (< 3 meses com conclusões).
 */
// Calcula os dados das três séries do gráfico de evolução de melhorias.
// Retorna null se não houver dados suficientes (< 3 concluídas ou < 2 meses históricos).
function calcularDadosEvolucaoMelhorias(melhorias) {
  const concluidas = melhorias.filter(m => m.sc === 'done' && m.dtFim);
  if (concluidas.length < 3) return null;

  const porMes        = {};
  concluidas.forEach(m => { const chaveMes = toYearMonthKey(m.dtFim); porMes[chaveMes] = (porMes[chaveMes] || 0) + 1; });
  const mesAtual    = toYearMonthKey(HOJE);
  const mesesHistoricos = Object.keys(porMes).sort().filter(k => k <= mesAtual);
  if (mesesHistoricos.length < 2) return null;

  const avancarMes = chaveMes => {
    const [ano, mes] = chaveMes.split('-').map(Number);
    return mes === 12 ? `${ano + 1}-01` : `${ano}-${String(mes + 1).padStart(2, '0')}`;
  };

  // Prazo final = outubro do ano corrente (ou o seguinte, se outubro já passou)
  const [anoAtual, mesNum] = mesAtual.split('-').map(Number);
  const PRAZO_OUTUBRO = `${mesNum <= 10 ? anoAtual : anoAtual + 1}-10`;

  let fimIntervalo = mesAtual;
  for (let i = 0; i < 6; i++) fimIntervalo = avancarMes(fimIntervalo);
  if (fimIntervalo > PRAZO_OUTUBRO) fimIntervalo = PRAZO_OUTUBRO;

  const todosMeses = [];
  let atual = mesesHistoricos[0];
  while (atual <= fimIntervalo) { todosMeses.push(atual); atual = avancarMes(atual); }

  const itensBacklogAtual = melhorias.filter(m => m.sc === 'todo').length;
  const mesesFuturos      = todosMeses.filter(m => m >= mesAtual);
  const previsaoPorMes    = mesesFuturos.length > 0 ? Math.max(1, Math.round(itensBacklogAtual / mesesFuturos.length)) : 1;

  return {
    labels:         todosMeses.map(m => toYearMonthLabel(m)),
    currentIndex:   todosMeses.indexOf(mesAtual),
    currentTodoItems: itensBacklogAtual,
    futureMonths:     mesesFuturos,
    forecastPerMonth: previsaoPorMes,
    completedData: todosMeses.map(m => m <= mesAtual ? (porMes[m] || 0) : null),
    backlogData:   todosMeses.map(m => {
      if (m > mesAtual) return null;
      return itensBacklogAtual + concluidas.filter(c => toYearMonthKey(c.dtFim) > m).length;
    }),
    forecastData:  todosMeses.map(m => m >= mesAtual ? previsaoPorMes : null),
  };
}

// Plugins do Chart.js para o gráfico de evolução: rótulos dos pontos e a linha do mês atual.
function pluginsEvolucaoMelhorias(currentIndex) {
  const dataLabels = {
    id: 'dataLabels',
    afterDatasetsDraw(chart) {
      const { ctx, data } = chart;
      data.datasets.forEach((dataset, i) => {
        const meta = chart.getDatasetMeta(i);
        if (meta.hidden) return;
        const acima = i !== 2; // Previsão (i===2) fica embaixo pra evitar sobreposição
        meta.data.forEach((el, j) => {
          const value = dataset.data[j];
          if (value == null) return;
          ctx.save();
          ctx.fillStyle    = dataset.borderColor;
          ctx.font         = `bold 10px Inter, system-ui, sans-serif`;
          ctx.textAlign    = 'center';
          ctx.textBaseline = acima ? 'bottom' : 'top';
          ctx.fillText(value, el.x, el.y + (acima ? -5 : 5));
          ctx.restore();
        });
      });
    }
  };
  const linhaHoje = {
    id: 'todayLine',
    afterDraw(chart) {
      if (currentIndex < 0) return;
      const { ctx, chartArea, scales } = chart;
      const xPixel = scales.x.getPixelForValue(chart.data.labels[currentIndex]);
      ctx.save();
      ctx.beginPath();
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = CHART_COLORS.err;
      ctx.lineWidth   = 1.5;
      ctx.moveTo(xPixel, chartArea.top);
      ctx.lineTo(xPixel, chartArea.bottom);
      ctx.stroke();
      ctx.restore();
    }
  };
  return [dataLabels, linhaHoje];
}

function construirGraficoEvolucaoMelhorias(melhorias) {
  const evolucao = calcularDadosEvolucaoMelhorias(melhorias);
  if (!evolucao) return '';

  const { labels, currentIndex, currentTodoItems, futureMonths, forecastPerMonth,
          completedData, backlogData, forecastData } = evolucao;
  const id = _generateChartId('mel-evol');

  registerChart(id, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label:               'Concluídas',
          data:                completedData,
          borderColor:         CHART_COLORS.ink,
          backgroundColor:     'transparent',
          borderWidth:         2,
          pointRadius:         4,
          pointBackgroundColor: CHART_COLORS.ink,
          tension:             0.1,
          spanGaps:            false,
        },
        {
          label:               'Backlog',
          data:                backlogData,
          borderColor:         CHART_COLORS.ink,
          backgroundColor:     'transparent',
          borderWidth:         2,
          borderDash:          [6, 4],
          pointRadius:         3,
          pointBackgroundColor: CHART_COLORS.ink,
          tension:             0.1,
          spanGaps:            false,
        },
        {
          label:               'Previsão',
          data:                forecastData,
          borderColor:         CHART_COLORS.err,
          backgroundColor:     'transparent',
          borderWidth:         1.5,
          pointRadius:         3,
          pointBackgroundColor: CHART_COLORS.err,
          tension:             0,
          spanGaps:            false,
        }
      ]
    },
    options: {
      responsive:          true,
      maintainAspectRatio: false,
      animation:           { duration: 400 },
      plugins: {
        legend: {
          position: 'top',
          labels: { color: CHART_COLORS.ink3, boxWidth: 20, boxHeight: 2, padding: 20, font: { size: 11 } }
        },
        tooltip: {
          callbacks: {
            label: ctx => ctx.parsed.y != null
              ? ` ${ctx.dataset.label}: ${ctx.parsed.y}`
              : null
          }
        }
      },
      scales: {
        x: {
          grid:   { display: false },
          border: { display: false },
          ticks:  { color: CHART_COLORS.ink4, font: { size: 10 }, maxTicksLimit: 14 }
        },
        y: {
          grid:   { color: CHART_COLORS.rule },
          border: { display: false },
          ticks:  { color: CHART_COLORS.ink4, font: { size: 10 } }
        }
      }
    },
    plugins: pluginsEvolucaoMelhorias(currentIndex)
  });

  return `<div class="card">
    <div class="card-title">
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
      Melhorias Concluídas × Backlog
      <span class="rt">previsão = ${currentTodoItems} pendentes ÷ ${futureMonths.length} meses = ${forecastPerMonth}/mês · linha vermelha = hoje</span>
    </div>
    <div style="position:relative;height:280px"><canvas id="${id}"></canvas></div>
  </div>`;
}


/*
 * visaoGeralPorArea(M) — tabela "Overview por categoria" da aba Pipefy Melhorias.
 *
 * Linhas  = áreas de negócio (P2P, O2C, TAX…), na ordem padrão + extras no final.
 * Colunas = Melhorias (total) + detalhamento por status.
 *
 * "Dev + Planej." e "Validação" são as duas fatias de sc='doing', diferenciadas pelo statusRaw:
 *   Validação    → statusRaw contém "validação" ou "aguardando"
 *   Dev + Planej → sc='doing' e não é validação
 */
function visaoGeralPorArea(melhorias) {
  const ehValidacao = melhoria => {
    const textoStatus = (melhoria.statusRaw || '').toLowerCase();
    return textoStatus.includes('validação') || textoStatus.includes('validacao') || textoStatus.includes('aguardando');
  };

  const COLUNAS = [
    { label: 'Melhorias',     fn: null,                                      cls: '' },
    { label: 'Backlog',       fn: m => m.sc === 'todo',                      cls: '' },
    { label: 'Dev + Planej.', fn: m => m.sc === 'doing' && !ehValidacao(m),  cls: '' },
    { label: 'Validação',     fn: m => ehValidacao(m),                      cls: '' },
    { label: 'Pipefy',        fn: m => m.sc === 'vendor',                    cls: '' },
    { label: 'Bloqueado',     fn: m => m.sc === 'blocked',                   cls: '' },
    { label: 'Concluídos',    fn: m => m.sc === 'done',                      cls: 'ov-done' },
    { label: 'Cancelados',    fn: m => m.sc === 'cancel',                    cls: 'ov-cancel' },
  ];

  const ORDEM  = ['COE','P2P','O2C','R2R','TAX','H2R'];
  const CORES = { COE:'#0195D6', P2P:'#E83430', O2C:'#4DB1B3', R2R:'#E66407', TAX:'#0F5299', H2R:'#8B6FD4' };

  const todasFrentes = [...new Set(melhorias.map(m => m.frente).filter(Boolean))];
  const frentes = [
    ...ORDEM.filter(f => todasFrentes.includes(f)),
    ...todasFrentes.filter(f => !ORDEM.includes(f)).sort(),
  ];
  if (!frentes.length) return '';

  const celula = value => value
    ? `<td>${value}</td>`
    : `<td class="ov-zero">—</td>`;

  const linhas = frentes.map(frente => {
    const itens = melhorias.filter(m => m.frente === frente);
    const cor   = CORES[frente] || 'var(--ink3)';
    const cols  = COLUNAS.map((c, i) => celula(i === 0 ? itens.length : itens.filter(c.fn).length)).join('');
    return `<tr>
      <td><span class="ov-badge" style="background:${cor}">${frente}</span></td>
      ${cols}
    </tr>`;
  }).join('');

  const totais = COLUNAS.map((c, i) =>
    `<td>${i === 0 ? melhorias.length : melhorias.filter(c.fn).length}</td>`
  ).join('');

  const cabecalhos = COLUNAS.map(c =>
    `<th class="${c.cls}">${c.label}</th>`
  ).join('');

  return `<div class="card">
    <div class="card-title">
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/>
      </svg>
      Overview por categoria
    </div>
    <div style="overflow-x:auto">
      <table class="ov-table">
        <thead><tr><th></th>${cabecalhos}</tr></thead>
        <tbody>${linhas}</tbody>
        <tfoot><tr>
          <td style="text-align:left">Total</td>
          ${totais}
        </tr></tfoot>
      </table>
    </div>
  </div>`;
}

/*
 * construirMelhorias() — aba Pipefy Melhorias.
 *
 * Lê:      App.P.improvements
 * Escreve: #mel-content
 * Chamada por: generate() e renderAll()
 *
 * ATENÇÃO — lógica especial de filtro de data:
 *   Usa dtInicio + dtFim (intervalo de desenvolvimento), não uma data única.
 *   Melhorias de backlog sem data são SEMPRE incluídas, mesmo com um
 *   filtro ativo (representam trabalho pendente, não histórico).
 *
 * Produz:
 *  - KPIs: total, concluídas, backlog, bloqueadas, fluxos distintos
 *  - Donut de status, barras por área, complexidade e responsável
 */
export function construirMelhorias(){
  const {kept: melhoriasFiltradas} = filtrarPorPeriodo(App.P.improvements);
  // Backlog sem data = trabalho pendente, não histórico. Sempre incluído.
  const backlogSemData = App.dateRange.mode !== 'all'
    ? App.P.improvements.filter(m => !m.dtInicio && !m.dtFim && m.sc === 'todo')
    : [];
  const melhorias = [...melhoriasFiltradas, ...backlogSemData];
  document.getElementById('mel-empty').style.display  = App.P.improvements.length ? 'none' : 'block';
  document.getElementById('mel-content').style.display = App.P.improvements.length ? 'block' : 'none';
  if(!App.P.improvements.length) return;
  const sc      = statusCounts(melhorias);
  const done    = sc.done;
  const backlog = sc.todo;
  const blocked = sc.blocked;

  let notaData = '';
  if(App.dateRange.mode !== 'all'){
    notaData = `<div class="note" style="background:var(--neu-bg);color:var(--ink3)"><i class="ti ti-calendar-stats"></i><div>
      Período aplicado: <b>${melhorias.length} melhorias</b> no recorte${backlogSemData.length > 0 ? ` (inclui <b>${backlogSemData.length} backlog</b> sem data)` : ''}.
      <br><span style="font-size:10px;opacity:.6;font-style:italic">Referência de data: início e conclusão do desenvolvimento — inclui melhorias ativas no período, mesmo que iniciadas antes dele</span>
      </div></div>`;
  }

  // "Fluxos (processos)" = número de NomeFluxo distintos no recorte atual
  const fluxosUnicos = new Set(App.P.improvements.map(m => m.fluxo).filter(Boolean)).size;

  // Qualidade de dados: concluída sem dtFim = erro de preenchimento na planilha.
  // Itens não concluídos sem dtFim estão corretos (ainda em andamento/backlog).
  const concluidasSemData = App.P.improvements.filter(m => m.sc==='done' && !m.dtFim).length;

  let html = notaData + `<div class="sh">Pipefy — Melhorias & Ajustes</div>
  ${barraAnalise('mel')}
  <div class="krow k5">
    <div class="kpi">${iconeKpi('message')}<div class="knum">${App.P.improvements.length}</div><div class="klbl">Total melhorias</div>${App.dateRange.mode !== 'all' ? `<div class="ksub">${melhorias.length} no recorte</div>` : ''}</div>
    <div class="kpi gl">${iconeKpi('check')}<div class="knum">${done}</div><div class="klbl">Concluídas</div><div class="ksub">${calculatePercentage(done,App.P.improvements.length)}% do total</div></div>
    <div class="kpi">${iconeKpi('stack')}<div class="knum">${backlog}</div><div class="klbl">Backlog</div></div>
    <div class="kpi wl">${iconeKpi('lock')}<div class="knum">${blocked}</div><div class="klbl">Bloqueadas</div></div>
    <div class="kpi il">${iconeKpi('branch')}<div class="knum">${fluxosUnicos}</div><div class="klbl">Fluxos (processos)</div><div class="ksub">distintos no recorte</div></div>
  </div>
  ${concluidasSemData > 0 ? `<div class="note" style="background:var(--neu-bg);color:var(--ink3)"><i class="ti ti-alert-triangle" style="color:var(--warn)"></i><div>
    <b>${concluidasSemData} melhorias marcadas como concluídas não têm data de conclusão preenchida.</b>
    Isso é um erro de preenchimento na planilha — preencher o campo <i>DataConclusaoRealDesenvolvimento</i> permite análise temporal correta dessas entregas.
  </div></div>` : ''}`;

  html += `<div class="two">
    <div class="card"><div class="card-title"><i class="ti ti-chart-pie"></i> Status</div>
      ${donut(['done','doing','todo','vendor','blocked','cancel'].map(k=>({label:STATUS_PT[k],value:melhorias.filter(m=>m.sc===k).length,color:STATUS_COLOR[k]})).filter(d=>d.value), {total:App.P.improvements.length})}</div>
    <div class="card"><div class="card-title"><i class="ti ti-building"></i> Por frente</div>
      ${horizontalBars(sortedCountEntries(melhorias, m=>m.frente),{max:8,lw:60,tot:melhorias.length})}</div>
  </div>`;
  html += `<div class="two">
    <div class="card"><div class="card-title"><i class="ti ti-stack-2"></i> Por complexidade</div>
      ${horizontalBars(sortedCountEntries(melhorias.filter(m=>m.complex), m=>m.complex),{max:6,lw:90})}</div>
    <div class="card"><div class="card-title"><i class="ti ti-user-code"></i> Por responsável</div>
      ${(() => {
        const dados = sortedCountEntries(melhorias.filter(m=>m.resp && isPipefyTeamMember(m.resp)), m=>m.resp);
        return horizontalBars(dados,{max:8,lw:130});
      })()}</div>
  </div>`;
  html += construirGraficoEvolucaoMelhorias(melhorias);
  html += visaoGeralPorArea(melhorias);
  html += '<div id="mel-atividades"></div>';
  document.getElementById('mel-content').innerHTML = html;
  flushCharts();
  setBadge('nb-mel', melhorias.length, '');
  renderizarSecaoAtividadesMelhorias();
}
