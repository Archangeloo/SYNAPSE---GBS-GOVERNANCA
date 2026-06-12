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
// Converte o texto bruto da planilha em um código interno padronizado.
// Isso isola o resto do código das variações de digitação nas planilhas
// (acentos, maiúsculas, prefixos numéricos de ordenação).
//
// Fluxo de Projetos GBS (do início ao fim):
//   Diagnóstico(1) → Planejamento(2) → Execução(3) → Encerramento(4) → Monitoramento(5)
//
// Códigos internos e quando são usados:
//   done    — item realmente entregue e fechado
//   doing   — em andamento ativo (desenvolvimento, execução, validação)
//   closing — projeto em fase de encerramento formal (último passo antes de fechar)
//   monitor — entregue e em acompanhamento pós go-live (não conta como atrasado)
//   todo    — ainda não iniciado (backlog, planejamento, diagnóstico)
//   blocked — pausado por impedimento externo
//   cancel  — cancelado permanentemente
//   vendor  — encaminhado ao suporte do fornecedor Pipefy
//   other   — qualquer status não reconhecido (útil para detectar novos valores na base)
export function statusClass(s) {
  // Remove prefixo numérico de ordenação que aparece em algumas planilhas
  // Ex: "6. Encerramento" → "encerramento" | "3 - Planejamento" → "planejamento"
  const t = (s || '').toString().trim().toLowerCase().replace(/^\s*\d+\s*[.\-)]\s*/, '');

  if (['suporte pipefy', 'encaminhado ao fornecedor', 'pipefy'].includes(t)) return 'vendor';

  if (['concluído', 'concluido', 'finalizados', 'finalizado', 'tema concluído.', 'tema concluído'].includes(t))
    return 'done';

  if (['em andamento', 'em execução', 'execução', 'execucao', 'desenvolvimento',
       'em validação', 'em validacao', 'aguardando validação', 'aguardando validacao'].includes(t))
    return 'doing';

  if (['encerramento'].includes(t))  return 'closing';
  if (['monitoramento'].includes(t)) return 'monitor';

  if (['planejamento', 'diagnóstico', 'diagnostico', 'não iniciado', 'nao iniciado', 'backlog'].includes(t))
    return 'todo';

  if (['bloqueado', 'pausado'].includes(t))  return 'blocked';
  if (['cancelado'].includes(t))             return 'cancel';

  return 'other';
}

// ─── Equipe CoE ───────────────────────────────────────────────────────────────
// Recebe o nome bruto do responsável (como vem da planilha) e verifica se é
// um membro da equipe CoE. Se sim, retorna o nome padronizado para exibição.
// Se não for CoE, retorna null (a pessoa não aparece no gráfico de equipe).
//
// Por que normalizar sem acento?
//   Evita falsos negativos por diferenças de codificação entre versões do Excel.
//   "Vinícius" e "Vinicius" devem casar com o mesmo membro.
export function coeNomePadrao(resp) {
  if (!resp) return null;
  // normaliza: minúsculas + remove diacríticos (acentos)
  const t = resp.toString().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '');

  for (const m of EQUIPE_COE) {
    for (const termo of m.match) {
      const termoNorm = termo.normalize('NFD').replace(/[̀-ͯ]/g, '');
      if (t.includes(termoNorm)) return m.nome; // encontrou → retorna nome canônico
    }
  }
  return null; // não é membro CoE
}

// ─── Ciclo de vida de Projetos GBS ────────────────────────────────────────────
// Converte o texto bruto do status para um número de fase (1 = começo, 5 = fim).
// Usado pelo cálculo de risco: projetos em fases iniciais têm mais caminho a
// percorrer e, portanto, maior incerteza de prazo.
// Retorna null para status fora do fluxo principal (cancelado, bloqueado).
export function projFase(statusRaw) {
  const t = (statusRaw || '').toString().trim().toLowerCase();
  if (t.includes('diagn'))   return 1; // Diagnóstico — levantamento inicial
  if (t.includes('planej'))  return 2; // Planejamento — desenho da solução
  if (t.includes('execu'))   return 3; // Execução     — implementação
  if (t.includes('encerr'))  return 4; // Encerramento — entrega formal
  if (t.includes('monitor')) return 5; // Monitoramento — pós go-live
  if (t.includes('conclu'))  return 5; // Concluído    — equivale ao monitoramento
  return null;
}

// Retorna true se o projeto está com o prazo vencido e ainda não foi encerrado.
// Projetos em monitoramento NÃO são atrasados — eles foram entregues mas
// seguem sendo acompanhados. Cancelados também não contam como atrasados.
export function projAtrasado(p) {
  return !!(p.dtFim && p.dtFim < HOJE && p.sc !== 'done' && p.sc !== 'cancel' && p.sc !== 'monitor');
}

// ─── Cálculo de risco automático ─────────────────────────────────────────────
// Gera um score de 0 a 100 combinando três fatores objetivos:
//
//  1) ATRASO (fator mais pesado, até 70 pontos):
//     score = min(70,  15 + dias × 1.2)
//     Por quê esses números?
//       - 15 pontos de "base" apenas por estar atrasado (sinalizador imediato)
//       - +1.2 ponto por dia corrido de atraso
//       - Satura em 70 (não queremos score de atraso inflado por projetos muito velhos)
//       - Com ~35 dias, o atraso já contribui com ~57 pontos → nível alto sozinho
//
//  2) PROXIMIDADE DO PRAZO (quando ainda não venceu):
//     ≤ 15 dias → +18 pontos (urgente, qualquer imprevisto já atrasa)
//     ≤ 30 dias → +10 pontos (atenção, mas há margem)
//
//  3) FASE DO PROJETO (peso por estágio, até 18 pontos):
//     { 1: 18, 2: 14, 3: 9, 4: 4, 5: 0 }
//     Projetos em estágios iniciais têm mais incerteza de prazo. Em Encerramento
//     o trabalho está quase feito; em Diagnóstico há muito pela frente.
//
//  4) BLOQUEIO (bônus fixo de 30 pontos):
//     Projeto parado por impedimento = risco alto independente do prazo.
//
// Classificação do nível:
//   score ≥ 55 → alto  (vermelho)
//   score ≥ 30 → médio (laranja)
//   score  < 30 → baixo (verde)
//
// Projetos já encerrados (done, monitor, cancel) retornam score=0 automaticamente
// — eles não estão mais "em jogo".
export function projRisco(p) {
  // Projetos fora do fluxo ativo não têm risco a calcular
  if (p.sc === 'done' || p.sc === 'cancel' || p.sc === 'monitor') {
    return { score: 0, nivel: 'baixo', motivos: [] };
  }

  let score    = 0;
  const motivos = [];
  const fase   = projFase(p.statusRaw) || 2; // se fase desconhecida, assume Planejamento (2)

  // ── Fator 1 e 2: prazo ──────────────────────────────────────────────────
  if (p.dtFim) {
    const dias = Math.round((HOJE - p.dtFim) / 86400000); // dias decorridos desde o prazo
    if (dias > 0) {
      // já venceu: 15 pontos base + 1.2 por dia, máximo de 70
      score += Math.min(70, 15 + dias * 1.2);
      motivos.push(`${dias} ${dias === 1 ? 'dia' : 'dias'} de atraso`);
    } else {
      // ainda não venceu: penalidade por proximidade do prazo
      const faltam = -dias; // dias que ainda faltam (dias é negativo quando no futuro)
      if (faltam <= 15) { score += 18; motivos.push(`prazo em ${faltam} ${faltam === 1 ? 'dia' : 'dias'}`); }
      else if (faltam <= 30) { score += 10; motivos.push('prazo próximo'); }
    }
  } else {
    // projeto ativo sem prazo definido = falta de controle
    score += 14;
    motivos.push('sem prazo definido');
  }

  // ── Fator 3: bloqueio ───────────────────────────────────────────────────
  if (p.sc === 'blocked') {
    score += 30;
    motivos.push('bloqueado');
  }

  // ── Fator 4: fase do projeto ────────────────────────────────────────────
  // Quanto mais cedo no ciclo, maior a incerteza → mais pontos de risco
  const pesoFase = { 1: 18, 2: 14, 3: 9, 4: 4, 5: 0 }[fase] || 9;
  score += pesoFase;

  // Só adiciona o motivo de "fase inicial" se não estiver bloqueado
  // (bloqueado já domina o motivo principal)
  if (fase <= 2 && p.sc !== 'blocked') motivos.push(`fase inicial (${p.statusRaw})`);

  // Limita em 100 e arredonda
  score = Math.min(100, Math.round(score));
  const nivel = score >= 55 ? 'alto' : (score >= 30 ? 'medio' : 'baixo');
  return { score, nivel, motivos };
}
