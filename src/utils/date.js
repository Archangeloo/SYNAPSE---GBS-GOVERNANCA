import { App } from '../state.js';
import { MESES, HOJE } from '../constants.js';

// ─── MÓDULO: utils/date.js ────────────────────────────────────────────────────
// Conversão, formatação e filtragem de datas.
//
// Exporta:
//   toDate(v)                  — converte qualquer valor (Date, serial Excel, ISO) → Date nativa
//   ym(d)                      — Date → "YYYY-MM" (chave de agrupamento mensal)
//   ymLabel(m)                 — "YYYY-MM" → "Mmm/AA" (ex: "Abr/26")
//   refDate(item)              — data de referência de um item (dtFim > criado)
//   inDateRange(d)             — boolean: data passa no filtro global?
//   activeInRange(ini, fim)    — 'in'|'out'|'nodate': intervalo cruza o filtro?
//   applyDate(arr)             — aplica filtro ao array → { kept, noDate }
// ─────────────────────────────────────────────────────────────────────────────

// ─── Conversão de valores para Date ─────────────────────────────────────────

// Aceita Date nativo, número serial do Excel ou string ISO.
// Retorna null para qualquer valor inválido.
export function toDate(v) {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v) ? null : v;
  if (typeof v === 'number') {
    // serial do Excel: (serial - 25569) * 86400000 ms desde a epoch
    const d = new Date(Math.round((v - 25569) * 864e5));
    return isNaN(d) ? null : d;
  }
  if (typeof v === 'string' && v.length > 4) {
    const d = new Date(v);
    return isNaN(d) ? null : d;
  }
  return null;
}

// ─── Formatação ──────────────────────────────────────────────────────────────

// Retorna "YYYY-MM" — usada como chave de agrupamento mensal
export function ym(d) {
  return d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` : '';
}

// Converte "YYYY-MM" em rótulo legível "Mmm/AA" (ex: "2026-04" → "Abr/26")
export function ymLabel(m) {
  if (!m) return '';
  const p = m.split('-');
  return `${MESES[+p[1] - 1]}/${p[0].slice(2)}`;
}

// ─── Data de referência de um item ──────────────────────────────────────────

// Prioridade: data de conclusão (dtFim) > data de criação (criado).
// Para Chamados RPA, 'criado' é a data de abertura do chamado.
export function refDate(item) {
  return item.dtFim || item.criado || null;
}

// ─── Filtro global de período ────────────────────────────────────────────────
// Cada fonte tem uma data diferente que faz sentido:
//   Pipefy Melhorias: DataConclusaoRealDesenvolvimento
//   Projetos: PrazoConclusão
//   Analytics: DataAbertura ou DataFechamento
//   Chamados RPA: criado
//   Inventário de Bots: NÃO filtra por data — usa AnoPRD separadamente
//
// ATENÇÃO: itens sem data ficam FORA do filtro quando ele está ativo.
// Isso é intencional — exibimos o aviso na interface. Nunca inventamos zero.

// Retorna true se uma data isolada passa no filtro ativo.
export function inDateRange(d) {
  const dr = App.dateRange;
  if (dr.mode === 'all') return true;
  if (!d) return false;
  if (dr.from && d < dr.from) return false;
  if (dr.to && d > dr.to) return false;
  return true;
}

// Verifica se um item esteve ATIVO durante o período do filtro,
// considerando um intervalo [inicio, fim] em vez de uma data única.
// Retorna 'in' | 'out' | 'nodate'.
export function activeInRange(ini, fim) {
  const dr = App.dateRange;
  if (dr.mode === 'all') return 'in';
  if (!ini && !fim) return 'nodate';
  const fFrom = dr.from || new Date(-8640000000000000);
  const fTo   = dr.to   || new Date(8640000000000000);
  const iIni = ini || fim;
  const iFim = fim || HOJE;
  // sobreposição de intervalos: item começa antes do fim do filtro E termina depois do início
  return (iIni <= fTo && iFim >= fFrom) ? 'in' : 'out';
}

// Aplica o filtro de data a um array.
// Retorna { kept: [...itens que passaram], noDate: N (quantidade sem data) }.
// Itens com dtInicio usam lógica de "ativo no período"; demais usam refDate.
export function applyDate(arr) {
  if (App.dateRange.mode === 'all') return { kept: arr, noDate: 0 };
  const kept = [], noDate = [];
  arr.forEach(x => {
    if (x.dtInicio !== undefined) {
      const r = activeInRange(x.dtInicio, x.dtFim);
      if (r === 'nodate') noDate.push(x);
      else if (r === 'in') kept.push(x);
    } else {
      const d = refDate(x);
      if (!d) noDate.push(x);
      else if (inDateRange(d)) kept.push(x);
    }
  });
  return { kept, noDate: noDate.length };
}
