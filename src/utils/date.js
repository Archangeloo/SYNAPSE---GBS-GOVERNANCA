// ─── MODULE: utils/date.js ─────────────────────────────────────────────────
// Date parsing/formatting helpers and the global period filter.
//
// GLOBAL DATE FILTER:
//   Each source has a different date that makes sense for it:
//   - Pipefy Improvements: DataConclusaoRealDesenvolvimento (dev delivery date)
//   - Projects: PrazoConclusão (project delivery deadline)
//   - Analytics: DataAbertura or DataFechamento
//   - RPA Tickets: criado (ticket opening date)
//   - Bot Inventory: does NOT filter by action date; uses AnoPRD separately
//
//   ATTENTION: items without a date fall OUTSIDE the filter when it's active.
//   This is intentional and transparent — the app shows the warning.
//   We never invent a zero for items without a date.
// ─────────────────────────────────────────────────────────────────────────────

import { App } from '../state.js';
import { MESES, HOJE, MS_PER_DAY, EXCEL_EPOCH_OFFSET } from '../constants.js';

/*
 * Returns the reference date of a normalized item.
 * Priority is: completion date (dtFim) > creation date (criado).
 * For RPA Tickets, criado is the ticket's opening date.
 */
export function dataReferencia(item){
  return item.dtFim || item.criado || null;
}

/*
 * Checks whether a date passes the global period filter.
 * Returns true if: mode=all, or the date is inside the range.
 * Returns false if: mode=custom and there's no date (item doesn't enter the filter).
 */
export function dataNoIntervalo(date){
  const dr = App.dateRange;
  if(dr.mode === 'all') return true;        // no filter: everything passes
  if(!date) return false;                    // no date: doesn't enter a specific period
  if(dr.from && date < dr.from) return false;  // before the start: out
  if(dr.to && date > dr.to) return false;      // after the end: out
  return true;
}

/*
 * Checks whether an item was ACTIVE during the filter period, considering
 * a [start, end] interval instead of a single date. Used for Pipefy,
 * where an improvement has a development start and completion.
 * Rules (custom mode):
 *   - has start and end → passes if the item's interval crosses the filter's interval
 *   - only has start (in progress) → passes if it started before the filter's end
 *     (considered active from the start until today)
 *   - only has end → falls back to single-date behavior (dataNoIntervalo on the end)
 *   - no date at all → out (counted as "no date")
 * Returns 'in' | 'out' | 'nodate'.
 */
export function ativoNoIntervalo(ini, fim){
  const dr = App.dateRange;
  if(dr.mode === 'all') return 'in';
  if(!ini && !fim) return 'nodate';
  // filter bounds (either can be null = open on that side)
  const fFrom = dr.from || new Date(-8640000000000000);
  const fTo   = dr.to   || new Date( 8640000000000000);
  // item bounds: if start is missing, use the end; if end is missing, consider "until today" (ongoing)
  const iIni = ini || fim;
  const iFim = fim || HOJE;
  // interval overlap: starts before the filter's end AND ends after the filter's start
  return (iIni <= fTo && iFim >= fFrom) ? 'in' : 'out';
}

/*
 * Aplica o filtro de data a um array inteiro.
 * Retorna: { kept: [...itens que passaram], noDate: N (quantidade sem data) }
 * Para itens que têm dtInicio (ex: Pipefy, Analytics), usa a lógica de "ativo no
 * período" (intervalo início→fim) — MAS só enquanto o item ainda está em
 * andamento. Um item já concluído (sc==='done') tem uma data de conclusão real
 * e fixa (dtFim); nesse caso o filtro passa a checar só se ESSA data cai no
 * período, com dataNoIntervalo. Se usássemos o intervalo inteiro também para
 * concluídos, um item que só passou pelo período em desenvolvimento e fechou
 * bem depois apareceria como "concluído no período" de forma enganosa.
 * Para os demais itens (sem dtInicio), usa a data única de dataReferencia.
 * Os itens sem data não são perdidos — ficam fora do recorte e o número é
 * exibido na nota de transparência da interface.
 */
export function filtrarPorPeriodo(arr){
  if(App.dateRange.mode === 'all') return { kept: arr, noDate: 0 };
  const kept = [], noDate = [];
  arr.forEach(x => {
    if(x.dtInicio !== undefined && x.sc !== 'done'){
      // ainda em andamento: usa o intervalo início→fim (ativoNoIntervalo)
      const rangeStatus = ativoNoIntervalo(x.dtInicio, x.dtFim);
      if(rangeStatus === 'nodate') noDate.push(x);
      else if(rangeStatus === 'in') kept.push(x);
    } else {
      // já concluído (ou sem conceito de intervalo): data única de referência
      const date = dataReferencia(x);
      if(!date) noDate.push(x);
      else if(dataNoIntervalo(date)) kept.push(x);
    }
  });
  return { kept, noDate: noDate.length };
}

/*
 * Converts any value type to a Date (or null if invalid).
 * Needed because Excel can store dates as:
 *   - a Date object (when cellDates:true and SheetJS manages to parse it)
 *   - an Excel serial number (ex: 45678 = days since 1900-01-01)
 *   - a date string (ex: "2026-04-24")
 */
export function toDate(rawValue){
  if(!rawValue) return null;
  if(rawValue instanceof Date) return isNaN(rawValue) ? null : rawValue;
  if(typeof rawValue === 'number'){
    const date = new Date(Math.round((rawValue - EXCEL_EPOCH_OFFSET) * 864e5));
    return isNaN(date) ? null : date;
  }
  if(typeof rawValue === 'string' && rawValue.length > 4){
    const date = new Date(rawValue);
    return isNaN(date) ? null : date;
  }
  return null;
}

// Formats a Date as a "YYYY-MM" string (used as the monthly grouping key)
export function toYearMonthKey(date){ return date ? `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}` : ''; }

// Converts "YYYY-MM" into a readable "Mmm/AA" label (ex: "2026-04" → "Abr/26")
export function toYearMonthLabel(monthKey){
  if(!monthKey) return '';
  const partes = monthKey.split('-');
  return `${MESES[+partes[1]-1]}/${partes[0].slice(2)}`;
}

// Converts a Date to a "YYYY-MM-DD" string (ISO format, used in date inputs).
export function toIsoDate(date){ return date.toISOString().slice(0, 10); }

// Calculates the number of days between two dates.
// Positive = date1 is more recent than date2 (ex: today - deadline = days overdue).
export function daysBetween(date1, date2){ return Math.round((date1 - date2) / MS_PER_DAY); }
