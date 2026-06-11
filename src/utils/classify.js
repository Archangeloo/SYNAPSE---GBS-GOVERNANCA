import { HOJE, EQUIPE_COE } from '../constants.js';

// ─── MÓDULO: utils/classify.js ───────────────────────────────────────────────
// Normalização de status, identificação de equipe e cálculos de risco de projeto.
//
// Exporta:
//   statusClass(s)         — texto bruto → código interno (done/doing/todo/blocked…)
//   coeNomePadrao(resp)    — nome do responsável → nome padronizado CoE (ou null)
//   projFase(statusRaw)    — texto de status → número da fase 1–5 (ou null)
//   projAtrasado(p)        — boolean: projeto com prazo vencido e não entregue?
//   projRisco(p)           — { score 0–100, nivel, motivos[] }: risco calculado
// ─────────────────────────────────────────────────────────────────────────────

// ─── Normalização de status ───────────────────────────────────────────────────
// Converte o texto bruto da planilha em código interno, normalizando variações
// de digitação, acentos e os status específicos do GBS.
//
// Fluxo de Projetos GBS:
//   Diagnóstico → Planejamento → Execução → Encerramento → Monitoramento
//
// Códigos internos:
//   done    = concluído | doing = em andamento | closing = em encerramento
//   monitor = pós go-live em monitoramento | todo = não iniciado / backlog
//   blocked = bloqueado/pausado | cancel = cancelado
//   vendor  = encaminhado ao suporte Pipefy | other = não reconhecido
export function statusClass(s) {
  // remove prefixo numérico de ordenação (ex: "6. Encerramento" → "encerramento")
  const t = (s || '').toString().trim().toLowerCase().replace(/^\s*\d+\s*[.\-)]\s*/, '');
  if (['suporte pipefy', 'encaminhado ao fornecedor', 'pipefy'].includes(t)) return 'vendor';
  if (['concluído', 'concluido', 'finalizados', 'finalizado', 'tema concluído.', 'tema concluído'].includes(t)) return 'done';
  if (['em andamento', 'em execução', 'execução', 'execucao', 'desenvolvimento', 'em validação', 'em validacao', 'aguardando validação', 'aguardando validacao'].includes(t)) return 'doing';
  if (['encerramento'].includes(t)) return 'closing';
  if (['monitoramento'].includes(t)) return 'monitor';
  if (['planejamento', 'diagnóstico', 'diagnostico', 'não iniciado', 'nao iniciado', 'backlog'].includes(t)) return 'todo';
  if (['bloqueado', 'pausado'].includes(t)) return 'blocked';
  if (['cancelado'].includes(t)) return 'cancel';
  return 'other';
}

// ─── Equipe CoE ───────────────────────────────────────────────────────────────
// Se o nome do responsável pertence à equipe CoE, retorna o nome padronizado.
// Senão, retorna null.
export function coeNomePadrao(resp) {
  if (!resp) return null;
  const t = resp.toString().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
  for (const m of EQUIPE_COE) {
    for (const termo of m.match) {
      const termoNorm = termo.normalize('NFD').replace(/[̀-ͯ]/g, '');
      if (t.includes(termoNorm)) return m.nome;
    }
  }
  return null;
}

// ─── Ciclo de vida de Projetos GBS ────────────────────────────────────────────
// Retorna o número da fase (1=Diagnóstico … 5=Monitoramento/Concluído).
// Retorna null para status fora do fluxo (cancelado, bloqueado).
export function projFase(statusRaw) {
  const t = (statusRaw || '').toString().trim().toLowerCase();
  if (t.includes('diagn')) return 1;
  if (t.includes('planej')) return 2;
  if (t.includes('execu')) return 3;
  if (t.includes('encerr')) return 4;
  if (t.includes('monitor')) return 5;
  if (t.includes('conclu')) return 5;
  return null;
}

// Retorna true se o projeto está com prazo vencido e ainda não foi entregue.
// Projetos concluídos, em monitoramento ou cancelados nunca são "atrasados".
export function projAtrasado(p) {
  return !!(p.dtFim && p.dtFim < HOJE && p.sc !== 'done' && p.sc !== 'cancel' && p.sc !== 'monitor');
}

// Calcula score de risco automático (0–100) para um projeto.
// Combina: atraso (peso maior) + fase (projetos iniciais = mais risco) + proximidade do prazo.
// Retorna { score, nivel, motivos[] } — nivel ∈ {alto, medio, baixo}.
export function projRisco(p) {
  if (p.sc === 'done' || p.sc === 'cancel' || p.sc === 'monitor') {
    return { score: 0, nivel: 'baixo', motivos: [] };
  }
  let score = 0;
  const motivos = [];
  const fase = projFase(p.statusRaw) || 2;

  if (p.dtFim) {
    const dias = Math.round((HOJE - p.dtFim) / 86400000);
    if (dias > 0) {
      // atraso: 15 pontos base + ~1/dia, saturando em 70 (~40 dias → risco alto)
      score += Math.min(70, 15 + dias * 1.2);
      motivos.push(`${dias} ${dias === 1 ? 'dia' : 'dias'} de atraso`);
    } else {
      const faltam = -dias;
      if (faltam <= 15) { score += 18; motivos.push(`prazo em ${faltam} ${faltam === 1 ? 'dia' : 'dias'}`); }
      else if (faltam <= 30) { score += 10; motivos.push('prazo próximo'); }
    }
  } else {
    score += 14;
    motivos.push('sem prazo definido');
  }

  if (p.sc === 'blocked') { score += 30; motivos.push('bloqueado'); }
  const pesoFase = { 1: 18, 2: 14, 3: 9, 4: 4, 5: 0 }[fase] || 9;
  score += pesoFase;
  if (fase <= 2 && p.sc !== 'blocked') motivos.push(`fase inicial (${p.statusRaw})`);

  score = Math.min(100, Math.round(score));
  const nivel = score >= 55 ? 'alto' : (score >= 30 ? 'medio' : 'baixo');
  return { score, nivel, motivos };
}
