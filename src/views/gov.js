// ─── MODULE: views/gov.js ──────────────────────────────────────────────────
// VIEW: GOVERNANCE (executive)
// The Governance tab is the unified view of all sources.
// It combines Projects + Pipefy Improvements + Analytics + RPA Tickets
// into a single set of KPIs and charts.
//
// Also hosts construirMapaCalor() — physically part of this section in the
// original app.js, even though it is actually rendered from the Analytics
// tab (views/ana.js imports it from here).
// ─────────────────────────────────────────────────────────────────────────────

import { App } from '../state.js';
import { statusCounts, count, calculatePercentage, iconeKpi } from '../utils/helpers.js';
import { nomePadraoCoe } from '../utils/classify.js';
import { filtrarPorPeriodo } from '../utils/date.js';
import { todasAcoesFiltradas } from '../data/actions.js';
import { donut, horizontalBars, heatmap, flushCharts } from '../charts.js';
import { barraAnalise } from '../analysis.js';

/*
 * construirGovernanca() — Control Panel (executive view).
 *
 * Reads:  App.P.improvements, App.P.proj, App.P.ana, App.R (all sources)
 * Writes: #gov-content
 * Calls:  todasAcoesFiltradas(), flushCharts()
 * Called by: generate() and renderAll() (when the date filter changes)
 *
 * Produces:
 *  - Composition KPIs: Completed / In progress / Backlog / Other
 *  - Unified status donut with an "Impediments" segment
 *  - Bars by owner (CoE team) and by area
 *  - Priority × area heatmap (Analytics)
 *  - Line chart of % completed over time
 */
export function construirGovernanca(){
  const any = App.loaded.gov || App.loaded.rpa;
  document.getElementById('gov-empty').style.display = any ? 'none' : 'block';
  document.getElementById('gov-content').style.display = any ? 'block' : 'none';
  if(!any) return;

  const {kept:actions, noDate} = todasAcoesFiltradas();

  // Available areas (only items with an area defined — RPA tickets have no area)
  const todasFrentes = [...new Set(actions.filter(a => a.frente).map(a => a.frente))].sort();
  // Validate: if the stored area no longer exists in the current data, reset it
  const frenteAtiva  = App.govFrente && todasFrentes.includes(App.govFrente) ? App.govFrente : '';
  if (!frenteAtiva) App.govFrente = '';
  const acoesFiltradas = frenteAtiva ? actions.filter(a => a.frente === frenteAtiva) : actions;

  const total = acoesFiltradas.length;
  const sc = statusCounts(acoesFiltradas);
  const done    = sc.done;
  const doing   = sc.doing + sc.closing;
  const backlog = sc.todo;
  const outros  = total - done - doing - backlog;
  const nCancel  = sc.cancel;
  const nBlocked = sc.blocked;
  const nMonitor = sc.monitor;
  const nVendor  = sc.vendor;
  // builds the description of what goes into "Other" (only categories with count > 0)
  const outrosDesc = [
    nCancel?`${nCancel} cancel.`:'',
    nBlocked?`${nBlocked} bloq.`:'',
    nMonitor?`${nMonitor} monit.`:'',
    nVendor?`${nVendor} suporte`:''
  ].filter(Boolean).join(' · ');

  // Active-filter notice — shows the period, total actions in range, and how many were excluded
  let dateNote = '';
  if(App.dateRange.mode !== 'all'){
    const fmt = d => d ? d.toLocaleDateString('pt-BR') : '∞';
    dateNote = `<div class="note" style="background:var(--neu-bg);color:var(--ink3)"><i class="ti ti-calendar-stats"></i><div>
      Período <b>${fmt(App.dateRange.from)} → ${fmt(App.dateRange.to)}</b>: <b>${total} ações</b> no recorte.`+
      (noDate>0 ? ` (${noDate} ações sem data não entram no filtro.)` : '')+
      ` Para ver tudo, limpe os campos de data no topo.
      <br><span style="font-size:10px;opacity:.6;font-style:italic">Referência por fonte: prazo de conclusão (Projetos) · início/conclusão do desenvolvimento (Pipefy) · data de abertura ou fechamento (Analytics) · data de abertura (RPA)</span>
      </div></div>`;
  }

  const sources = ['Projetos','Pipefy','Analytics','Chamados RPA'];
  const bySource = sources.map(source => {
    const subAcoes = acoesFiltradas.filter(a => a.source === source);
    const subDone  = subAcoes.filter(a => a.sc === 'done').length;
    return {f: source, total: subAcoes.length, done: subDone};
  }).filter(x => x.total > 0);

  // Area filter chips — no inline onclick, listeners added after innerHTML
  const frenteChips = todasFrentes.length > 1
    ? `<div class="filters" id="gov-frente-chips" style="margin-bottom:16px">
        <span style="font-size:11px;color:var(--ink4);text-transform:uppercase;letter-spacing:.04em">Frente</span>
        <button class="chip${!frenteAtiva ? ' active' : ''}" data-gf="">Todas</button>
        ${todasFrentes.map(f =>
          `<button class="chip${frenteAtiva === f ? ' active' : ''}" data-gf="${f.replace(/"/g,'&quot;')}">${f}</button>`
        ).join('')}
      </div>` : '';


  // Composition KPIs
  let html = `<div class="sh">Painel de Controle — visão executiva</div>
  ${frenteChips}${dateNote}
  ${barraAnalise('gov')}
  <div class="krow k5">
    <div class="kpi il">${iconeKpi('list')}<div class="knum">${total}</div><div class="klbl">Total de ações CoE</div>
      <div class="ksub">${sources.filter(f=>actions.some(a=>a.source===f)).length} fontes integradas</div></div>
    <div class="kpi gl">${iconeKpi('check')}<div class="knum">${calculatePercentage(done,total)}%</div><div class="klbl">Concluídas</div>
      <div class="ksub">${done} de ${total}</div></div>
    <div class="kpi">${iconeKpi('clock')}<div class="knum">${calculatePercentage(doing,total)}%</div><div class="klbl">Em andamento</div>
      <div class="ksub">${doing} de ${total}</div></div>
    <div class="kpi">${iconeKpi('stack')}<div class="knum">${calculatePercentage(backlog,total)}%</div><div class="klbl">Backlog / não iniciadas</div>
      <div class="ksub">${backlog} de ${total}</div></div>
    <div class="kpi">${iconeKpi('dots')}<div class="knum">${calculatePercentage(outros,total)}%</div><div class="klbl">Outros</div>
      <div class="ksub">${outrosDesc||'—'}</div></div>
  </div>`;


  // Status donut — merges Encerramento + Monitoramento into a single slice
  // ("Em encerramento" = final phase / delivered) and uses a deliberate palette:
  //   dark green = done · light green = closing (final phase) ·
  //   blue = in progress · gray = not started · amber = blocked ·
  //   red = cancelled · purple = vendor support.
  // Ordered from most advanced/positive to least. The total shown matches
  // "Total de ações CoE" because every status is included.
  const scAll = count(acoesFiltradas, a => a.sc);
  const donutDefs = [
    {label:'Concluído',       value: scAll.done    || 0,                          color:'#4DB1B3'},
    {label:'Em encerramento', value:(scAll.closing || 0) + (scAll.monitor || 0),  color:'#E66407'},
    {label:'Em andamento',    value: scAll.doing   || 0,                          color:'#0195D6'},
    {label:'Não iniciado',    value: scAll.todo    || 0,                          color:'#9CA3AF'},
    {label:'Impedimentos',    value:(scAll.blocked || 0) + (scAll.vendor  || 0)
                                  +(scAll.cancel  || 0) + (scAll.other   || 0),   color:'#C5284C'},
  ];
  const donutData = donutDefs.filter(d => d.value > 0);

  // Details what makes up "Impedimentos" (only shows categories with a value > 0)
  const impedimentosDesc = [
    scAll.blocked ? `${scAll.blocked} bloqueado${scAll.blocked > 1 ? 's' : ''}` : '',
    scAll.cancel  ? `${scAll.cancel} cancelado${scAll.cancel  > 1 ? 's' : ''}` : '',
    scAll.vendor  ? `${scAll.vendor} suporte/fornec.`                           : '',
    scAll.other   ? `${scAll.other} outro${scAll.other > 1 ? 's' : ''}`         : '',
  ].filter(Boolean).join(' · ');

  // Total actions per CoE team owner (ALL — open, completed, cancelled).
  // Shows ONLY the CoE team (see COE_TEAM), summed by standardized name.
  // IMPORTANT: each source has its own owner field:
  //   - Projetos/Pipefy/Analytics: 'resp' field (1 owner per item)
  //   - RPA Tickets: 'responsaveis' field (list — who works the ticket, not the
  //     requester; a ticket can have several owners, each one counts).
  // Respects each source's period filter (filtrarPorPeriodo).
  const respCoE = {};
  const addResp = nomeRaw => {
    const nome = nomePadraoCoe(nomeRaw);
    if(nome) respCoE[nome] = (respCoE[nome]||0) + 1;
  };
  // When an area filter is active: filters each source by area; RPA has no area → excluded
  filtrarPorPeriodo(App.P.proj).kept.filter(p => !frenteAtiva || p.frente === frenteAtiva).forEach(p => addResp(p.resp));
  filtrarPorPeriodo(App.P.improvements).kept.filter(m => !frenteAtiva || m.frente === frenteAtiva).forEach(m => addResp(m.resp));
  filtrarPorPeriodo(App.P.ana).kept.filter(a => !frenteAtiva || a.frente === frenteAtiva).forEach(a => addResp(a.resp));
  // RPA: always included (no filter), or when the bot's area matches the active area
  filtrarPorPeriodo(App.R).kept.filter(r => !frenteAtiva || r.area === frenteAtiva).forEach(r => (r.responsaveis||[]).forEach(addResp));
  const respTop = Object.entries(respCoE).sort((a,b) => b[1]-a[1]);
  const totalRespCoE = respTop.reduce((s,e)=>s+e[1],0); // base for the percentage

  // "By area" always shows the full picture (actions, not acoesFiltradas) for comparison
  const frCount = count(actions.filter(a => a.frente), a => a.frente);
  const fonteInfo = bySource.map(x =>
    `<span><b style="color:var(--ink2)">${x.f}</b> ${x.total} <span style="color:var(--ink4)">(${calculatePercentage(x.done,x.total)}% concl.)</span></span>`
  ).join(' &thinsp;·&thinsp; ');
  html += `<div class="g3">
    <div class="card"><div class="card-title"><i class="ti ti-chart-pie"></i> Status das ações</div>
      ${donut(donutData)}
      ${impedimentosDesc ? `<div style="margin-top:10px;padding:7px 10px;background:rgba(197,40,76,0.07);border-radius:var(--r);font-size:11px;color:var(--err)">
        <b>Impedimentos:</b> ${impedimentosDesc}
      </div>` : ''}
      <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--rule);font-size:11px;color:var(--ink3);line-height:2">${fonteInfo}</div></div>
    <div class="card"><div class="card-title"><i class="ti ti-user-bolt"></i> Por responsável <span class="rt">equipe CoE</span></div>
      ${respTop.length ? horizontalBars(respTop, {max:12, lw:130, tot:totalRespCoE}) : '<div style="font-size:12px;color:var(--ink4)">Sem dados da equipe CoE.</div>'}</div>
    <div class="card"><div class="card-title"><i class="ti ti-building"></i> Por frente</div>
      ${horizontalBars(Object.entries(frCount).sort((a,b)=>b[1]-a[1]), {max:8, lw:60, tot:Object.values(frCount).reduce((s,v)=>s+v,0)})}</div>
  </div>`;

  // Diagnostic footer — shows where each number comes from (audit trail).
  // Helps quickly spot if any source has an unexpected count.
  const diag = [
    `Pipefy: ${App.P.improvements.length}`,
    `Projetos: ${App.P.proj.length}`,
    `Analytics: ${App.P.ana.length}`,
    `Chamados RPA: ${App.R.length}`,
    `Bots: ${App.B.length}`
  ].join(' · ');
  html += `<div style="font-size:10px;color:var(--ink4);margin-top:18px;padding-top:12px;border-top:1px solid var(--rule)">
    Contagem por fonte (total sem filtro de data): ${diag}. Total combinado: ${App.P.improvements.length+App.P.proj.length+App.P.ana.length+App.R.length} ações.</div>`;

  document.getElementById('gov-content').innerHTML = html;

  // Area chip listeners — no inline onclick, zero escaping risk
  document.querySelectorAll('[data-gf]').forEach(btn => {
    btn.addEventListener('click', () => { App.govFrente = btn.dataset.gf; construirGovernanca(); });
  });

  flushCharts();
}


/*
 * construirMapaCalor() — heatmap of open Analytics actions by priority × area.
 * Rows = priorities 1 to 4. Columns = areas.
 * Cells with more open actions turn more red.
 * Only shown if there is Analytics data with priority filled in.
 */
export function construirMapaCalor(){
  const {kept:anaF} = filtrarPorPeriodo(App.P.ana);
  const {kept:projF} = filtrarPorPeriodo(App.P.proj);
  const frentes = [...new Set([...anaF,...projF].map(x=>x.frente).filter(Boolean))].sort();
  if(!anaF.length || !frentes.length) return '';
  const prios = [1,2,3,4];
  const matrix = prios.map(p => frentes.map(f =>
    anaF.filter(a => a.prio===p && a.frente===f && a.sc!=='done').length
  ));
  if(!matrix.flat().some(v => v > 0)) return '';
  return `<div class="card"><div class="card-title"><i class="ti ti-grid-dots"></i> Ações Analytics abertas — prioridade × frente
    <span class="rt">foco executivo</span></div>
    <div style="overflow-x:auto">${heatmap(matrix, prios.map(p=>`Prioridade ${p}`), frentes)}</div></div>`;
}
