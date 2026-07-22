// views/bots.js — ABA: INVENTÁRIO DE BOTS
// FILTRO DE DATA DIFERENTE: usa o ANO em que o bot entrou em produção (AnoPRD),
// não uma data de ação. Filtrar por "2026" mostra só bots que entraram em
// produção em 2026 (não chamados ou melhorias de 2026).

import { App } from '../state.js';
import { MAIN_RPA_AREAS } from '../constants.js';
import { contar, calcularPercentual, contagemOrdenada, chamadosPorBot, iconeKpi } from '../utils/helpers.js';
import { filtrarPorPeriodo } from '../utils/date.js';
import { graficoRosca, barrasHorizontais, renderizarGraficosPendentes } from '../charts.js';
import { barraAnalise } from '../analysis.js';

/*
 * construirBots() — aba Inventário de Bots (dentro de RPA & Bots).
 *
 * Lê:      App.bots (inventário), App.chamadosRPA (pro cruzamento com chamados, se disponível)
 * Escreve: #bots-empty / #bots-content
 *          #bots-list  → lista filtrável de bots, via renderizarListaBots()
 * Chamada por: gerarDashboard() e renderizarTudo()
 *
 * FILTRO DE DATA DIFERENTE:
 *   Usa AnoPRD (ano de entrada em produção), não datas de ação.
 *   "Filtrar por 2026" mostra bots que entraram em produção em 2026, não chamados de 2026.
 *
 * Produz:
 *  - KPIs: total de bots, em PRD, em DEV, backlog
 *  - Barras por área e donut por perímetro (bots em PRD)
 *  - Barras por criticidade e frequência
 *  - Tabela de cruzamento inventário × chamados (se App.chamadosRPA estiver disponível)
 *  - Lista filtrada com expansão inline (detalhes do bot)
 */
export function construirBots(){
  // Filtro especial de AnoPRD (extrai só o ano do intervalo de datas selecionado)
  const pf = App.periodoFiltro;
  let bots = App.bots;
  let dateNote = '';
  if(pf.modo !== 'all'){
    const yFrom = pf.de  ? pf.de.getFullYear()  : null;
    const yTo   = pf.ate ? pf.ate.getFullYear() : null;
    bots = App.bots.filter(b => {
      const prdYear = parseInt(b.anoPrd);
      if(isNaN(prdYear)) return false;            // sem AnoPRD: fica fora do filtro
      if(yFrom!=null && prdYear<yFrom) return false;
      if(yTo!=null   && prdYear>yTo)   return false;
      return true;
    });
    const semAno = App.bots.filter(b => isNaN(parseInt(b.anoPrd))).length;
    dateNote = `<div class="note" style="background:var(--neu-bg);color:var(--ink3)"><i class="ti ti-calendar-stats"></i><div>
      Período aplicado: <b>${bots.length} bots</b> que entraram em produção entre ${yFrom||'∞'} e ${yTo||'∞'}.` +
      (semAno>0 ? ` ${semAno} bots sem ano de PRD não entram no filtro.` : '') +
      `<br><span style="font-size:10px;opacity:.6;font-style:italic">Referência de data: ano de entrada em produção (AnoPRD) — filtra por ano, não por data exata</span>
      </div></div>`;
  }
  document.getElementById('bots-empty').style.display  = App.bots.length ? 'none' : 'block';
  document.getElementById('bots-content').style.display = App.bots.length ? 'block' : 'none';
  if(!App.bots.length) return;

  const prd       = bots.filter(b=>b.status==='PRD').length;
  const dev       = bots.filter(b=>b.status==='DEV').length;
  const backlog   = bots.filter(b=>b.status==='BACKLOG').length;
  const cancel    = bots.filter(b=>b.status==='CANCELADO'||b.status==='DESATIVADO').length;

  let html = dateNote + `<div class="sh">Inventário de Bots — RPA</div>
  ${barraAnalise('bots')}
  <div class="krow">
    <div class="kpi">${iconeKpi('robot')}<div class="knum">${bots.length}</div><div class="klbl">Total de bots</div></div>
    <div class="kpi gl">${iconeKpi('rocket')}<div class="knum">${prd}</div><div class="klbl">Em produção</div><div class="ksub">${calcularPercentual(prd,bots.length)}% do total</div></div>
    <div class="kpi wl">${iconeKpi('code')}<div class="knum">${dev}</div><div class="klbl">Em desenvolvimento</div></div>
    <div class="kpi">${iconeKpi('stack')}<div class="knum">${backlog}</div><div class="klbl">Backlog</div></div>
  </div>`;

  const prdBots = bots.filter(b=>b.status==='PRD');
  // As 5 áreas de negócio principais ficam visíveis; o resto (MEX, PAM, IT, etc.)
  // é somado em "Outros" pra o total das barras bater com o total de bots em PRD.
  const AREAS_PRINCIPAIS = MAIN_RPA_AREAS;
  const porAreaPrd = contar(prdBots, b => b.area);
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
      ${barrasHorizontais(areaBots,{max:6,lw:60,tot:prd})}</div>
    <div class="card"><div class="card-title"><i class="ti ti-world"></i> Por perímetro</div>
      ${graficoRosca(Object.entries(contar(prdBots,b=>b.perimetro)).map(([k,v],i)=>({label:k,value:v,color:['var(--info)','var(--ok)','var(--warn)','var(--err)'][i%4]})))}</div>
  </div>`;
  html += `<div class="two">
    <div class="card"><div class="card-title"><i class="ti ti-alert-octagon"></i> Por criticidade</div>
      ${barrasHorizontais([1,2,3,4].map(c=>['Criticidade '+c,prdBots.filter(b=>b.criticidade===c).length]).filter(e=>e[1]),{max:4,lw:100})}
      <div class="note" style="margin-top:14px;margin-bottom:0;background:var(--neu-bg);color:var(--ink3)"><i class="ti ti-info-circle"></i><div>
        <b>Critérios de criticidade:</b><br>
        <b>1 — Crítica:</b> processo essencial; falha gera impacto financeiro/fiscal imediato ou para a operação.<br>
        <b>2 — Alta:</b> processo importante com prazo sensível; falha causa atraso relevante.<br>
        <b>3 — Média:</b> processo recorrente; falha tem impacto moderado e contornável.<br>
        <b>4 — Baixa:</b> processo de apoio; falha tem baixo impacto e pode esperar.</div></div></div>
    <div class="card"><div class="card-title"><i class="ti ti-repeat"></i> Por frequência</div>
      ${barrasHorizontais(contagemOrdenada(prdBots.filter(b=>b.frequencia), b=>b.frequencia),{max:6,lw:80})}</div>
  </div>`;

  // Cruzamento inventário × chamados (só se o relatório RPA estiver carregado)
  if(App.chamadosRPA.length) html += construirCruzamentoBots(bots);

  // Lista filtrada por status e área
  html += `<div class="filters" style="margin-top:8px">
    <label>Status</label><select id="bot-fs" onchange="renderizarListaBots()"><option value="">Todos</option>
      <option>PRD</option><option>DEV</option><option>BACKLOG</option><option>CANCELADO</option><option>DESATIVADO</option></select>
    <label>Área</label><select id="bot-fa" onchange="renderizarListaBots()"><option value="">Todas</option>
      ${[...new Set(bots.map(b=>b.area))].filter(Boolean).sort().map(a=>`<option>${a}</option>`).join('')}</select></div>
    <div class="card np"><div class="ilist" id="bots-list" style="border:none;border-radius:0"></div></div>`;
  document.getElementById('bots-content').innerHTML = html;
  renderizarGraficosPendentes();
  renderizarListaBots();
}

/*
 * construirCruzamentoBots(Bf) — tabela de cruzamento inventário × chamados RPA.
 * Tenta bater o nome do bot (inventário) com o nome do processo (chamados)
 * usando match aproximado (um contém o outro, depois de normalizado).
 * Mostra os 10 bots em PRD com mais chamados de manutenção — candidatos a refatoração.
 *
 * LIMITAÇÃO: o match de nome é heurístico. Se o nome do bot no inventário for
 * muito diferente do nome do processo no Pipefy, o cruzamento pode não achar.
 */
function construirCruzamentoBots(Bf){
  const {kept:Rf} = filtrarPorPeriodo(App.chamadosRPA); // também aplica o filtro de data aos chamados
  const chamPorProc = contar(Rf, r => r.processo);
  const rows = chamadosPorBot(Bf.filter(b => b.status === 'PRD'), chamPorProc)
    .filter(r => r.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 10)
    .map(r => ({ nome: r.bot.nome, area: r.bot.area, criticidade: r.bot.criticidade, chamados: r.total }));
  if(!rows.length) return '';
  let tbl = '<table class="tbl"><thead><tr><th>Bot</th><th>Área</th><th>Criticidade</th><th>Chamados manut.</th></tr></thead><tbody>';
  rows.forEach(r=>{
    tbl += `<tr><td style="color:var(--ink)">${r.nome}</td><td>${r.area}</td>
    <td>${r.criticidade?'Crit '+r.criticidade:'—'}</td><td><span class="badge ${r.chamados>10?'red':'warn'}">${r.chamados}</span></td></tr>`;
  });
  tbl += '</tbody></table>';
  return `<div class="card"><div class="card-title"><i class="ti ti-link"></i> Bots em produção × chamados de manutenção
    <span class="rt">cruzamento inventário × Pipefy</span></div>
    <div style="font-size:11px;color:var(--ink4);margin-bottom:12px">Bots com mais manutenções são candidatos a refatoração. Match por nome do processo.</div>
    <div style="overflow-x:auto">${tbl}</div></div>`;
}

/*
 * renderizarListaBots() — lista filtrada de bots com filtros locais (status, área).
 * Aplica o filtro de data por AnoPRD antes dos filtros locais.
 * Mostra até 200 bots; avisa se houver mais.
 */
export function renderizarListaBots(){
  const filterStatus = document.getElementById('bot-fs')?.value||'';
  const filterArea   = document.getElementById('bot-fa')?.value||'';
  const pf = App.periodoFiltro;
  let source = App.bots;
  // filtro de data especial: por AnoPRD (não por data de ação)
  if(pf.modo !== 'all'){
    const yFrom = pf.de  ? pf.de.getFullYear()  : null;
    const yTo   = pf.ate ? pf.ate.getFullYear() : null;
    source = App.bots.filter(b=>{
      const prdYear = parseInt(b.anoPrd);
      if(isNaN(prdYear)) return false;
      if(yFrom!=null && prdYear<yFrom) return false;
      if(yTo!=null   && prdYear>yTo)   return false;
      return true;
    });
  }
  let bots = source.filter(b => (!filterStatus||b.status===filterStatus) && (!filterArea||b.area===filterArea));
  const sb = {PRD:'ok', DEV:'info', BACKLOG:'neu', CANCELADO:'red', DESATIVADO:'red'};
  const botDot = {PRD:'#4DB1B3', DEV:'#0195D6', BACKLOG:'#9CA3AF', CANCELADO:'#C5284C', DESATIVADO:'#E83430'};
  const critLabel = {1:'Crítica',2:'Alta',3:'Média',4:'Baixa'};
  const critBadge = {1:'err',2:'warn',3:'neu',4:'neu'};
  let itensBots = bots.slice(0,200).map(b => {
    const key = b.nome;
    const open = App.botsAbertos.has(key);
    const safeKey = key.replace(/'/g,"\\'").replace(/"/g,'&quot;');
    return `<div class="proj-row ${open?'open':''}">
      <div class="icard" onclick="alternarBot('${safeKey}')" style="cursor:pointer">
        <div class="iico" style="background:var(--neu-bg);flex-direction:column;gap:4px">
          <span style="width:11px;height:11px;border-radius:50%;background:${botDot[b.status]||'#9a9a92'};display:block"></span>
        </div>
        <div class="imain">
          <div class="ititle">${b.nome}</div>
          <div class="isub">
            ${b.area?`<span class="apill">${b.area}</span>`:''}
            ${b.perimetro&&b.perimetro!=='Brasil'?`<span class="apill">${b.perimetro}</span>`:''}
            ${b.areaCliente&&b.areaCliente&&b.areaCliente!==b.area?`<span style="color:var(--ink4);font-size:10px">→ ${b.areaCliente}</span>`:''}
            ${b.frequencia?`<span style="color:var(--ink4)">${b.frequencia}</span>`:''}
            ${b.fte?`<span class="badge ok" style="font-size:9px;padding:1px 5px">${b.fte} FTE</span>`:''}
            ${b.volumetria?`<span style="color:var(--ink4);font-size:10px">${b.volumetria.toLocaleString('pt-BR')}/mês</span>`:''}
          </div>
        </div>
        <div class="iright">
          ${b.anoPrd&&b.status==='PRD'?`<span style="font-size:10px;color:var(--ink4)">PRD ${b.anoPrd}</span>`:''}
          ${b.criticidade?`<span class="badge ${critBadge[b.criticidade]||'neu'}" style="font-size:9px" title="Criticidade ${b.criticidade}: ${critLabel[b.criticidade]}">${critLabel[b.criticidade]||'Crit '+b.criticidade}</span>`:''}
          <span class="badge ${sb[b.status]||'neu'}" style="font-size:9px">${b.status}</span>
          <span style="color:var(--ink4);font-size:11px;margin-left:4px;transition:transform .15s;transform:rotate(${open?'90deg':'0deg'})">▶</span>
        </div>
      </div>
      ${open ? detalhesBot(b) : ''}
    </div>`;
  }).join('');
  if(bots.length>200) itensBots += `<div class="icard" style="justify-content:center;color:var(--ink4);font-size:12px">Exibindo 200 de ${bots.length}</div>`;
  const listaBots = document.getElementById('bots-list');
  if(listaBots) listaBots.innerHTML = itensBots || '<div class="empty" style="padding:24px">Nenhum bot neste filtro</div>';
}

export function alternarBot(key){
  if(App.botsAbertos.has(key)) App.botsAbertos.delete(key);
  else App.botsAbertos.add(key);
  renderizarListaBots();
}

function detalhesBot(bot){
  const row = (lbl, val) => val ? `<div class="pd-block"><div class="pd-lbl">${lbl}</div><div class="pd-val">${val}</div></div>` : '';
  const critDesc = {1:'Falha gera impacto financeiro/fiscal imediato ou para a operação.',2:'Processo com prazo sensível — falha causa atraso relevante.',3:'Falha tem impacto moderado e contornável.',4:'Processo de apoio — falha tem baixo impacto.'};
  const critTxt = bot.criticidade ? `${bot.criticidade} — ${['Crítica','Alta','Média','Baixa'][bot.criticidade-1]||''}: ${critDesc[bot.criticidade]||''}` : '';
  return `<div class="proj-detail">
    ${row('Desenvolvedor', bot.desenvolvedor)}
    ${row('Suporte / Sustentação', bot.suporte)}
    ${row('Descrição', bot.descricao)}
    ${row('Área cliente', bot.areaCliente)}
    ${row('Sistema SAP', bot.sap)}
    ${row('Criticidade', critTxt)}
    ${row('FTEs economizados', bot.fte ? bot.fte+' FTE' : '')}
    ${row('Volumetria mensal', bot.volumetria ? bot.volumetria.toLocaleString('pt-BR')+' transações/mês' : '')}
    ${row('Nº de robôs', bot.numeroBots ? String(bot.numeroBots) : '')}
  </div>`;
}
