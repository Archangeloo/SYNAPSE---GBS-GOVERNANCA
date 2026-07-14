// ─── MODULE: views/rpa.js ──────────────────────────────────────────────────
// VIEW: RPA TICKETS (5 sub-tabs)
// DATE FILTER: uses 'criado' (ticket opening date).
// Every ticket has this date filled in (a required field in Pipefy).
// Sub-tabs: Overview, Top bots, Problem types, Resolution time, Tickets.
// ─────────────────────────────────────────────────────────────────────────────

import { App } from '../state.js';
import { MAIN_RPA_AREAS } from '../constants.js';
import { count, calculatePercentage, sortedCountEntries, averageField, iconeKpi } from '../utils/helpers.js';
import { filtrarPorPeriodo, toYearMonthLabel } from '../utils/date.js';
import { donut, horizontalBars, clusteredBars, verticalBarsChart, flushCharts } from '../charts.js';
import { barraAnalise } from '../analysis.js';
import { setBadge } from '../nav.js';

/*
 * buildRPATickets() — RPA & Bots tab (ticket sub-tabs).
 *
 * Reads:  App.R (tickets), App.B (inventory, via areaPorProc)
 * Writes: #rpa-empty / #rpa-content  (visibility)
 *          #rpage-visao   → structure + calls renderRPAStatus()
 *          #rpage-bots    → top bots by maintenance volume
 *          #rpage-prob    → problem types × phase (clusteredBars)
 *          #rpage-tempo   → average time per bot
 *          #rpage-lista   → paginated table with search
 * Called by: generate() and renderAll()
 *
 * FUNCTION STRUCTURE:
 *   1. Validation and date-filter note
 *   2. Overview sub-tab  → htmlVisao + renderRPAStatus()
 *   3. Top Bots sub-tab     → htmlTopBots
 *   4. Problem Types sub-tab → htmlProblemas
 *   5. Time sub-tab        → htmlTempo
 *   6. List sub-tab        → htmlLista + renderRPAList()
 */
export function buildRPATickets(){
  const {kept: chamados, noDate} = filtrarPorPeriodo(App.R);
  const emptyEl = document.getElementById('rpa-empty');
  emptyEl.style.display  = App.R.length ? 'none' : 'block';
  document.getElementById('rpa-content').style.display = App.R.length ? 'block' : 'none';
  // if there was a wrong-file warning, shows a specific message instead of the default text
  if(!App.R.length){
    emptyEl.innerHTML = App.rpaWarn
      ? `<i class="ti ti-alert-triangle" style="color:var(--warn)"></i>${App.rpaWarn}`
      : `<i class="ti ti-robot"></i>Carregue o relatório de Chamados RPA`;
    return;
  }

  const total      = chamados.length;
  const venc       = chamados.filter(r => r.vencido).length;
  const concl      = chamados.filter(r => r.fase.toLowerCase().includes('conclu')).length;
  const abertos    = total - concl;
  const reexec     = chamados.filter(r => r.problema.toLowerCase().includes('reexecu')).length;
  const procUnicos = new Set(chamados.map(r=>r.processo).filter(p=>p&&p!=='(sem processo)')).size;

  let dateNote = '';
  if(App.dateRange.mode !== 'all'){
    dateNote = `<div class="note" style="background:var(--neu-bg);color:var(--ink3)"><i class="ti ti-calendar-stats"></i><div>
      Período aplicado: <b>${total} chamados</b> abertos no recorte.` +
      (noDate>0 ? ` ${noDate} sem data de criação não entram no filtro.` : '') +
      `<br><span style="font-size:10px;opacity:.6;font-style:italic">Referência de data: data de abertura do chamado</span>
      </div></div>`;
  }

  // Local status (phase) filter — options derived from the phases present in the data
  const fasesDisp = [...new Set(chamados.map(r=>r.fase).filter(Boolean))].sort();
  const filtroStatus = `<div class="filters" style="margin-bottom:14px">
    <label>Status do chamado</label>
    <select id="rpa-fs" onchange="renderRPAStatus()"><option value="">Todos</option>
      ${fasesDisp.map(f=>`<option>${f}</option>`).join('')}</select>
    <span style="font-size:11px;color:var(--ink4);margin-left:auto" id="rpa-fs-count"></span>
  </div>`;

  let htmlVisao = dateNote + barraAnalise('rpa') + filtroStatus + `<div id="rpa-visao-kpis"></div>`;
  document.getElementById('rpage-visao').innerHTML = htmlVisao;
  // the KPIs and charts are rendered by renderRPAStatus (it respects the status filter)
  renderRPAStatus();

  const labelComArea = rpaLabelWithArea(chamados);
  buildRPATabTopBots(chamados, labelComArea);
  buildRPATabProblems(chamados);
  buildRPATabTime(chamados, labelComArea);
  buildRPATabList(chamados, total, venc);
}

// Returns a function that formats "Nome do bot  ·  ÁREA" for chart labels.
function rpaLabelWithArea(chamados) {
  const areaPorProc = {};
  chamados.forEach(r => { if(r.processo && !areaPorProc[r.processo]) areaPorProc[r.processo] = r.area; });
  return proc => {
    const area = areaPorProc[proc];
    return area && area !== '(não mapeada)' ? `${proc}  ·  ${area}` : proc;
  };
}

function buildRPATabTopBots(chamados, labelComArea) {
  const procList = sortedCountEntries(chamados, r => r.processo)
    .filter(([proc]) => proc !== '(sem processo)')
    .map(([proc, n]) => [labelComArea(proc), n]);
  document.getElementById('rpage-bots').innerHTML =
    `<div class="card"><div class="card-title"><i class="ti ti-trophy"></i> Top bots por nº de manutenções<span class="rt">${procList.length} processos</span></div>
      ${horizontalBars(procList,{max:15,lw:300,color:'var(--err)',fixedLabel:true})}</div>`;
  flushCharts();
}

function buildRPATabProblems(chamados) {
  const porProb   = count(chamados, r => r.problema);
  const porReexec = count(chamados.filter(r=>r.reexec), r => r.reexec);
  const porIntext = count(chamados.filter(r=>r.intext), r => r.intext);

  const fasesDef = [
    {key:'Backlog',                    label:'Backlog',         color:'#9CA3AF'},
    {key:'Identificação do problema',  label:'Identificação',   color:'#E66407'},
    {key:'Desenvolvimento da solução', label:'Desenvolvimento', color:'#0195D6'},
    {key:'Reexecução',                 label:'Reexecução',      color:'#4DB1B3'},
    {key:'Concluído',                  label:'Concluído',       color:'#0F5299'}
  ];
  const areasDef = [
    {key:'P2P',           label:'P2P',         color:'#0195D6'},
    {key:'TAX',           label:'TAX',         color:'#E66407'},
    {key:'H2R',           label:'H2R',         color:'#4DB1B3'},
    {key:'O2C',           label:'O2C',         color:'#8B6FD4'},
    {key:'R2R',           label:'R2R',         color:'#C5284C'},
    {key:'(não mapeada)', label:'Não mapeada', color:'#9CA3AF'}
  ];
  const paletaProb = ['#0195D6','#E66407','#4DB1B3','#C5284C','#E83430','#0F5299','#8B6FD4'];
  const probsOrd   = Object.entries(porProb).sort((a,b)=>b[1]-a[1]).map(e=>e[0]);
  const serieProb  = probsOrd.map((pr,i) => ({key:pr, label:pr, color:paletaProb[i%paletaProb.length]}));

  const gruposProb = fasesDef.map(f => {
    const sub = chamados.filter(r => r.fase===f.key);
    const valores = {};
    probsOrd.forEach(pr => { valores[pr] = sub.filter(r=>r.problema===pr).length; });
    return {label:f.label, color:f.color, valores};
  });
  const gruposArea = areasDef
    .map(a => {
      const sub = chamados.filter(r => r.area === a.key);
      const valores = {};
      probsOrd.forEach(pr => { valores[pr] = sub.filter(r=>r.problema===pr).length; });
      return {label:a.label, color:a.color, valores};
    })
    .filter(g => probsOrd.some(pr => g.valores[pr] > 0));

  const reexecDonut = donut(Object.entries(porReexec).map(([k,vv],i)=>({label:k,value:vv,color:i===0?'var(--ok)':'var(--warn)'})));
  const intextEntries = Object.entries(porIntext);
  const intextDonut = intextEntries.length
    ? donut(intextEntries.map(([k,vv])=>({label:k,value:vv,color:k.toLowerCase().includes('intern')?'var(--info)':'var(--warn)'})))
    : `<div style="font-size:12px;color:var(--ink4);font-style:italic">Campo "Interno ou externo?" ainda não disponível nos dados.<br>Adicione esse campo ao formulário RPA no Pipefy para habilitar esta análise.</div>`;

  document.getElementById('rpage-prob').innerHTML =
    `<div class="card"><div class="card-title"><i class="ti ti-alert-circle"></i> Tipos de problema <span class="rt">por fase do chamado</span></div>
      ${clusteredBars(gruposProb, serieProb)}</div>
    <div class="card"><div class="card-title"><i class="ti ti-building"></i> Tipos de problema <span class="rt">por área</span></div>
      ${clusteredBars(gruposArea, serieProb)}</div>
    <div class="two">
      <div class="card"><div class="card-title"><i class="ti ti-refresh"></i> Admite reexecução?</div>
        ${reexecDonut}
        <div class="note" style="margin-top:14px;margin-bottom:0;background:var(--neu-bg);color:var(--ink3)"><i class="ti ti-info-circle"></i><div>
          <b>O que é reexecução?</b> Indica se o bot pode ser rodado novamente após uma falha sem risco de duplicar transações.
          <b>Admite:</b> basta re-executar — o resultado é o mesmo.
          <b>Não admite:</b> é preciso investigar até onde processou antes de qualquer ação (ex: evitar pagamento duplo ou lançamento duplicado no SAP).
        </div></div></div>
      <div class="card"><div class="card-title"><i class="ti ti-arrow-fork"></i> Causa interna ou externa?</div>
        ${intextDonut}</div>
    </div>`;
  flushCharts();
}

function buildRPATabTime(chamados, labelComArea) {
  const tempoPorProcesso = {};
  chamados.forEach(r => {
    const diasAtivos = (r.tIdent || 0) + (r.tDesenv || 0);
    if (diasAtivos > 0) {
      if (!tempoPorProcesso[r.processo]) tempoPorProcesso[r.processo] = { soma: 0, contagem: 0 };
      tempoPorProcesso[r.processo].soma     += diasAtivos;
      tempoPorProcesso[r.processo].contagem += 1;
    }
  });
  const procAvg = Object.entries(tempoPorProcesso)
    .filter(([proc, d]) => proc !== '(sem processo)' && d.contagem >= 3)
    .map(([proc, d]) => [labelComArea(proc), +(d.soma / d.contagem).toFixed(1)])
    .sort((a, b) => b[1] - a[1]);
  const procUm = Object.entries(tempoPorProcesso)
    .filter(([proc, d]) => proc !== '(sem processo)' && d.contagem === 1)
    .map(([proc, d]) => [labelComArea(proc), +d.soma.toFixed(1)])
    .sort((a, b) => b[1] - a[1]);

  const notaTempoMedio = `<div class="note" style="margin-top:14px;margin-bottom:0;background:var(--neu-bg);color:var(--ink3)"><i class="ti ti-info-circle"></i><div>Soma dos dias em <b>Identificação</b> + <b>Desenvolvimento</b> dividida pelo nº de chamados do bot. Só bots com <b>3+ chamados</b> entram (evita distorção de amostra única).</div></div>`;
  const cardTempoMedio = `<div class="card"><div class="card-title"><i class="ti ti-clock"></i> Tempo médio por bot<span class="rt">dias · 3+ chamados</span></div>
    ${horizontalBars(procAvg,{max:12,lw:200,color:'var(--warn)'})}${notaTempoMedio}</div>`;

  let html = `<div class="krow">
    <div class="kpi">${iconeKpi('clock')}<div class="knum sm">${averageField(chamados,'tIdent')}</div><div class="klbl">Média dias · Identificação</div></div>
    <div class="kpi">${iconeKpi('clock')}<div class="knum sm">${averageField(chamados,'tDesenv')}</div><div class="klbl">Média dias · Desenvolvimento</div></div>
    <div class="kpi">${iconeKpi('clock')}<div class="knum sm">${averageField(chamados,'tReexec')}</div><div class="klbl">Média dias · Reexecução</div></div>
    <div class="kpi">${iconeKpi('chartbar')}<div class="knum sm">${chamados.filter(r=>r.tIdent!=null||r.tDesenv!=null).length}</div><div class="klbl">Chamados com tempo medido</div></div>
  </div>`;
  if (procUm.length) {
    html += `<div class="two">${cardTempoMedio}<div class="card"><div class="card-title"><i class="ti ti-clock-hour-4"></i> Bots com 1 chamado<span class="rt">dias · ${procUm.length} bots</span></div>
      ${horizontalBars(procUm,{max:20,lw:200,color:'#5aa0a0'})}
      <div class="note" style="margin-top:14px;margin-bottom:0;background:var(--neu-bg);color:var(--ink3)"><i class="ti ti-info-circle"></i><div>Um único chamado — não é média, serve de referência.</div></div></div></div>`;
  } else {
    html += cardTempoMedio;
  }
  document.getElementById('rpage-tempo').innerHTML = html;
  flushCharts();
}

function buildRPATabList(chamados, total, venc) {
  document.getElementById('rpage-lista').innerHTML =
    `<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
      <input type="text" id="rsearch" placeholder="Buscar por código, processo, solicitante..." oninput="renderRPAList()" style="flex:1;max-width:360px">
      <span style="font-size:11px;color:var(--ink4)" id="rlista-count">${total} chamados</span></div>
    <div class="card np"><div style="overflow-x:auto"><table class="tbl" style="margin:0">
    <thead><tr><th style="padding-left:20px">Código</th><th>Processo</th><th>Problema</th><th>Fase</th><th>Mês</th><th style="padding-right:20px">Status</th></tr></thead>
    <tbody id="rlista-body"></tbody></table></div></div>`;
  renderRPAList();
  setBadge('nb-rpa', venc>0 ? venc+' venc' : total, venc>0?'warn':'');
}

/*
 * renderRPAStatus() — renders the KPIs and charts of the RPA Tickets overview,
 * respecting the global date filter AND the local status (phase) filter.
 * Includes: KPIs, monthly volume, opened by weekday (Mon-Fri) and tickets by area.
 */
export function renderRPAStatus(){
  const {kept: chamadosFiltrados} = filtrarPorPeriodo(App.R);   // já filtrado pelo período global
  const faseSelecionada = document.getElementById('rpa-fs')?.value || '';
  const chamados = faseSelecionada ? chamadosFiltrados.filter(r => r.fase === faseSelecionada) : chamadosFiltrados;

  const total      = chamados.length;
  const venc       = chamados.filter(r => r.vencido).length;
  const concl      = chamados.filter(r => r.fase.toLowerCase().includes('conclu')).length;
  const abertos    = total - concl;
  const reexec     = chamados.filter(r => r.problema.toLowerCase().includes('reexecu')).length;
  const pctVenc    = calculatePercentage(venc, total);
  const procUnicos = new Set(chamados.map(r => r.processo).filter(p => p && p !== '(sem processo)')).size;

  const cnt = document.getElementById('rpa-fs-count');
  if(cnt) cnt.textContent = faseSelecionada ? `${total} chamados em "${faseSelecionada}"` : `${total} chamados`;

  let htmlKpis = `<div class="krow k5">
    <div class="kpi">${iconeKpi('ticket')}<div class="knum">${total}</div><div class="klbl">Total chamados</div><div class="ksub">${procUnicos} processos distintos</div></div>
    <div class="kpi gl">${iconeKpi('check')}<div class="knum">${concl}</div><div class="klbl">Concluídos</div><div class="ksub">${calculatePercentage(concl,total)}%</div></div>
    <div class="kpi il">${iconeKpi('clock')}<div class="knum">${abertos}</div><div class="klbl">Abertos</div></div>
    <div class="kpi dl">${iconeKpi('alert')}<div class="knum">${venc}</div><div class="klbl">Vencidos</div><div class="ksub">${pctVenc}% do total</div></div>
    <div class="kpi wl">${iconeKpi('refresh')}<div class="knum">${reexec}</div><div class="klbl">Reexecuções</div></div>
  </div>`;

  // Monthly volume (stacked bars: normal tickets + overdue)
  const porMes={}, porMesV={};
  chamados.forEach(r => {
    if (r.mes) {
      porMes[r.mes]  = (porMes[r.mes]  || 0) + 1;
      if (r.vencido) porMesV[r.mes] = (porMesV[r.mes] || 0) + 1;
    }
  });
  const meses = Object.keys(porMes).sort().slice(-12);
  const vol   = verticalBarsChart(meses, porMes, porMesV);

  // Monthly volume + phase donut side by side (time view + current state)
  htmlKpis += `<div class="two">
    <div class="card"><div class="card-title"><i class="ti ti-chart-bar"></i> Volume mensal</div>${vol}</div>
    <div class="card"><div class="card-title"><i class="ti ti-chart-pie"></i> Status (fase) dos chamados</div>
      ${donut(Object.entries(count(chamados,r=>r.fase)).map(([k,vv],i)=>({label:k,value:vv,color:['var(--ok)','var(--info)','var(--warn)','var(--err)','#7c5cbf','var(--ink4)'][i%6]})))}</div>
  </div>`;

  // Tickets by area (area inherited from the bot inventory via name matching).
  // The main areas stay visible; the rest (PAM, CI, IT, ARG, etc.)
  // are summed into "Outros" to avoid cluttering the chart with tiny slices.
  const porArea = count(chamados, r => r.area || '(não mapeada)');
  let outrosArea = 0;
  const areaEntries = [];
  Object.entries(porArea).forEach(([area, n]) => {
    const up = area.toUpperCase();
    if(MAIN_RPA_AREAS.includes(up) || area === '(não mapeada)'){
      areaEntries.push([area, n]);
    } else {
      outrosArea += n; // PAM, CI, IT, ARG e quaisquer outras pequenas
    }
  });
  areaEntries.sort((a,b)=>b[1]-a[1]);
  if(outrosArea > 0) areaEntries.push(['Outros', outrosArea]); // "Outros" sempre por último
  htmlKpis += `<div class="card"><div class="card-title"><i class="ti ti-building"></i> Tickets por área</div>
    ${horizontalBars(areaEntries,{max:12,lw:120,tot:total,fixedLabel:true})}</div>`;

  document.getElementById('rpa-visao-kpis').innerHTML = htmlKpis;
  flushCharts();
}

/*
 * renderRPAList() — renders the paginated ticket list.
 * Applies the global date filter + text search.
 * Shows up to 1000 tickets; warns if there are more.
 */
export function renderRPAList(){
  const {kept: chamados} = filtrarPorPeriodo(App.R);
  const query = (document.getElementById('rsearch')?.value||'').toLowerCase();
  const vis = query ? chamados.filter(r=>(r.cod+r.processo+r.solicitante+r.problema).toLowerCase().includes(query)) : chamados;
  const cnt = document.getElementById('rlista-count');
  if(cnt) cnt.textContent = vis.length+' chamados';
  let linhasChamados = vis.slice(0,1000).map(r => {
    const concl = r.fase.toLowerCase().includes('conclu');
    return `<tr>
      <td style="padding-left:20px;font-family:monospace;font-size:11px;color:var(--ink3)">${r.cod}</td>
      <td style="font-size:11px">${r.processo}</td>
      <td style="font-size:11px;color:var(--ink3)">${r.problema}</td>
      <td><span class="badge ${concl?'ok':'info'}" style="font-size:9px">${r.fase}</span></td>
      <td style="font-size:11px;color:var(--ink4)">${toYearMonthLabel(r.mes)}</td>
      <td style="padding-right:20px">${r.vencido?'<span class="badge red">Vencido</span>':'<span class="badge neu">No prazo</span>'}</td></tr>`;
  }).join('');
  if(vis.length > 1000) linhasChamados += `<tr><td colspan="6" style="text-align:center;padding:16px;color:var(--ink4);font-size:12px">Exibindo 1000 de ${vis.length} — use a busca para refinar</td></tr>`;
  const corpoTabela = document.getElementById('rlista-body');
  if(corpoTabela) corpoTabela.innerHTML = linhasChamados;
}
