// ─── MODULE: utils/helpers.js ──────────────────────────────────────────────
// Small, generic utility functions reused across parsers, views and charts.
// ─────────────────────────────────────────────────────────────────────────────

import { _SVG, PIPEFY_TEAM } from '../constants.js';

/*
 * Looks up a sheet in a workbook by a name fragment.
 * Case-insensitive, and ignores underscores and spaces.
 * Ex: findSheet(wb, 'melhorias') finds 'Pipefy_Melhorias'.
 */
export function findSheet(wb, frag){
  const fragNorm = frag.toLowerCase().replace(/[_ ]/g,'');
  return wb.SheetNames.find(nome => nome.toLowerCase().replace(/[_ ]/g,'').includes(fragNorm));
}

/*
 * Looks up a column's value in a SheetJS row, accepting multiple
 * possible names (since the column name can vary between spreadsheet versions).
 * The comparison is case-insensitive and ignores extra spaces.
 * Returns '' if none of the keys are found.
 */
export function getColumnValue(row, keys){
  const rowKeys = Object.keys(row);
  for(const key of keys){
    for(const columnName of rowKeys){
      if(columnName.trim().toLowerCase() === key.toLowerCase()){
        const value = row[columnName];
        return value == null ? '' : value;
      }
    }
  }
  return '';
}

/*
 * Counts the frequency of a value across an array of objects.
 * fn: function that extracts the key to count (ex: r => r.frente)
 * Returns: { 'P2P': 42, 'O2C': 33, ... }
 */
export function count(arr, fn){
  const freq = {};
  arr.forEach(x => { const chave = fn(x) || '—'; freq[chave] = (freq[chave]||0) + 1; });
  return freq;
}

// Calculates a rounded percentage. Returns 0 if the divisor is 0 (never divides by zero).
export function calculatePercentage(value, total){ return total ? Math.round(value/total*100) : 0; }

// Calculates the average of a numeric field across an array, ignoring nulls.
// Returns the value as a string with 1 decimal, or '—' if there's no data.
export function averageField(arr, campo){
  const valores = arr.filter(r => r[campo] != null).map(r => r[campo]);
  return valores.length ? (valores.reduce((soma, v) => soma + v, 0) / valores.length).toFixed(1) : '—';
}

// Normalizes a bot or process name for approximate (fuzzy) comparison.
// Strips bracketed prefixes (ex: "[P2P]"), lowercases, and
// removes anything that isn't a letter or digit.
export function normalizeBotName(name){ return name.toLowerCase().replace(/^\[.*?\]/, '').replace(/[^a-z0-9]/g, ''); }

// True if `nome` matches one of the Pipefy improvements dev team members.
export function isPipefyTeamMember(nome){ return PIPEFY_TEAM.some(p => nome.toLowerCase().includes(p)); }

/*
 * Counts how many items in an array have each status code.
 * Eliminates the repeated pattern: arr.filter(x => x.sc === 'done').length
 * Usage: const { done, todo: backlog, blocked } = statusCounts(arr);
 */
export function statusCounts(arr) {
  const codes = ['done', 'doing', 'todo', 'blocked', 'cancel', 'vendor', 'closing', 'monitor'];
  const result = {};
  codes.forEach(code => { result[code] = arr.filter(x => x.sc === code).length; });
  return result;
}

/*
 * Groups arr by keyFn, counts frequencies, and returns [key, count] pairs
 * sorted from most to least frequent.
 */
export function sortedCountEntries(arr, keyFn) {
  return Object.entries(count(arr, keyFn)).sort((a, b) => b[1] - a[1]);
}

// Builds the inline-SVG markup for a named KPI icon (see constants.js _SVG).
export function iconeKpi(name){
  const path = _SVG[name] || '';
  if(!path) return '';
  return `<svg class="kico" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
}
