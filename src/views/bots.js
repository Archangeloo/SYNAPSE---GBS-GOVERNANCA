// ─── MODULE: views/bots.js ─────────────────────────────────────────────────
// VIEW: BOT INVENTORY
// DIFFERENT DATE FILTER: uses the YEAR the bot went live (AnoPRD),
// not an action date. Filtering by "2026" shows only bots that
// went live in 2026 (not tickets or improvements from 2026).
// ─────────────────────────────────────────────────────────────────────────────

import { App } from '../state.js';
import { MAIN_RPA_AREAS } from '../constants.js';
import { count, calculatePercentage, sortedCountEntries, normalizeBotName, iconeKpi } from '../utils/helpers.js';
import { filtrarPorPeriodo } from '../utils/date.js';
import { donut, horizontalBars, flushCharts } from '../charts.js';
import { barraAnalise } from '../analysis.js';

/*
 * buildBots() — Bot Inventory tab (inside RPA & Bots).
 *
 * Reads:  App.B (inventory), App.R (for ticket cross-reference, if available)
 * Writes: #bots-empty / #bots-content
 *          #bots-list  → filterable bot list, via renderBotsList()
 * Called by: generate() and renderAll()
 *
 * DIFFERENT DATE FILTER:
 *   Uses AnoPRD (year the bot went live), not action dates.
 *   "Filter by 2026" shows bots that went live in 2026, not tickets from 2026.
 *
 * Produces:
 *  - KPIs: total bots, in PRD, in DEV, backlog
 *  - Bars by area and donut by perimeter (bots in PRD)
 *  - Bars by criticality and frequency
 *  - Inventory × tickets cross-reference table (if App.R is available)
 *  - Filtered list with inline expand (bot details)
 */
export function buildBots(){
  // Special AnoPRD filter (extracts just the year from the selected date range)
  const dr = App.dateRange;
  let bots = App.B;
  let dateNote = '';
  if(dr.mode !== 'all'){
    const yFrom = dr.from ? dr.from.getFullYear() : null;
    const yTo   = dr.to   ? dr.to.getFullYear()   : null;
    bots = App.B.filter(b => {
      const prdYear = parseInt(b.anoPrd);
      if(isNaN(prdYear)) return false;            // sem AnoPRD: fica fora do filtro
      if(yFrom!=null && prdYear<yFrom) return false;
      if(yTo!=null   && prdYear>yTo)   return false;
      return true;
    });
    const semAno = App.B.filter(b => isNaN(parseInt(b.anoPrd))).length;
    dateNote = `<div class="note" style="background:var(--neu-bg);color:var(--ink3)"><i class="ti ti-calendar-stats"></i><div>
      Período aplicado: <b>${bots.length} bots</b> que entraram em produção entre ${yFrom||'∞'} e ${yTo||'∞'}.` +
      (semAno>0 ? ` ${semAno} bots sem ano de PRD não entram no filtro.` : '') +
      `<br><span style="font-size:10px;opacity:.6;font-style:italic">Referência de data: ano de entrada em produção (AnoPRD) — filtra por ano, não por data exata</span>
      </div></div>`;
  }
  document.getElementById('bots-empty').style.display  = App.B.length ? 'none' : 'block';
  document.getElementById('bots-content').style.display = App.B.length ? 'block' : 'none';
  if(!App.B.length) return;

  const prd       = bots.filter(b=>b.status==='PRD').length;
  const dev       = bots.filter(b=>b.status==='DEV').length;
  const backlog   = bots.filter(b=>b.status==='BACKLOG').length;
  const cancel    = bots.filter(b=>b.status==='CANCELADO'||b.status==='DESATIVADO').length;

  let html = dateNote + `<div class="sh">Inventário de Bots — RPA</div>
  ${barraAnalise('bots')}
  <div class="krow">
    <div class="kpi">${iconeKpi('robot')}<div class="knum">${bots.length}</div><div class="klbl">Total de bots</div></div>
    <div class="kpi gl">${iconeKpi('rocket')}<div class="knum">${prd}</div><div class="klbl">Em produção</div><div class="ksub">${calculatePercentage(prd,bots.length)}% do total</div></div>
    <div class="kpi wl">${iconeKpi('code')}<div class="knum">${dev}</div><div class="klbl">Em desenvolvimento</div></div>
    <div class="kpi">${iconeKpi('stack')}<div class="knum">${backlog}</div><div class="klbl">Backlog</div></div>
  </div>`;

  const prdBots = bots.filter(b=>b.status==='PRD');
  // The 5 main business areas stay visible; the rest (MEX, PAM, IT, etc.)
  // are summed into "Outros" so the bars' total matches the total bots in PRD.
  const AREAS_PRINCIPAIS = MAIN_RPA_AREAS;
  const porAreaPrd = count(prdBots, b => b.area);
  let outrosPrd = 0;
  const areaBots = [];
  Object.entries(porAreaPrd).forEach(([area, n]) => {
    if(AREAS_PRINCIPAIS.includes(area.toUpperCase())) areaBots.push([area, n]);
    else outrosPrd += n;
  });
  areaBots.sort((a,b) => b[1]-a[1]);
  if(outrosPrd > 0) areaBots.push(['Outros', outrosPrd]); // "Outros" por último
  html += `<div class="two">
    <div class="card"><div class="card-title"><i class="ti ti-building"></i> Bots em PRD por área</div>
      ${horizontalBars(areaBots,{max:6,lw:60,tot:prd})}</div>
    <div class="card"><div class="card-title"><i class="ti ti-world"></i> Por perímetro</div>
      ${donut(Object.entries(count(prdBots,b=>b.perimetro)).map(([k,v],i)=>({label:k,value:v,color:['var(--info)','var(--ok)','var(--warn)','var(--err)'][i%4]})))}</div>
  </div>`;
  html += `<div class="two">
    <div class="card"><div class="card-title"><i class="ti ti-alert-octagon"></i> Por criticidade</div>
      ${horizontalBars([1,2,3,4].map(c=>['Criticidade '+c,prdBots.filter(b=>b.criticidade===c).length]).filter(e=>e[1]),{max:4,lw:100})}
      <div class="note" style="margin-top:14px;margin-bottom:0;background:var(--neu-bg);color:var(--ink3)"><i class="ti ti-info-circle"></i><div>
        <b>Critérios de criticidade:</b><br>
        <b>1 — Crítica:</b> processo essencial; falha gera impacto financeiro/fiscal imediato ou para a operação.<br>
        <b>2 — Alta:</b> processo importante com prazo sensível; falha causa atraso relevante.<br>
        <b>3 — Média:</b> processo recorrente; falha tem impacto moderado e contornável.<br>
        <b>4 — Baixa:</b> processo de apoio; falha tem baixo impacto e pode esperar.</div></div></div>
    <div class="card"><div class="card-title"><i class="ti ti-repeat"></i> Por frequência</div>
      ${horizontalBars(sortedCountEntries(prdBots.filter(b=>b.freq), b=>b.freq),{max:6,lw:80})}</div>
  </div>`;

  // Inventory × tickets cross-reference (only if the RPA report is loaded)
  if(App.R.length) html += buildBotsCruzamento(bots);

  // List filtered by status and area
  html += `<div class="filters" style="margin-top:8px">
    <label>Status</label><select id="bot-fs" onchange="renderBotsList()"><option value="">Todos</option>
      <option>PRD</option><option>DEV</option><option>BACKLOG</option><option>CANCELADO</option><option>DESATIVADO</option></select>
    <label>Área</label><select id="bot-fa" onchange="renderBotsList()"><option value="">Todas</option>
      ${[...new Set(bots.map(b=>b.area))].filter(Boolean).sort().map(a=>`<option>${a}</option>`).join('')}</select></div>
    <div class="card np"><div class="ilist" id="bots-list" style="border:none;border-radius:0"></div></div>`;
  document.getElementById('bots-content').innerHTML = html;
  flushCharts();
  renderBotsList();
}

/*
 * buildBotsCruzamento(Bf) — inventory × RPA tickets cross-reference table.
 * Tries to match the bot name (inventory) with the process name (tickets)
 * using an approximate match (one contains the other, after normalization).
 * Shows the 10 bots in PRD with the most maintenance tickets — refactoring candidates.
 *
 * LIMITATION: the name match is heuristic. If the bot's name in the inventory
 * is very different from the process name in Pipefy, the cross-reference can miss it.
 */
function buildBotsCruzamento(Bf){
  const norm = normalizeBotName;
  const {kept:Rf} = filtrarPorPeriodo(App.R); // also applies the date filter to the tickets
  const chamPorProc = count(Rf, r => r.processo);
  const rows = Bf.filter(b => b.status === 'PRD').map(b => {
    const botNameNorm = norm(b.nome);
    let totalChamados = 0;
    Object.entries(chamPorProc).forEach(([proc, qtd]) => {
      const procNameNorm = norm(proc);
      if (procNameNorm && botNameNorm && (botNameNorm.includes(procNameNorm) || procNameNorm.includes(botNameNorm))) {
        totalChamados += qtd;
      }
    });
    return { nome: b.nome, area: b.area, crit: b.criticidade, ch: totalChamados };
  }).filter(r => r.ch > 0).sort((a, b) => b.ch - a.ch).slice(0, 10);
  if(!rows.length) return '';
  let tbl = '<table class="tbl"><thead><tr><th>Bot</th><th>Área</th><th>Criticidade</th><th>Chamados manut.</th></tr></thead><tbody>';
  rows.forEach(r=>{
    tbl += `<tr><td style="color:var(--ink)">${r.nome}</td><td>${r.area}</td>
    <td>${r.crit?'Crit '+r.crit:'—'}</td><td><span class="badge ${r.ch>10?'red':'warn'}">${r.ch}</span></td></tr>`;
  });
  tbl += '</tbody></table>';
  return `<div class="card"><div class="card-title"><i class="ti ti-link"></i> Bots em produção × chamados de manutenção
    <span class="rt">cruzamento inventário × Pipefy</span></div>
    <div style="font-size:11px;color:var(--ink4);margin-bottom:12px">Bots com mais manutenções são candidatos a refatoração. Match por nome do processo.</div>
    <div style="overflow-x:auto">${tbl}</div></div>`;
}

/*
 * renderBotsList() — filtered bot list with local filters (status, area).
 * Applies the AnoPRD date filter before the local filters.
 * Shows up to 200 bots; warns if there are more.
 */
export function renderBotsList(){
  const filterStatus = document.getElementById('bot-fs')?.value||'';
  const filterArea   = document.getElementById('bot-fa')?.value||'';
  const dr = App.dateRange;
  let source = App.B;
  // special date filter: by AnoPRD (not by action date)
  if(dr.mode !== 'all'){
    const yFrom = dr.from ? dr.from.getFullYear() : null;
    const yTo   = dr.to   ? dr.to.getFullYear()   : null;
    source = App.B.filter(b=>{
      const prdYear = parseInt(b.anoPrd);
      if(isNaN(prdYear)) return false;
      if(yFrom!=null && prdYear<yFrom) return false;
      if(yTo!=null   && prdYear>yTo)   return false;
      return true;
    });
  }
  if(!App.botsOpen) App.botsOpen = new Set();
  let bots = source.filter(b => (!filterStatus||b.status===filterStatus) && (!filterArea||b.area===filterArea));
  const sb = {PRD:'ok', DEV:'info', BACKLOG:'neu', CANCELADO:'red', DESATIVADO:'red'};
  const botDot = {PRD:'#4DB1B3', DEV:'#0195D6', BACKLOG:'#9CA3AF', CANCELADO:'#C5284C', DESATIVADO:'#E83430'};
  const critLabel = {1:'Crítica',2:'Alta',3:'Média',4:'Baixa'};
  const critBadge = {1:'err',2:'warn',3:'neu',4:'neu'};
  let itensBots = bots.slice(0,200).map(b => {
    const key = b.nome;
    const open = App.botsOpen.has(key);
    const safeKey = key.replace(/'/g,"\\'").replace(/"/g,'&quot;');
    return `<div class="proj-row ${open?'open':''}">
      <div class="icard" onclick="toggleBot('${safeKey}')" style="cursor:pointer">
        <div class="iico" style="background:var(--neu-bg);flex-direction:column;gap:4px">
          <span style="width:11px;height:11px;border-radius:50%;background:${botDot[b.status]||'#9a9a92'};display:block"></span>
        </div>
        <div class="imain">
          <div class="ititle">${b.nome}</div>
          <div class="isub">
            ${b.area?`<span class="apill">${b.area}</span>`:''}
            ${b.perimetro&&b.perimetro!=='Brasil'?`<span class="apill">${b.perimetro}</span>`:''}
            ${b.areaCliente&&b.areaCliente&&b.areaCliente!==b.area?`<span style="color:var(--ink4);font-size:10px">→ ${b.areaCliente}</span>`:''}
            ${b.freq?`<span style="color:var(--ink4)">${b.freq}</span>`:''}
            ${b.fte?`<span class="badge ok" style="font-size:9px;padding:1px 5px">${b.fte} FTE</span>`:''}
            ${b.vol?`<span style="color:var(--ink4);font-size:10px">${b.vol.toLocaleString('pt-BR')}/mês</span>`:''}
          </div>
        </div>
        <div class="iright">
          ${b.anoPrd&&b.status==='PRD'?`<span style="font-size:10px;color:var(--ink4)">PRD ${b.anoPrd}</span>`:''}
          ${b.criticidade?`<span class="badge ${critBadge[b.criticidade]||'neu'}" style="font-size:9px" title="Criticidade ${b.criticidade}: ${critLabel[b.criticidade]}">${critLabel[b.criticidade]||'Crit '+b.criticidade}</span>`:''}
          <span class="badge ${sb[b.status]||'neu'}" style="font-size:9px">${b.status}</span>
          <span style="color:var(--ink4);font-size:11px;margin-left:4px;transition:transform .15s;transform:rotate(${open?'90deg':'0deg'})">▶</span>
        </div>
      </div>
      ${open ? botDetails(b) : ''}
    </div>`;
  }).join('');
  if(bots.length>200) itensBots += `<div class="icard" style="justify-content:center;color:var(--ink4);font-size:12px">Exibindo 200 de ${bots.length}</div>`;
  const listaBots = document.getElementById('bots-list');
  if(listaBots) listaBots.innerHTML = itensBots || '<div class="empty" style="padding:24px">Nenhum bot neste filtro</div>';
}

export function toggleBot(key){
  if(!App.botsOpen) App.botsOpen = new Set();
  if(App.botsOpen.has(key)) App.botsOpen.delete(key);
  else App.botsOpen.add(key);
  renderBotsList();
}

function botDetails(bot){
  const row = (lbl, val) => val ? `<div class="pd-block"><div class="pd-lbl">${lbl}</div><div class="pd-val">${val}</div></div>` : '';
  const critDesc = {1:'Falha gera impacto financeiro/fiscal imediato ou para a operação.',2:'Processo com prazo sensível — falha causa atraso relevante.',3:'Falha tem impacto moderado e contornável.',4:'Processo de apoio — falha tem baixo impacto.'};
  const critTxt = bot.criticidade ? `${bot.criticidade} — ${['Crítica','Alta','Média','Baixa'][bot.criticidade-1]||''}: ${critDesc[bot.criticidade]||''}` : '';
  return `<div class="proj-detail">
    ${row('Desenvolvedor', bot.dev)}
    ${row('Suporte / Sustentação', bot.suporte)}
    ${row('Descrição', bot.desc)}
    ${row('Área cliente', bot.areaCliente)}
    ${row('Sistema SAP', bot.sap)}
    ${row('Criticidade', critTxt)}
    ${row('FTEs economizados', bot.fte ? bot.fte+' FTE' : '')}
    ${row('Volumetria mensal', bot.vol ? bot.vol.toLocaleString('pt-BR')+' transações/mês' : '')}
    ${row('Nº de robôs', bot.nBots ? String(bot.nBots) : '')}
  </div>`;
}
