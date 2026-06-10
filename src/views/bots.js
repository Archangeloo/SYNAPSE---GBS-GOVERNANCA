import { App } from '../state.js';
import { applyDate } from '../utils/date.js';
import { count, pct } from '../utils/helpers.js';
import { donut, hbars } from '../charts.js';
import { aiBar } from '../analysis.js';

// ─── buildBots ────────────────────────────────────────────────────────────────
// Monta a sub-aba Inventário de bots (dentro da aba RPA & Bots).
// FILTRO DE DATA DIFERENTE: usa AnoPRD (ano de entrada em produção), não data de ação.
export function buildBots() {
  const dr = App.dateRange;
  let B = App.B;
  let dn = '';
  if (dr.mode !== 'all') {
    const yFrom = dr.from ? dr.from.getFullYear() : null;
    const yTo   = dr.to   ? dr.to.getFullYear()   : null;
    B = App.B.filter(b => {
      const y = parseInt(b.anoPrd);
      if (isNaN(y)) return false;
      if (yFrom != null && y < yFrom) return false;
      if (yTo   != null && y > yTo)   return false;
      return true;
    });
    const semAno = App.B.filter(b => isNaN(parseInt(b.anoPrd))).length;
    dn = `<div class="note" style="background:var(--neu-bg);color:var(--ink3)"><i class="ti ti-calendar-stats"></i><div>
      Período aplicado: <b>${B.length} bots</b> que entraram em produção entre ${yFrom || '∞'} e ${yTo || '∞'}.` +
      (semAno > 0 ? ` ${semAno} bots sem ano de PRD não entram no filtro.` : '') + `</div></div>`;
  }

  document.getElementById('bots-empty').style.display  = App.B.length ? 'none' : 'block';
  document.getElementById('bots-content').style.display = App.B.length ? 'block' : 'none';
  if (!App.B.length) return;

  const prd     = B.filter(b => b.status === 'PRD').length;
  const dev     = B.filter(b => b.status === 'DEV').length;
  const backlog = B.filter(b => b.status === 'BACKLOG').length;

  let h = dn + `<div class="sh">Inventário de Bots — RPA</div>
  ${aiBar('bots')}
  <div class="krow">
    <div class="kpi"><div class="knum">${B.length}</div><div class="klbl">Total de bots</div></div>
    <div class="kpi gl"><div class="knum">${prd}</div><div class="klbl">Em produção</div><div class="ksub">${pct(prd, B.length)}% do total</div></div>
    <div class="kpi wl"><div class="knum">${dev}</div><div class="klbl">Em desenvolvimento</div></div>
    <div class="kpi"><div class="knum">${backlog}</div><div class="klbl">Backlog</div></div>
  </div>`;

  const prdBots = B.filter(b => b.status === 'PRD');
  const AREAS_PRINCIPAIS = ['P2P', 'TAX', 'H2R', 'O2C', 'R2R'];
  const porAreaPrd = count(prdBots, b => b.area);
  let outrosPrd = 0;
  const areaBots = [];
  Object.entries(porAreaPrd).forEach(([area, n]) => {
    if (AREAS_PRINCIPAIS.includes(area.toUpperCase())) areaBots.push([area, n]);
    else outrosPrd += n;
  });
  areaBots.sort((a, b) => b[1] - a[1]);
  if (outrosPrd > 0) areaBots.push(['Outros', outrosPrd]);

  h += `<div class="two">
    <div class="card"><div class="card-title"><i class="ti ti-building"></i> Bots em PRD por área</div>
      ${hbars(areaBots, { max: 6, lw: 60, tot: prd })}</div>
    <div class="card"><div class="card-title"><i class="ti ti-world"></i> Por perímetro</div>
      ${donut(Object.entries(count(prdBots, b => b.perimetro)).map(([k, v], i) => ({ label: k, value: v, color: ['var(--info)', 'var(--ok)', 'var(--warn)', 'var(--err)'][i % 4] })))}</div>
  </div>`;

  h += `<div class="two">
    <div class="card"><div class="card-title"><i class="ti ti-alert-octagon"></i> Por criticidade</div>
      ${hbars([1, 2, 3, 4].map(c => ['Criticidade ' + c, prdBots.filter(b => b.criticidade === c).length]).filter(e => e[1]), { max: 4, lw: 100 })}
      <div class="note" style="margin-top:14px;margin-bottom:0;background:var(--neu-bg);color:var(--ink3)"><i class="ti ti-info-circle"></i><div>
        <b>Critérios de criticidade:</b><br>
        <b>1 — Crítica:</b> processo essencial; falha gera impacto financeiro/fiscal imediato ou para a operação.<br>
        <b>2 — Alta:</b> processo importante com prazo sensível; falha causa atraso relevante.<br>
        <b>3 — Média:</b> processo recorrente; falha tem impacto moderado e contornável.<br>
        <b>4 — Baixa:</b> processo de apoio; falha tem baixo impacto e pode esperar.</div></div></div>
    <div class="card"><div class="card-title"><i class="ti ti-repeat"></i> Por frequência</div>
      ${hbars(Object.entries(count(prdBots.filter(b => b.freq), b => b.freq)).sort((a, b) => b[1] - a[1]), { max: 6, lw: 80 })}</div>
  </div>`;

  if (App.R.length) h += buildBotsCruzamento(B);

  h += `<div class="filters" style="margin-top:8px">
    <label>Status</label><select id="bot-fs" onchange="renderBotsList()"><option value="">Todos</option>
      <option>PRD</option><option>DEV</option><option>BACKLOG</option><option>CANCELADO</option><option>DESATIVADO</option></select>
    <label>Área</label><select id="bot-fa" onchange="renderBotsList()"><option value="">Todas</option>
      ${[...new Set(B.map(b => b.area))].filter(Boolean).sort().map(a => `<option>${a}</option>`).join('')}</select></div>
    <div class="ilist" id="bots-list"></div>`;

  document.getElementById('bots-content').innerHTML = h;
  renderBotsList();
}

// ─── buildBotsCruzamento ──────────────────────────────────────────────────────
// Tabela de cruzamento inventário × chamados: top 10 bots em PRD com mais manutenções.
function buildBotsCruzamento(Bf) {
  const norm = s => s.toLowerCase().replace(/^\[.*?\]/, '').replace(/[^a-z0-9]/g, '');
  const { kept: Rf } = applyDate(App.R);
  const chamPorProc = count(Rf, r => r.processo);
  const rows = Bf.filter(b => b.status === 'PRD').map(b => {
    const bn = norm(b.nome); let ch = 0;
    Object.entries(chamPorProc).forEach(([proc, n]) => {
      const pn = norm(proc);
      if (pn && bn && (bn.includes(pn) || pn.includes(bn))) ch += n;
    });
    return { nome: b.nome, area: b.area, crit: b.criticidade, ch };
  }).filter(r => r.ch > 0).sort((a, b) => b.ch - a.ch).slice(0, 10);
  if (!rows.length) return '';
  let tbl = '<table class="tbl"><thead><tr><th>Bot</th><th>Área</th><th>Criticidade</th><th>Chamados manut.</th></tr></thead><tbody>';
  rows.forEach(r => {
    tbl += `<tr><td style="color:var(--ink)">${r.nome}</td><td>${r.area}</td>
    <td>${r.crit ? 'Crit ' + r.crit : '—'}</td><td><span class="badge ${r.ch > 10 ? 'red' : 'warn'}">${r.ch}</span></td></tr>`;
  });
  tbl += '</tbody></table>';
  return `<div class="card"><div class="card-title"><i class="ti ti-link"></i> Bots em produção × chamados de manutenção
    <span class="rt">cruzamento inventário × Pipefy</span></div>
    <div style="font-size:11px;color:var(--ink4);margin-bottom:12px">Bots com mais manutenções são candidatos a refatoração. Match por nome do processo.</div>
    <div style="overflow-x:auto">${tbl}</div></div>`;
}

// ─── renderBotsList ───────────────────────────────────────────────────────────
// Lista filtrada de bots com filtros locais (status, área). Exibe até 200.
export function renderBotsList() {
  const fs = document.getElementById('bot-fs')?.value || '';
  const fa = document.getElementById('bot-fa')?.value || '';
  const dr = App.dateRange;
  let source = App.B;
  if (dr.mode !== 'all') {
    const yFrom = dr.from ? dr.from.getFullYear() : null;
    const yTo   = dr.to   ? dr.to.getFullYear()   : null;
    source = App.B.filter(b => {
      const y = parseInt(b.anoPrd);
      if (isNaN(y)) return false;
      if (yFrom != null && y < yFrom) return false;
      if (yTo   != null && y > yTo)   return false;
      return true;
    });
  }
  let B = source.filter(b => (!fs || b.status === fs) && (!fa || b.area === fa));
  const sb = { PRD: 'ok', DEV: 'info', BACKLOG: 'neu', CANCELADO: 'red', DESATIVADO: 'red' };
  const botDot = { PRD: '#3fa46a', DEV: '#4a90d9', BACKLOG: '#9a9a92', CANCELADO: '#d46a6a', DESATIVADO: '#d46a6a' };
  let h = B.slice(0, 200).map(b => `<div class="icard">
    <div class="iico" style="background:var(--neu-bg)"><span style="width:11px;height:11px;border-radius:50%;background:${botDot[b.status] || '#9a9a92'};display:block"></span></div>
    <div class="imain"><div class="ititle">${b.nome}</div>
      <div class="isub">
        ${b.area ? `<span class="apill">${b.area}</span>` : ''}
        ${b.perimetro && b.perimetro !== 'Brasil' ? `<span class="apill">${b.perimetro}</span>` : ''}
        ${b.dev ? `<span>${b.dev}</span>` : ''}
        ${b.freq ? `<span style="color:var(--ink4)">· ${b.freq}</span>` : ''}
        ${b.vol ? `<span style="color:var(--ink4)">· ${b.vol.toLocaleString('pt-BR')}/mês</span>` : ''}
      </div></div>
    <div class="iright">
      ${b.criticidade ? `<span style="font-size:10px;color:var(--ink4)">Crit ${b.criticidade}</span>` : ''}
      <span class="badge ${sb[b.status] || 'neu'}">${b.status}</span>
    </div></div>`).join('');
  if (B.length > 200) h += `<div class="icard" style="justify-content:center;color:var(--ink4);font-size:12px">Exibindo 200 de ${B.length}</div>`;
  const el = document.getElementById('bots-list');
  if (el) el.innerHTML = h || '<div class="empty" style="padding:24px">Nenhum bot neste filtro</div>';
}
