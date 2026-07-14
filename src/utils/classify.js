// ─── MODULE: utils/classify.js ─────────────────────────────────────────────
// Status normalization, CoE team identification, and project risk scoring.
// ─────────────────────────────────────────────────────────────────────────────

import { HOJE, COE_TEAM } from '../constants.js';
import { daysBetween } from './date.js';

/*
 * Converts the raw status text (from the spreadsheet) into an internal code.
 * This normalizes spelling variants ("Concluido" vs "Concluído"), synonyms,
 * and GBS-specific statuses (Encerramento, Monitoramento).
 *
 * GBS Project flow:
 *   Diagnóstico → Planejamento → Execução → Encerramento → Monitoramento
 *   (none of these is "done" — "done" only appears once a project truly closes)
 *
 * Mapping to internal code:
 *   done    = actually completed (doesn't exist yet for projects)
 *   doing   = in progress / in development
 *   closing = in the closing process (can be overdue if the deadline passed)
 *   monitor = delivered, in post go-live monitoring (does not count as overdue)
 *   todo    = not started / backlog / planning
 *   blocked = blocked / paused
 *   cancel  = cancelled
 *   vendor  = forwarded to Pipefy support (external vendor)
 *   other   = any unrecognized value
 */
export function classeStatus(rawStatus){
  // Removes the numeric ordering prefix, if any.
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
 * classeStatus specific to Improvements (Pipefy_Melhorias).
 * There, "Planejamento" is already an item pulled out of the backlog (active
 * work), so it's counted together with "doing" — this is what feeds the
 * "Dev + Planej." column of the Overview and the "Backlog" KPI on the
 * Improvements tab.
 * Do not use for Projects/Analytics: there "Planejamento" is phase 2 of the
 * flow (Diagnóstico→Planejamento→Execução...) and must stay 'todo'.
 */
export function classeStatusMelhoria(rawStatus){
  const normalized = (rawStatus || '').toString().trim().toLowerCase().replace(/^\s*\d+\s*[.\-)]\s*/, '');
  if (normalized === 'planejamento') return 'doing';
  return classeStatus(rawStatus);
}

/*
 * nomePadraoCoe(resp) — takes the responsible person's name as it
 * appears in the data and, if they are a CoE team member, returns the
 * standardized name (label). Otherwise returns null.
 * Uses each member's 'match' terms (case-insensitive, accent-insensitive).
 */
export function nomePadraoCoe(resp){
  if(!resp) return null;
  const normalized = resp.toString().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g,''); // strip accents for comparison
  for(const member of COE_TEAM){
    for(const term of member.match){
      const termNorm = term.normalize('NFD').replace(/[̀-ͯ]/g,'');
      if(normalized.includes(termNorm)) return member.name;
    }
  }
  return null;
}

/*
 * Phase number in the lifecycle of a GBS Project.
 * The higher the number, the closer to completion.
 * Flow: Diagnóstico(1) → Planejamento(2) → Execução(3) → Encerramento(4) → Monitoramento(5)
 * Returns null for statuses outside the flow (cancelled, blocked).
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
 * projetoAtrasado(project) — true if the project has a past-due deadline and
 * hasn't been delivered/cancelled yet. Considered "not overdue-eligible":
 * completed, in monitoring (post go-live), or cancelled projects.
 */
export function projetoAtrasado(project){
  return !!(project.dtFim && project.dtFim < HOJE && project.sc!=='done' && project.sc!=='cancel' && project.sc!=='monitor');
}

/*
 * riscoProjeto(project) — automatic risk score (0 to 100) for a project.
 * Combines three objective factors, with no manual field needed in the spreadsheet:
 *   1) DELAY (heaviest weight): days past the deadline. The more overdue, the higher.
 *   2) PHASE: projects in early phases (Diagnóstico/Planejamento) with a tight
 *      deadline are riskier than ones already in Encerramento.
 *   3) DEADLINE PROXIMITY: an approaching deadline (even without a delay) raises risk.
 * Completed/cancelled/monitoring projects have risk 0 (no longer "in play").
 * Returns { score, level, reasons[] } — level ∈ {high, medium, low}.
 */
export function riscoProjeto(project){
  if(project.sc==='done' || project.sc==='cancel' || project.sc==='monitor'){
    return { score:0, level:'low', reasons:[] };
  }
  let score = 0;
  const reasons = [];
  const phase = faseProjeto(project.statusRaw) || 2;

  // 1) Delay — the strongest factor. A meaningful delay alone already pushes to high risk.
  if(project.dtFim){
    const days = daysBetween(HOJE, project.dtFim);
    if(days > 0){
      // 15 base points + ~1/day, capping at 70; ~40 days already crosses the "high" threshold
      score += Math.min(70, 15 + days*1.2);
      reasons.push(`${days} ${days===1?'dia':'dias'} de atraso`);
    } else {
      // 2) Deadline proximity (not yet overdue)
      const daysLeft = -days;
      if(daysLeft <= 15){ score += 18; reasons.push(`prazo em ${daysLeft} ${daysLeft===1?'dia':'dias'}`); }
      else if(daysLeft <= 30){ score += 10; reasons.push('prazo próximo'); }
    }
  } else {
    // no deadline set on an active project = lack-of-control risk
    score += 14; reasons.push('sem prazo definido');
  }

  // 3) Phase — weight by stage (earlier phases = more road ahead = more risk)
  if(project.sc==='blocked'){ score += 30; reasons.push('bloqueado'); }
  const phaseWeight = {1:18, 2:14, 3:9, 4:4, 5:0}[phase] || 9;
  score += phaseWeight;
  if(phase<=2 && project.sc!=='blocked') reasons.push(`fase inicial (${project.statusRaw})`);

  score = Math.min(100, Math.round(score));
  const level = score>=55 ? 'high' : (score>=30 ? 'medium' : 'low');
  return { score, level, reasons };
}
