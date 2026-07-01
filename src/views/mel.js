import { App } from '../state.js';
import { applyDate } from '../utils/date.js';
import { STATUS_PT, STATUS_COLOR, EQUIPE_MEL } from '../constants.js';
import { count, pct } from '../utils/helpers.js';
import { donut, hbars } from '../charts.js';
import { aiBar } from '../analysis.js';
import { setBadge } from '../nav.js';

// ─── MÓDULO: views/mel.js ────────────────────────────────────────────────────
// Aba Pipefy Melhorias: KPIs, gráficos de status/frente/complexidade/responsável.
//
// Exporta:
//   buildMel() — renderiza a aba completa
//
// ATENÇÃO — filtro de data por intervalo:
//   Usa dtInicio + dtFim (intervalo de desenvolvimento). Uma melhoria entra no
//   recorte se esteve ativa em algum momento do período selecionado.
//   Melhorias de backlog sem nenhuma data são sempre incluídas.
// ─────────────────────────────────────────────────────────────────────────────

// ─── buildMel ─────────────────────────────────────────────────────────────────
// Monta a aba Pipefy Melhorias.
// FILTRO DE DATA: usa DataConclusaoRealDesenvolvimento.
// Melhorias em backlog/planejamento sem essa data ficam fora do filtro — correto.
export function buildMel() {
  const { kept: M, noDate } = applyDate(App.P.mel);
  document.getElementById('mel-empty').style.display  = App.P.mel.length ? 'none' : 'block';
  document.getElementById('mel-content').style.display = App.P.mel.length ? 'block' : 'none';
  if (!App.P.mel.length) return;

  const done    = M.filter(m => m.sc === 'done').length;
  const backlog = M.filter(m => m.sc === 'todo').length;
  const blocked = M.filter(m => m.sc === 'blocked').length;

  let dn = '';
  if (App.dateRange.mode !== 'all') {
    const semInicio = App.P.mel.filter(m => !m.dtInicio).length;
    const semFim    = App.P.mel.filter(m => !m.dtFim).length;
    dn = `<div class="note" style="background:var(--neu-bg);color:var(--ink3)"><i class="ti ti-calendar-stats"></i><div>
      Período aplicado: <b>${M.length} melhorias</b> ativas no recorte (começaram ou concluíram no intervalo).` +
      (noDate > 0 ? ` ${noDate} sem nenhuma data não entram no filtro.` : '') +
      `<br><span style="opacity:.85">No Pipefy, ${semInicio} de ${App.P.mel.length} melhorias estão sem data de início e ${semFim} sem data de conclusão — preencher essas datas amplia a análise por período.</span></div></div>`;
  }

  const fluxosUnicos = new Set(M.map(m => m.fluxo).filter(Boolean)).size;

  // ── Progresso até outubro 2025 (prazo final) ─────────────────────────────
  // Usa App.P.mel (todos os registros, sem filtro global de data) para dar a
  // visão do programa completo até o prazo final de outubro.
  const OCT_2025      = new Date(2025, 9, 31);
  const emEscopo      = App.P.mel.filter(m => m.sc !== 'cancel' && (!m.dtFim || m.dtFim <= OCT_2025));
  const conclEscopo   = emEscopo.filter(m => m.sc === 'done').length;
  const andamEscopo   = emEscopo.filter(m => m.sc === 'doing' || m.sc === 'vendor').length;
  const backlogEscopo = emEscopo.filter(m => m.sc === 'todo').length;
  const bloqEscopo    = emEscopo.filter(m => m.sc === 'blocked').length;
  const pctConclEsc   = pct(conclEscopo, emEscopo.length);

  // Barra de progresso empilhada: concluídas | em andamento | bloqueadas | backlog
  const barConclW   = pct(conclEscopo,   emEscopo.length);
  const barAndamW   = pct(andamEscopo,   emEscopo.length);
  const barBloqW    = pct(bloqEscopo,    emEscopo.length);
  const barBacklogW = pct(backlogEscopo, emEscopo.length);

  const progressBar = `
    <div style="display:flex;height:10px;border-radius:6px;overflow:hidden;margin:10px 0 6px">
      <div style="width:${barConclW}%;background:#3fa46a" title="Concluídas: ${conclEscopo}"></div>
      <div style="width:${barAndamW}%;background:#4a90d9" title="Em andamento: ${andamEscopo}"></div>
      <div style="width:${barBloqW}%;background:#d4a93c" title="Bloqueadas: ${bloqEscopo}"></div>
      <div style="width:${barBacklogW}%;background:#d0d2d6" title="Backlog: ${backlogEscopo}"></div>
    </div>
    <div style="display:flex;gap:16px;flex-wrap:wrap;font-size:10px;color:var(--ink3)">
      <span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#3fa46a;margin-right:4px"></span>Concluídas ${conclEscopo}</span>
      <span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#4a90d9;margin-right:4px"></span>Em andamento ${andamEscopo}</span>
      <span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#d4a93c;margin-right:4px"></span>Bloqueadas ${bloqEscopo}</span>
      <span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#d0d2d6;margin-right:4px"></span>Backlog ${backlogEscopo}</span>
    </div>`;

  let h = dn + `<div class="sh">Pipefy — Melhorias & Ajustes</div>
  ${aiBar('mel')}
  <div class="krow k5">
    <div class="kpi"><div class="knum">${M.length}</div><div class="klbl">Total melhorias</div></div>
    <div class="kpi gl"><div class="knum">${done}</div><div class="klbl">Concluídas</div><div class="ksub">${pct(done, M.length)}% do total</div></div>
    <div class="kpi"><div class="knum">${backlog}</div><div class="klbl">Backlog</div></div>
    <div class="kpi wl"><div class="knum">${blocked}</div><div class="klbl">Bloqueadas</div></div>
    <div class="kpi il"><div class="knum">${fluxosUnicos}</div><div class="klbl">Fluxos (processos)</div><div class="ksub">distintos no recorte</div></div>
  </div>
  <div class="card">
    <div class="card-title"><i class="ti ti-flag"></i> Concluídas vs Backlog — prazo final outubro 2025
      <span class="rt">${emEscopo.length} melhorias em escopo</span>
    </div>
    <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:4px">
      <span style="font-family:'Syne';font-size:32px;font-weight:700;color:#3fa46a">${pctConclEsc}%</span>
      <span style="font-size:13px;color:var(--ink3)">concluídas</span>
      <span style="font-size:12px;color:var(--ink4);margin-left:4px">${conclEscopo} de ${emEscopo.length}</span>
    </div>
    ${progressBar}
  </div>`;

  h += `<div class="two">
    <div class="card"><div class="card-title"><i class="ti ti-chart-pie"></i> Status</div>
      ${donut(['done', 'doing', 'todo', 'vendor', 'blocked', 'cancel'].map(k => ({ label: STATUS_PT[k], value: M.filter(m => m.sc === k).length, color: STATUS_COLOR[k] })).filter(d => d.value))}</div>
    <div class="card"><div class="card-title"><i class="ti ti-building"></i> Por frente</div>
      ${hbars(Object.entries(count(M, m => m.frente)).sort((a, b) => b[1] - a[1]), { max: 8, lw: 60, tot: M.length })}</div>
  </div>`;

  h += `<div class="two">
    <div class="card"><div class="card-title"><i class="ti ti-stack-2"></i> Por complexidade</div>
      ${hbars(Object.entries(count(M.filter(m => m.complex), m => m.complex)).sort((a, b) => b[1] - a[1]), { max: 6, lw: 90 })}</div>
    <div class="card"><div class="card-title"><i class="ti ti-user-code"></i> Por responsável</div>
      ${(() => {
        const ehEquipe = nome => EQUIPE_MEL.some(p => nome.toLowerCase().includes(p));
        const dados = Object.entries(count(M.filter(m => m.resp && ehEquipe(m.resp)), m => m.resp)).sort((a, b) => b[1] - a[1]);
        return hbars(dados, { max: 8, lw: 130 });
      })()}</div>
  </div>`;

  document.getElementById('mel-content').innerHTML = h;
  setBadge('nb-mel', M.length, '');
}
