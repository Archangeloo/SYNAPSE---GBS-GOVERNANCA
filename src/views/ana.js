// views/ana.js — ABA: ANALYTICS
// FILTRO DE DATA: usa DataAbertura (início do desenvolvimento)
// ou DataFechamento (fim da validação) como fallback.
// Muitas atividades não têm data preenchida — a interface mostra quantas foram excluídas.

import { App } from '../state.js';
import { STATUS_PT, STATUS_COLOR } from '../constants.js';
import { contarPorStatus, contar, calcularPercentual, contagemOrdenada, iconeKpi } from '../utils/helpers.js';
import { filtrarPorPeriodo } from '../utils/date.js';
import { graficoRosca, barrasHorizontais, renderizarGraficosPendentes } from '../charts.js';
import { barraAnalise } from '../analysis.js';
import { definirBadge } from '../nav.js';
import { construirMapaCalor } from './gov.js';

/*
 * construirAnalytics() — aba Analytics.
 *
 * Lê:      App.dadosGovernanca.analytics
 * Escreve: #ana-content
 * Chamada por: gerarDashboard() e renderizarTudo()
 *
 * ATENÇÃO — baixa cobertura de data:
 *   Muitas atividades não têm data preenchida na planilha.
 *   Com filtro ativo, só entram as atividades COM data.
 *   A interface mostra quantas foram excluídas, por transparência.
 *
 * Produz:
 *  - KPIs: total, concluídas, em andamento, não iniciadas
 *  - Donut de status, barras por prioridade, área e responsável
 *  - Heatmap prioridade × área (via construirMapaCalor(), chamado direto aqui)
 */
export function construirAnalytics(){
  const {kept:A, noDate} = filtrarPorPeriodo(App.dadosGovernanca.analytics);
  document.getElementById('ana-empty').style.display  = App.dadosGovernanca.analytics.length ? 'none' : 'block';
  document.getElementById('ana-content').style.display = App.dadosGovernanca.analytics.length ? 'block' : 'none';
  if(!App.dadosGovernanca.analytics.length) return;
  const contagem = contarPorStatus(A);
  const done = contagem.done;
  const doing = contagem.doing;
  const todo  = contagem.todo;
  const comData = A.filter(a => a.dataFim).length;

  // Nota informativa: quantas atividades têm data vs. quantas não têm
  let dateNote = '';
  if(App.periodoFiltro.modo !== 'all'){
    dateNote = `<div class="note" style="background:var(--neu-bg);color:var(--ink3)"><i class="ti ti-calendar-stats"></i><div>
      Período aplicado: <b>${A.length} atividades</b> no recorte.` +
      (noDate>0 ? ` ${noDate} sem data não entram no filtro.` : '') +
      `<br><span style="font-size:10px;opacity:.6;font-style:italic">Referência de data: data de abertura da atividade (ou fechamento como fallback)</span>
      </div></div>`;
  } else if(comData < A.length){
    // sem filtro ativo: avisa quantas têm data (relevante pro gráfico de evolução)
    dateNote = `<div class="note"><i class="ti ti-info-circle"></i><div>${comData} de ${A.length} atividades têm data registrada. As ${A.length-comData} restantes não têm data preenchida na base, então não entram nos cálculos por período.</div></div>`;
  }

  // só prioridades de 1 a 5 (valores fora dessa faixa são descartados do gráfico)
  const prioCount = contar(A.filter(a => a.prioridade && a.prioridade>=1 && a.prioridade<=5), a => 'Prioridade '+a.prioridade);
  let html = dateNote + `<div class="sh">Analytics</div>
  ${barraAnalise('ana')}
  <div class="krow">
    <div class="kpi">${iconeKpi('chartbar')}<div class="knum">${A.length}</div><div class="klbl">Total</div></div>
    <div class="kpi gl">${iconeKpi('check')}<div class="knum">${done}</div><div class="klbl">Concluídas</div><div class="ksub">${calcularPercentual(done,A.length)}%</div></div>
    <div class="kpi il">${iconeKpi('clock')}<div class="knum">${doing}</div><div class="klbl">Em andamento</div></div>
    <div class="kpi">${iconeKpi('minus')}<div class="knum">${todo}</div><div class="klbl">Não iniciadas</div></div>
  </div>`;
  html += `<div class="g3">
    <div class="card"><div class="card-title"><i class="ti ti-chart-pie"></i> Status</div>
      ${graficoRosca(['done','doing','todo','blocked','cancel'].map(k=>({label:STATUS_PT[k],value:A.filter(a=>a.codigoStatus===k).length,color:STATUS_COLOR[k]})).filter(d=>d.value))}</div>
    <div class="card"><div class="card-title"><i class="ti ti-flag"></i> Por prioridade</div>
      ${barrasHorizontais(Object.entries(prioCount).sort((a,b)=>{const na=+a[0].match(/\d+/),nb=+b[0].match(/\d+/);return na-nb;}),{max:10,lw:90})}</div>
    <div class="card"><div class="card-title"><i class="ti ti-building"></i> Por frente</div>
      ${barrasHorizontais(contagemOrdenada(A.filter(a=>a.frente), a=>a.frente),{max:8,lw:60,tot:A.length})}</div>
  </div>`;
  html += `<div class="two">
    <div class="card"><div class="card-title"><i class="ti ti-user"></i> Por responsável</div>
      ${barrasHorizontais(contagemOrdenada(A.filter(a=>a.responsavel), a=>a.responsavel),{max:8,lw:140})}</div>
    ${construirMapaCalor()}
  </div>`;
  document.getElementById('ana-content').innerHTML = html;
  renderizarGraficosPendentes();
  definirBadge('nb-ana', A.length, '');
}
