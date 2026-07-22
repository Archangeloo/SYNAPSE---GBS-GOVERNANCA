// utils/classify.js — normalização de status, identificação do time CoE e score de risco de projeto.

import { HOJE, COE_TEAM } from '../constants.js';
import { diasEntre } from './date.js';

/*
 * Converte o texto de status bruto (da planilha) num código interno.
 * Isso normaliza variações de grafia ("Concluido" vs "Concluído"), sinônimos,
 * e status específicos do GBS (Encerramento, Monitoramento).
 *
 * Fluxo de Projeto GBS:
 *   Diagnóstico → Planejamento → Execução → Encerramento → Monitoramento
 *   (nenhuma dessas fases é "done" — "done" só aparece quando o projeto fecha de verdade)
 *
 * Mapeamento pro código interno:
 *   done    = realmente concluído (ainda não existe para projetos)
 *   doing   = em andamento / em desenvolvimento
 *   closing = em processo de encerramento (pode estar atrasado se o prazo passou)
 *   monitor = entregue, em monitoramento pós-go-live (não conta como atrasado)
 *   todo    = não iniciado / backlog / planejamento
 *   blocked = bloqueado / pausado
 *   cancel  = cancelado
 *   vendor  = encaminhado pro suporte Pipefy (fornecedor externo)
 *   other   = qualquer valor não reconhecido
 */
export function classeStatus(rawStatus){
  // Remove o prefixo numérico de ordenação, se houver.
  // Ex: "6. Encerramento" → "encerramento", "3 - Planejamento" → "planejamento"
  const normalized = (rawStatus || '').toString().trim().toLowerCase().replace(/^\s*\d+\s*[.\-)]\s*/, '');

  if (['suporte pipefy', 'encaminhado ao fornecedor', 'pipefy'].includes(normalized))
    return 'vendor';

  if (['concluído', 'concluido', 'finalizados', 'finalizado', 'tema concluído.', 'tema concluído'].includes(normalized))
    return 'done';

  if (['em andamento', 'em execução', 'execução', 'execucao', 'desenvolvimento',
       'em validação', 'em validacao', 'aguardando validação', 'aguardando validacao'].includes(normalized))
    return 'doing';

  if (['encerramento'].includes(normalized))  return 'closing';
  if (['monitoramento'].includes(normalized)) return 'monitor';

  if (['planejamento', 'diagnóstico', 'diagnostico', 'não iniciado', 'nao iniciado', 'backlog'].includes(normalized))
    return 'todo';

  if (['bloqueado', 'pausado'].includes(normalized))  return 'blocked';
  if (['cancelado'].includes(normalized))             return 'cancel';

  return 'other';
}

/*
 * classeStatus específico pra Melhorias (Pipefy_Melhorias).
 * Ali, "Planejamento" já é um item puxado do backlog (trabalho ativo), então
 * conta junto com "doing" — é isso que alimenta a coluna "Dev + Planej." do
 * Overview e o KPI "Backlog" da aba Melhorias.
 * Não usar para Projetos/Analytics: lá "Planejamento" é a fase 2 do fluxo
 * (Diagnóstico→Planejamento→Execução...) e precisa continuar 'todo'.
 */
export function classeStatusMelhoria(rawStatus){
  const normalized = (rawStatus || '').toString().trim().toLowerCase().replace(/^\s*\d+\s*[.\-)]\s*/, '');
  if (normalized === 'planejamento') return 'doing';
  return classeStatus(rawStatus);
}

/*
 * nomePadraoCoe(responsavel) — pega o nome do responsável como aparece nos dados e,
 * se for integrante do time CoE, retorna o nome padronizado (label).
 * Caso contrário retorna null.
 * Usa os termos de match de cada integrante (sem diferenciar maiúsculas/acentos).
 */
export function nomePadraoCoe(responsavel){
  if(!responsavel) return null;
  const normalized = responsavel.toString().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g,''); // remove acentos pra comparar
  for(const member of COE_TEAM){
    for(const term of member.match){
      const termNorm = term.normalize('NFD').replace(/[̀-ͯ]/g,'');
      if(normalized.includes(termNorm)) return member.name;
    }
  }
  return null;
}

/*
 * Número da fase no ciclo de vida de um Projeto GBS.
 * Quanto maior o número, mais perto da conclusão.
 * Fluxo: Diagnóstico(1) → Planejamento(2) → Execução(3) → Encerramento(4) → Monitoramento(5)
 * Retorna null pra status fora do fluxo (cancelado, bloqueado).
 */
export function faseProjeto(statusRaw){
  const normalized = (statusRaw||'').toString().trim().toLowerCase();
  if(normalized.includes('diagn')) return 1;
  if(normalized.includes('planej')) return 2;
  if(normalized.includes('execu')) return 3;
  if(normalized.includes('encerr')) return 4;
  if(normalized.includes('monitor')) return 5;
  if(normalized.includes('conclu')) return 5;
  return null;
}

/*
 * projetoAtrasado(project) — true se o projeto tem prazo vencido e ainda não
 * foi entregue/cancelado. Não entram no "elegível a atraso": concluídos,
 * em monitoramento (pós go-live) ou cancelados.
 */
export function projetoAtrasado(project){
  return !!(project.dataFim && project.dataFim < HOJE && project.codigoStatus!=='done' && project.codigoStatus!=='cancel' && project.codigoStatus!=='monitor');
}

/*
 * riscoProjeto(project) — score de risco automático (0 a 100) pra um projeto.
 * Combina três fatores objetivos, sem precisar de nenhum campo manual na planilha:
 *   1) ATRASO (peso maior): dias após o prazo. Quanto mais atrasado, maior o score.
 *   2) FASE: projetos em fases iniciais (Diagnóstico/Planejamento) com prazo apertado
 *      são mais arriscados do que os que já estão em Encerramento.
 *   3) PROXIMIDADE DO PRAZO: um prazo se aproximando (mesmo sem atraso) já eleva o risco.
 * Projetos concluídos/cancelados/em monitoramento têm risco 0 (não estão mais "em jogo").
 * Retorna { score, level, reasons[] } — level ∈ {high, medium, low}.
 */
export function riscoProjeto(project){
  if(project.codigoStatus==='done' || project.codigoStatus==='cancel' || project.codigoStatus==='monitor'){
    return { score:0, level:'low', reasons:[] };
  }
  let score = 0;
  const reasons = [];
  const phase = faseProjeto(project.statusRaw) || 2;

  // 1) Atraso — o fator mais forte. Um atraso significativo já empurra pra risco alto sozinho.
  if(project.dataFim){
    const days = diasEntre(HOJE, project.dataFim);
    if(days > 0){
      // 15 pontos base + ~1/dia, com teto em 70; ~40 dias já cruza o limiar de "alto"
      score += Math.min(70, 15 + days*1.2);
      reasons.push(`${days} ${days===1?'dia':'dias'} de atraso`);
    } else {
      // 2) Proximidade do prazo (ainda não atrasado)
      const daysLeft = -days;
      if(daysLeft <= 15){ score += 18; reasons.push(`prazo em ${daysLeft} ${daysLeft===1?'dia':'dias'}`); }
      else if(daysLeft <= 30){ score += 10; reasons.push('prazo próximo'); }
    }
  } else {
    // sem prazo definido num projeto ativo = risco de falta de controle
    score += 14; reasons.push('sem prazo definido');
  }

  // 3) Fase — peso por estágio (fases mais iniciais = mais caminho pela frente = mais risco)
  if(project.codigoStatus==='blocked'){ score += 30; reasons.push('bloqueado'); }
  const phaseWeight = {1:18, 2:14, 3:9, 4:4, 5:0}[phase] || 9;
  score += phaseWeight;
  if(phase<=2 && project.codigoStatus!=='blocked') reasons.push(`fase inicial (${project.statusRaw})`);

  score = Math.min(100, Math.round(score));
  const level = score>=55 ? 'high' : (score>=30 ? 'medium' : 'low');
  return { score, level, reasons };
}
