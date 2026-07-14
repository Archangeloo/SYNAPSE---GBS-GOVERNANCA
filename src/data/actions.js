// ─── MODULE: data/actions.js ───────────────────────────────────────────────
// Cross-source "actions" aggregation: merges Projetos, Pipefy Melhorias,
// Analytics and Chamados RPA into a single unified array. Used by the
// Governance view and by the automatic analysis (analysis.js).
//
// This module exists to break the circular dependency that used to exist
// between views/gov.js and analysis.js in the original module plan
// (see TODO.md) — both need this aggregation, so it lives in its own
// low-level, dependency-free (besides state/constants) module.
// ─────────────────────────────────────────────────────────────────────────────

import { App } from '../state.js';
import { filtrarPorPeriodo } from '../utils/date.js';

/*
 * todasAcoes() — merges the 4 sources into a single "actions" array.
 * Each action has: source, sc (normalized status), frente, owner,
 * dtFim (reference date for filters and charts) and source-specific fields.
 *
 * For RPA Tickets:
 *   - sc is derived from the current phase (contains "conclu" → done, else → doing)
 *   - dtFim = ticket completion date
 *   - criado = opening date (used as a dataReferencia fallback)
 *   - vencido = boolean flag from Pipefy
 */
export function todasAcoes(){
  const out = [];
  App.P.proj.forEach(p => out.push({source:'Projetos', sc:p.sc, frente:p.frente, resp:p.resp, dtFim:p.dtFim, prog:p.prog, prio:null}));
  App.P.improvements.forEach(m => out.push({source:'Pipefy', sc:m.sc, frente:m.frente, resp:m.resp, dtInicio:m.dtInicio, dtFim:m.dtFim, prog:null, prio:null}));
  App.P.ana.forEach(a => out.push({source:'Analytics', sc:a.sc, frente:a.frente, resp:a.resp, dtInicio:a.dtInicio, dtFim:a.dtFim, prog:null, prio:a.prio}));
  App.R.forEach(r => out.push({
    source:'Chamados RPA',
    sc: r.fase.toLowerCase().includes('conclu') ? 'done' : 'doing',
    // frente = bot's main business area (P2P, O2C, R2R, TAX, H2R), resolved by enrichRPAWithArea()
    // Secondary inventory areas (Arg, CI, IT, PAM…) are not business areas → null
    frente: ['P2P','O2C','R2R','TAX','H2R'].includes(r.area) ? r.area : null,
    resp:r.solicitante,
    dtInicio:r.criado, dtFim:r.dtFim, criado:r.criado,
    prog:null, prio:null, vencido:r.vencido
  }));
  return out;
}

// Filtered version: applies the global date filter before returning
export function todasAcoesFiltradas(){
  return filtrarPorPeriodo(todasAcoes());
}
