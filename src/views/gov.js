// views/gov.js — ABA: GOVERNANÇA (visão executiva)
// A aba Governança é a visão unificada de todas as fontes.
// Combina Projetos + Melhorias Pipefy + Analytics + Chamados RPA
// num único conjunto de KPIs e gráficos.
//
// Também hospeda construirMapaCalor() — fisicamente parte desta seção desde
// o app.js original, mesmo sendo renderizado a partir da aba Analytics
// (views/ana.js importa daqui).

import { App } from '../state.js';
import { contarPorStatus, contar, calcularPercentual, iconeKpi } from '../utils/helpers.js';
import { nomePadraoCoe } from '../utils/classify.js';
import { filtrarPorPeriodo } from '../utils/date.js';
import { todasAcoesFiltradas } from '../data/actions.js';
import { graficoRosca, barrasHorizontais, mapaCalor, renderizarGraficosPendentes } from '../charts.js';
import { barraAnalise } from '../analysis.js';

/*
 * construirGovernanca() — Painel de Controle (visão executiva).
 *
 * Lê:      App.dadosGovernanca.melhorias, App.dadosGovernanca.projetos, App.dadosGovernanca.analytics, App.chamadosRPA (todas as fontes)
 * Escreve: #gov-content
 * Chamada por: gerarDashboard() e renderizarTudo() (quando o filtro de data muda)
 *
 * Produz:
 *  - KPIs de composição: Concluído / Em andamento / Backlog / Outros
 *  - Donut de status unificado com um segmento de "Impedimentos"
 *  - Barras por responsável (equipe CoE) e por frente
 *  - Heatmap prioridade × frente (Analytics)
 */
export function construirGovernanca(){
  const any = App.carregado.governanca || App.carregado.rpa;
  document.getElementById('gov-empty').style.display = any ? 'none' : 'block';
  document.getElementById('gov-content').style.display = any ? 'block' : 'none';
  if(!any) return;

  const {kept:actions, noDate} = todasAcoesFiltradas();

  // Frentes disponíveis (só itens com frente definida — chamados RPA não têm frente)
  const todasFrentes = [...new Set(actions.filter(a => a.frente).map(a => a.frente))].sort();
  // Validação: se a frente guardada não existe mais nos dados atuais, reseta
  const frenteAtiva  = App.frenteGovernanca && todasFrentes.includes(App.frenteGovernanca) ? App.frenteGovernanca : '';
  if (!frenteAtiva) App.frenteGovernanca = '';
  const acoesFiltradas = frenteAtiva ? actions.filter(a => a.frente === frenteAtiva) : actions;

  const total = acoesFiltradas.length;
  const contagem = contarPorStatus(acoesFiltradas);
  const done    = contagem.done;
  const doing   = contagem.doing + contagem.closing;
  const backlog = contagem.todo;
  const outros  = total - done - doing - backlog;
  const nCancel  = contagem.cancel;
  const nBlocked = contagem.blocked;
  const nMonitor = contagem.monitor;
  const nVendor  = contagem.vendor;
  // monta a descrição do que compõe "Outros" (só categorias com contagem > 0)
  const outrosDesc = [
    nCancel?`${nCancel} cancel.`:'',
    nBlocked?`${nBlocked} bloq.`:'',
    nMonitor?`${nMonitor} monit.`:'',
    nVendor?`${nVendor} suporte`:''
  ].filter(Boolean).join(' · ');

  // Aviso de filtro ativo — mostra o período, total de ações no recorte, e quantas ficaram fora
  let dateNote = '';
  if(App.periodoFiltro.modo !== 'all'){
    const fmt = d => d ? d.toLocaleDateString('pt-BR') : '∞';
    dateNote = `<div class="note" style="background:var(--neu-bg);color:var(--ink3)"><i class="ti ti-calendar-stats"></i><div>
      Período <b>${fmt(App.periodoFiltro.de)} → ${fmt(App.periodoFiltro.ate)}</b>: <b>${total} ações</b> no recorte.`+
      (noDate>0 ? ` (${noDate} ações sem data não entram no filtro.)` : '')+
      ` Para ver tudo, limpe os campos de data no topo.
      <br><span style="font-size:10px;opacity:.6;font-style:italic">Referência por fonte: prazo de conclusão (Projetos) · início/conclusão do desenvolvimento (Pipefy) · data de abertura ou fechamento (Analytics) · data de abertura (RPA)</span>
      </div></div>`;
  }

  const sources = ['Projetos','Pipefy','Analytics','Chamados RPA'];
  const bySource = sources.map(source => {
    const subAcoes = acoesFiltradas.filter(a => a.source === source);
    const subDone  = subAcoes.filter(a => a.codigoStatus === 'done').length;
    return {f: source, total: subAcoes.length, done: subDone};
  }).filter(x => x.total > 0);

  // Chips de filtro de frente — sem onclick inline, listeners adicionados depois do innerHTML
  const frenteChips = todasFrentes.length > 1
    ? `<div class="filters" id="gov-frente-chips" style="margin-bottom:16px">
        <span style="font-size:11px;color:var(--ink4);text-transform:uppercase;letter-spacing:.04em">Frente</span>
        <button class="chip${!frenteAtiva ? ' active' : ''}" data-gf="">Todas</button>
        ${todasFrentes.map(f =>
          `<button class="chip${frenteAtiva === f ? ' active' : ''}" data-gf="${f.replace(/"/g,'&quot;')}">${f}</button>`
        ).join('')}
      </div>` : '';


  // KPIs de composição
  let html = `<div class="sh">Painel de Controle — visão executiva</div>
  ${frenteChips}${dateNote}
  ${barraAnalise('gov')}
  <div class="krow k5">
    <div class="kpi il">${iconeKpi('list')}<div class="knum">${total}</div><div class="klbl">Total de ações CoE</div>
      <div class="ksub">${sources.filter(f=>actions.some(a=>a.source===f)).length} fontes integradas</div></div>
    <div class="kpi gl">${iconeKpi('check')}<div class="knum">${calcularPercentual(done,total)}%</div><div class="klbl">Concluídas</div>
      <div class="ksub">${done} de ${total}</div></div>
    <div class="kpi">${iconeKpi('clock')}<div class="knum">${calcularPercentual(doing,total)}%</div><div class="klbl">Em andamento</div>
      <div class="ksub">${doing} de ${total}</div></div>
    <div class="kpi">${iconeKpi('stack')}<div class="knum">${calcularPercentual(backlog,total)}%</div><div class="klbl">Backlog / não iniciadas</div>
      <div class="ksub">${backlog} de ${total}</div></div>
    <div class="kpi">${iconeKpi('dots')}<div class="knum">${calcularPercentual(outros,total)}%</div><div class="klbl">Outros</div>
      <div class="ksub">${outrosDesc||'—'}</div></div>
  </div>`;


  // Donut de status — junta Encerramento + Monitoramento numa fatia só
  // ("Em encerramento" = fase final / entregue) e usa uma paleta deliberada,
  // ordenada do mais avançado/positivo pro menos. O total mostrado bate com
  // "Total de ações CoE" porque todo status está incluído.
  const statusTodos = contar(acoesFiltradas, a => a.codigoStatus);
  const donutDefs = [
    {label:'Concluído',       value: statusTodos.done    || 0,                          color:'#4DB1B3'},
    {label:'Em encerramento', value:(statusTodos.closing || 0) + (statusTodos.monitor || 0),  color:'#E66407'},
    {label:'Em andamento',    value: statusTodos.doing   || 0,                          color:'#0195D6'},
    {label:'Não iniciado',    value: statusTodos.todo    || 0,                          color:'#9CA3AF'},
    {label:'Impedimentos',    value:(statusTodos.blocked || 0) + (statusTodos.vendor  || 0)
                                  +(statusTodos.cancel  || 0) + (statusTodos.other   || 0),   color:'#C5284C'},
  ];
  const donutData = donutDefs.filter(d => d.value > 0);

  // Detalha o que compõe "Impedimentos" (só mostra categorias com valor > 0)
  const impedimentosDesc = [
    statusTodos.blocked ? `${statusTodos.blocked} bloqueado${statusTodos.blocked > 1 ? 's' : ''}` : '',
    statusTodos.cancel  ? `${statusTodos.cancel} cancelado${statusTodos.cancel  > 1 ? 's' : ''}` : '',
    statusTodos.vendor  ? `${statusTodos.vendor} suporte/fornec.`                           : '',
    statusTodos.other   ? `${statusTodos.other} outro${statusTodos.other > 1 ? 's' : ''}`         : '',
  ].filter(Boolean).join(' · ');

  // Total de ações por responsável da equipe CoE (TODAS — abertas, concluídas, canceladas).
  // Mostra APENAS o time CoE (ver COE_TEAM), somado pelo nome padronizado.
  // IMPORTANTE: cada fonte tem seu próprio campo de responsável:
  //   - Projetos/Pipefy/Analytics: campo 'responsavel' (1 responsável por item)
  //   - Chamados RPA: campo 'responsaveis' (lista — quem trabalha no chamado, não
  //     quem abriu; um chamado pode ter vários responsáveis, cada um conta).
  // Respeita o filtro de período de cada fonte (filtrarPorPeriodo).
  const respCoE = {};
  const addResp = nomeRaw => {
    const nome = nomePadraoCoe(nomeRaw);
    if(nome) respCoE[nome] = (respCoE[nome]||0) + 1;
  };
  // Quando um filtro de frente está ativo: filtra cada fonte por frente; RPA sem frente → excluído
  filtrarPorPeriodo(App.dadosGovernanca.projetos).kept.filter(p => !frenteAtiva || p.frente === frenteAtiva).forEach(p => addResp(p.responsavel));
  filtrarPorPeriodo(App.dadosGovernanca.melhorias).kept.filter(m => !frenteAtiva || m.frente === frenteAtiva).forEach(m => addResp(m.responsavel));
  filtrarPorPeriodo(App.dadosGovernanca.analytics).kept.filter(a => !frenteAtiva || a.frente === frenteAtiva).forEach(a => addResp(a.responsavel));
  // RPA: sempre incluído (sem filtro), ou quando a área do bot bate com a frente ativa
  filtrarPorPeriodo(App.chamadosRPA).kept.filter(r => !frenteAtiva || r.area === frenteAtiva).forEach(r => (r.responsaveis||[]).forEach(addResp));
  const respTop = Object.entries(respCoE).sort((a,b) => b[1]-a[1]);
  const totalRespCoE = respTop.reduce((s,e)=>s+e[1],0); // base pro percentual

  // "Por frente" sempre mostra o quadro completo (actions, não acoesFiltradas) pra comparação
  const frCount = contar(actions.filter(a => a.frente), a => a.frente);
  const fonteInfo = bySource.map(x =>
    `<span><b style="color:var(--ink2)">${x.f}</b> ${x.total} <span style="color:var(--ink4)">(${calcularPercentual(x.done,x.total)}% concl.)</span></span>`
  ).join(' &thinsp;·&thinsp; ');
  html += `<div class="g3">
    <div class="card"><div class="card-title"><i class="ti ti-chart-pie"></i> Status das ações</div>
      ${graficoRosca(donutData)}
      ${impedimentosDesc ? `<div style="margin-top:10px;padding:7px 10px;background:rgba(197,40,76,0.07);border-radius:var(--r);font-size:11px;color:var(--err)">
        <b>Impedimentos:</b> ${impedimentosDesc}
      </div>` : ''}
      <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--rule);font-size:11px;color:var(--ink3);line-height:2">${fonteInfo}</div></div>
    <div class="card"><div class="card-title"><i class="ti ti-user-bolt"></i> Por responsável <span class="rt">equipe CoE</span></div>
      ${respTop.length ? barrasHorizontais(respTop, {max:12, lw:130, tot:totalRespCoE}) : '<div style="font-size:12px;color:var(--ink4)">Sem dados da equipe CoE.</div>'}</div>
    <div class="card"><div class="card-title"><i class="ti ti-building"></i> Por frente</div>
      ${barrasHorizontais(Object.entries(frCount).sort((a,b)=>b[1]-a[1]), {max:8, lw:60, tot:Object.values(frCount).reduce((s,v)=>s+v,0)})}</div>
  </div>`;

  // Rodapé de diagnóstico — mostra de onde vem cada número (trilha de auditoria).
  // Ajuda a identificar rápido se alguma fonte está com contagem inesperada.
  const diag = [
    `Pipefy: ${App.dadosGovernanca.melhorias.length}`,
    `Projetos: ${App.dadosGovernanca.projetos.length}`,
    `Analytics: ${App.dadosGovernanca.analytics.length}`,
    `Chamados RPA: ${App.chamadosRPA.length}`,
    `Bots: ${App.bots.length}`
  ].join(' · ');
  html += `<div style="font-size:10px;color:var(--ink4);margin-top:18px;padding-top:12px;border-top:1px solid var(--rule)">
    Contagem por fonte (total sem filtro de data): ${diag}. Total combinado: ${App.dadosGovernanca.melhorias.length+App.dadosGovernanca.projetos.length+App.dadosGovernanca.analytics.length+App.chamadosRPA.length} ações.</div>`;

  document.getElementById('gov-content').innerHTML = html;

  // Listeners dos chips de frente — sem onclick inline, zero risco de escaping
  document.querySelectorAll('[data-gf]').forEach(btn => {
    btn.addEventListener('click', () => { App.frenteGovernanca = btn.dataset.gf; construirGovernanca(); });
  });

  renderizarGraficosPendentes();
}


/*
 * construirMapaCalor() — heatmap de ações Analytics abertas, por prioridade × frente.
 * Linhas = prioridades 1 a 4. Colunas = frentes.
 * Células com mais ações abertas ficam mais vermelhas.
 * Só aparece se houver dados de Analytics com prioridade preenchida.
 */
export function construirMapaCalor(){
  const {kept:anaF} = filtrarPorPeriodo(App.dadosGovernanca.analytics);
  const {kept:projF} = filtrarPorPeriodo(App.dadosGovernanca.projetos);
  const frentes = [...new Set([...anaF,...projF].map(x=>x.frente).filter(Boolean))].sort();
  if(!anaF.length || !frentes.length) return '';
  const prios = [1,2,3,4];
  const matrix = prios.map(p => frentes.map(f =>
    anaF.filter(a => a.prioridade===p && a.frente===f && a.codigoStatus!=='done').length
  ));
  if(!matrix.flat().some(v => v > 0)) return '';
  return `<div class="card"><div class="card-title"><i class="ti ti-grid-dots"></i> Ações Analytics abertas — prioridade × frente
    <span class="rt">foco executivo</span></div>
    <div style="overflow-x:auto">${mapaCalor(matrix, prios.map(p=>`Prioridade ${p}`), frentes)}</div></div>`;
}
