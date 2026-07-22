// nav.js — navegação: troca entre as abas principais e as sub-abas de RPA & Bots,
// mais o pequeno helper de badge da navegação usado por várias views.

import { _animarNumero } from './charts.js';

// Troca entre as abas principais do dashboard.
// Funciona alternando a classe 'active' no item de navegação e na seção correspondente.
export function definirNav(id){
  ['upload','gov','proj','mel','rpa','ana'].forEach(n => {
    const ni = document.getElementById('nav-'+n);
    const pg = document.getElementById('page-'+n);
    if(ni) ni.classList.toggle('active', n === id);
    if(pg) pg.classList.toggle('active', n === id);
  });
  // Anima os KPIs da aba que acabou de ficar visível
  const pg = document.getElementById('page-'+id);
  if(pg) pg.querySelectorAll('.knum').forEach(el => {
    delete el.dataset.an;
    _animarNumero(el);
  });
}

// Troca entre as sub-abas de RPA & Bots
// (Visão geral, Top bots, Tipos de problema, Tempo de resolução, Chamados, Inventário de bots)
export function definirSubAbaRPA(id){
  document.querySelectorAll('#page-rpa .pip-sub-page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('#page-rpa .pip-nav-item').forEach(n => n.classList.remove('active'));
  const pg = document.getElementById('rpage-'+id);
  const nv = document.getElementById('rnav-'+id);
  if(pg) pg.classList.add('active');
  if(nv) nv.classList.add('active');
}

// Atualiza o badge numérico de uma aba no menu de navegação
export function definirBadge(id, txt, cls){
  const element = document.getElementById(id);
  if(element){ element.textContent=txt; element.className='nb'+(cls?' '+cls:''); }
}
