// main.js — GERAR DASHBOARD — PONTO DE ENTRADA PRINCIPAL
// Chamado quando o usuário clica em "Gerar dashboard".
// Orquestra: parsers → encontra o intervalo de datas → constrói todas as views → navega.
//
// Este também é o módulo que o navegador carregaria (<script type="module"
// src="src/main.js">) se o app um dia deixasse de depender do arquivo único app.js.
// Como o index.html ainda chama cada handler de interface como global simples
// (onclick="gerarDashboard()", onchange="renderizarStatusRPA()", etc.), este arquivo
// reexpõe cada uma dessas funções em window — o equivalente, em módulo ES, das
// declarações de função de nível superior de que o app.js depende hoje.

import { App } from './state.js';
import { reiniciarGraficos } from './charts.js';
import { dataReferencia, paraDataIso } from './utils/date.js';
import { interpretarGov, interpretarInventario } from './parsers/gov.js';
import { interpretarRPA, enriquecerRPAComArea } from './parsers/rpa.js';
import { definirNav, definirSubAbaRPA, definirBadge } from './nav.js';
import { tratarArrastarSobreDropzone, tratarSairDropzone, tratarSoltarDropzone, tratarMudancaArquivo } from './upload.js';
import { definirPeriodoRapido, aplicarFiltroData, limparFiltroData } from './filters.js';
import { gerarAnalise } from './analysis.js';
import { construirGovernanca } from './views/gov.js';
import { construirProjetos, renderizarListaProjetos, alternarChipProjeto, alternarProjeto } from './views/proj.js';
import { construirMelhorias } from './views/mel.js';
import {
  abrirFormularioAtividade, fecharFormularioAtividade, fecharFormularioAtividadeAoClicarFora,
  salvarFormularioAtividade, confirmarExclusaoAtividade
} from './views/mel-activities.js';
import { construirAnalytics } from './views/ana.js';
import { construirChamadosRPA, renderizarStatusRPA, renderizarListaRPA } from './views/rpa.js';
import { construirBots, renderizarListaBots, alternarBot } from './views/bots.js';

/*
 * gerarDashboard() — orquestra a construção inteira do dashboard.
 *
 * Lê:      App.planilhaGovernanca, App.planilhaRPA (as duas planilhas carregadas)
 * Escreve: o DOM de cada aba, o texto de sincronização do cabeçalho, e navega pra Governança
 * Chamada por: o botão "Gerar dashboard" (index.html)
 */
function gerarDashboard(){
  // Destrói as instâncias anteriores do Chart.js e zera o contador de id
  // pra evitar o erro "Canvas already in use" a cada regeneração do dashboard
  reiniciarGraficos();

  // 1. Interpreta cada fonte (converte o Excel bruto em objetos normalizados)
  if(App.planilhaGovernanca) interpretarGov();        // base de governança: Pipefy, Projetos, Analytics
  if(App.planilhaGovernanca) interpretarInventario();  // inventário de bots (aba separada dentro da base de governança)
  if(App.planilhaRPA) interpretarRPA();                // relatório de chamados de manutenção RPA
  enriquecerRPAComArea();      // atribui a área do bot aos chamados (por match de nome)

  // 2. Encontra o intervalo global de datas (mín e máx entre todas as fontes)
  //    Isso define os limites mín/máx dos campos de data do cabeçalho,
  //    impedindo o usuário de selecionar datas fora do intervalo dos dados.
  const all = [...App.dadosGovernanca.melhorias, ...App.dadosGovernanca.projetos, ...App.dadosGovernanca.analytics, ...App.chamadosRPA];
  const dates = all.map(dataReferencia).filter(Boolean).map(d => d.getTime());
  if(dates.length){
    const min = new Date(Math.min(...dates));
    const max = new Date(Math.max(...dates));
    const iso = paraDataIso;
    ['df-from','df-to'].forEach(id => {
      const el = document.getElementById(id);
      if(el){ el.min=iso(min); el.max=iso(max); }
    });
  }

  // 3. Constrói cada view (try/catch por aba: um erro numa não bloqueia as outras nem o redirecionamento)
  function construirAba(builder) {
    try { builder(); } catch(error) { console.error('[SYNAPSE] erro ao construir aba:', error); }
  }
  construirAba(() => construirGovernanca());
  construirAba(() => { if(App.dadosGovernanca.projetos.length) construirProjetos(); });
  construirAba(() => { if(App.dadosGovernanca.melhorias.length) construirMelhorias(); });
  construirAba(() => { if(App.dadosGovernanca.analytics.length) construirAnalytics(); });
  construirAba(() => { if(App.chamadosRPA.length) construirChamadosRPA(); });
  construirAba(() => { if(App.bots.length) construirBots(); });

  // 4. Atualiza os badges de navegação e o texto de status
  if(App.dadosGovernanca.melhorias.length) definirBadge('nb-mel', App.dadosGovernanca.melhorias.length, '');
  const now = new Date();
  const ts  = `Atualizado ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  const src = [App.carregado.governanca?'Base Governança':'', App.carregado.rpa?'Chamados RPA':''].filter(Boolean).join(' · ');
  const lbl = document.getElementById('sync-lbl');
  lbl.textContent = `${ts} · ${src}`;
  lbl.dataset.base = `${ts} · ${src}`; // guardado pra atualizarBadgeData não sobrescrever isso

  // 5. Revela o filtro de data e o botão de exportar (ficam escondidos até o primeiro generate)
  const df = document.getElementById('date-filter');
  if(df) df.style.display = 'flex';
  const bp = document.getElementById('btn-print');
  if(bp) bp.style.display = 'flex';

  // 6. Navega pra aba Governança (visão executiva)
  definirNav('gov');
}

// Toda função referenciada por um handler de evento inline no HTML (seja no
// próprio index.html, seja nas strings de HTML montadas pelas views) precisa
// existir em window — bindings de nível superior de um módulo ES não são
// globais por padrão.
Object.assign(window, {
  gerarDashboard,
  definirNav, definirSubAbaRPA, definirBadge,
  tratarArrastarSobreDropzone, tratarSairDropzone, tratarSoltarDropzone, tratarMudancaArquivo,
  definirPeriodoRapido, aplicarFiltroData, limparFiltroData,
  gerarAnalise,
  renderizarListaProjetos, alternarChipProjeto, alternarProjeto,
  abrirFormularioAtividade, fecharFormularioAtividade, fecharFormularioAtividadeAoClicarFora,
  salvarFormularioAtividade, confirmarExclusaoAtividade,
  renderizarStatusRPA, renderizarListaRPA,
  renderizarListaBots, alternarBot,
});

// Inicializa na tela de Upload quando a página carrega
definirNav('upload');

// Botão "Voltar ao topo": aparece depois de 300px de scroll, some no topo
window.addEventListener('scroll', () => {
  const btn = document.getElementById('btn-top');
  if (btn) btn.classList.toggle('visible', window.scrollY > 300);
});
