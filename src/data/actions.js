// data/actions.js — agregação "ações" entre fontes: junta Projetos, Melhorias Pipefy,
// Analytics e Chamados RPA num único array. Usado pela view de Governança e pela
// análise automática (analysis.js).
//
// Esse módulo existe pra evitar uma dependência circular entre views/gov.js e
// analysis.js — as duas precisam dessa agregação, então ela mora num módulo próprio,
// de baixo nível e sem dependências além de state/constants.

import { App } from '../state.js';
import { filtrarPorPeriodo } from '../utils/date.js';

/*
 * todasAcoes() — junta as 4 fontes num único array de "ações".
 * Cada ação tem: source, codigoStatus, frente, responsavel,
 * dataFim (data de referência pra filtros e gráficos) e campos específicos da fonte.
 *
 * Para Chamados RPA:
 *   - codigoStatus é derivado da fase atual (contém "conclu" → done, senão → doing)
 *   - dataFim = data de conclusão do chamado
 *   - criado = data de abertura (usado como fallback de dataReferencia)
 *   - vencido = flag booleana vinda do Pipefy
 */
export function todasAcoes(){
  const out = [];
  App.dadosGovernanca.projetos.forEach(p => out.push({source:'Projetos', codigoStatus:p.codigoStatus, frente:p.frente, responsavel:p.responsavel, dataFim:p.dataFim, progresso:p.progresso, prioridade:null}));
  App.dadosGovernanca.melhorias.forEach(m => out.push({source:'Pipefy', codigoStatus:m.codigoStatus, frente:m.frente, responsavel:m.responsavel, dataInicio:m.dataInicio, dataFim:m.dataFim, progresso:null, prioridade:null}));
  App.dadosGovernanca.analytics.forEach(a => out.push({source:'Analytics', codigoStatus:a.codigoStatus, frente:a.frente, responsavel:a.responsavel, dataInicio:a.dataInicio, dataFim:a.dataFim, progresso:null, prioridade:a.prioridade}));
  App.chamadosRPA.forEach(r => out.push({
    source:'Chamados RPA',
    codigoStatus: r.fase.toLowerCase().includes('conclu') ? 'done' : 'doing',
    // frente = área de negócio principal do bot (P2P, O2C, R2R, TAX, H2R), resolvida por enriquecerRPAComArea()
    // Áreas secundárias do inventário (Arg, CI, IT, PAM…) não são áreas de negócio → null
    frente: ['P2P','O2C','R2R','TAX','H2R'].includes(r.area) ? r.area : null,
    responsavel:r.solicitante,
    dataInicio:r.criado, dataFim:r.dataFim, criado:r.criado,
    progresso:null, prioridade:null, vencido:r.vencido
  }));
  return out;
}

// Versão filtrada: aplica o filtro global de data antes de retornar
export function todasAcoesFiltradas(){
  return filtrarPorPeriodo(todasAcoes());
}
