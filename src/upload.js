// ─── MODULE: upload.js ─────────────────────────────────────────────────────
// FILE UPLOAD
// Drag & drop and file-input handling for the two Excel sources (Governance
// base and RPA ticket report), using SheetJS (XLSX, loaded globally via CDN)
// to parse the binary into a workbook stored on App.gov / App.rpa.
// ─────────────────────────────────────────────────────────────────────────────

import { App } from './state.js';

// Drag & drop: drag-over (over), drag-leave (leave), drop events
export function handleDropzoneDragOver(event,id){ event.preventDefault(); document.getElementById(id).classList.add('over'); }
export function handleDropzoneDragLeave(id){ document.getElementById(id).classList.remove('over'); }
export function handleDropzoneDrop(event,type){
  event.preventDefault();
  document.getElementById('dz-'+type).classList.remove('over');
  const file = event.dataTransfer.files[0];
  if(file) readFile(file, type);
}

// File input handler (click on the file selection button)
export function handleFileInputChange(input,type){ if(input.files[0]) readFile(input.files[0], type); }

/*
 * Reads an Excel (.xlsx) file from disk using FileReader.
 * Uses the SheetJS (XLSX) library to parse the binary.
 * cellDates:true makes SheetJS return native Date objects (not Excel serials).
 * After reading, stores the workbook in App.gov or App.rpa depending on the type.
 */
export function readFile(file, type){
  const reader = new FileReader();
  reader.onload = e => {
    const wb = XLSX.read(new Uint8Array(e.target.result), {type:'array', cellDates:true});
    if(type === 'gov') App.gov = wb;
    else App.rpa = wb;
    App.loaded[type] = true;
    showOk(type, file.name, wb);
    updateBar();
  };
  reader.readAsArrayBuffer(file);
}

/*
 * Updates the upload card's UI after a successful read.
 * For the governance base, checks which expected tabs were found
 * and shows green/yellow badges for each one.
 */
function showOk(type, name, wb){
  document.getElementById('ok-'+type).classList.add('show');
  document.getElementById('uc-'+type).classList.add('loaded');
  document.getElementById('fn-'+type).textContent = name;
  const tg = document.getElementById('tg-'+type);
  tg.classList.add('show');
  if(type === 'gov'){
    const found = wb.SheetNames;
    const want = ['Pipefy_Melhorias','Projetos','Analytics','Inventario_RPA'];
    // shows the tabs found
    let html = '<b>Abas lidas:</b> ' + want.map(w => {
      const ok = found.some(f => f.toLowerCase().replace(/[_ ]/g,'').includes(w.toLowerCase().replace(/[_ ]/g,'')));
      return `<span class="badge ${ok?'ok':'warn'}" style="margin:2px">${w}${ok?'':' (?)'}</span>`;
    }).join('');
    // Pipefy_Melhorias column diagnostics — helps identify the correct date column name
    const sMel = found.find(f => f.toLowerCase().replace(/[_ ]/g,'').includes('pipefymelhorias') || f.toLowerCase().replace(/[_ ]/g,'').includes('melhorias'));
    if(sMel){
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[sMel], {defval:''});
      if(rows.length){
        const cols = Object.keys(rows[0]);
        const dateCols = cols.filter(c => /data|criado|created|inicio|abertura|planejamento|conclus/i.test(c));
        html += `<br><details style="margin-top:6px"><summary style="font-size:10px;color:var(--ink3);cursor:pointer">🔍 Colunas de data encontradas em Pipefy_Melhorias (clique)</summary>
          <div style="font-size:10px;color:var(--ink2);margin-top:4px;line-height:2">
            ${dateCols.length ? dateCols.map(c => `<code style="background:var(--paper);padding:1px 4px;border-radius:3px">${c}</code>`).join('  ') : '<i>Nenhuma coluna com "data", "criado", "início" ou "conclusão" encontrada.</i>'}
          </div></details>`;
      }
    }
    tg.innerHTML = html;
  } else {
    // for the RPA report, shows the tab name and total tickets
    const sheet    = wb.Sheets[wb.SheetNames[0]];
    const rowCount = XLSX.utils.sheet_to_json(sheet, {defval:''}).length;
    tg.innerHTML = `<b>Aba lida:</b> <span class="badge ok" style="margin:2px">${wb.SheetNames[0]} · ${rowCount} chamados</span>`;
  }
}

/*
 * Updates the "X de 2 bases carregadas" counter and enables/disables the "Gerar dashboard" button.
 */
function updateBar(){
  const loadedCount = Object.values(App.loaded).filter(Boolean).length;
  document.getElementById('abar-status').innerHTML = `<strong style="color:var(--ink)">${loadedCount} de 2</strong> bases carregadas`;
  document.getElementById('btn-gen').disabled = loadedCount === 0;
}
