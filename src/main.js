// ─── Entry point do bundle SYNAPSE ───────────────────────────────────────────
// Orquestra parsers, views e navegação. Expõe as funções chamadas pelo HTML
// (onclick="...") no escopo global via Object.assign(window, ...).

import { App } from './state.js';
import { parseGov } from './parsers/gov.js';
import { parseRPA, parseInv, enrichRPAComArea } from './parsers/rpa.js';
import { buildGov } from './views/gov.js';
import { buildProj, renderProjList, toggleProjChip, toggleProj } from './views/proj.js';
import { buildMel } from './views/mel.js';
import { buildAna } from './views/ana.js';
import { buildRPAChamados, renderRPAStatus, renderRPALista } from './views/rpa.js';
import { buildBots, renderBotsList } from './views/bots.js';
import { gerarAnalise } from './analysis.js';
import { setNav, rpaPage, setBadge } from './nav.js';
import { dzO, dzL, dzD, hf, updateBar } from './upload.js';
import { setQuickRange, applyDateFilter, clearDateFilter, renderAll, updateDateBadge } from './filters.js';
import { refDate } from './utils/date.js';

// ─── generate ────────────────────────────────────────────────────────────────
// Ponto de entrada principal: chamado ao clicar em "Gerar dashboard".
function generate() {
  // 1. Parseia cada fonte
  if (App.gov) parseGov();
  if (App.gov) parseInv();
  if (App.rpa) parseRPA();
  enrichRPAComArea();

  // 2. Descobre o range global de datas para limitar os inputs de data no header
  const all = [...App.P.mel, ...App.P.proj, ...App.P.ana, ...App.R];
  const dates = all.map(refDate).filter(Boolean).map(d => d.getTime());
  if (dates.length) {
    const min = new Date(Math.min(...dates));
    const max = new Date(Math.max(...dates));
    const iso = d => d.toISOString().slice(0, 10);
    ['df-from', 'df-to'].forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.min = iso(min); el.max = iso(max); }
    });
  }

  // 3. Constrói todas as views (só as que têm dados)
  buildGov();
  if (App.P.proj.length) buildProj();
  if (App.P.mel.length) buildMel();
  if (App.P.ana.length) buildAna();
  if (App.R.length) buildRPAChamados();
  if (App.B.length) buildBots();

  // 4. Atualiza badges de navegação e texto de status no header
  if (App.P.mel.length) setBadge('nb-mel', App.P.mel.length, '');
  const now = new Date();
  const ts  = `Atualizado ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const src = [App.loaded.gov ? 'Base Governança' : '', App.loaded.rpa ? 'Chamados RPA' : ''].filter(Boolean).join(' · ');
  const lbl = document.getElementById('sync-lbl');
  lbl.textContent = `${ts} · ${src}`;
  lbl.dataset.base = `${ts} · ${src}`;

  // 5. Revela o filtro de data (fica escondido até o primeiro generate)
  const df = document.getElementById('date-filter');
  if (df) df.style.display = 'flex';

  // 6. Navega para a aba Governança
  setNav('gov');
}

// ─── Expõe funções ao escopo global ──────────────────────────────────────────
// O bundle IIFE não exporta para window automaticamente.
// As funções abaixo são chamadas pelos atributos onclick do index.html.
Object.assign(window, {
  // Navegação
  setNav, rpaPage,
  // Upload
  hf, dzO, dzL, dzD,
  // Filtro de data
  setQuickRange, applyDateFilter, clearDateFilter,
  // Renderizações dinâmicas
  renderProjList, toggleProjChip, toggleProj,
  renderRPAStatus, renderRPALista,
  renderBotsList,
  // Análise
  gerarAnalise,
  // Geração do dashboard
  generate
});
