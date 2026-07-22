// views/proj.js — ABA: PROJETOS
// Apresenta a carteira de projetos da área com:
// - KPIs seguindo o fluxo real do GBS (Diagnóstico→Planejamento→Execução→Encerramento→Monitoramento)
// - Donut de status, barras por área/área cliente
// - Lista filtrável (busca, responsável, status, área)
// - Expansão inline ao clicar: revela os campos ricos da planilha (descrição, equipes, etc.)

import { App } from '../state.js';
import { STATUS_BADGE } from '../constants.js';
import { contar, iconeKpi } from '../utils/helpers.js';
import { projetoAtrasado, riscoProjeto } from '../utils/classify.js';
import { filtrarPorPeriodo } from '../utils/date.js';
import { graficoRosca, barrasHorizontais, renderizarGraficosPendentes } from '../charts.js';
import { barraAnalise } from '../analysis.js';
import { definirBadge } from '../nav.js';

/*
 * construirProjetos() — aba Projetos.
 *
 * Lê:      App.dadosGovernanca.projetos
 * Escreve: #proj-content  (estrutura + filtros)
 *          #proj-list      (lista de itens, via renderizarListaProjetos())
 * Chamada por: gerarDashboard() e renderizarTudo()
 *
 * Produz:
 *  - KPIs: total, em execução, fase final, atrasados, risco alto
 *  - Donut de status e barras por área/área cliente
 *  - Lista filtrável com expansão inline (detalhes do projeto)
 *  - Score de risco automático de 0 a 100 por projeto
 */
export function construirProjetos(){
  const {kept:P, noDate} = filtrarPorPeriodo(App.dadosGovernanca.projetos);
  document.getElementById('proj-empty').style.display = (P.length||noDate) ? 'none' : 'block';
  document.getElementById('proj-content').style.display = (P.length||noDate) ? 'block' : 'none';
  if(!P.length && !noDate) return;

  // Contagens por código de status — respeitam o fluxo real do GBS
  const done    = P.filter(p => p.codigoStatus==='done').length;     // concluído (ainda não existe na base)
  const doing   = P.filter(p => p.codigoStatus==='doing').length;    // em execução
  // Encerramento + Monitoramento agrupados (ambos = projeto entregue / em fase final)
  const finalizando = P.filter(p => p.codigoStatus==='closing' || p.codigoStatus==='monitor').length;
  const atrasados = P.filter(projetoAtrasado);                // prazo vencido e não entregue
  const criticos = P.filter(p => riscoProjeto(p).level==='high'); // risco alto

  const dnProj = App.periodoFiltro.modo !== 'all'
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
    <div class="kpi wl">${iconeKpi('flame')}<div class="knum">${criticos.length}</div><div class="klbl">Risco alto</div>
      <div class="ksub">score de risco</div></div>
  </div>`;

  // Frente vem do campo AreaCliente (novo) ou Frente (legado)
  const frCount = contar(P.filter(p => p.frente), p => p.frente);
  // donut: cada status com cor distinta e coerente com o avanço no fluxo
  //   Não iniciado = cinza | Em andamento = azul | Encerr./Monit. = verde (fase final/entregue)
  //   Concluído = verde escuro | Bloqueado = âmbar | Cancelado = vermelho
  const donutProj = [
    {label:'Concluído',      value:P.filter(p=>p.codigoStatus==='done').length,                       color:'#4DB1B3'},
    {label:'Em andamento',   value:P.filter(p=>p.codigoStatus==='doing').length,                      color:'#0195D6'},
    {label:'Em encerramento',value:P.filter(p=>p.codigoStatus==='closing'||p.codigoStatus==='monitor').length,  color:'#E66407'},
    {label:'Não iniciado',   value:P.filter(p=>p.codigoStatus==='todo').length,                       color:'#9CA3AF'},
    {label:'Bloqueado',      value:P.filter(p=>p.codigoStatus==='blocked').length,                    color:'#E83430'},
    {label:'Cancelado',      value:P.filter(p=>p.codigoStatus==='cancel').length,                     color:'#C5284C'}
  ].filter(d=>d.value);
  html += `<div class="two">
    <div class="card"><div class="card-title"><i class="ti ti-chart-pie"></i> Por status</div>
      ${graficoRosca(donutProj)}</div>
    <div class="card"><div class="card-title"><i class="ti ti-building"></i> Por frente / área cliente</div>
      ${Object.keys(frCount).length ? barrasHorizontais(Object.entries(frCount).sort((a,b)=>b[1]-a[1]),{max:8,lw:80,tot:P.length}) : '<div style="font-size:12px;color:var(--ink4)">Sem dados de área</div>'}</div>
  </div>`;

  html += `<div class="note" style="background:var(--neu-bg);border-color:var(--rule);color:var(--ink3)"><i class="ti ti-info-circle"></i><div>
    <b>Cálculo de risco automático (score 0–100):</b>
    <b>Atraso</b> — fator principal, 15pts base + ~1pt/dia, teto 70pts (≈40 dias já é risco alto).
    <b>Fase</b> — projetos em Diagnóstico/Planejamento pontuam mais (18/14pts) pois têm mais caminho pela frente.
    <b>Prazo</b> — vence em ≤15 dias = +18pts · ≤30 dias = +10pts · sem prazo definido = +14pts.
    Nível: <b>alto ≥ 55</b> · <b>médio ≥ 30</b> · <b>baixo &lt; 30</b>. Concluídos e em monitoramento sempre têm risco 0.
  </div></div>`;
  // Monta os selects de filtro dinamicamente a partir dos valores presentes nos dados
  const pessoas = [...new Set(P.map(p => p.responsavel).filter(Boolean))].sort();
  html += `<div class="filters" style="margin-top:4px">
    <input type="text" id="proj-q" placeholder="Buscar projeto, responsável, frente..." oninput="renderizarListaProjetos()" style="flex:1;max-width:280px">
    <button class="chip" id="proj-chip-atraso" onclick="alternarChipProjeto('atraso')">⚠ Só atrasados</button>
    <button class="chip" id="proj-chip-risco" onclick="alternarChipProjeto('risco')">Risco alto</button>
    <label>Responsável</label>
    <select id="proj-fp" onchange="renderizarListaProjetos()"><option value="">Todos</option>
      ${pessoas.map(p=>`<option>${p}</option>`).join('')}</select>
    <label>Status</label>
    <select id="proj-fs" onchange="renderizarListaProjetos()"><option value="">Todos</option>
      ${[...new Set(P.map(p=>p.statusRaw).filter(Boolean))].sort().map(s=>`<option>${s}</option>`).join('')}</select>
    <label>Frente</label>
    <select id="proj-ff" onchange="renderizarListaProjetos()"><option value="">Todas</option>
      ${[...new Set(P.map(p=>p.frente).filter(Boolean))].sort().map(f=>`<option>${f}</option>`).join('')}</select>
    <span style="font-size:11px;color:var(--ink4);margin-left:auto" id="proj-count"></span>
  </div>`;
  html += `<div class="card np"><div class="ilist" id="proj-list" style="border:none;border-radius:0"></div></div>`;
  document.getElementById('proj-content').innerHTML = html;
  renderizarGraficosPendentes();
  renderizarListaProjetos();
  definirBadge('nb-proj', P.length+' proj', '');
}

/*
 * renderizarListaProjetos() — renderiza a lista filtrada de projetos.
 * Chamada por construirProjetos() e sempre que um filtro muda (busca, responsável, status, área).
 * Aplica o filtro global de data + os filtros locais da aba.
 * Mantém o estado dos projetos expandidos (App.projetosAbertos) entre re-renderizações.
 */
export function renderizarListaProjetos(){
  const {kept: projetos} = filtrarPorPeriodo(App.dadosGovernanca.projetos);
  const textoBusca       = (document.getElementById('proj-q')?.value||'').toLowerCase();
  const filterPessoa     = document.getElementById('proj-fp')?.value||'';
  const filterStatus     = document.getElementById('proj-fs')?.value||'';
  const filterFrente     = document.getElementById('proj-ff')?.value||'';
  const chips = App.chipsProjetos;
  // busca em título, responsável, frente, descrição e próximos passos
  let vis = projetos.filter(p =>
    (!textoBusca || (p.titulo+' '+p.responsavel+' '+p.frente+' '+(p.descricao||'')+' '+(p.proximosPassos||'')).toLowerCase().includes(textoBusca)) &&
    (!filterPessoa || p.responsavel===filterPessoa) &&
    (!filterStatus || p.statusRaw===filterStatus) &&
    (!filterFrente || p.frente===filterFrente) &&
    (!chips.atraso || projetoAtrasado(p)) &&
    (!chips.risco  || riscoProjeto(p).level==='high')
  );
  // ordena por score de risco (mais crítico primeiro); empate vai pelo mais avançado
  vis.sort((a,b) => {
    const scoreA = riscoProjeto(a).score, scoreB = riscoProjeto(b).score;
    if(scoreB !== scoreA) return scoreB - scoreA;
    return (b.progresso||0) - (a.progresso||0);
  });
  const cnt = document.getElementById('proj-count');
  if(cnt) cnt.textContent = `${vis.length} de ${projetos.length}`;
  let itensProjeto = vis.map(p => {
    const badgeClass  = STATUS_BADGE[p.codigoStatus];
    const estaAtrasado = projetoAtrasado(p);
    const risco        = riscoProjeto(p); // { score, level, reasons }
    const key          = String(p.numero||p.titulo); // chave única pro estado aberto/fechado
    const open         = App.projetosAbertos.has(key);
    // indicador de status: bolinha colorida em CSS puro (não depende de fonte de ícone)
    const COR_STATUS = {
      done:'#3fa46a', doing:'#4a90d9', closing:'#d49a4a', monitor:'#6fa0e0',
      todo:'#9a9a92', blocked:'#d4a93c', cancel:'#d46a6a', vendor:'#8f6fd0', other:'#9a9a92'
    };
    const corStatus = COR_STATUS[p.codigoStatus] || COR_STATUS.other;
    // badge de risco (só pra nível médio/alto, pra não poluir os de baixo risco)
    const riscoBadge = risco.level==='high'
      ? `<span class="badge red" title="${risco.reasons.join(' · ')}">risco alto</span>`
      : (risco.level==='medium' ? `<span class="badge warn" title="${risco.reasons.join(' · ')}">risco médio</span>` : '');
    return `<div class="proj-row ${open?'open':''}" data-k="${key.replace(/"/g,'')}">
      <div class="icard" onclick="alternarProjeto('${key.replace(/'/g,"\\'").replace(/"/g,'&quot;')}')" style="cursor:pointer">
        <div class="iico" style="background:${estaAtrasado?'var(--err-bg)':'var(--neu-bg)'}">
          <span style="width:11px;height:11px;border-radius:50%;background:${corStatus};display:block"></span>
        </div>
        <div class="imain"><div class="ititle">${p.titulo}</div>
          <div class="isub">
            ${p.frente?`<span class="apill">${p.frente}</span>`:''}
            ${estaAtrasado?`<span style="font-size:10px;color:var(--err);font-weight:500">⚠ atrasado</span>`:''}
            ${p.progresso!=null?`<span style="font-size:10px;color:var(--ink4)">${Math.round(p.progresso*100)}% concluído</span>`:''}
          </div>
        </div>
        <div class="iright">
          ${riscoBadge}
          <span class="badge ${badgeClass}" style="font-size:9px">${p.statusRaw}</span>
          <span style="color:var(--ink4);font-size:11px;margin-left:4px;transition:transform .15s;transform:rotate(${open?'90deg':'0deg'})">▶</span>
        </div>
      </div>
      ${open ? detalhesProjeto(p) : ''}
    </div>`;
  }).join('');
  const el = document.getElementById('proj-list');
  if(el) el.innerHTML = itensProjeto || '<div class="empty" style="padding:24px">Nenhum projeto neste filtro</div>';
}

/*
 * alternarChipProjeto(qual) — alterna um filtro rápido (atrasado / risco alto)
 * na aba Projetos e re-renderiza a lista, atualizando o destaque visual do chip.
 */
export function alternarChipProjeto(qual){
  App.chipsProjetos[qual] = !App.chipsProjetos[qual];
  const map = {atraso:'proj-chip-atraso', risco:'proj-chip-risco'};
  const btn = document.getElementById(map[qual]);
  if(btn) btn.classList.toggle('active', App.chipsProjetos[qual]);
  renderizarListaProjetos();
}

/*
 * alternarProjeto(key) — abre ou fecha o painel de detalhes de um projeto.
 * Usa um Set (App.projetosAbertos) pra controlar quais projetos estão expandidos.
 * Se a chave já está no Set → remove (fecha). Se não → adiciona (abre).
 * Re-renderiza a lista em seguida pra refletir a mudança.
 */
export function alternarProjeto(key){
  if(App.projetosAbertos.has(key)) App.projetosAbertos.delete(key);
  else App.projetosAbertos.add(key);
  renderizarListaProjetos();
}

/*
 * detalhesProjeto(project) — gera o HTML do painel de detalhes expandido de um projeto.
 * Só renderiza os blocos de campo que estão preenchidos na planilha.
 * Campos vazios não aparecem (nem como placeholder vazio).
 * O layout é uma grade de 2 colunas (ou 1 coluna no mobile).
 */
export function detalhesProjeto(project){
  const fmt = txt => String(txt||'').trim().replace(/\n/g,'<br>');
  const blocks = [];
  if(project.responsavel)  blocks.push({lbl:'Responsável',             val:project.responsavel});
  if(project.dataFim)      blocks.push({lbl:'Prazo de conclusão',      val:`${project.dataFim.toLocaleDateString('pt-BR')}${projetoAtrasado(project)?' &nbsp;<span style="color:var(--err)">⚠ prazo vencido</span>':''}`});
  if(project.descricao)   blocks.push({lbl:'Descrição',              val:fmt(project.descricao)});
  if(project.equipes)     blocks.push({lbl:'Equipes envolvidas',     val:fmt(project.equipes)});
  if(project.pontoFocal)  blocks.push({lbl:'Ponto focal',            val:project.pontoFocal});
  if(project.atividadesConcluidas) blocks.push({lbl:'Atividades concluídas',  val:fmt(project.atividadesConcluidas)});
  if(project.atividadesAndamento)  blocks.push({lbl:'Atividades em andamento',val:fmt(project.atividadesAndamento)});
  if(project.proximosPassos)       blocks.push({lbl:'Próximos passos',        val:fmt(project.proximosPassos)});
  if(project.comentarios) blocks.push({lbl:'Comentários',           val:fmt(project.comentarios)});
  if(!blocks.length) return `<div class="proj-detail"><div style="font-size:12px;color:var(--ink4);font-style:italic">Sem detalhes preenchidos na planilha.</div></div>`;
  return `<div class="proj-detail">` + blocks.map(b =>
    `<div class="pd-block"><div class="pd-lbl">${b.lbl}</div><div class="pd-val">${b.val}</div></div>`
  ).join('') + `</div>`;
}
