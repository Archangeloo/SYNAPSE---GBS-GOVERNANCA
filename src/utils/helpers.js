// utils/helpers.js — funções pequenas e genéricas, reaproveitadas por parsers, views e gráficos.

import { _SVG, PIPEFY_TEAM } from '../constants.js';

// Procura uma aba na planilha por um pedaço do nome, ignorando maiúsculas/minúsculas,
// espaços e underlines. Ex: buscarAba(wb, 'melhorias') acha 'Pipefy_Melhorias'.
export function buscarAba(wb, frag){
  const fragNorm = frag.toLowerCase().replace(/[_ ]/g,'');
  return wb.SheetNames.find(nome => nome.toLowerCase().replace(/[_ ]/g,'').includes(fragNorm));
}

// Busca o valor de uma coluna numa linha da planilha, aceitando vários nomes possíveis
// (o nome da coluna varia entre versões da base). Comparação sem acento de caixa e sem
// espaços extras. Retorna '' se nenhuma das chaves for encontrada.
export function obterValorColuna(row, keys){
  const rowKeys = Object.keys(row);
  for(const key of keys){
    for(const columnName of rowKeys){
      if(columnName.trim().toLowerCase() === key.toLowerCase()){
        const value = row[columnName];
        return value == null ? '' : value;
      }
    }
  }
  return '';
}

// Conta a frequência de um valor num array de objetos.
// fn: função que extrai a chave a contar (ex: r => r.frente)
// Retorna: { 'P2P': 42, 'O2C': 33, ... }
export function contar(arr, fn){
  const freq = {};
  arr.forEach(x => { const chave = fn(x) || '—'; freq[chave] = (freq[chave]||0) + 1; });
  return freq;
}

// Calcula um percentual arredondado. Retorna 0 se o divisor for 0 (nunca divide por zero).
export function calcularPercentual(value, total){ return total ? Math.round(value/total*100) : 0; }

// Calcula a média de um campo numérico num array, ignorando nulos.
// Retorna o valor como string com 1 casa decimal, ou '—' se não houver dado.
export function mediaDoCampo(arr, campo){
  const valores = arr.filter(r => r[campo] != null).map(r => r[campo]);
  return valores.length ? (valores.reduce((soma, v) => soma + v, 0) / valores.length).toFixed(1) : '—';
}

// Normaliza o nome de um bot ou processo para comparação aproximada:
// remove prefixo entre colchetes (ex: "[P2P]"), deixa minúsculo e tira
// tudo que não for letra ou número.
export function normalizarNomeBot(name){ return name.toLowerCase().replace(/^\[.*?\]/, '').replace(/[^a-z0-9]/g, ''); }

// Diz se dois nomes JÁ NORMALIZADOS (via normalizarNomeBot) batem por inclusão aproximada —
// um contém o outro. É o critério usado em todo lugar que cruza bot × processo/chamado
// (inventário de bots, cruzamento de manutenções e enriquecimento de área dos chamados RPA).
export function nomesBatem(nomeNormA, nomeNormB){
  return !!(nomeNormA && nomeNormB && (nomeNormA.includes(nomeNormB) || nomeNormB.includes(nomeNormA)));
}

// Para cada bot em produção, soma quantos chamados (agrupados por processo) correspondem
// a ele pelo nome. Usado tanto no cruzamento da aba de Bots quanto na análise automática.
export function chamadosPorBot(botsPrd, chamadosPorProcesso){
  return botsPrd.map(bot => {
    const nomeBotNorm = normalizarNomeBot(bot.nome);
    let total = 0;
    Object.entries(chamadosPorProcesso).forEach(([processo, qtd]) => {
      if(nomesBatem(nomeBotNorm, normalizarNomeBot(processo))) total += qtd;
    });
    return { bot, total };
  });
}

// True se `nome` bater com algum integrante do time de desenvolvimento de Melhorias Pipefy.
export function ehIntegranteEquipePipefy(nome){ return PIPEFY_TEAM.some(p => nome.toLowerCase().includes(p)); }

// Conta quantos itens de um array têm cada código de status.
// Elimina o padrão repetido: arr.filter(x => x.codigoStatus === 'done').length
// Uso: const { done, todo: backlog, blocked } = contarPorStatus(arr);
export function contarPorStatus(arr) {
  const codes = ['done', 'doing', 'todo', 'blocked', 'cancel', 'vendor', 'closing', 'monitor'];
  const result = {};
  codes.forEach(code => { result[code] = arr.filter(x => x.codigoStatus === code).length; });
  return result;
}

// Agrupa arr por keyFn, conta as frequências e retorna pares [chave, contagem]
// ordenados do mais frequente pro menos frequente.
export function contagemOrdenada(arr, keyFn) {
  return Object.entries(contar(arr, keyFn)).sort((a, b) => b[1] - a[1]);
}

// Monta o SVG inline de um ícone de KPI a partir do nome (ver constants.js, _SVG).
export function iconeKpi(name){
  const path = _SVG[name] || '';
  if(!path) return '';
  return `<svg class="kico" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
}
