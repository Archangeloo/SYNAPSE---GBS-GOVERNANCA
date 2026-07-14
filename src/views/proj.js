// ─── MODULE: views/proj.js ─────────────────────────────────────────────────
// VIEW: PROJECTS
// Presents the area's project portfolio with:
// - KPIs following the real GBS flow (Diagnóstico→Planejamento→Execução→Encerramento→Monitoramento)
// - Status donut, bars by area/client area
// - Filterable list (search, owner, status, area)
// - Inline expand on click: reveals rich spreadsheet fields (description, teams, etc.)
// ─────────────────────────────────────────────────────────────────────────────

import { App } from '../state.js';
import { STATUS_BADGE } from '../constants.js';
import { count, iconeKpi } from '../utils/helpers.js';
import { projetoAtrasado, riscoProjeto } from '../utils/classify.js';
import { filtrarPorPeriodo } from '../utils/date.js';
import { donut, horizontalBars, flushCharts } from '../charts.js';
import { barraAnalise } from '../analysis.js';
import { setBadge } from '../nav.js';

/*
 * buildProjects() — Projects tab.
 *
 * Reads:  App.P.proj
 * Writes: #proj-content  (structure + filters)
 *          #proj-list      (item list, via renderProjectList())
 * Called by: generate() and renderAll()
 *
 * Produces:
 *  - KPIs: total, in execution, final phase, overdue, high risk
 *  - Status donut and bars by area/client area
 *  - Filterable list with inline expand (project details)
 *  - Automatic 0-100 risk score per project
 */
export function buildProjects(){
  const {kept:P, noDate} = filtrarPorPeriodo(App.P.proj);
  document.getElementById('proj-empty').style.display = (P.length||noDate) ? 'none' : 'block';
  document.getElementById('proj-content').style.display = (P.length||noDate) ? 'block' : 'none';
  if(!P.length && !noDate) return;

  // Contagens por código de status — respeitam o fluxo real do GBS
  const done    = P.filter(p => p.sc==='done').length;     // concluído (ainda não existe na base)
  const doing   = P.filter(p => p.sc==='doing').length;    // em execução
  // Encerramento + Monitoramento agrupados (ambos = projeto entregue / em fase final)
  const finalizando = P.filter(p => p.sc==='closing' || p.sc==='monitor').length;
  const atrasados = P.filter(projetoAtrasado);                // prazo vencido e não entregue
  const criticos = P.filter(p => riscoProjeto(p).level==='high').length; // risco alto

  const dnProj = App.dateRange.mode !== 'all'
    ? `<div class="note" style="background:var(--neu-bg);color:var(--ink3)"><i class="ti ti-calendar-stats"></i><div>
        Período aplicado: <b>${P.length} projetos</b> no recorte.${noDate > 0 ? ` ${noDate} sem prazo definido não entram no filtro.` : ''}
        <br><span style="font-size:10px;opacity:.6;font-style:italic">Referência de data: prazo de conclusão do projeto</span>
        </div></div>` : '';

  let html = `<div class="sh">Projetos</div>
  ${dnProj}
  ${barraAnalise('proj')}
  <div class="krow k5">
    <div class="kpi">${iconeKpi('folders')}<div class="knum">${P.length}</div><div class="klbl">Total</div></div>
    <div class="kpi il">${iconeKpi('play')}<div class="knum">${doing}</div><div class="klbl">Em execução</div></div>
    <div class="kpi gl">${iconeKpi('flag')}<div class="knum">${finalizando}</div><div class="klbl">Em fase final</div>
      <div class="ksub">encerramento / monit.</div></div>
    <div class="kpi dl">${iconeKpi('clock')}<div class="knum">${atrasados.length}</div><div class="klbl">Atrasados</div>
      <div class="ksub">prazo vencido</div></div>
    <div class="kpi wl">${iconeKpi('flame')}<div class="knum">${criticos}</div><div class="klbl">Risco alto</div>
      <div class="ksub">score de risco</div></div>
  </div>`;

  // Frente vem do campo AreaCliente (novo) ou Frente (legado)
  const frCount = count(P.filter(p => p.frente), p => p.frente);
  // donut: cada status com cor distinta e coerente com o avanço no fluxo
  //   Não iniciado = cinza | Em andamento = azul | Encerr./Monit. = verde (fase final/entregue)
  //   Concluído = verde escuro | Bloqueado = âmbar | Cancelado = vermelho
  const donutProj = [
    {label:'Concluído',      value:P.filter(p=>p.sc==='done').length,                       color:'#4DB1B3'},
    {label:'Em andamento',   value:P.filter(p=>p.sc==='doing').length,                      color:'#0195D6'},
    {label:'Em encerramento',value:P.filter(p=>p.sc==='closing'||p.sc==='monitor').length,  color:'#E66407'},
    {label:'Não iniciado',   value:P.filter(p=>p.sc==='todo').length,                       color:'#9CA3AF'},
    {label:'Bloqueado',      value:P.filter(p=>p.sc==='blocked').length,                    color:'#E83430'},
    {label:'Cancelado',      value:P.filter(p=>p.sc==='cancel').length,                     color:'#C5284C'}
  ].filter(d=>d.value);
  html += `<div class="two">
    <div class="card"><div class="card-title"><i class="ti ti-chart-pie"></i> Por status</div>
      ${donut(donutProj)}</div>
    <div class="card"><div class="card-title"><i class="ti ti-building"></i> Por frente / área cliente</div>
      ${Object.keys(frCount).length ? horizontalBars(Object.entries(frCount).sort((a,b)=>b[1]-a[1]),{max:8,lw:80,tot:P.length}) : '<div style="font-size:12px;color:var(--ink4)">Sem dados de área</div>'}</div>
  </div>`;

  html += `<div class="note" style="background:var(--neu-bg);border-color:var(--rule);color:var(--ink3)"><i class="ti ti-info-circle"></i><div>
    <b>Cálculo de risco automático (score 0–100):</b>
    <b>Atraso</b> — fator principal, 15pts base + ~1pt/dia, teto 70pts (≈40 dias já é risco alto).
    <b>Fase</b> — projetos em Diagnóstico/Planejamento pontuam mais (18/14pts) pois têm mais caminho pela frente.
    <b>Prazo</b> — vence em ≤15 dias = +18pts · ≤30 dias = +10pts · sem prazo definido = +14pts.
    Nível: <b>alto ≥ 55</b> · <b>médio ≥ 30</b> · <b>baixo &lt; 30</b>. Concluídos e em monitoramento sempre têm risco 0.
  </div></div>`;
  // Monta os selects de filtro dinamicamente a partir dos valores presentes nos dados
  const pessoas = [...new Set(P.map(p => p.resp).filter(Boolean))].sort();
  html += `<div class="filters" style="margin-top:4px">
    <input type="text" id="proj-q" placeholder="Buscar projeto, responsável, frente..." oninput="renderProjectList()" style="flex:1;max-width:280px">
    <button class="chip" id="proj-chip-atraso" onclick="toggleProjectChip('atraso')">⚠ Só atrasados</button>
    <button class="chip" id="proj-chip-risco" onclick="toggleProjectChip('risco')">Risco alto</button>
    <label>Responsável</label>
    <select id="proj-fp" onchange="renderProjectList()"><option value="">Todos</option>
      ${pessoas.map(p=>`<option>${p}</option>`).join('')}</select>
    <label>Status</label>
    <select id="proj-fs" onchange="renderProjectList()"><option value="">Todos</option>
      ${[...new Set(P.map(p=>p.statusRaw).filter(Boolean))].sort().map(s=>`<option>${s}</option>`).join('')}</select>
    <label>Frente</label>
    <select id="proj-ff" onchange="renderProjectList()"><option value="">Todas</option>
      ${[...new Set(P.map(p=>p.frente).filter(Boolean))].sort().map(f=>`<option>${f}</option>`).join('')}</select>
    <span style="font-size:11px;color:var(--ink4);margin-left:auto" id="proj-count"></span>
  </div>`;
  html += `<div class="card np"><div class="ilist" id="proj-list" style="border:none;border-radius:0"></div></div>`;
  document.getElementById('proj-content').innerHTML = html;
  flushCharts();
  renderProjectList();
  setBadge('nb-proj', P.length+' proj', '');
}

/*
 * renderProjectList() — renders the filtered list of projects.
 * Called by buildProjects() and whenever a filter changes (search, owner, status, area).
 * Applies the global date filter + the tab's local filters.
 * Keeps the expanded-projects state (App.projOpen) across re-renders.
 */
export function renderProjectList(){
  const {kept: projetos} = filtrarPorPeriodo(App.P.proj);
  const textoBusca       = (document.getElementById('proj-q')?.value||'').toLowerCase();
  const filterPessoa     = document.getElementById('proj-fp')?.value||'';
  const filterStatus     = document.getElementById('proj-fs')?.value||'';
  const filterFrente     = document.getElementById('proj-ff')?.value||'';
  const chips = App.projChips || {atraso:false, risco:false};
  // busca em título, responsável, frente, descrição e próximos passos
  let vis = projetos.filter(p =>
    (!textoBusca || (p.titulo+' '+p.resp+' '+p.frente+' '+(p.descricao||'')+' '+(p.proximos||'')).toLowerCase().includes(textoBusca)) &&
    (!filterPessoa || p.resp===filterPessoa) &&
    (!filterStatus || p.statusRaw===filterStatus) &&
    (!filterFrente || p.frente===filterFrente) &&
    (!chips.atraso || projetoAtrasado(p)) &&
    (!chips.risco  || riscoProjeto(p).level==='high')
  );
  // ordena por score de risco (mais crítico primeiro); empate vai pelo mais avançado
  vis.sort((a,b) => {
    const scoreA = riscoProjeto(a).score, scoreB = riscoProjeto(b).score;
    if(scoreB !== scoreA) return scoreB - scoreA;
    return (b.prog||0) - (a.prog||0);
  });
  const cnt = document.getElementById('proj-count');
  if(cnt) cnt.textContent = `${vis.length} de ${projetos.length}`;
  if(!App.projOpen) App.projOpen = new Set();
  let itensProjeto = vis.map(p => {
    const badgeClass  = STATUS_BADGE[p.sc];
    const estaAtrasado = projetoAtrasado(p);
    const risco        = riscoProjeto(p); // { score, level, reasons }
    const key          = String(p.num||p.titulo); // chave única para o estado aberto/fechado
    const open         = App.projOpen.has(key);
    // indicador de status: bolinha colorida em CSS puro (não depende de fonte de ícone)
    const COR_STATUS = {
      done:'#3fa46a', doing:'#4a90d9', closing:'#d49a4a', monitor:'#6fa0e0',
      todo:'#9a9a92', blocked:'#d4a93c', cancel:'#d46a6a', vendor:'#8f6fd0', other:'#9a9a92'
    };
    const corStatus = COR_STATUS[p.sc] || COR_STATUS.other;
    // badge de risco (só para nível médio/alto, para não poluir os de baixo risco)
    const riscoBadge = risco.level==='high'
      ? `<span class="badge red" title="${risco.reasons.join(' · ')}">risco alto</span>`
      : (risco.level==='medium' ? `<span class="badge warn" title="${risco.reasons.join(' · ')}">risco médio</span>` : '');
    return `<div class="proj-row ${open?'open':''}" data-k="${key.replace(/"/g,'')}">
      <div class="icard" onclick="toggleProject('${key.replace(/'/g,"\\'").replace(/"/g,'&quot;')}')" style="cursor:pointer">
        <div class="iico" style="background:${estaAtrasado?'var(--err-bg)':'var(--neu-bg)'}">
          <span style="width:11px;height:11px;border-radius:50%;background:${corStatus};display:block"></span>
        </div>
        <div class="imain"><div class="ititle">${p.titulo}</div>
          <div class="isub">
            ${p.frente?`<span class="apill">${p.frente}</span>`:''}
            ${estaAtrasado?`<span style="font-size:10px;color:var(--err);font-weight:500">⚠ atrasado</span>`:''}
            ${p.prog!=null?`<span style="font-size:10px;color:var(--ink4)">${Math.round(p.prog*100)}% concluído</span>`:''}
          </div>
        </div>
        <div class="iright">
          ${riscoBadge}
          <span class="badge ${badgeClass}" style="font-size:9px">${p.statusRaw}</span>
          <span style="color:var(--ink4);font-size:11px;margin-left:4px;transition:transform .15s;transform:rotate(${open?'90deg':'0deg'})">▶</span>
        </div>
      </div>
      ${open ? projectDetails(p) : ''}
    </div>`;
  }).join('');
  const el = document.getElementById('proj-list');
  if(el) el.innerHTML = itensProjeto || '<div class="empty" style="padding:24px">Nenhum projeto neste filtro</div>';
}

/*
 * toggleProjectChip(qual) — toggles a quick filter (overdue / high risk)
 * on the Projects tab and re-renders the list, updating the chip's visual highlight.
 */
export function toggleProjectChip(qual){
  if(!App.projChips) App.projChips = {atraso:false, risco:false};
  App.projChips[qual] = !App.projChips[qual];
  const map = {atraso:'proj-chip-atraso', risco:'proj-chip-risco'};
  const btn = document.getElementById(map[qual]);
  if(btn) btn.classList.toggle('active', App.projChips[qual]);
  renderProjectList();
}

/*
 * toggleProject(key) — opens or closes a project's details panel.
 * Uses a Set (App.projOpen) to track which projects are expanded.
 * If the key is already in the Set → removes it (closes). If not → adds it (opens).
 * Re-renders the list afterward to reflect the change.
 */
export function toggleProject(key){
  if(!App.projOpen) App.projOpen = new Set();
  if(App.projOpen.has(key)) App.projOpen.delete(key);
  else App.projOpen.add(key);
  renderProjectList();
}

/*
 * projectDetails(project) — generates the HTML for a project's expanded details panel.
 * Only renders the field blocks that are filled in on the spreadsheet.
 * Empty fields don't show up (not even as an empty placeholder).
 * The layout is a 2-column grid (or 1 column on mobile).
 */
export function projectDetails(project){
  const fmt = txt => String(txt||'').trim().replace(/\n/g,'<br>');
  const blocks = [];
  if(project.resp)        blocks.push({lbl:'Responsável',             val:project.resp});
  if(project.dtFim)       blocks.push({lbl:'Prazo de conclusão',      val:`${project.dtFim.toLocaleDateString('pt-BR')}${projetoAtrasado(project)?' &nbsp;<span style="color:var(--err)">⚠ prazo vencido</span>':''}`});
  if(project.descricao)   blocks.push({lbl:'Descrição',              val:fmt(project.descricao)});
  if(project.equipes)     blocks.push({lbl:'Equipes envolvidas',     val:fmt(project.equipes)});
  if(project.focal)       blocks.push({lbl:'Ponto focal',            val:project.focal});
  if(project.atvConcl)    blocks.push({lbl:'Atividades concluídas',  val:fmt(project.atvConcl)});
  if(project.atvAndam)    blocks.push({lbl:'Atividades em andamento',val:fmt(project.atvAndam)});
  if(project.proximos)    blocks.push({lbl:'Próximos passos',        val:fmt(project.proximos)});
  if(project.comentarios) blocks.push({lbl:'Comentários',           val:fmt(project.comentarios)});
  if(!blocks.length) return `<div class="proj-detail"><div style="font-size:12px;color:var(--ink4);font-style:italic">Sem detalhes preenchidos na planilha.</div></div>`;
  return `<div class="proj-detail">` + blocks.map(b =>
    `<div class="pd-block"><div class="pd-lbl">${b.lbl}</div><div class="pd-val">${b.val}</div></div>`
  ).join('') + `</div>`;
}
