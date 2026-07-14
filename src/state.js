// ─── MODULE: state.js ──────────────────────────────────────────────────────
// Single global application state object, shared by every other module.
// Nothing here is computed — it's just the data + UI state containers that
// the parsers write to and the views read from.
// ─────────────────────────────────────────────────────────────────────────────

export const App = {
  // Raw workbooks read by SheetJS (null until the user uploads the file)
  gov: null,
  rpa: null,

  // Normalized data after parsing (arrays of plain objects)
  P: {
    improvements: [], // Pipefy_Melhorias — Pipefy improvements and adjustments
    proj: [],         // Projetos — the area's project portfolio
    ana: []            // Analytics — Analytics activities
  },
  R: [],       // RPA Tickets — bot maintenance tickets
  B: [],       // Bot Inventory — automation catalog (no date filter; uses AnoPRD)

  // Tracks which files have already been loaded
  loaded: { gov: false, rpa: false },

  // Global period filter (applied to every tab at the same time)
  // mode: 'all' = no filter | 'custom' = manual date range
  dateRange: { mode: 'all', from: null, to: null },

  // Set of expanded projects in the list (key = num or titulo)
  projOpen: new Set(),
  // Quick filter chips on the Projects tab: show only overdue / only high risk
  projChips: { atraso: false, risco: false },

  // Active area filter on the Governance tab ('' = all areas)
  govFrente: ''
};
