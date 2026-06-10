import { App } from '../state.js';
import { applyDate } from '../utils/date.js';
import { STATUS_PT, STATUS_COLOR } from '../constants.js';
import { count, pct } from '../utils/helpers.js';
import { donut, hbars } from '../charts.js';
import { buildHeatmap } from './gov.js';
import { aiBar } from '../analysis.js';
import { setBadge } from '../nav.js';

// ─── buildAna ─────────────────────────────────────────────────────────────────
// Monta a aba Analytics.
// FILTRO DE DATA: usa DataAbertura (início) ou DataFechamento (término) como fallback.
// ~49 de 161 atividades têm DataAbertura; 36 têm DataFechamento; ~76 sem data.
export function buildAna() {
  const { kept: A, noDate } = applyDate(App.P.ana);
  document.getElementById('ana-empty').style.display  = App.P.ana.length ? 'none' : 'block';
  document.getElementById('ana-content').style.display = App.P.ana.length ? 'block' : 'none';
  if (!App.P.ana.length) return;

  const done  = A.filter(a => a.sc === 'done').length;
  const doing = A.filter(a => a.sc === 'doing').length;
  const todo  = A.filter(a => a.sc === 'todo').length;
  const comData = A.filter(a => a.dtFim).length;

  let dn = '';
  if (App.dateRange.mode !== 'all') {
    dn = `<div class="note" style="background:var(--neu-bg);color:var(--ink3)"><i class="ti ti-calendar-stats"></i><div>
      Período aplicado: <b>${A.length} atividades</b> no recorte.` +
      (noDate > 0 ? ` ${noDate} sem data não entram no filtro.` : '') + `</div></div>`;
  } else if (comData < A.length) {
    dn = `<div class="note"><i class="ti ti-info-circle"></i><div>${comData} de ${A.length} atividades têm data registrada. As ${A.length - comData} restantes não têm data preenchida na base, então não entram nos cálculos por período.</div></div>`;
  }

  const prioCount = count(A.filter(a => a.prio && a.prio >= 1 && a.prio <= 5), a => 'Prioridade ' + a.prio);
  let h = dn + `<div class="sh">Analytics</div>
  ${aiBar('ana')}
  <div class="krow">
    <div class="kpi"><div class="knum">${A.length}</div><div class="klbl">Total</div></div>
    <div class="kpi gl"><div class="knum">${done}</div><div class="klbl">Concluídas</div><div class="ksub">${pct(done, A.length)}%</div></div>
    <div class="kpi il"><div class="knum">${doing}</div><div class="klbl">Em andamento</div></div>
    <div class="kpi"><div class="knum">${todo}</div><div class="klbl">Não iniciadas</div></div>
  </div>`;

  h += `<div class="two">
    <div class="card"><div class="card-title"><i class="ti ti-chart-pie"></i> Status</div>
      ${donut(['done', 'doing', 'todo', 'blocked', 'cancel'].map(k => ({ label: STATUS_PT[k], value: A.filter(a => a.sc === k).length, color: STATUS_COLOR[k] })).filter(d => d.value))}</div>
    <div class="card"><div class="card-title"><i class="ti ti-flag"></i> Por prioridade</div>
      ${hbars(Object.entries(prioCount).sort((a, b) => { const na = +a[0].match(/\d+/), nb = +b[0].match(/\d+/); return na - nb; }), { max: 10, lw: 90 })}</div>
  </div>`;

  h += `<div class="two">
    <div class="card"><div class="card-title"><i class="ti ti-building"></i> Por frente</div>
      ${hbars(Object.entries(count(A.filter(a => a.frente), a => a.frente)).sort((a, b) => b[1] - a[1]), { max: 8, lw: 60, tot: A.length })}</div>
    <div class="card"><div class="card-title"><i class="ti ti-user"></i> Por responsável</div>
      ${hbars(Object.entries(count(A.filter(a => a.resp), a => a.resp)).sort((a, b) => b[1] - a[1]), { max: 8, lw: 140 })}</div>
  </div>`;

  h += buildHeatmap();
  document.getElementById('ana-content').innerHTML = h;
  setBadge('nb-ana', A.length, '');
}
