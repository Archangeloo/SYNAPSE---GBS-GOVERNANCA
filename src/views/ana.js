// ─── MODULE: views/ana.js ──────────────────────────────────────────────────
// VIEW: ANALYTICS
// DATE FILTER: uses DataAbertura (start of development)
// or DataFechamento (end of validation) as a fallback.
// Many activities have no date filled in — the interface shows how many were excluded.
// ─────────────────────────────────────────────────────────────────────────────

import { App } from '../state.js';
import { STATUS_PT, STATUS_COLOR } from '../constants.js';
import { statusCounts, count, calculatePercentage, sortedCountEntries, iconeKpi } from '../utils/helpers.js';
import { filtrarPorPeriodo } from '../utils/date.js';
import { donut, horizontalBars, flushCharts } from '../charts.js';
import { barraAnalise } from '../analysis.js';
import { setBadge } from '../nav.js';
import { construirMapaCalor } from './gov.js';

/*
 * buildAnalytics() — Analytics tab.
 *
 * Reads:  App.P.ana
 * Writes: #ana-content
 * Called by: generate() and renderAll()
 *
 * ATTENTION — low date coverage:
 *   Many activities have no date filled in on the spreadsheet.
 *   With an active filter, only activities WITH a date are included.
 *   The interface shows how many were excluded, for transparency.
 *
 * Produces:
 *  - KPIs: total, completed, in progress, not started
 *  - Status donut, bars by priority, area and owner
 *  - Priority × area heatmap (via construirMapaCalor(), called directly here)
 */
export function buildAnalytics(){
  const {kept:A, noDate} = filtrarPorPeriodo(App.P.ana);
  document.getElementById('ana-empty').style.display  = App.P.ana.length ? 'none' : 'block';
  document.getElementById('ana-content').style.display = App.P.ana.length ? 'block' : 'none';
  if(!App.P.ana.length) return;
  const sc   = statusCounts(A);
  const done = sc.done;
  const doing = sc.doing;
  const todo  = sc.todo;
  const comData = A.filter(a => a.dtFim).length;

  // Informational note: how many activities have a date vs. how many don't
  let dateNote = '';
  if(App.dateRange.mode !== 'all'){
    dateNote = `<div class="note" style="background:var(--neu-bg);color:var(--ink3)"><i class="ti ti-calendar-stats"></i><div>
      Período aplicado: <b>${A.length} atividades</b> no recorte.` +
      (noDate>0 ? ` ${noDate} sem data não entram no filtro.` : '') +
      `<br><span style="font-size:10px;opacity:.6;font-style:italic">Referência de data: data de abertura da atividade (ou fechamento como fallback)</span>
      </div></div>`;
  } else if(comData < A.length){
    // no active filter: warns how many have a date (relevant to the evolution chart)
    dateNote = `<div class="note"><i class="ti ti-info-circle"></i><div>${comData} de ${A.length} atividades têm data registrada. As ${A.length-comData} restantes não têm data preenchida na base, então não entram nos cálculos por período.</div></div>`;
  }

  // only priorities 1 to 5 (values outside that range are dropped from the chart)
  const prioCount = count(A.filter(a => a.prio && a.prio>=1 && a.prio<=5), a => 'Prioridade '+a.prio);
  let html = dateNote + `<div class="sh">Analytics</div>
  ${barraAnalise('ana')}
  <div class="krow">
    <div class="kpi">${iconeKpi('chartbar')}<div class="knum">${A.length}</div><div class="klbl">Total</div></div>
    <div class="kpi gl">${iconeKpi('check')}<div class="knum">${done}</div><div class="klbl">Concluídas</div><div class="ksub">${calculatePercentage(done,A.length)}%</div></div>
    <div class="kpi il">${iconeKpi('clock')}<div class="knum">${doing}</div><div class="klbl">Em andamento</div></div>
    <div class="kpi">${iconeKpi('minus')}<div class="knum">${todo}</div><div class="klbl">Não iniciadas</div></div>
  </div>`;
  html += `<div class="g3">
    <div class="card"><div class="card-title"><i class="ti ti-chart-pie"></i> Status</div>
      ${donut(['done','doing','todo','blocked','cancel'].map(k=>({label:STATUS_PT[k],value:A.filter(a=>a.sc===k).length,color:STATUS_COLOR[k]})).filter(d=>d.value))}</div>
    <div class="card"><div class="card-title"><i class="ti ti-flag"></i> Por prioridade</div>
      ${horizontalBars(Object.entries(prioCount).sort((a,b)=>{const na=+a[0].match(/\d+/),nb=+b[0].match(/\d+/);return na-nb;}),{max:10,lw:90})}</div>
    <div class="card"><div class="card-title"><i class="ti ti-building"></i> Por frente</div>
      ${horizontalBars(sortedCountEntries(A.filter(a=>a.frente), a=>a.frente),{max:8,lw:60,tot:A.length})}</div>
  </div>`;
  html += `<div class="two">
    <div class="card"><div class="card-title"><i class="ti ti-user"></i> Por responsável</div>
      ${horizontalBars(sortedCountEntries(A.filter(a=>a.resp), a=>a.resp),{max:8,lw:140})}</div>
    ${construirMapaCalor()}
  </div>`;
  document.getElementById('ana-content').innerHTML = html;
  flushCharts();
  setBadge('nb-ana', A.length, '');
}
