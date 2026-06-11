import { App } from './state.js';
import { HOJE } from './constants.js';
import { buildGov } from './views/gov.js';
import { buildProj } from './views/proj.js';
import { buildMel } from './views/mel.js';
import { buildAna } from './views/ana.js';
import { buildRPAChamados } from './views/rpa.js';
import { buildBots } from './views/bots.js';

// ─── MÓDULO: filters.js ──────────────────────────────────────────────────────
// Controles do filtro global de período (data range) do header.
// Quando o filtro muda, chama renderAll() para redesenhar todas as abas.
//
// Exporta:
//   setQuickRange(mode)         — atalho: 'month' | 'quarter' | 'year'
//   applyDateFilter(fromChip?)  — lê os inputs de data e aplica o filtro
//   clearDateFilter()           — reseta para modo 'all' (sem filtro)
//   renderAll()                 — redesenha todas as abas com filtro atual
//   updateDateBadge()           — atualiza texto de status no header
// ─────────────────────────────────────────────────────────────────────────────

// ─── Filtro global de período ─────────────────────────────────────────────────

// Aplica um atalho de período (mês/trimestre/ano atual).
// Calcula datas de início e fim, preenche os inputs e aciona o filtro.
export function setQuickRange(mode) {
  const y = HOJE.getFullYear();
  const m = HOJE.getMonth();
  let from, to;
  if (mode === 'month') {
    from = new Date(y, m, 1);
    to   = new Date(y, m + 1, 0);
  } else if (mode === 'quarter') {
    const q = Math.floor(m / 3);
    from = new Date(y, q * 3, 1);
    to   = new Date(y, q * 3 + 3, 0);
  } else if (mode === 'year') {
    from = new Date(y, 0, 1);
    to   = new Date(y, 11, 31);
  }
  const iso = d => d.toISOString().slice(0, 10);
  document.getElementById('df-from').value = iso(from);
  document.getElementById('df-to').value   = iso(to);
  ['month', 'quarter', 'year'].forEach(k => {
    const c = document.getElementById('dfc-' + k);
    if (c) c.classList.toggle('active', k === mode);
  });
  applyDateFilter(true);
}

// Chamado quando o usuário muda os campos de data ou clica num atalho.
// fromChip=true preserva os chips marcados (não desmarca ao aplicar o atalho).
export function applyDateFilter(fromChip) {
  const dr = App.dateRange;
  const ff = document.getElementById('df-from').value;
  const tt = document.getElementById('df-to').value;
  if (!ff && !tt) {
    dr.mode = 'all'; dr.from = null; dr.to = null;
  } else {
    dr.mode = 'custom';
    dr.from = ff ? new Date(ff + 'T00:00:00') : null;
    dr.to   = tt ? new Date(tt + 'T23:59:59') : null;
  }
  if (fromChip !== true) {
    ['month', 'quarter', 'year'].forEach(k => {
      const c = document.getElementById('dfc-' + k); if (c) c.classList.remove('active');
    });
  }
  const wrap = document.getElementById('date-filter');
  if (wrap) wrap.classList.toggle('active', dr.mode !== 'all');
  renderAll();
}

// Limpa os campos de data e volta para modo 'all'.
export function clearDateFilter() {
  document.getElementById('df-from').value = '';
  document.getElementById('df-to').value   = '';
  ['month', 'quarter', 'year'].forEach(k => {
    const c = document.getElementById('dfc-' + k); if (c) c.classList.remove('active');
  });
  applyDateFilter();
}

// Redesenha todas as abas com o estado atual (chamado sempre que o filtro muda).
export function renderAll() {
  buildGov();
  if (App.P.proj.length) buildProj();
  if (App.P.mel.length) buildMel();
  if (App.P.ana.length) buildAna();
  if (App.R.length) buildRPAChamados();
  if (App.B.length) buildBots();
  updateDateBadge();
}

// Atualiza o texto de status no header com o período ativo.
// Preserva o texto original (horário de atualização) via dataset.base.
export function updateDateBadge() {
  const dr = App.dateRange;
  const base = document.getElementById('sync-lbl').dataset.base || '';
  let periodo = '';
  if (dr.mode !== 'all') {
    const fmt = d => d ? d.toLocaleDateString('pt-BR') : '∞';
    periodo = ` · período: ${fmt(dr.from)} → ${fmt(dr.to)}`;
  }
  document.getElementById('sync-lbl').textContent = base + periodo;
}
