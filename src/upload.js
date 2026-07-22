// upload.js — upload de arquivo: drag & drop e input de arquivo pras duas planilhas
// Excel (base de Governança e relatório de chamados RPA), usando o SheetJS (XLSX,
// carregado globalmente via CDN) pra interpretar o binário e guardar a planilha em
// App.planilhaGovernanca / App.planilhaRPA.

import { App } from './state.js';

// Drag & drop: eventos de arrastar sobre (over), sair (leave) e soltar (drop)
export function tratarArrastarSobreDropzone(event,id){ event.preventDefault(); document.getElementById(id).classList.add('over'); }
export function tratarSairDropzone(id){ document.getElementById(id).classList.remove('over'); }
export function tratarSoltarDropzone(event,type){
  event.preventDefault();
  document.getElementById('dz-'+type).classList.remove('over');
  const file = event.dataTransfer.files[0];
  if(file) lerArquivo(file, type);
}

// Handler do input de arquivo (clique no botão de seleção de arquivo)
export function tratarMudancaArquivo(input,type){ if(input.files[0]) lerArquivo(input.files[0], type); }

/*
 * Lê um arquivo Excel (.xlsx) do disco usando FileReader.
 * Usa a biblioteca SheetJS (XLSX) pra interpretar o binário.
 * cellDates:true faz o SheetJS retornar objetos Date nativos (não seriais do Excel).
 * Depois de ler, guarda a planilha em App.planilhaGovernanca ou App.planilhaRPA
 * dependendo do tipo.
 */
export function lerArquivo(file, type){
  const reader = new FileReader();
  reader.onload = e => {
    const wb = XLSX.read(new Uint8Array(e.target.result), {type:'array', cellDates:true});
    if(type === 'gov') App.planilhaGovernanca = wb;
    else App.planilhaRPA = wb;
    App.carregado[type === 'gov' ? 'governanca' : 'rpa'] = true;
    mostrarSucesso(type, file.name, wb);
    atualizarBarra();
  };
  reader.readAsArrayBuffer(file);
}

/*
 * Atualiza a interface do card de upload depois de uma leitura bem-sucedida.
 * Pra base de governança, checa quais abas esperadas foram encontradas
 * e mostra badges verde/amarelo pra cada uma.
 */
function mostrarSucesso(type, name, wb){
  document.getElementById('ok-'+type).classList.add('show');
  document.getElementById('uc-'+type).classList.add('loaded');
  document.getElementById('fn-'+type).textContent = name;
  const tg = document.getElementById('tg-'+type);
  tg.classList.add('show');
  if(type === 'gov'){
    const found = wb.SheetNames;
    const want = ['Pipefy_Melhorias','Projetos','Analytics','Inventario_RPA'];
    // mostra as abas encontradas
    let html = '<b>Abas lidas:</b> ' + want.map(w => {
      const ok = found.some(f => f.toLowerCase().replace(/[_ ]/g,'').includes(w.toLowerCase().replace(/[_ ]/g,'')));
      return `<span class="badge ${ok?'ok':'warn'}" style="margin:2px">${w}${ok?'':' (?)'}</span>`;
    }).join('');
    // diagnóstico de colunas de Pipefy_Melhorias — ajuda a identificar o nome certo da coluna de data
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
    // pro relatório RPA, mostra o nome da aba e o total de chamados
    const sheet    = wb.Sheets[wb.SheetNames[0]];
    const rowCount = XLSX.utils.sheet_to_json(sheet, {defval:''}).length;
    tg.innerHTML = `<b>Aba lida:</b> <span class="badge ok" style="margin:2px">${wb.SheetNames[0]} · ${rowCount} chamados</span>`;
  }
}

/*
 * Atualiza o contador "X de 2 bases carregadas" e habilita/desabilita o botão "Gerar dashboard".
 */
function atualizarBarra(){
  const loadedCount = Object.values(App.carregado).filter(Boolean).length;
  document.getElementById('abar-status').innerHTML = `<strong style="color:var(--ink)">${loadedCount} de 2</strong> bases carregadas`;
  document.getElementById('btn-gen').disabled = loadedCount === 0;
}
