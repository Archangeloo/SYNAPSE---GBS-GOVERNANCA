import { App } from '../state.js';
import { applyDate, ymLabel } from '../utils/date.js';
import { count, pct } from '../utils/helpers.js';
import { donut, hbars, clusteredBars } from '../charts.js';
import { aiBar } from '../analysis.js';
import { setBadge } from '../nav.js';

// ─── buildRPAChamados ─────────────────────────────────────────────────────────
// Monta a aba RPA & Bots com 5 sub-abas: Visão geral, Top bots, Tipos de problema,
// Tempo de resolução, Chamados.
// FILTRO DE DATA: usa 'criado' (data de abertura). Todos os chamados têm essa data.
export function buildRPAChamados() {
  const { kept: R, noDate } = applyDate(App.R);
  const emptyEl = document.getElementById('rpa-empty');
  emptyEl.style.display = App.R.length ? 'none' : 'block';
  document.getElementById('rpa-content').style.display = App.R.length ? 'block' : 'none';
  if (!App.R.length) {
    emptyEl.innerHTML = App.rpaWarn
      ? `<i class="ti ti-alert-triangle" style="color:var(--warn)"></i>${App.rpaWarn}`
      : `<i class="ti ti-robot"></i>Carregue o relatório de Chamados RPA`;
    return;
  }

  const total = R.length;
  const venc  = R.filter(r => r.vencido).length;
  const procUnicos = new Set(R.map(r => r.processo).filter(p => p && p !== '(sem processo)')).size;

  let dn = '';
  if (App.dateRange.mode !== 'all') {
    dn = `<div class="note" style="background:var(--neu-bg);color:var(--ink3)"><i class="ti ti-calendar-stats"></i><div>
      Período aplicado: <b>${total} chamados</b> abertos no recorte.` +
      (noDate > 0 ? ` ${noDate} sem data de criação não entram no filtro.` : '') + `</div></div>`;
  }

  const fasesDisp = [...new Set(R.map(r => r.fase).filter(Boolean))].sort();
  const filtroStatus = `<div class="filters" style="margin-bottom:14px">
    <label>Status do chamado</label>
    <select id="rpa-fs" onchange="renderRPAStatus()"><option value="">Todos</option>
      ${fasesDisp.map(f => `<option>${f}</option>`).join('')}</select>
    <span style="font-size:11px;color:var(--ink4);margin-left:auto" id="rpa-fs-count"></span>
  </div>`;

  document.getElementById('rpage-visao').innerHTML = dn + aiBar('rpa') + filtroStatus + `<div id="rpa-visao-kpis"></div>`;
  renderRPAStatus();

  // mapa processo → área (já resolvido por enrichRPAComArea)
  const areaPorProc = {};
  R.forEach(r => { if (r.processo && !areaPorProc[r.processo]) areaPorProc[r.processo] = r.area; });
  const labelComArea = proc => {
    const a = areaPorProc[proc];
    return a && a !== '(não mapeada)' ? `${proc}  ·  ${a}` : proc;
  };

  // Sub-aba: Top Bots
  const porProcV = count(R, r => r.processo);
  const procList = Object.entries(porProcV)
    .filter(e => e[0] !== '(sem processo)')
    .sort((a, b) => b[1] - a[1])
    .map(([proc, n]) => [labelComArea(proc), n]);
  document.getElementById('rpage-bots').innerHTML =
    `<div class="card"><div class="card-title"><i class="ti ti-trophy"></i> Top bots por nº de manutenções<span class="rt">${procList.length} processos</span></div>
    ${hbars(procList, { max: 15, lw: 300, color: 'var(--err)', fixedLabel: true })}</div>`;

  // Sub-aba: Tipos de problema — barras clusterizadas
  const porProb   = count(R, r => r.problema);
  const porReexec = count(R.filter(r => r.reexec), r => r.reexec);
  const fasesDef  = [
    { key: 'Backlog',                    label: 'Backlog',         color: '#9a9a92' },
    { key: 'Identificação do problema',  label: 'Identificação',   color: '#d4a93c' },
    { key: 'Desenvolvimento da solução', label: 'Desenvolvimento', color: '#4a90d9' },
    { key: 'Reexecução',                 label: 'Reexecução',      color: '#8f6fd0' },
    { key: 'Concluído',                  label: 'Concluído',       color: '#3fa46a' }
  ];
  const probsOrd  = Object.entries(porProb).sort((a, b) => b[1] - a[1]).map(e => e[0]);
  const paletaProb = ['#4a90d9', '#d49a4a', '#3fa46a', '#8f6fd0', '#d46a6a', '#5aa0a0', '#9a7ad4'];
  const serieProb  = probsOrd.map((pr, i) => ({ key: pr, label: pr, color: paletaProb[i % paletaProb.length] }));
  const grupos = fasesDef.map(f => {
    const sub = R.filter(r => r.fase === f.key);
    const valores = {};
    probsOrd.forEach(pr => { valores[pr] = sub.filter(r => r.problema === pr).length; });
    return { label: f.label, color: f.color, valores };
  });
  document.getElementById('rpage-prob').innerHTML =
    `<div class="card"><div class="card-title"><i class="ti ti-alert-circle"></i> Tipos de problema <span class="rt">por fase do chamado</span></div>
      ${clusteredBars(grupos, serieProb)}</div>
    <div class="card"><div class="card-title"><i class="ti ti-refresh"></i> Admite reexecução?</div>
      ${donut(Object.entries(porReexec).map(([k, vv], i) => ({ label: k, value: vv, color: i === 0 ? 'var(--ok)' : 'var(--warn)' })))}</div>`;

  // Sub-aba: Tempo de resolução
  const avg = (arr, k) => { const v = arr.filter(r => r[k] != null).map(r => r[k]); return v.length ? (v.reduce((s, x) => s + x, 0) / v.length).toFixed(1) : '—'; };
  let t = `<div class="krow">
    <div class="kpi"><div class="knum sm">${avg(R, 'tIdent')}</div><div class="klbl">Média dias · Identificação</div></div>
    <div class="kpi"><div class="knum sm">${avg(R, 'tDesenv')}</div><div class="klbl">Média dias · Desenvolvimento</div></div>
    <div class="kpi"><div class="knum sm">${avg(R, 'tReexec')}</div><div class="klbl">Média dias · Reexecução</div></div>
    <div class="kpi"><div class="knum sm">${R.filter(r => r.tIdent != null || r.tDesenv != null).length}</div><div class="klbl">Chamados com tempo medido</div></div>
  </div>`;
  const procTempo = {};
  R.forEach(r => {
    const tt = (r.tIdent || 0) + (r.tDesenv || 0);
    if (tt > 0) { if (!procTempo[r.processo]) procTempo[r.processo] = { s: 0, n: 0 }; procTempo[r.processo].s += tt; procTempo[r.processo].n++; }
  });
  const procAvg = Object.entries(procTempo).filter(e => e[0] !== '(sem processo)' && e[1].n >= 3)
    .map(([k, v]) => [labelComArea(k), +(v.s / v.n).toFixed(1)]).sort((a, b) => b[1] - a[1]);
  const procUm = Object.entries(procTempo).filter(e => e[0] !== '(sem processo)' && e[1].n === 1)
    .map(([k, v]) => [labelComArea(k), +v.s.toFixed(1)]).sort((a, b) => b[1] - a[1]);
  t += `<div class="card"><div class="card-title"><i class="ti ti-clock"></i> Tempo médio de resolução por bot<span class="rt">dias · bots com 3+ chamados</span></div>
    ${hbars(procAvg, { max: 12, lw: 300, color: 'var(--warn)', fixedLabel: true })}
    <div class="note" style="margin-top:14px;margin-bottom:0;background:var(--neu-bg);color:var(--ink3)"><i class="ti ti-info-circle"></i><div>
      <b>Como o tempo é calculado:</b> para cada chamado, somamos os dias que ele passou na fase de <b>Identificação do problema</b> e na de <b>Desenvolvimento da solução</b> (as fases de trabalho ativo). A barra mostra a <b>média desses dias</b> entre os chamados de cada bot.
      Só entram bots com <b>3 chamados ou mais</b>, para a média ser estatisticamente confiável — um único chamado muito longo distorceria o número. Quanto maior a barra, mais tempo aquele bot leva, em média, para ter a manutenção resolvida.</div></div></div>`;
  if (procUm.length) {
    t += `<div class="card"><div class="card-title"><i class="ti ti-clock-hour-4"></i> Tempo de resolução — bots com apenas 1 chamado<span class="rt">dias · ${procUm.length} bots</span></div>
      ${hbars(procUm, { max: 30, lw: 300, color: '#5aa0a0', fixedLabel: true })}
      <div class="note" style="margin-top:14px;margin-bottom:0;background:var(--neu-bg);color:var(--ink3)"><i class="ti ti-info-circle"></i><div>
        Estes bots tiveram <b>um único chamado</b> no período, então o valor é o tempo <b>daquele chamado</b> (Identificação + Desenvolvimento), não uma média. Por ser uma amostra de 1, serve de referência, mas não indica um padrão do bot.</div></div></div>`;
  }
  document.getElementById('rpage-tempo').innerHTML = t;

  // Sub-aba: Lista de chamados
  document.getElementById('rpage-lista').innerHTML =
    `<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
    <input type="text" id="rsearch" placeholder="Buscar por código, processo, solicitante..." oninput="renderRPALista()" style="flex:1;max-width:360px">
    <span style="font-size:11px;color:var(--ink4)" id="rlista-count">${total} chamados</span></div>
    <div class="card np"><div style="overflow-x:auto"><table class="tbl" style="margin:0">
    <thead><tr><th style="padding-left:20px">Código</th><th>Processo</th><th>Problema</th><th>Fase</th><th>Mês</th><th style="padding-right:20px">Status</th></tr></thead>
    <tbody id="rlista-body"></tbody></table></div></div>`;
  renderRPALista();
  setBadge('nb-rpa', venc > 0 ? venc + ' venc' : total, venc > 0 ? 'warn' : '');
}

// ─── renderRPAStatus ──────────────────────────────────────────────────────────
// KPIs + gráficos da visão geral de Chamados RPA, com filtro local de fase.
export function renderRPAStatus() {
  const { kept: R0 } = applyDate(App.R);
  const fs = document.getElementById('rpa-fs')?.value || '';
  const R  = fs ? R0.filter(r => r.fase === fs) : R0;
  const total  = R.length;
  const venc   = R.filter(r => r.vencido).length;
  const concl  = R.filter(r => r.fase.toLowerCase().includes('conclu')).length;
  const abertos= total - concl;
  const reexec = R.filter(r => r.problema.toLowerCase().includes('reexecu')).length;
  const procUnicos = new Set(R.map(r => r.processo).filter(p => p && p !== '(sem processo)')).size;
  const cnt = document.getElementById('rpa-fs-count');
  if (cnt) cnt.textContent = fs ? `${total} chamados em "${fs}"` : `${total} chamados`;

  let v = `<div class="krow k5">
    <div class="kpi"><div class="knum">${total}</div><div class="klbl">Total chamados</div><div class="ksub">${procUnicos} processos distintos</div></div>
    <div class="kpi gl"><div class="knum">${concl}</div><div class="klbl">Concluídos</div><div class="ksub">${pct(concl, total)}%</div></div>
    <div class="kpi il"><div class="knum">${abertos}</div><div class="klbl">Abertos</div></div>
    <div class="kpi dl"><div class="knum">${venc}</div><div class="klbl">Vencidos</div><div class="ksub">${pct(venc, total)}% do total</div></div>
    <div class="kpi wl"><div class="knum">${reexec}</div><div class="klbl">Reexecuções</div></div>
  </div>`;

  const porMes = {}, porMesV = {};
  R.forEach(r => { if (r.mes) { porMes[r.mes] = (porMes[r.mes] || 0) + 1; if (r.vencido) porMesV[r.mes] = (porMesV[r.mes] || 0) + 1; } });
  const meses = Object.keys(porMes).sort();
  const mx = Math.max(...meses.map(m => porMes[m]), 1);
  let vol = '<div class="vchart">';
  meses.slice(-12).forEach(m => {
    const tt = porMes[m] || 0, vv = porMesV[m] || 0;
    const hTot = Math.round(tt / mx * 100);
    vol += `<div class="vcol"><div class="vcol-bars">
      <div class="vcol-num" style="bottom:calc(${hTot}% + 2px)">${tt}</div>
      <div class="vbar-total" style="height:${hTot}%"></div>
      <div class="vbar-inc" style="height:${Math.round(vv / mx * 100)}%"></div>
    </div><div class="vcol-lbl">${ymLabel(m)}</div>${vv > 0 ? `<div class="vcol-venc">${vv} venc.</div>` : ''}</div>`;
  });
  vol += '</div><div class="vlegend"><div class="vleg"><div class="vleg-dot" style="background:var(--brand);opacity:.3"></div>Total</div><div class="vleg"><div class="vleg-dot" style="background:var(--err)"></div>Vencidos</div></div>';
  v += `<div class="card"><div class="card-title"><i class="ti ti-chart-bar"></i> Volume mensal</div>${vol}</div>`;

  const AREAS_PRINCIPAIS = ['P2P', 'TAX', 'H2R', 'O2C', 'R2R'];
  const porArea = count(R, r => r.area || '(não mapeada)');
  let outrosArea = 0;
  const areaEntries = [];
  Object.entries(porArea).forEach(([area, n]) => {
    if (AREAS_PRINCIPAIS.includes(area.toUpperCase()) || area === '(não mapeada)') areaEntries.push([area, n]);
    else outrosArea += n;
  });
  areaEntries.sort((a, b) => b[1] - a[1]);
  if (outrosArea > 0) areaEntries.push(['Outros', outrosArea]);
  v += `<div class="two">
    <div class="card"><div class="card-title"><i class="ti ti-building"></i> Tickets por área</div>
      ${hbars(areaEntries, { max: 12, lw: 120, tot: total, fixedLabel: true })}</div>
    <div class="card"><div class="card-title"><i class="ti ti-chart-pie"></i> Status (fase) dos chamados</div>
      ${donut(Object.entries(count(R, r => r.fase)).map(([k, vv], i) => ({ label: k, value: vv, color: ['var(--ok)', 'var(--info)', 'var(--warn)', 'var(--err)', '#7c5cbf', 'var(--ink4)'][i % 6] })))}</div>
  </div>`;
  document.getElementById('rpa-visao-kpis').innerHTML = v;
}

// ─── renderRPALista ───────────────────────────────────────────────────────────
// Lista paginada de chamados com busca. Exibe até 1000; avisa se houver mais.
export function renderRPALista() {
  const { kept: R } = applyDate(App.R);
  const q = (document.getElementById('rsearch')?.value || '').toLowerCase();
  const vis = q ? R.filter(r => (r.cod + r.processo + r.solicitante + r.problema).toLowerCase().includes(q)) : R;
  const cnt = document.getElementById('rlista-count');
  if (cnt) cnt.textContent = vis.length + ' chamados';
  let h = vis.slice(0, 1000).map(r => {
    const concl = r.fase.toLowerCase().includes('conclu');
    return `<tr>
      <td style="padding-left:20px;font-family:monospace;font-size:11px;color:var(--ink3)">${r.cod}</td>
      <td style="font-size:11px">${r.processo}</td>
      <td style="font-size:11px;color:var(--ink3)">${r.problema}</td>
      <td><span class="badge ${concl ? 'ok' : 'info'}" style="font-size:9px">${r.fase}</span></td>
      <td style="font-size:11px;color:var(--ink4)">${ymLabel(r.mes)}</td>
      <td style="padding-right:20px">${r.vencido ? '<span class="badge red">Vencido</span>' : '<span class="badge neu">No prazo</span>'}</td></tr>`;
  }).join('');
  if (vis.length > 1000) h += `<tr><td colspan="6" style="text-align:center;padding:16px;color:var(--ink4);font-size:12px">Exibindo 1000 de ${vis.length} — use a busca para refinar</td></tr>`;
  const b = document.getElementById('rlista-body');
  if (b) b.innerHTML = h;
}
