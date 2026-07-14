// ─── MODULE: filters.js ────────────────────────────────────────────────────
// GLOBAL DATE FILTER — HEADER CONTROLS
// Reads the two header date inputs (or a quick-range shortcut), updates
// App.dateRange, and redraws every tab that depends on it.
// ─────────────────────────────────────────────────────────────────────────────

import { App } from './state.js';
import { HOJE } from './constants.js';
import { toIsoDate } from './utils/date.js';
import { construirGovernanca } from './views/gov.js';
import { buildProjects } from './views/proj.js';
import { construirMelhorias } from './views/mel.js';
import { buildAnalytics } from './views/ana.js';
import { buildRPATickets } from './views/rpa.js';
import { buildBots } from './views/bots.js';

/*
 * setQuickRange(mode) — applies a period shortcut (current month/quarter/year).
 * Calculates the start and end dates based on today's date, fills in the
 * date fields, then triggers the filter. Visually marks the active chip.
 */
export function setQuickRange(mode){
  // If the clicked chip is already active, clears the filter (toggle)
  const chip = document.getElementById('dfc-' + mode);
  if (chip && chip.classList.contains('active')) {
    clearDateFilter();
    return;
  }

  const year = HOJE.getFullYear();
  const month = HOJE.getMonth();
  let from, to;
  if(mode==='month'){
    from = new Date(year, month, 1);
    to   = new Date(year, month+1, 0); // last day of the current month
  } else if(mode==='quarter'){
    const quarter = Math.floor(month/3);  // 0,1,2,3
    from = new Date(year, quarter*3, 1);
    to   = new Date(year, quarter*3+3, 0); // last day of the quarter
  } else if(mode==='year'){
    from = new Date(year, 0, 1);
    to   = new Date(year, 11, 31);
  }
  const iso = toIsoDate;
  document.getElementById('df-from').value = iso(from);
  document.getElementById('df-to').value   = iso(to);
  // marks the active chip
  ['month','quarter','year'].forEach(k=>{
    const chip = document.getElementById('dfc-'+k);
    if(chip) chip.classList.toggle('active', k===mode);
  });
  applyDateFilter(true); // true = don't clear the chips (already marked above)
}

/*
 * applyDateFilter(fromChip) — called when the user changes the date fields
 * or clicks a shortcut. Updates App.dateRange and redraws everything.
 * fromChip: if false (manual change), unmarks the shortcut chips.
 */
export function applyDateFilter(fromChip){
  const dr = App.dateRange;
  const ff = document.getElementById('df-from').value;
  const tt = document.getElementById('df-to').value;
  if(!ff && !tt){
    dr.mode='all'; dr.from=null; dr.to=null;
  } else {
    dr.mode = 'custom';
    dr.from = ff ? new Date(ff+'T00:00:00') : null;
    dr.to   = tt ? new Date(tt+'T23:59:59') : null;
  }
  // a manual change in the fields unmarks the quick shortcuts
  if(fromChip!==true){
    ['month','quarter','year'].forEach(k=>{
      const chip=document.getElementById('dfc-'+k); if(chip) chip.classList.remove('active');
    });
  }
  const wrap = document.getElementById('date-filter');
  if(wrap) wrap.classList.toggle('active', dr.mode!=='all');
  renderAll();
}

// Clears both date fields, unmarks shortcuts, and returns to 'all' mode
export function clearDateFilter(){
  document.getElementById('df-from').value = '';
  document.getElementById('df-to').value   = '';
  ['month','quarter','year'].forEach(k=>{
    const chip=document.getElementById('dfc-'+k); if(chip) chip.classList.remove('active');
  });
  applyDateFilter();
}

/*
 * renderAll() — redraws every tab with the current state (filters included).
 * Called whenever the date filter changes.
 * Each build*() function applies the date filter internally before calculating.
 */
export function renderAll(){
  construirGovernanca();
  if(App.P.proj.length) buildProjects();
  if(App.P.improvements.length) construirMelhorias();
  if(App.P.ana.length) buildAnalytics();
  if(App.R.length) buildRPATickets();
  if(App.B.length) buildBots();
  updateDateBadge();
}

/*
 * updateDateBadge() — updates the status text in the header (topbar).
 * When a filter is active, appends "· período: DD/MM/AAAA → DD/MM/AAAA".
 * Uses dataset.base to store the original text (update time + sources)
 * and avoid overwriting it when the period updates.
 */
export function updateDateBadge(){
  const dr = App.dateRange;
  const base = document.getElementById('sync-lbl').dataset.base || '';
  let periodo = '';
  if(dr.mode !== 'all'){
    const fmt = d => d ? d.toLocaleDateString('pt-BR') : '∞';
    periodo = ` · período: ${fmt(dr.from)} → ${fmt(dr.to)}`;
  }
  document.getElementById('sync-lbl').textContent = base + periodo;
}
