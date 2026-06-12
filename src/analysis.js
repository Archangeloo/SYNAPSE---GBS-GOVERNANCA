import { App } from './state.js';
import { AI_SPARK } from './constants.js';
import { applyDate } from './utils/date.js';
import { projAtrasado, projRisco, projFase, coeNomePadrao } from './utils/classify.js';
import { count, pct } from './utils/helpers.js';
import { allActionsFiltered } from './views/gov.js';
import { HOJE } from './constants.js';

// ─── MÓDULO: analysis.js ─────────────────────────────────────────────────────
// Painel de análise automática de cada aba do dashboard.
//
// IMPORTANTE: não é IA nem modelo de linguagem — são análises programadas que
// detectam padrões nos dados (concentração, tendência, gargalos, outliers) e
// geram frases dinâmicas em português conforme os dados e filtro de período.
//
// Cada função analise*() retorna um array de "insights" no formato:
//   { tipo: 'pos'|'neu'|'warn'|'neg', ico: string, texto: string }
//
//   tipo determina a cor do card:
//     pos  = verde   (algo bom)
//     neu  = cinza   (informativo, neutro)
//     warn = laranja (atenção, mas não crítico)
//     neg  = vermelho (problema identificado)
//
// Exporta:
//   aiBar(aba)          — HTML do botão "Gerar análise" + placeholder do painel
//   gerarAnalise(aba)   — calcula insights e renderiza o painel (toggle)
//   topEntry(obj, excl) — entrada com maior valor num objeto { chave: n }
// ─────────────────────────────────────────────────────────────────────────────

// Gera o HTML do botão "Gerar análise" e o container vazio onde o painel vai aparecer.
export function aiBar(aba) {
  return `<div class="ai-bar">
    <button class="ai-btn" id="ai-btn-${aba}" onclick="gerarAnalise('${aba}')">${AI_SPARK} Gerar análise</button>
    <span class="ai-hint">leitura automática dos números deste recorte · 100% local</span>
  </div><div id="ai-panel-${aba}"></div>`;
}

// Calcula e renderiza o painel de análise. Funciona como toggle:
// primeiro clique abre, segundo clique fecha.
// O setTimeout de 280ms cria a impressão de "processamento" para o usuário.
export function gerarAnalise(aba) {
  const panel = document.getElementById('ai-panel-' + aba);
  const btn   = document.getElementById('ai-btn-' + aba);
  if (!panel) return;

  // Se já está aberto, fecha e sai
  if (panel.dataset.open === '1') {
    panel.innerHTML = ''; panel.dataset.open = '0';
    return;
  }

  if (btn) btn.classList.add('loading'); // animação no botão durante o cálculo

  setTimeout(() => {
    // Mapeia cada aba para sua função de análise específica
    const fn = { gov: analiseGov, proj: analiseProj, mel: analiseMel, ana: analiseAna, rpa: analiseRPA, bots: analiseBots }[aba];
    const insights = (fn ? fn() : []).filter(Boolean); // remove nulls/undefined

    const corpo = insights.length
      ? insights.map(i => `<div class="ai-item ${i.tipo}"><div class="ai-ico">${i.ico || '•'}</div><div>${i.texto}</div></div>`).join('')
      : `<div class="ai-item neu"><div class="ai-ico">•</div><div>Não há dados suficientes neste recorte para gerar uma análise. Tente limpar o filtro de período.</div></div>`;

    panel.innerHTML = `<div class="ai-panel">
      <div class="ai-panel-head">${AI_SPARK}<span class="ai-panel-title">Análise automática</span>
        <span class="ai-panel-sub">${insights.length} ${insights.length === 1 ? 'observação' : 'observações'} · recalculado dos dados atuais</span></div>
      ${corpo}</div>`;
    panel.dataset.open = '1';
    if (btn) btn.classList.remove('loading');
  }, 280);
}

// Retorna a entrada com maior valor num objeto de contagem { chave: n },
// excluindo as chaves passadas em 'excluir'. Retorna null se o objeto for vazio.
export function topEntry(obj, excluir = []) {
  const e = Object.entries(obj).filter(([k]) => !excluir.includes(k)).sort((a, b) => b[1] - a[1]);
  return e[0] || null;
}

// ─── Análise: GOVERNANÇA ──────────────────────────────────────────────────────
// Cruza todas as 4 fontes para gerar insights executivos.
function analiseGov() {
  const { kept: A } = allActionsFiltered();
  const tot = A.length;
  if (!tot) return [];

  const ins     = [];
  const done    = A.filter(a => a.sc === 'done').length;
  const doing   = A.filter(a => a.sc === 'doing' || a.sc === 'closing').length;
  const backlog = A.filter(a => a.sc === 'todo').length;
  const taxa    = pct(done, tot);

  // Insight 1: Taxa de conclusão geral
  // Limiar: ≥60% = positivo, 35–59% = neutro, <35% = atenção
  ins.push({ tipo: taxa >= 60 ? 'pos' : (taxa >= 35 ? 'neu' : 'warn'), ico: '%',
    texto: `<b>${taxa}% das ${tot} ações estão concluídas</b> (${done}). Em andamento: ${doing}. Backlog/não iniciadas: ${backlog} (${pct(backlog, tot)}%).` });

  // Insight 2: Qual fonte tem mais ações em aberto (possível gargalo de entrega)
  const fontes = ['Projetos', 'Pipefy', 'Analytics', 'Chamados RPA'];
  const backlogPorFonte = {};
  fontes.forEach(f => {
    backlogPorFonte[f] = A.filter(a => a.fonte === f && (a.sc === 'todo' || a.sc === 'doing' || a.sc === 'closing')).length;
  });
  const topBacklog = topEntry(backlogPorFonte);
  if (topBacklog && topBacklog[1] > 0) {
    ins.push({ tipo: 'neu', ico: '≡',
      texto: `A fonte com mais ações em aberto é <b>${topBacklog[0]}</b>, com ${topBacklog[1]} ${topBacklog[1] === 1 ? 'ação' : 'ações'} (em andamento ou backlog).` });
  }

  // Insight 3: Concentração de carga na equipe CoE
  // Limiar 30%: se uma pessoa carrega mais de 30% das ações abertas, é gargalo.
  // Abaixo disso é "maior carga individual" (informativo, não problemático).
  const abertasPorResp = {};
  A.filter(a => a.resp && a.sc !== 'done' && a.sc !== 'cancel').forEach(a => {
    const nome = coeNomePadrao(a.resp);
    if (nome) abertasPorResp[nome] = (abertasPorResp[nome] || 0) + 1;
  });
  const totalAbertas = Object.values(abertasPorResp).reduce((s, v) => s + v, 0);
  const topResp      = topEntry(abertasPorResp);
  if (topResp && totalAbertas > 0) {
    const concentrado = topResp[1] / totalAbertas > 0.3; // mais de 30% das ações em uma pessoa
    ins.push({ tipo: concentrado ? 'warn' : 'neu', ico: '@',
      texto: `Na equipe CoE, <b>${topResp[0]}</b> concentra ${topResp[1]} ações abertas (${pct(topResp[1], totalAbertas)}% do total da equipe) — ${concentrado ? 'possível gargalo de capacidade' : 'maior carga individual'}.` });
  }

  // Insight 4: Cancelamentos expressivos
  // Limiar 5%: abaixo disso é ruído normal; acima merece revisão de processo.
  const cancel = A.filter(a => a.sc === 'cancel').length;
  if (cancel > 0 && pct(cancel, tot) >= 5) {
    ins.push({ tipo: 'warn', ico: '×',
      texto: `<b>${cancel} ações canceladas</b> (${pct(cancel, tot)}% do total) — vale revisar o motivo para reduzir retrabalho de planejamento.` });
  }

  return ins;
}

// ─── Análise: PROJETOS ────────────────────────────────────────────────────────
function analiseProj() {
  const { kept: P } = applyDate(App.P.proj);
  const tot = P.length;
  if (!tot) return [];

  const ins     = [];
  const exec    = P.filter(p => p.sc === 'doing').length;
  const fin     = P.filter(p => p.sc === 'closing' || p.sc === 'monitor').length;
  const atrasados = P.filter(projAtrasado);

  // Insight 1: Visão geral do portfólio
  ins.push({ tipo: 'neu', ico: '≡',
    texto: `<b>${tot} projetos</b> no recorte: ${exec} em execução, ${fin} em fase final (encerramento/monitoramento).` });

  // Insight 2: Projetos atrasados (ordenados por dias de atraso, do mais crítico)
  if (atrasados.length > 0) {
    const comDias = atrasados.map(p => ({
      titulo: p.titulo,
      dias: Math.round((HOJE - p.dtFim) / 86400000), // dias desde o prazo
      statusRaw: p.statusRaw
    })).sort((a, b) => b.dias - a.dias); // mais atrasado primeiro

    const lista = comDias.map(p => `<b>${p.titulo}</b> (${p.dias}d, ${p.statusRaw})`).join('; ');
    ins.push({ tipo: 'neg', ico: '!',
      texto: `<b>${atrasados.length} ${atrasados.length === 1 ? 'projeto atrasado' : 'projetos atrasados'}</b>: ${lista}.` });
  } else {
    ins.push({ tipo: 'pos', ico: '✓', texto: `Nenhum projeto com prazo vencido neste recorte.` });
  }

  // Insight 3: Projeto mais crítico pelo score de risco composto
  const comRisco = P.map(p => ({ p, r: projRisco(p) }))
    .filter(x => x.r.score > 0)
    .sort((a, b) => b.r.score - a.r.score); // mais crítico primeiro

  if (comRisco.length) {
    const top   = comRisco[0];
    const altos = comRisco.filter(x => x.r.nivel === 'alto').length;
    ins.push({ tipo: top.r.nivel === 'alto' ? 'neg' : 'warn', ico: '▲',
      texto: `Projeto mais crítico: <b>${top.p.titulo}</b> (risco ${top.r.nivel}, score ${top.r.score}) — ${top.r.motivos.join(', ')}.` });
    if (altos > 1) {
      ins.push({ tipo: 'warn', ico: '▲',
        texto: `<b>${altos} projetos</b> estão em risco alto e merecem atenção prioritária.` });
    }
  }

  // Insight 4: Frente com mais projetos (concentração de demanda)
  const porFrente = count(P.filter(p => p.frente), p => p.frente);
  const topFr     = topEntry(porFrente);
  if (topFr) ins.push({ tipo: 'neu', ico: '#', texto: `A frente com mais projetos é <b>${topFr[0]}</b> (${topFr[1]}).` });

  // Insight 5: Projetos não iniciados (backlog de projetos aguardando kick-off)
  // Limiar 30%: se mais de 30% da carteira ainda não começou, é sinal de pipeline represado.
  const naoIni = P.filter(p => p.sc === 'todo').length;
  if (naoIni > 0) {
    ins.push({ tipo: pct(naoIni, tot) > 30 ? 'warn' : 'neu', ico: '○',
      texto: `<b>${naoIni} ${naoIni === 1 ? 'projeto não iniciado' : 'projetos não iniciados'}</b> (${pct(naoIni, tot)}% da carteira) aguardando início.` });
  }

  return ins;
}

// ─── Análise: PIPEFY MELHORIAS ────────────────────────────────────────────────
function analiseMel() {
  const { kept: M } = applyDate(App.P.mel);
  const tot = M.length;
  if (!tot) return [];

  const ins     = [];
  const done    = M.filter(m => m.sc === 'done').length;
  const backlog = M.filter(m => m.sc === 'todo').length;
  const blocked = M.filter(m => m.sc === 'blocked').length;

  // Insight 1: Taxa de conclusão
  // Limiar 60%: abaixo disso o backlog está crescendo mais rápido que as entregas.
  ins.push({ tipo: pct(done, tot) >= 60 ? 'pos' : 'neu', ico: '%',
    texto: `<b>${pct(done, tot)}% das ${tot} melhorias concluídas</b> (${done}). Backlog: ${backlog}.` });

  // Insight 2: Complexidade predominante (orienta onde focar automação de processo)
  const porCplx = count(M.filter(m => m.complex), m => m.complex);
  const topC    = topEntry(porCplx);
  if (topC) ins.push({ tipo: 'neu', ico: '≡', texto: `Complexidade predominante: <b>${topC[0]}</b> (${topC[1]} melhorias, ${pct(topC[1], tot)}%).` });

  // Insight 3: Frente que mais demanda melhorias (foco de esforço do time Pipefy)
  const porFr = count(M.filter(m => m.frente), m => m.frente);
  const topFr = topEntry(porFr);
  if (topFr) ins.push({ tipo: 'neu', ico: '#', texto: `A frente que mais demanda melhorias é <b>${topFr[0]}</b> (${topFr[1]}).` });

  // Insight 4: Melhorias bloqueadas (travadas por impedimento externo)
  if (blocked > 0) ins.push({ tipo: 'warn', ico: '!',
    texto: `<b>${blocked} ${blocked === 1 ? 'melhoria bloqueada' : 'melhorias bloqueadas'}</b> — vale destravar para liberar o fluxo.` });

  return ins;
}

// ─── Análise: ANALYTICS ───────────────────────────────────────────────────────
function analiseAna() {
  const { kept: A } = applyDate(App.P.ana);
  const tot = A.length;
  if (!tot) return [];

  const ins  = [];
  const done = A.filter(a => a.sc === 'done').length;

  // Insight 1: Taxa de conclusão
  // Limiar 50%: patamar mínimo saudável para Analytics.
  ins.push({ tipo: pct(done, tot) >= 50 ? 'pos' : 'neu', ico: '%',
    texto: `<b>${pct(done, tot)}% das ${tot} atividades concluídas</b> (${done}).` });

  // Insight 2: Atividades P1 em aberto (máxima prioridade, risco operacional)
  const p1aberta = A.filter(a => a.prio === 1 && a.sc !== 'done' && a.sc !== 'cancel').length;
  if (p1aberta > 0) ins.push({ tipo: 'neg', ico: '!',
    texto: `<b>${p1aberta} ${p1aberta === 1 ? 'atividade de Prioridade 1 em aberto' : 'atividades de Prioridade 1 em aberto'}</b> — foco máximo de atenção.` });

  // Insight 3: Frente com mais atividades
  const porFr = count(A.filter(a => a.frente), a => a.frente);
  const topFr = topEntry(porFr);
  if (topFr) ins.push({ tipo: 'neu', ico: '#', texto: `A frente com mais atividades de Analytics é <b>${topFr[0]}</b> (${topFr[1]}).` });

  // Insight 4: Atividades sem data (reduzem a utilidade do filtro de período)
  const semData = A.filter(a => !a.dtFim && !a.dtAbre).length;
  if (semData > 0) ins.push({ tipo: 'neu', ico: '○',
    texto: `${semData} de ${tot} atividades não têm data registrada, então não entram nos cálculos por período.` });

  return ins;
}

// ─── Análise: CHAMADOS RPA ────────────────────────────────────────────────────
function analiseRPA() {
  const { kept: R } = applyDate(App.R);
  const tot = R.length;
  if (!tot) return [];

  const ins   = [];
  const venc  = R.filter(r => r.vencido).length;
  const concl = R.filter(r => r.fase.toLowerCase().includes('conclu')).length;

  // Insight 1: Concentração nos top 3 processos
  // Por que 40%? Se 3 processos (de dezenas) concentram 40%+ dos chamados,
  // estabilizá-los tem impacto desproporcional na redução do volume de suporte.
  const porProc   = count(R.filter(r => r.processo !== '(sem processo)'), r => r.processo);
  const ordenado  = Object.entries(porProc).sort((a, b) => b[1] - a[1]);
  const totalProc = ordenado.reduce((s, e) => s + e[1], 0);
  if (ordenado.length >= 3) {
    const top3  = ordenado.slice(0, 3);
    const soma3 = top3.reduce((s, e) => s + e[1], 0);
    ins.push({ tipo: soma3 / totalProc > 0.4 ? 'warn' : 'neu', ico: '≡',
      texto: `Os 3 processos com mais manutenções (<b>${top3.map(e => e[0]).join(', ')}</b>) concentram <b>${pct(soma3, totalProc)}%</b> dos chamados. Estabilizá-los reduz bastante o volume de suporte.` });
  }

  // Insight 2: Taxa de vencimento de SLA
  // Limiar: >25% é crítico (vermelho), >0% é atenção (laranja), 0% é positivo.
  ins.push({ tipo: pct(venc, tot) > 25 ? 'neg' : (pct(venc, tot) > 0 ? 'warn' : 'pos'), ico: pct(venc, tot) > 25 ? '!' : '%',
    texto: `<b>${pct(venc, tot)}% dos ${tot} chamados venceram o prazo</b> (${venc}). Concluídos: ${pct(concl, tot)}%.` });

  // Insight 3: Tipo de problema mais frequente
  const porProb = count(R, r => r.problema);
  const topProb = topEntry(porProb, ['']); // exclui chave vazia
  if (topProb && topProb[0]) ins.push({ tipo: 'neu', ico: '?',
    texto: `Problema mais frequente: <b>"${topProb[0]}"</b> (${topProb[1]} chamados, ${pct(topProb[1], tot)}%).` });

  // Insight 4: Tendência de volume (crescendo ou caindo?)
  // Compara a média mensal da primeira metade do período com a segunda metade.
  // Limiar 15%: variações menores que 15% são ruído; acima disso é tendência real.
  const porMes = {};
  R.forEach(r => { if (r.mes) porMes[r.mes] = (porMes[r.mes] || 0) + 1; });
  const meses = Object.keys(porMes).sort();

  if (meses.length >= 4) {
    const metade  = Math.floor(meses.length / 2);
    const recentes = meses.slice(-metade).reduce((s, m) => s + porMes[m], 0) / metade;  // média da 2ª metade
    const antigos  = meses.slice(0, metade).reduce((s, m) => s + porMes[m], 0) / metade; // média da 1ª metade
    const variacao = antigos > 0 ? Math.round((recentes - antigos) / antigos * 100) : 0;

    if (Math.abs(variacao) >= 15) {
      ins.push({ tipo: variacao > 0 ? 'warn' : 'pos', ico: variacao > 0 ? '↑' : '↓',
        texto: `O volume de chamados está <b>${variacao > 0 ? 'subindo' : 'caindo'}</b>: média recente ${recentes.toFixed(0)}/mês vs ${antigos.toFixed(0)}/mês no início do período (${variacao > 0 ? '+' : ''}${variacao}%).` });
    }
  }

  // Insight 5: Área que mais abre chamados
  const porArea = count(R.filter(r => r.area && r.area !== '(não mapeada)'), r => r.area);
  const topArea = topEntry(porArea);
  if (topArea) ins.push({ tipo: 'neu', ico: '#', texto: `A área que mais abre chamados é <b>${topArea[0]}</b> (${topArea[1]}).` });

  return ins;
}

// ─── Análise: INVENTÁRIO DE BOTS ──────────────────────────────────────────────
function analiseBots() {
  const B = App.B;
  if (!B.length) return [];

  const ins     = [];
  const prd     = B.filter(b => b.status === 'PRD').length;
  const dev     = B.filter(b => b.status === 'DEV').length;
  const backlog = B.filter(b => b.status === 'BACKLOG').length;

  // Insight 1: Distribuição do portfólio por status
  ins.push({ tipo: 'neu', ico: '≡',
    texto: `<b>${B.length} bots no inventário</b>: ${prd} em produção (${pct(prd, B.length)}%), ${dev} em desenvolvimento, ${backlog} em backlog.` });

  // Insight 2: Área mais automatizada (em produção)
  const prdBots = B.filter(b => b.status === 'PRD');
  const topArea = topEntry(count(prdBots, b => b.area));
  if (topArea) ins.push({ tipo: 'neu', ico: '#',
    texto: `A área com mais automações em produção é <b>${topArea[0]}</b> (${topArea[1]} bots, ${pct(topArea[1], prd)}%).` });

  // Insight 3: Bots críticos (nível 1-2) em produção
  // Criticidade 1-2 = falha causa impacto financeiro/fiscal imediato → monitoramento rigoroso obrigatório
  const criticos = prdBots.filter(b => b.criticidade && b.criticidade <= 2).length;
  if (criticos > 0) ins.push({ tipo: 'warn', ico: '!',
    texto: `<b>${criticos} bots em produção são de criticidade alta</b> (nível 1-2) — priorize monitoramento e plano de contingência.` });

  // Insight 4: Bot em produção com mais manutenções (candidato a refatoração)
  // Faz match fuzzy entre nome do bot e nome do processo no Pipefy.
  // A normalização remove prefixos como "[P2P]", espaços e pontuação para melhorar o match.
  if (App.R.length) {
    const norm      = s => s.toLowerCase().replace(/^\[.*?\]/, '').replace(/[^a-z0-9]/g, '');
    const chamPorProc = count(App.R, r => r.processo);
    let maxCh = 0, botMaisCh = '';

    prdBots.forEach(b => {
      const bn = norm(b.nome);
      let ch = 0;
      Object.entries(chamPorProc).forEach(([proc, n]) => {
        const pn = norm(proc);
        // o nome do processo está contido no nome do bot, ou vice-versa
        if (pn && bn && (bn.includes(pn) || pn.includes(bn))) ch += n;
      });
      if (ch > maxCh) { maxCh = ch; botMaisCh = b.nome; }
    });

    if (maxCh > 0) ins.push({ tipo: 'warn', ico: '⚙',
      texto: `O bot em produção com mais manutenções é <b>${botMaisCh}</b> (${maxCh} chamados) — forte candidato a refatoração.` });
  }

  return ins;
}
