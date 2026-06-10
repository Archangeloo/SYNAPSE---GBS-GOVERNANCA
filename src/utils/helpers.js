// ─── Helpers genéricos ────────────────────────────────────────────────────────

// Busca uma aba num workbook por fragmento de nome (insensível a maiúsculas,
// underlines e espaços). Ex: findSheet(wb, 'melhorias') → 'Pipefy_Melhorias'.
export function findSheet(wb, frag) {
  const f = frag.toLowerCase().replace(/[_ ]/g, '');
  return wb.SheetNames.find(s => s.toLowerCase().replace(/[_ ]/g, '').includes(f));
}

// Busca o valor de uma coluna numa linha do SheetJS, aceitando múltiplos nomes
// possíveis (porque o nome da coluna pode variar entre versões da planilha).
// Comparação insensível a maiúsculas e espaços extras. Retorna '' se não achar.
export function get(row, keys) {
  const rk = Object.keys(row);
  for (const k of keys) {
    for (const r of rk) {
      if (r.trim().toLowerCase() === k.toLowerCase()) {
        const v = row[r];
        return v == null ? '' : v;
      }
    }
  }
  return '';
}

// Conta a frequência de um valor em um array de objetos.
// fn: função que extrai a chave a contar (ex: r => r.frente)
// Retorna: { 'P2P': 42, 'O2C': 33, ... }
export function count(arr, fn) {
  const m = {};
  arr.forEach(x => { const k = fn(x) || '—'; m[k] = (m[k] || 0) + 1; });
  return m;
}

// Calcula percentual arredondado. Retorna 0 se divisor=0 (nunca divide por zero).
export function pct(a, b) {
  return b ? Math.round(a / b * 100) : 0;
}
