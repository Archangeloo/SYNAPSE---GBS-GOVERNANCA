// ─── MODULE: parsers/rpa.js ────────────────────────────────────────────────
// Parser for the RPA maintenance ticket report (App.rpa), plus the bot-area
// enrichment step that links each ticket back to the bot inventory.
// ─────────────────────────────────────────────────────────────────────────────

import { App } from '../state.js';
import { findSheet, getColumnValue, normalizeBotName } from '../utils/helpers.js';
import { toDate, toYearMonthKey } from '../utils/date.js';

/*
 * parseRPA() — processes the RPA maintenance ticket report (Pipefy export).
 * ROBUST: looks for the right tab among all of them (may not be the first), validates
 * that it has the expected columns, and discards junk rows (with no real identifier).
 * If the file doesn't look like a ticket report, logs a warning in App.rpaWarn
 * and leaves App.R empty (instead of generating hundreds of junk rows).
 *
 * Reads:  App.rpa (workbook loaded by the user via SheetJS)
 * Writes: App.R → normalized RPA tickets
 * Called by: generate()
 *
 * AUTOMATIC TAB DETECTION:
 *   Tests every tab in the file and picks the one with columns typical of tickets
 *   (Código, Processo, Fase…). If no tab looks like a ticket report,
 *   logs App.rpaWarn and leaves App.R empty — avoids generating junk on screen.
 *
 * COMPUTED FIELDS:
 *   - mes:    "YYYY-MM" string derived from criado, for monthly grouping
 *   - vencido: true if the phase isn't "Concluído" and criado is > 30 days ago
 *   - tIdent / tDesenv / tReexec: days in each phase (calculated from
 *     phase entry/exit date columns, if available)
 *   - area: filled in later by enrichRPAWithArea() via matching against App.B
 */
export function parseRPA(){
  const wb = App.rpa;
  App.rpaWarn = '';
  // Looks for the tab that looks like it holds tickets: it needs to have characteristic columns.
  // Tests each tab and picks the one that looks most like a ticket report.
  let melhorAba = null, melhorScore = -1;
  wb.SheetNames.forEach(sn => {
    const sample = XLSX.utils.sheet_to_json(wb.Sheets[sn], {defval:''}).slice(0,3);
    if(!sample.length) return;
    const cols = Object.keys(sample[0]).map(c => c.trim().toLowerCase());
    // columns that identify a Pipefy ticket report
    let score = 0;
    if(cols.some(c=>c==='código'||c==='codigo')) score++;
    if(cols.some(c=>c==='fase atual')) score++;
    if(cols.some(c=>c==='processo')) score++;
    if(cols.some(c=>c.includes('qual é o problema'))) score++;
    if(cols.some(c=>c==='criado em')) score++;
    if(score > melhorScore){ melhorScore = score; melhorAba = sn; }
  });

  // needs to match at least 2 characteristic columns to be considered valid
  if(melhorScore < 2){
    App.R = [];
    App.rpaWarn = 'O arquivo carregado no campo "Chamados RPA" não parece ser um relatório de chamados de manutenção (faltam colunas como Código, Fase atual, Processo). Verifique se subiu o arquivo certo.';
    return;
  }

  const rows = XLSX.utils.sheet_to_json(wb.Sheets[melhorAba], {defval:''});
  App.R = rows.map(r => {
    const criado = toDate(getColumnValue(r, ['Criado em']));
    const vencRaw = getColumnValue(r, ['Vencido']);
    const venc = vencRaw===true || String(vencRaw).toLowerCase()==='true' || String(vencRaw).toLowerCase()==='sim';
    return {
      cod:        String(getColumnValue(r, ['Código','Codigo'])).trim(),
      titulo:     String(getColumnValue(r, ['Título','Titulo'])).trim(),
      fase:       String(getColumnValue(r, ['Fase atual'])).trim(),
      processo:   String(getColumnValue(r, ['Processo'])).trim() || '(sem processo)',
      problema:   String(getColumnValue(r, ['Qual é o problema?'])).trim(),
      reexec:     String(getColumnValue(r, ['Este robô admite reexecução?'])).trim(),
      intext:     String(getColumnValue(r, ['O problema é interno ou externo?', 'Interno ou externo?', 'Causa interna ou externa?', 'Causa interna/externa'])).trim(),
      solicitante:String(getColumnValue(r, ['Nome do solicitante'])).trim(),
      // "Responsáveis" = who works the ticket (RPA CoE team), not who opened it.
      // Can have several names separated by commas; we store it as a list so we
      // can count each owner individually.
      responsaveis: String(getColumnValue(r, ['Responsáveis','Responsável']))
        .split(',').map(s=>s.trim()).filter(Boolean),
      criado,
      dtInicio: criado,                            // Criado em → start of the interval
      dtFim:    toDate(getColumnValue(r, ['Finalizado em'])), // Finalizado em → end of the interval
      mes: toYearMonthKey(criado),
      finalizado: toDate(getColumnValue(r, ['Finalizado em'])), // alias for display
      vencido:    venc,
      tIdent:  parseFloat(getColumnValue(r, ['Tempo total na fase Identificação do problema (dias)']))||null,
      tDesenv: parseFloat(getColumnValue(r, ['Tempo total na fase Desenvolvimento da solução (dias)']))||null,
      tReexec: parseFloat(getColumnValue(r, ['Tempo total na fase Reexecução (dias)']))||null
    };
  // JUNK FILTER: keeps only rows that have a real code (tickets always have a code).
  // This avoids counting blank rows or footer rows that some exports include.
  }).filter(r => r.cod);
}

/*
 * areaByKeyword(proc) — keyword-based fallback rules used by enrichRPAWithArea()
 * when a process name can't be matched against the bot inventory.
 * ex. "Bank Statements"/"Payment Run" → P2P, "Tax ..." → TAX, etc.
 */
export function areaByKeyword(proc){
  const nomeProc = (proc||'').toLowerCase();
  // P2P — payments, bank statements, exchange
  if(nomeProc.includes('bank statement')) return 'P2P';
  if(nomeProc.includes('payment run')) return 'P2P';
  if(nomeProc.includes('payment order')) return 'P2P';
  if(nomeProc.includes('payments receipt') || nomeProc.includes('payment receipt')) return 'P2P';
  if(nomeProc.includes('exchange rate') || nomeProc.includes('exchange contract')) return 'P2P';
  if(nomeProc.includes('reserve of values')) return 'P2P';
  if(nomeProc.includes('freight')) return 'P2P';
  // TAX — taxes
  if(nomeProc.includes('tax conciliation') || nomeProc.includes('tax checking') || nomeProc.includes('tax payment') || nomeProc.includes('indirect tax') || nomeProc.includes('direct tax')) return 'TAX';
  // H2R — HR / payroll / benefits
  if(nomeProc.includes('vacation') || nomeProc.includes('payroll') || nomeProc.includes('employee') || nomeProc.includes('benefit')) return 'H2R';
  // O2C — credit / billing
  if(nomeProc.includes('credit limit') || nomeProc.includes('settlement statement')) return 'O2C';
  return '';
}

/*
 * enrichRPAWithArea() — assigns each RPA ticket its area (P2P, O2C, etc.).
 * Tickets have no area field, only the Processo name. Uses two layers:
 *   1st) Cross-reference with the Bot Inventory: approximate name match
 *       (one contains the other, after normalization) to inherit the bot's area.
 *   2nd) If the cross-reference fails, keyword rules (areaByKeyword):
 *       This recovers processes whose name in Pipefy differs from the inventory.
 * Whatever doesn't match either layer gets '(não mapeada)' — typically
 * tickets with an empty Processo field. Call AFTER parseRPA() and parseInv().
 */
export function enrichRPAWithArea(){
  if(!App.R.length) return;
  const botAreas = App.B.filter(b=>b.nome && b.area).map(b => ({nomeNorm: normalizeBotName(b.nome), area:b.area}));
  App.R.forEach(r => {
    const procNorm = normalizeBotName(r.processo);
    let area = '';
    // 1st layer: cross-reference with the bot inventory
    if(procNorm && botAreas.length){
      const hit = botAreas.find(b => b.nomeNorm && (b.nomeNorm.includes(procNorm) || procNorm.includes(b.nomeNorm)));
      if(hit) area = hit.area;
    }
    // 2nd layer: keyword rules (recovers names that differ from the inventory)
    if(!area) area = areaByKeyword(r.processo);
    r.area = area || '(não mapeada)';
  });
}
