import { App } from '../state.js';
import { applyDate, refDate } from '../utils/date.js';
import { coeNomePadrao } from '../utils/classify.js';
import { count, pct } from '../utils/helpers.js';
import { donut, hbars, lineChart } from '../charts.js';
import { heatmap } from '../charts.js';
import { aiBar } from '../analysis.js';
import { ymLabel, ym } from '../utils/date.js';
import { HOJE } from '../constants.js';

// ─── allActions / allActionsFiltered ─────────────────────────────────────────
// Unifica as 4 fontes num único array de "ações" para a visão executiva.
export function allActions() {
  const out = [];
  App.P.proj.forEach(p => out.push({ fonte: 'Projetos', sc: p.sc, frente: p.frente, resp: p.resp, dtFim: p.dtFim, prog: p.prog, prio: null }));
  App.P.mel.forEach(m => out.push({ fonte: 'Pipefy', sc: m.sc, frente: m.frente, resp: m.resp, dtInicio: m.dtInicio, dtFim: m.dtFim, prog: null, prio: null }));
  App.P.ana.forEach(a => out.push({ fonte: 'Analytics', sc: a.sc, frente: a.frente, resp: a.resp, dtFim: a.dtFim, prog: null, prio: a.prio }));
  App.R.forEach(r => out.push({
    fonte: 'Chamados RPA',
    sc: r.fase.toLowerCase().includes('conclu') ? 'done' : 'doing',
    frente: null, resp: r.solicitante,
    dtFim: r.finalizado, criado: r.criado,
    prog: null, prio: null, vencido: r.vencido
  }));
  return out;
}

export function allActionsFiltered() {
  return applyDate(allActions());
}

// Determina se uma ação está atrasada.
// null = não há dados suficientes para calcular (não conta como "no prazo").
export function isLate(a) {
  if (a.fonte === 'Chamados RPA') return a.vencido && a.sc !== 'done';
  if (a.fonte === 'Projetos' && a.dtFim) return a.dtFim < HOJE && a.sc !== 'done' && a.sc !== 'cancel' && a.sc !== 'monitor';
  return null;
}

// ─── buildGov ────────────────────────────────────────────────────────────────
// Monta a aba Governança (visão executiva) com KPIs cruzados de todas as fontes.
export function buildGov() {
  const any = App.loaded.gov || App.loaded.rpa;
  document.getElementById('gov-empty').style.display = any ? 'none' : 'block';
  document.getElementById('gov-content').style.display = any ? 'block' : 'none';
  if (!any) return;

  const { kept: A, noDate } = allActionsFiltered();
  const total = A.length;
  const done = A.filter(a => a.sc === 'done').length;
  const doing = A.filter(a => a.sc === 'doing' || a.sc === 'closing').length;
  const backlog = A.filter(a => a.sc === 'todo').length;
  const outros = total - done - doing - backlog;
  const nCancel = A.filter(a => a.sc === 'cancel').length;
  const nBlocked = A.filter(a => a.sc === 'blocked').length;
  const nMonitor = A.filter(a => a.sc === 'monitor').length;
  const nVendor = A.filter(a => a.sc === 'vendor').length;
  const outrosDesc = [
    nCancel ? `${nCancel} cancel.` : '',
    nBlocked ? `${nBlocked} bloq.` : '',
    nMonitor ? `${nMonitor} monit.` : '',
    nVendor ? `${nVendor} suporte` : ''
  ].filter(Boolean).join(' · ');

  let dateNote = '';
  if (App.dateRange.mode !== 'all') {
    const fmt = d => d ? d.toLocaleDateString('pt-BR') : '∞';
    dateNote = `<div class="note" style="background:var(--neu-bg);color:var(--ink3)"><i class="ti ti-calendar-stats"></i><div>
      Período <b>${fmt(App.dateRange.from)} → ${fmt(App.dateRange.to)}</b>: <b>${total} ações</b> no recorte.` +
      (noDate > 0 ? ` (${noDate} ações sem data não entram no filtro.)` : '') +
      ` Para ver tudo, limpe os campos de data no topo.</div></div>`;
  }

  const fontes = ['Projetos', 'Pipefy', 'Analytics', 'Chamados RPA'];
  const porFonte = fontes.map(f => {
    const sub = A.filter(a => a.fonte === f);
    return { f, total: sub.length, done: sub.filter(a => a.sc === 'done').length };
  }).filter(x => x.total > 0);

  let h = `<div class="sh">Painel de Controle — visão executiva</div>
  ${dateNote}
  ${aiBar('gov')}
  <div class="krow k5">
    <div class="kpi il"><div class="knum">${total}</div><div class="klbl">Total de ações CoE</div>
      <div class="ksub">${fontes.filter(f => A.some(a => a.fonte === f)).length} fontes integradas</div></div>
    <div class="kpi gl"><div class="knum">${pct(done, total)}%</div><div class="klbl">Concluídas</div>
      <div class="ksub">${done} de ${total}</div></div>
    <div class="kpi"><div class="knum">${pct(doing, total)}%</div><div class="klbl">Em andamento</div>
      <div class="ksub">${doing} de ${total}</div></div>
    <div class="kpi"><div class="knum">${pct(backlog, total)}%</div><div class="klbl">Backlog / não iniciadas</div>
      <div class="ksub">${backlog} de ${total}</div></div>
    <div class="kpi"><div class="knum">${pct(outros, total)}%</div><div class="klbl">Outros</div>
      <div class="ksub">${outrosDesc || '—'}</div></div>
  </div>`;

  h += `<div class="sh mt">Por fonte</div><div class="krow k5" style="grid-template-columns:repeat(${porFonte.length},1fr)">`;
  porFonte.forEach(x => {
    h += `<div class="kpi"><div class="knum sm">${x.total}</div><div class="klbl">${x.f}</div>
      <div class="ksub">${pct(x.done, x.total)}% concl.</div></div>`;
  });
  h += `</div>`;

  const scAll = count(A, a => a.sc);
  const donutDefs = [
    { label: 'Concluído',        value: scAll.done || 0,                         color: '#2f7d4f' },
    { label: 'Em encerramento',  value: (scAll.closing || 0) + (scAll.monitor || 0), color: '#5bbd7a' },
    { label: 'Em andamento',     value: scAll.doing || 0,                        color: '#3b82c4' },
    { label: 'Não iniciado',     value: scAll.todo || 0,                         color: '#b8bcc2' },
    { label: 'Bloqueado',        value: scAll.blocked || 0,                      color: '#d89b3c' },
    { label: 'Suporte / fornec.',value: scAll.vendor || 0,                       color: '#8f6fd0' },
    { label: 'Cancelado',        value: scAll.cancel || 0,                       color: '#c75d5d' },
    { label: 'Outro',            value: scAll.other || 0,                        color: '#9aa0a6' }
  ].filter(d => d.value);

  // Ações por responsável CoE: conta por fonte, cada uma com seu campo 'resp'
  const respCoE = {};
  const addResp = nomeRaw => {
    const nome = coeNomePadrao(nomeRaw);
    if (nome) respCoE[nome] = (respCoE[nome] || 0) + 1;
  };
  applyDate(App.P.proj).kept.forEach(p => addResp(p.resp));
  applyDate(App.P.mel).kept.forEach(m => addResp(m.resp));
  applyDate(App.P.ana).kept.forEach(a => addResp(a.resp));
  applyDate(App.R).kept.forEach(r => (r.responsaveis || []).forEach(addResp));
  const respTop = Object.entries(respCoE).sort((a, b) => b[1] - a[1]);
  const totalRespCoE = respTop.reduce((s, e) => s + e[1], 0);

  h += `<div class="two">
    <div class="card"><div class="card-title"><i class="ti ti-chart-pie"></i> Status das ações</div>${donut(donutDefs)}</div>
    <div class="card"><div class="card-title"><i class="ti ti-user-bolt"></i> Ações por responsável<span class="rt">equipe CoE · total</span></div>
      ${respTop.length ? hbars(respTop, { max: 18, lw: 150, tot: totalRespCoE, showTotal: totalRespCoE, totLabel: 'Total de ações da equipe' }) : '<div style="font-size:12px;color:var(--ink4)">Nenhuma ação da equipe CoE neste recorte.</div>'}</div>
  </div>`;

  const frCount = count(A.filter(a => a.frente), a => a.frente);
  h += `<div class="two">
    <div class="card"><div class="card-title"><i class="ti ti-building"></i> Ações por frente</div>
      ${hbars(Object.entries(frCount).sort((a, b) => b[1] - a[1]), { max: 8, lw: 60, tot: Object.values(frCount).reduce((s, v) => s + v, 0) })}</div>
    <div class="card"><div class="card-title"><i class="ti ti-source-code"></i> Ações por fonte</div>
      ${hbars(fontes.map(f => [f, A.filter(a => a.fonte === f).length]).filter(e => e[1]), { max: 6, lw: 100, tot: total })}</div>
  </div>`;

  h += buildEvolucao(A);

  const diag = [
    `Pipefy: ${App.P.mel.length}`,
    `Projetos: ${App.P.proj.length}`,
    `Analytics: ${App.P.ana.length}`,
    `Chamados RPA: ${App.R.length}`,
    `Bots: ${App.B.length}`
  ].join(' · ');
  h += `<div style="font-size:10px;color:var(--ink4);margin-top:18px;padding-top:12px;border-top:1px solid var(--rule)">
    Contagem por fonte (total sem filtro de data): ${diag}. Total combinado: ${App.P.mel.length + App.P.proj.length + App.P.ana.length + App.R.length} ações.</div>`;

  document.getElementById('gov-content').innerHTML = h;
}

// ─── buildHeatmap ─────────────────────────────────────────────────────────────
// Heatmap de ações Analytics abertas por prioridade × frente.
export function buildHeatmap() {
  const { kept: anaF } = applyDate(App.P.ana);
  const { kept: projF } = applyDate(App.P.proj);
  const frentes = [...new Set([...anaF, ...projF].map(x => x.frente).filter(Boolean))].sort();
  if (!anaF.length || !frentes.length) return '';
  const prios = [1, 2, 3, 4];
  const matrix = prios.map(p => frentes.map(f =>
    anaF.filter(a => a.prio === p && a.frente === f && a.sc !== 'done').length
  ));
  if (!matrix.flat().some(v => v > 0)) return '';
  return `<div class="card"><div class="card-title"><i class="ti ti-grid-dots"></i> Ações Analytics abertas — prioridade × frente
    <span class="rt">foco executivo</span></div>
    <div style="overflow-x:auto">${heatmap(matrix, prios.map(p => `Prioridade ${p}`), frentes)}</div></div>`;
}

// ─── buildEvolucao ────────────────────────────────────────────────────────────
// Gráfico de linha: % concluído acumulado mês a mês.
// Só plota meses até o mês atual para não exibir meses futuros com zero.
function buildEvolucao(A) {
  const comData = A.filter(a => a.dtFim);
  if (comData.length < 3) return '';
  const mesAtual = ym(HOJE);
  const passadas = comData.filter(a => ym(a.dtFim) <= mesAtual);
  if (passadas.length < 3) return '';
  const meses = [...new Set(passadas.map(a => ym(a.dtFim)))].sort().filter(m => m <= mesAtual);
  if (meses.length < 2) return '';
  const denom = passadas.length;
  let acum = 0;
  const pts = meses.map(m => {
    acum += passadas.filter(a => a.sc === 'done' && ym(a.dtFim) === m).length;
    return { label: ymLabel(m), value: pct(acum, denom) };
  });
  const ultimoPct = pts[pts.length - 1].value;
  return `<div class="card"><div class="card-title"><i class="ti ti-trending-up"></i> Evolução do % concluído
    <span class="rt">para comitê</span></div>
    ${lineChart(pts, { pctAxis: true, max: 100, fmt: v => v + '%' })}
    <div style="font-size:10px;color:var(--ink4);margin-top:8px">Conclusões acumuladas sobre ${denom} ações com data de conclusão registrada, de ${pts[0].label} a ${pts[pts.length - 1].label}. Atinge ${ultimoPct}% no período medido.</div></div>`;
}
