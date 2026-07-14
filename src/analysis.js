// ─── MODULE: analysis.js ───────────────────────────────────────────────────
// ANÁLISE AUTOMÁTICA ("IA" de insights calculados)
// Gera leituras analíticas a partir dos dados, 100% no navegador —
// nada é enviado a nenhum servidor. Isso não é um modelo de linguagem:
// são análises programadas (concentração, tendência, gargalos, outliers)
// que produzem frases dinâmicas, sempre recalculadas de acordo com a
// planilha e o filtro de período ativo.
//
// Cada aba tem uma função analisar<Aba>() que retorna uma lista de
// observações no formato { type, text }, onde type ∈ {pos, neg, warn, neu}
// controla a cor/ícone. gerarAnalise() monta o painel e barraAnalise() o botão.
// ─────────────────────────────────────────────────────────────────────────────

import { App } from './state.js';
import { HOJE } from './constants.js';
import { count, calculatePercentage, statusCounts, normalizeBotName } from './utils/helpers.js';
import { filtrarPorPeriodo, daysBetween } from './utils/date.js';
import { nomePadraoCoe, projetoAtrasado, faseProjeto, riscoProjeto } from './utils/classify.js';
import { todasAcoesFiltradas } from './data/actions.js';

// helper: maior entrada {chave,valor} de um objeto de contagem
function maiorEntrada(objeto, excluidos=[]){
  const entradas = Object.entries(objeto).filter(([k]) => !excluidos.includes(k)).sort((a,b)=>b[1]-a[1]);
  return entradas[0] || null;
}

/* --- Análise: GOVERNANÇA --- */
function analisarGovernanca(){
  const {kept:acoes} = todasAcoesFiltradas();
  const total = acoes.length;
  if(!total) return [];
  const observacoes = [];
  const sc      = statusCounts(acoes);
  const done    = sc.done;
  const doing   = sc.doing + sc.closing;
  const backlog = sc.todo;
  const taxa = calculatePercentage(done,total);

  // 1. Leitura geral de conclusão
  observacoes.push({type: taxa>=60?'pos':(taxa>=35?'neu':'warn'), ico:'%',
    text:`<b>${taxa}% das ${total} ações estão concluídas</b> (${done}). Em andamento: ${doing}. Backlog/não iniciadas: ${backlog} (${calculatePercentage(backlog,total)}%).`});

  // 2. Qual fonte concentra mais backlog em aberto
  const fontes = ['Projetos','Pipefy','Analytics','Chamados RPA'];
  const backlogPorFonte = {};
  fontes.forEach(f => { backlogPorFonte[f] = acoes.filter(a=>a.source===f && (a.sc==='todo'||a.sc==='doing'||a.sc==='closing')).length; });
  const maiorBacklog = maiorEntrada(backlogPorFonte);
  if(maiorBacklog && maiorBacklog[1]>0){
    observacoes.push({type:'neu', ico:'≡',
      text:`A fonte com mais ações em aberto é <b>${maiorBacklog[0]}</b>, com ${maiorBacklog[1]} ${maiorBacklog[1]===1?'ação':'ações'} (em andamento ou backlog).`});
  }

  // 3. Concentração de ações abertas por responsável (só equipe CoE, igual ao gráfico)
  const abertasPorResponsavel = {};
  acoes.filter(a=>a.resp && a.sc!=='done' && a.sc!=='cancel').forEach(a=>{
    const nome = nomePadraoCoe(a.resp);
    if(nome) abertasPorResponsavel[nome] = (abertasPorResponsavel[nome]||0)+1;
  });
  const totalAberto = Object.values(abertasPorResponsavel).reduce((s,v)=>s+v,0);
  const maiorResponsavel = maiorEntrada(abertasPorResponsavel);
  if(maiorResponsavel && totalAberto>0){
    // limiar de 30%: uma pessoa carregando >30% das ações abertas é um possível gargalo.
    // Abaixo disso é só "maior carga individual" — informativo, não um problema.
    observacoes.push({type: maiorResponsavel[1]/totalAberto>0.3?'warn':'neu', ico:'@',
      text:`Na equipe CoE, <b>${maiorResponsavel[0]}</b> concentra ${maiorResponsavel[1]} ações abertas (${calculatePercentage(maiorResponsavel[1],totalAberto)}% do total da equipe) — ${maiorResponsavel[1]/totalAberto>0.3?'possível gargalo de capacidade':'maior carga individual'}.`});
  }

  // 4. Canceladas (sinalizado se relevante)
  // limiar de 5%: abaixo disso é ruído normal de planejamento; acima merece revisão de processo.
  const cancelados = acoes.filter(a=>a.sc==='cancel').length;
  if(cancelados>0 && calculatePercentage(cancelados,total)>=5){
    observacoes.push({type:'warn', ico:'×',
      text:`<b>${cancelados} ações canceladas</b> (${calculatePercentage(cancelados,total)}% do total) — vale revisar o motivo para reduzir retrabalho de planejamento.`});
  }
  return observacoes;
}

/* --- Análise: PROJETOS --- */
function analisarProjetos(){
  const {kept:projetos} = filtrarPorPeriodo(App.P.proj);
  const total = projetos.length;
  if(!total) return [];
  const observacoes = [];
  const emExecucao = projetos.filter(p=>p.sc==='doing').length;
  const emFaseFinal = projetos.filter(p=>p.sc==='closing'||p.sc==='monitor').length;
  const atrasados = projetos.filter(projetoAtrasado);

  // 1. Status geral
  observacoes.push({type:'neu', ico:'≡',
    text:`<b>${total} projetos</b> no recorte: ${emExecucao} em execução, ${emFaseFinal} em fase final (encerramento/monitoramento).`});

  // 2. Atrasados — uma lista NOMEADA de quais são (ordenados por dias de atraso)
  if(atrasados.length>0){
    const comDias = atrasados.map(p => ({
      titulo: p.titulo,
      dias: daysBetween(HOJE, p.dtFim),
      fase: faseProjeto(p.statusRaw), statusRaw: p.statusRaw
    })).sort((a,b)=>b.dias-a.dias);
    const lista = comDias.map(p => `<b>${p.titulo}</b> (${p.dias}d, ${p.statusRaw})`).join('; ');
    observacoes.push({type:'neg', ico:'!',
      text:`<b>${atrasados.length} ${atrasados.length===1?'projeto atrasado':'projetos atrasados'}</b>: ${lista}.`});
  } else {
    observacoes.push({type:'pos', ico:'✓', text:`Nenhum projeto com prazo vencido neste recorte.`});
  }

  // 3. Projeto mais crítico pelo score de risco automático
  const comRisco = projetos.map(p => ({project: p, risk: riscoProjeto(p)})).filter(x=>x.risk.score>0).sort((a,b)=>b.risk.score-a.risk.score);
  if(comRisco.length){
    const maisCritico = comRisco[0];
    const nivelPt = {high:'alto', medium:'médio', low:'baixo'}[maisCritico.risk.level];
    observacoes.push({type: maisCritico.risk.level==='high'?'neg':'warn', ico:'▲',
      text:`Projeto mais crítico: <b>${maisCritico.project.titulo}</b> (risco ${nivelPt}, score ${maisCritico.risk.score}) — ${maisCritico.risk.reasons.join(', ')}.`});
    const contagemRiscoAlto = comRisco.filter(x=>x.risk.level==='high').length;
    if(contagemRiscoAlto>1){
      observacoes.push({type:'warn', ico:'▲',
        text:`<b>${contagemRiscoAlto} projetos</b> estão em risco alto e merecem atenção prioritária.`});
    }
  }

  // 4. Frente com mais projetos
  const porArea = count(projetos.filter(p=>p.frente), p=>p.frente);
  const maiorArea = maiorEntrada(porArea);
  if(maiorArea){
    observacoes.push({type:'neu', ico:'#',
      text:`A frente com mais projetos é <b>${maiorArea[0]}</b> (${maiorArea[1]}).`});
  }

  // 5. Projetos não iniciados
  // limiar de 30%: se mais de 30% da carteira não começou, o pipeline está represado.
  const naoIniciados = projetos.filter(p=>p.sc==='todo').length;
  if(naoIniciados>0){
    observacoes.push({type: calculatePercentage(naoIniciados,total)>30?'warn':'neu', ico:'○',
      text:`<b>${naoIniciados} ${naoIniciados===1?'projeto não iniciado':'projetos não iniciados'}</b> (${calculatePercentage(naoIniciados,total)}% da carteira) aguardando início.`});
  }
  return observacoes;
}

/* --- Análise: MELHORIAS PIPEFY --- */
function analisarMelhorias(){
  const {kept: melhorias} = filtrarPorPeriodo(App.P.improvements);
  const total = melhorias.length;
  if(!total) return [];
  const observacoes = [];
  const sc      = statusCounts(melhorias);
  const done    = sc.done;
  const backlog = sc.todo;
  const blocked = sc.blocked;

  observacoes.push({type: calculatePercentage(done,total)>=60?'pos':'neu', ico:'%',
    text:`<b>${calculatePercentage(done,total)}% das ${total} melhorias concluídas</b> (${done}). Backlog: ${backlog}.`});

  // complexidade predominante
  const porComplexidade = count(melhorias.filter(m=>m.complex), m=>m.complex);
  const maiorComplexidade = maiorEntrada(porComplexidade);
  if(maiorComplexidade){
    observacoes.push({type:'neu', ico:'≡',
      text:`Complexidade predominante: <b>${maiorComplexidade[0]}</b> (${maiorComplexidade[1]} melhorias, ${calculatePercentage(maiorComplexidade[1],total)}%).`});
  }

  // área que mais demanda melhorias
  const porArea = count(melhorias.filter(m=>m.frente), m=>m.frente);
  const maiorArea = maiorEntrada(porArea);
  if(maiorArea){
    observacoes.push({type:'neu', ico:'#',
      text:`A frente que mais demanda melhorias é <b>${maiorArea[0]}</b> (${maiorArea[1]}).`});
  }

  if(blocked>0){
    observacoes.push({type:'warn', ico:'!',
      text:`<b>${blocked} ${blocked===1?'melhoria bloqueada':'melhorias bloqueadas'}</b> — vale destravar para liberar o fluxo.`});
  }
  return observacoes;
}

/* --- Análise: ANALYTICS --- */
function analisarAnalytics(){
  const {kept:atividades} = filtrarPorPeriodo(App.P.ana);
  const total = atividades.length;
  if(!total) return [];
  const observacoes = [];
  const done = atividades.filter(a=>a.sc==='done').length;

  observacoes.push({type: calculatePercentage(done,total)>=50?'pos':'neu', ico:'%',
    text:`<b>${calculatePercentage(done,total)}% das ${total} atividades concluídas</b> (${done}).`});

  // prioridade 1 ainda aberta — alerta
  const p1Abertas = atividades.filter(a=>a.prio===1 && a.sc!=='done' && a.sc!=='cancel').length;
  if(p1Abertas>0){
    observacoes.push({type:'neg', ico:'!',
      text:`<b>${p1Abertas} ${p1Abertas===1?'atividade de Prioridade 1 em aberto':'atividades de Prioridade 1 em aberto'}</b> — foco máximo de atenção.`});
  }

  // área com mais demanda
  const porArea = count(atividades.filter(a=>a.frente), a=>a.frente);
  const maiorArea = maiorEntrada(porArea);
  if(maiorArea){
    observacoes.push({type:'neu', ico:'#',
      text:`A frente com mais atividades de Analytics é <b>${maiorArea[0]}</b> (${maiorArea[1]}).`});
  }

  // sem data (transparência)
  const semData = atividades.filter(a=>!a.dtFim && !a.dtInicio).length;
  if(semData>0){
    observacoes.push({type:'neu', ico:'○',
      text:`${semData} de ${total} atividades não têm data registrada, então não entram nos cálculos por período.`});
  }
  return observacoes;
}

/* --- Análise: CHAMADOS RPA --- */
function analisarRPA(){
  const {kept: chamados} = filtrarPorPeriodo(App.R);
  const total = chamados.length;
  if(!total) return [];
  const observacoes = [];
  const vencidos = chamados.filter(r=>r.vencido).length;
  const concluidos = chamados.filter(r=>r.fase.toLowerCase().includes('conclu')).length;

  // 1. Concentração nos top bots
  // limiar de 40%: se 3 processos (de dezenas) concentram >40% dos chamados,
  // estabilizá-los tem um impacto desproporcional no volume total de suporte.
  const porProcesso = count(chamados.filter(r=>r.processo!=='(sem processo)'), r=>r.processo);
  const ordenados = Object.entries(porProcesso).sort((a,b)=>b[1]-a[1]);
  const totalProcesso = ordenados.reduce((s,e)=>s+e[1],0);
  if(ordenados.length>=3){
    const top3 = ordenados.slice(0,3);
    const somaTop3 = top3.reduce((s,e)=>s+e[1],0);
    observacoes.push({type: somaTop3/totalProcesso>0.4?'warn':'neu', ico:'≡',
      text:`Os 3 processos com mais manutenções (<b>${top3.map(e=>e[0]).join(', ')}</b>) concentram <b>${calculatePercentage(somaTop3,totalProcesso)}%</b> dos chamados. Estabilizá-los reduz bastante o volume de suporte.`});
  }

  // 2. Taxa de chamados vencidos (SLA)
  // Limiar: >25% = crítico (vermelho), >0% = atenção (laranja), 0% = bom (verde).
  observacoes.push({type: calculatePercentage(vencidos,total)>25?'neg':(calculatePercentage(vencidos,total)>0?'warn':'pos'), ico: calculatePercentage(vencidos,total)>25?'!':'%',
    text:`<b>${calculatePercentage(vencidos,total)}% dos ${total} chamados venceram o prazo</b> (${vencidos}). Concluídos: ${calculatePercentage(concluidos,total)}%.`});

  // 3. Problema mais comum
  const porProblema = count(chamados, r=>r.problema);
  const maiorProblema = maiorEntrada(porProblema, ['']);
  if(maiorProblema && maiorProblema[0]){
    observacoes.push({type:'neu', ico:'?',
      text:`Problema mais frequente: <b>"${maiorProblema[0]}"</b> (${maiorProblema[1]} chamados, ${calculatePercentage(maiorProblema[1],total)}%).`});
  }

  // 4. Tendência mês a mês: compara a média da 1ª metade do período com a 2ª metade.
  // limiar de 15%: variações abaixo disso são flutuação normal; acima é uma tendência real.
  // Dividir em duas metades funciona com qualquer número de meses disponíveis.
  const porMes = {};
  chamados.forEach(r=>{ if(r.mes) porMes[r.mes]=(porMes[r.mes]||0)+1; });
  const meses = Object.keys(porMes).sort();
  if(meses.length>=4){
    const metade = Math.floor(meses.length/2);
    const recente = meses.slice(-metade).reduce((s,m)=>s+porMes[m],0)/metade; // média da 2ª metade
    const anterior  = meses.slice(0,metade).reduce((s,m)=>s+porMes[m],0)/metade; // média da 1ª metade
    const variacao = anterior>0 ? Math.round((recente-anterior)/anterior*100) : 0; // variação %
    if(Math.abs(variacao)>=15){
      observacoes.push({type: variacao>0?'warn':'pos', ico: variacao>0?'↑':'↓',
        text:`O volume de chamados está <b>${variacao>0?'subindo':'caindo'}</b>: média recente ${recente.toFixed(0)}/mês vs ${anterior.toFixed(0)}/mês no início do período (${variacao>0?'+':''}${variacao}%).`});
    }
  }

  // 5. Área que mais abre chamados (se mapeada)
  const porArea = count(chamados.filter(r=>r.area && r.area!=='(não mapeada)'), r=>r.area);
  const maiorArea = maiorEntrada(porArea);
  if(maiorArea){
    observacoes.push({type:'neu', ico:'#',
      text:`A área que mais abre chamados é <b>${maiorArea[0]}</b> (${maiorArea[1]}).`});
  }
  return observacoes;
}

/* --- Análise: INVENTÁRIO DE BOTS --- */
function analisarBots(){
  // bots usam o filtro de AnoPRD; aqui analisamos o conjunto completo carregado
  const bots = App.B;
  if(!bots.length) return [];
  const observacoes = [];
  const prd     = bots.filter(b=>b.status==='PRD').length;
  const dev     = bots.filter(b=>b.status==='DEV').length;
  const backlog = bots.filter(b=>b.status==='BACKLOG').length;

  observacoes.push({type:'neu', ico:'≡',
    text:`<b>${bots.length} bots no inventário</b>: ${prd} em produção (${calculatePercentage(prd,bots.length)}%), ${dev} em desenvolvimento, ${backlog} em backlog.`});

  // cobertura por área (entre as áreas de negócio principais)
  const botsPrd = bots.filter(b=>b.status==='PRD');
  const porArea = count(botsPrd, b=>b.area);
  const maiorArea = maiorEntrada(porArea);
  if(maiorArea){
    observacoes.push({type:'neu', ico:'#',
      text:`A área com mais automações em produção é <b>${maiorArea[0]}</b> (${maiorArea[1]} bots, ${calculatePercentage(maiorArea[1],prd)}%).`});
  }

  // bots críticos
  const criticos = botsPrd.filter(b=>b.criticidade && b.criticidade<=2).length;
  if(criticos>0){
    observacoes.push({type:'warn', ico:'!',
      text:`<b>${criticos} bots em produção são de criticidade alta</b> (nível 1-2) — priorize monitoramento e plano de contingência.`});
  }

  // cruzamento com chamados, se disponível
  if(App.R.length){
    const chamadosPorProcesso = count(App.R, r=>r.processo);
    let maxChamados = 0, botComMaisChamados = '';
    botsPrd.forEach(b => {
      const nomeBotNorm = normalizeBotName(b.nome);
      let totalChamados = 0;
      Object.entries(chamadosPorProcesso).forEach(([proc, qtd]) => {
        const nomeProcNorm = normalizeBotName(proc);
        if (nomeProcNorm && nomeBotNorm && (nomeBotNorm.includes(nomeProcNorm) || nomeProcNorm.includes(nomeBotNorm))) {
          totalChamados += qtd;
        }
      });
      if (totalChamados > maxChamados) { maxChamados = totalChamados; botComMaisChamados = b.nome; }
    });
    if(maxChamados>0){
      observacoes.push({type:'warn', ico:'⚙',
        text:`O bot em produção com mais manutenções é <b>${botComMaisChamados}</b> (${maxChamados} chamados) — forte candidato a refatoração.`});
    }
  }
  return observacoes;
}

// Ícone (SVG inline) do botão "faísca/análise" — não depende de fonte externa
const FAISCA_IA = '<svg class="ai-spark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2z"/></svg>';

/*
 * barraAnalise(aba) — gera o HTML do botão "Gerar análise" de uma aba.
 * O id do container do painel é ai-panel-<aba>, preenchido por gerarAnalise().
 */
export function barraAnalise(aba){
  return `<div class="ai-bar">
    <button class="ai-btn" id="ai-btn-${aba}" onclick="gerarAnalise('${aba}')">${FAISCA_IA} Gerar análise</button>
    <span class="ai-hint">leitura automática dos números deste recorte · 100% local</span>
  </div><div id="ai-panel-${aba}"></div>`;
}

/*
 * gerarAnalise(aba) — calcula as observações da aba e renderiza o painel.
 * Mostra um estado breve de "analisando" (puramente visual) e depois o resultado.
 * Clicar de novo recolhe o painel (toggle).
 */
export function gerarAnalise(aba){
  const painel = document.getElementById('ai-panel-'+aba);
  const botao = document.getElementById('ai-btn-'+aba);
  if(!painel) return;
  // toggle: se já está aberto, recolhe
  if(painel.dataset.open === '1'){
    painel.innerHTML = ''; painel.dataset.open = '0';
    return;
  }
  if(botao) botao.classList.add('loading');
  // pequeno atraso só pra dar uma sensação de processamento (não bloqueia nada)
  setTimeout(() => {
    const funcao = {
      gov: analisarGovernanca, proj: analisarProjetos, mel: analisarMelhorias,
      ana: analisarAnalytics, rpa: analisarRPA, bots: analisarBots
    }[aba];
    const observacoes = (funcao ? funcao() : []).filter(Boolean);
    const corpo = observacoes.length
      ? observacoes.map(i => `<div class="ai-item ${i.type}"><div class="ai-ico">${i.ico||'•'}</div><div>${i.text}</div></div>`).join('')
      : `<div class="ai-item neu"><div class="ai-ico">•</div><div>Não há dados suficientes neste recorte para gerar uma análise. Tente limpar o filtro de período.</div></div>`;
    painel.innerHTML = `<div class="ai-panel">
      <div class="ai-panel-head">${FAISCA_IA}<span class="ai-panel-title">Análise automática</span>
        <span class="ai-panel-sub">${observacoes.length} ${observacoes.length===1?'observação':'observações'} · recalculado dos dados atuais</span></div>
      ${corpo}</div>`;
    painel.dataset.open = '1';
    if(botao) botao.classList.remove('loading');
  }, 280);
}
