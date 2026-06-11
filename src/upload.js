import { App } from './state.js';

// ─── MÓDULO: upload.js ───────────────────────────────────────────────────────
// Gerencia o upload de arquivos Excel: drag-and-drop e seleção via input file.
// Usa FileReader + SheetJS (XLSX global injetado via CDN no index.html).
//
// Exporta:
//   dzO(e, id)       — drag-over: adiciona classe visual 'over'
//   dzL(id)          — drag-leave: remove classe 'over'
//   dzD(e, t)        — drag-drop: lê o arquivo solto
//   hf(i, t)         — handler do <input type="file">
//   readFile(f, type) — lê arquivo Excel e popula App.gov ou App.rpa
//   showOk(type, name, wb) — atualiza UI após leitura bem-sucedida
//   updateBar()      — atualiza contador de bases carregadas
// ─────────────────────────────────────────────────────────────────────────────

// ─── Drag & drop ──────────────────────────────────────────────────────────────
export function dzO(e, id)  { e.preventDefault(); document.getElementById(id).classList.add('over'); }
export function dzL(id)     { document.getElementById(id).classList.remove('over'); }
export function dzD(e, t)   {
  e.preventDefault();
  document.getElementById('dz-' + t).classList.remove('over');
  const f = e.dataTransfer.files[0];
  if (f) readFile(f, t);
}

// Handler do input file (clique no botão de seleção de arquivo)
export function hf(i, t) { if (i.files[0]) readFile(i.files[0], t); }

// ─── Leitura do arquivo Excel ─────────────────────────────────────────────────
// Usa FileReader + SheetJS (XLSX global injetado pela CDN no index.html).
// cellDates:true faz o SheetJS retornar objetos Date nativos.
export function readFile(file, type) {
  const rd = new FileReader();
  rd.onload = e => {
    const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array', cellDates: true });
    if (type === 'gov') App.gov = wb;
    else App.rpa = wb;
    App.loaded[type] = true;
    showOk(type, file.name, wb);
    updateBar();
  };
  rd.readAsArrayBuffer(file);
}

// Atualiza a UI do card de upload após leitura bem-sucedida.
// Para a base de governança, verifica quais abas esperadas foram encontradas.
export function showOk(type, name, wb) {
  document.getElementById('ok-' + type).classList.add('show');
  document.getElementById('uc-' + type).classList.add('loaded');
  document.getElementById('fn-' + type).textContent = name;
  const tg = document.getElementById('tg-' + type);
  tg.classList.add('show');
  if (type === 'gov') {
    const found = wb.SheetNames;
    const want = ['Pipefy_Melhorias', 'Projetos', 'Analytics', 'Inventario_RPA'];
    tg.innerHTML = '<b>Abas lidas:</b> ' + want.map(w => {
      const ok = found.some(f => f.toLowerCase().replace(/[_ ]/g, '').includes(w.toLowerCase().replace(/[_ ]/g, '')));
      return `<span class="badge ${ok ? 'ok' : 'warn'}" style="margin:2px">${w}${ok ? '' : ' (?)'}</span>`;
    }).join('');
  } else {
    const ws = wb.Sheets[wb.SheetNames[0]];
    const n = XLSX.utils.sheet_to_json(ws, { defval: '' }).length;
    tg.innerHTML = `<b>Aba lida:</b> <span class="badge ok" style="margin:2px">${wb.SheetNames[0]} · ${n} chamados</span>`;
  }
}

// Atualiza o contador "X de 2 bases carregadas" e habilita/desabilita o botão.
export function updateBar() {
  const n = Object.values(App.loaded).filter(Boolean).length;
  document.getElementById('abar-status').innerHTML = `<strong style="color:var(--ink)">${n} de 2</strong> bases carregadas`;
  document.getElementById('btn-gen').disabled = n === 0;
}
