// ─── MODULE: main.js ───────────────────────────────────────────────────────
// GENERATE — MAIN ENTRY POINT
// Called when the user clicks "Gerar dashboard".
// Orchestrates: parsers → finds the date range → builds every view → navigates.
//
// This is also the module the browser would load (<script type="module"
// src="src/main.js">) if the app ever moves off the single-file app.js.
// Since index.html still calls every interactive handler as a plain global
// (onclick="generate()", onchange="renderRPAStatus()", etc.), this file
// re-exposes each of those functions on window — the ES-module equivalent
// of the top-level function declarations app.js relies on today.
// ─────────────────────────────────────────────────────────────────────────────

import { App } from './state.js';
import { resetCharts } from './charts.js';
import { dataReferencia, toIsoDate } from './utils/date.js';
import { parseGov, parseInv } from './parsers/gov.js';
import { parseRPA, enrichRPAWithArea } from './parsers/rpa.js';
import { setNav, rpaPage, setBadge } from './nav.js';
import { handleDropzoneDragOver, handleDropzoneDragLeave, handleDropzoneDrop, handleFileInputChange } from './upload.js';
import { setQuickRange, applyDateFilter, clearDateFilter } from './filters.js';
import { gerarAnalise } from './analysis.js';
import { construirGovernanca } from './views/gov.js';
import { buildProjects, renderProjectList, toggleProjectChip, toggleProject } from './views/proj.js';
import { construirMelhorias } from './views/mel.js';
import {
  abrirFormularioAtividade, fecharFormularioAtividade, fecharFormularioAtividadeAoClicarFora,
  salvarFormularioAtividade, confirmarExclusaoAtividade
} from './views/mel-activities.js';
import { buildAnalytics } from './views/ana.js';
import { buildRPATickets, renderRPAStatus, renderRPAList } from './views/rpa.js';
import { buildBots, renderBotsList, toggleBot } from './views/bots.js';

/*
 * generate() — orchestrates the whole dashboard build.
 *
 * Reads:  App.gov, App.rpa (the two uploaded workbooks)
 * Writes: every tab's DOM, the header sync label, and navigates to Governance
 * Called by: the "Gerar dashboard" button (index.html)
 */
function generate(){
  // Destroys previous Chart.js instances and resets the id counter
  // to avoid the "Canvas already in use" error on every dashboard regeneration
  resetCharts();

  // 1. Parses each source (converts raw Excel into normalized objects)
  if(App.gov) parseGov();   // governance base: Pipefy, Projetos, Analytics
  if(App.gov) parseInv();   // bot inventory (separate tab within the governance base)
  if(App.rpa) parseRPA();   // RPA maintenance ticket report
  enrichRPAWithArea();      // assigns bot area to tickets (via name matching)

  // 2. Finds the global date range (min and max across all sources)
  //    This sets the min/max limits of the header's date inputs,
  //    preventing the user from selecting dates outside the data's range.
  const all = [...App.P.improvements, ...App.P.proj, ...App.P.ana, ...App.R];
  const dates = all.map(dataReferencia).filter(Boolean).map(d => d.getTime());
  if(dates.length){
    const min = new Date(Math.min(...dates));
    const max = new Date(Math.max(...dates));
    const iso = toIsoDate;
    ['df-from','df-to'].forEach(id => {
      const el = document.getElementById(id);
      if(el){ el.min=iso(min); el.max=iso(max); }
    });
  }

  // 3. Builds every view (try/catch per tab: an error in one doesn't block the others or the redirect)
  function buildTab(builder) {
    try { builder(); } catch(error) { console.error('[SYNAPSE] erro ao construir aba:', error); }
  }
  buildTab(() => construirGovernanca());
  buildTab(() => { if(App.P.proj.length) buildProjects(); });
  buildTab(() => { if(App.P.improvements.length) construirMelhorias(); });
  buildTab(() => { if(App.P.ana.length) buildAnalytics(); });
  buildTab(() => { if(App.R.length) buildRPATickets(); });
  buildTab(() => { if(App.B.length) buildBots(); });

  // 4. Updates navigation badges and status text
  if(App.P.improvements.length) setBadge('nb-mel', App.P.improvements.length, '');
  const now = new Date();
  const ts  = `Atualizado ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  const src = [App.loaded.gov?'Base Governança':'', App.loaded.rpa?'Chamados RPA':''].filter(Boolean).join(' · ');
  const lbl = document.getElementById('sync-lbl');
  lbl.textContent = `${ts} · ${src}`;
  lbl.dataset.base = `${ts} · ${src}`; // stored so updateDateBadge doesn't overwrite it

  // 5. Reveals the date filter and the export button (hidden until the first generate)
  const df = document.getElementById('date-filter');
  if(df) df.style.display = 'flex';
  const bp = document.getElementById('btn-print');
  if(bp) bp.style.display = 'flex';

  // 6. Navigates to the Governance tab (executive view)
  setNav('gov');
}

// Every function referenced from an inline HTML event handler (either in
// index.html itself or in HTML strings built by the view modules) needs to
// exist on window — ES module top-level bindings are not global by default.
Object.assign(window, {
  generate,
  setNav, rpaPage, setBadge,
  handleDropzoneDragOver, handleDropzoneDragLeave, handleDropzoneDrop, handleFileInputChange,
  setQuickRange, applyDateFilter, clearDateFilter,
  gerarAnalise,
  renderProjectList, toggleProjectChip, toggleProject,
  abrirFormularioAtividade, fecharFormularioAtividade, fecharFormularioAtividadeAoClicarFora,
  salvarFormularioAtividade, confirmarExclusaoAtividade,
  renderRPAStatus, renderRPAList,
  renderBotsList, toggleBot,
});

// Initializes on the Upload screen when the page loads
setNav('upload');

// "Back to top" button: appears after 300px of scroll, hides at the top
window.addEventListener('scroll', () => {
  const btn = document.getElementById('btn-top');
  if (btn) btn.classList.toggle('visible', window.scrollY > 300);
});
