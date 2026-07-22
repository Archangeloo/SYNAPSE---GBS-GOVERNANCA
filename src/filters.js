// filters.js — FILTRO GLOBAL DE DATA — CONTROLES DO CABEÇALHO
// Lê os dois campos de data do cabeçalho (ou um atalho de período rápido), atualiza
// App.periodoFiltro, e redesenha toda aba que depende disso.

import { App } from './state.js';
import { HOJE } from './constants.js';
import { paraDataIso } from './utils/date.js';
import { construirGovernanca } from './views/gov.js';
import { construirProjetos } from './views/proj.js';
import { construirMelhorias } from './views/mel.js';
import { construirAnalytics } from './views/ana.js';
import { construirChamadosRPA } from './views/rpa.js';
import { construirBots } from './views/bots.js';

/*
 * definirPeriodoRapido(mode) — aplica um atalho de período (mês/trimestre/ano atual).
 * Calcula início e fim com base na data de hoje, preenche os campos de data,
 * e então aciona o filtro. Marca visualmente o chip ativo.
 */
export function definirPeriodoRapido(mode){
  // Se o chip clicado já está ativo, limpa o filtro (toggle)
  const chip = document.getElementById('dfc-' + mode);
  if (chip && chip.classList.contains('active')) {
    limparFiltroData();
    return;
  }

  const year = HOJE.getFullYear();
  const month = HOJE.getMonth();
  let from, to;
  if(mode==='month'){
    from = new Date(year, month, 1);
    to   = new Date(year, month+1, 0); // último dia do mês atual
  } else if(mode==='quarter'){
    const quarter = Math.floor(month/3);  // 0,1,2,3
    from = new Date(year, quarter*3, 1);
    to   = new Date(year, quarter*3+3, 0); // último dia do trimestre
  } else if(mode==='year'){
    from = new Date(year, 0, 1);
    to   = new Date(year, 11, 31);
  }
  const iso = paraDataIso;
  document.getElementById('df-from').value = iso(from);
  document.getElementById('df-to').value   = iso(to);
  // marca o chip ativo
  ['month','quarter','year'].forEach(k=>{
    const chip = document.getElementById('dfc-'+k);
    if(chip) chip.classList.toggle('active', k===mode);
  });
  aplicarFiltroData(true); // true = não limpa os chips (já marcados acima)
}

/*
 * aplicarFiltroData(fromChip) — chamado quando o usuário muda os campos de data
 * ou clica num atalho. Atualiza App.periodoFiltro e redesenha tudo.
 * fromChip: se false (mudança manual), desmarca os chips de atalho.
 */
export function aplicarFiltroData(fromChip){
  const pf = App.periodoFiltro;
  const ff = document.getElementById('df-from').value;
  const tt = document.getElementById('df-to').value;
  if(!ff && !tt){
    pf.modo='all'; pf.de=null; pf.ate=null;
  } else {
    pf.modo = 'custom';
    pf.de  = ff ? new Date(ff+'T00:00:00') : null;
    pf.ate = tt ? new Date(tt+'T23:59:59') : null;
  }
  // uma mudança manual nos campos desmarca os atalhos rápidos
  if(fromChip!==true){
    ['month','quarter','year'].forEach(k=>{
      const chip=document.getElementById('dfc-'+k); if(chip) chip.classList.remove('active');
    });
  }
  const wrap = document.getElementById('date-filter');
  if(wrap) wrap.classList.toggle('active', pf.modo!=='all');
  renderizarTudo();
}

// Limpa os dois campos de data, desmarca os atalhos, e volta pro modo 'all'
export function limparFiltroData(){
  document.getElementById('df-from').value = '';
  document.getElementById('df-to').value   = '';
  ['month','quarter','year'].forEach(k=>{
    const chip=document.getElementById('dfc-'+k); if(chip) chip.classList.remove('active');
  });
  aplicarFiltroData();
}

/*
 * renderizarTudo() — redesenha todas as abas com o estado atual (filtros inclusos).
 * Chamado sempre que o filtro de data muda.
 * Cada função construir*() aplica o filtro de data internamente antes de calcular.
 */
export function renderizarTudo(){
  construirGovernanca();
  if(App.dadosGovernanca.projetos.length) construirProjetos();
  if(App.dadosGovernanca.melhorias.length) construirMelhorias();
  if(App.dadosGovernanca.analytics.length) construirAnalytics();
  if(App.chamadosRPA.length) construirChamadosRPA();
  if(App.bots.length) construirBots();
  atualizarBadgeData();
}

/*
 * atualizarBadgeData() — atualiza o texto de status no cabeçalho (topbar).
 * Quando há filtro ativo, acrescenta "· período: DD/MM/AAAA → DD/MM/AAAA".
 * Usa dataset.base pra guardar o texto original (hora da atualização + fontes)
 * e não sobrescrever isso quando o período muda.
 */
export function atualizarBadgeData(){
  const pf = App.periodoFiltro;
  const base = document.getElementById('sync-lbl').dataset.base || '';
  let periodo = '';
  if(pf.modo !== 'all'){
    const fmt = d => d ? d.toLocaleDateString('pt-BR') : '∞';
    periodo = ` · período: ${fmt(pf.de)} → ${fmt(pf.ate)}`;
  }
  document.getElementById('sync-lbl').textContent = base + periodo;
}
