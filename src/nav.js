// ─── MODULE: nav.js ────────────────────────────────────────────────────────
// NAVIGATION
// Tab switching (main dashboard tabs + RPA & Bots sub-tabs) and the small
// nav-badge helper shared by several views.
// ─────────────────────────────────────────────────────────────────────────────

import { _animateNumber } from './charts.js';

/*
 * Switches between the dashboard's main tabs.
 * Works by toggling the 'active' class on the nav item and the matching section.
 */
export function setNav(id){
  ['upload','gov','proj','mel','rpa','ana'].forEach(n => {
    const ni = document.getElementById('nav-'+n);
    const pg = document.getElementById('page-'+n);
    if(ni) ni.classList.toggle('active', n === id);
    if(pg) pg.classList.toggle('active', n === id);
  });
  // Animates the KPIs of the tab that just became visible
  const pg = document.getElementById('page-'+id);
  if(pg) pg.querySelectorAll('.knum').forEach(el => {
    delete el.dataset.an;
    _animateNumber(el);
  });
}

/*
 * Switches between the RPA & Bots tab's sub-tabs
 * (Overview, Top bots, Problem types, Resolution time, Tickets, Bot inventory)
 */
export function rpaPage(id){
  document.querySelectorAll('#page-rpa .pip-sub-page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('#page-rpa .pip-nav-item').forEach(n => n.classList.remove('active'));
  const pg = document.getElementById('rpage-'+id);
  const nv = document.getElementById('rnav-'+id);
  if(pg) pg.classList.add('active');
  if(nv) nv.classList.add('active');
}

// Helper: atualiza o badge numérico de uma aba no menu de navegação
export function setBadge(id, txt, cls){
  const element = document.getElementById(id);
  if(element){ element.textContent=txt; element.className='nb'+(cls?' '+cls:''); }
}
