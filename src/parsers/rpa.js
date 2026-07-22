// parsers/rpa.js — parser do relatório de chamados de manutenção RPA (App.planilhaRPA), mais o
// enriquecimento de área que liga cada chamado de volta ao inventário de bots.

import { App } from '../state.js';
import { buscarAba, obterValorColuna, normalizarNomeBot, nomesBatem } from '../utils/helpers.js';
import { paraData, paraChaveAnoMes } from '../utils/date.js';

/*
 * interpretarRPA() — processa o relatório de chamados de manutenção RPA (exportação do Pipefy).
 * ROBUSTO: procura a aba certa entre todas (pode não ser a primeira), valida que ela
 * tem as colunas esperadas, e descarta linhas de lixo (sem identificador real).
 * Se o arquivo não parecer um relatório de chamados, grava um aviso em App.avisoRPA
 * e deixa App.chamadosRPA vazio (em vez de gerar centenas de linhas de lixo).
 *
 * Lê:      App.planilhaRPA (planilha carregada pelo usuário via SheetJS)
 * Escreve: App.chamadosRPA → chamados RPA normalizados
 * Chamada por: gerarDashboard()
 *
 * DETECÇÃO AUTOMÁTICA DE ABA:
 *   Testa cada aba do arquivo e escolhe a que tem colunas típicas de chamado
 *   (Código, Processo, Fase…). Se nenhuma aba parecer um relatório de chamados,
 *   grava App.avisoRPA e deixa App.chamadosRPA vazio — evita gerar lixo na tela.
 *
 * CAMPOS CALCULADOS:
 *   - mes:    string "YYYY-MM" derivada de criado, pro agrupamento mensal
 *   - vencido: true se a fase não é "Concluído" e criado é > 30 dias atrás
 *   - diasIdentificacao / diasDesenvolvimento / diasReexecucao: dias em cada fase
 *     (calculados a partir das colunas de data de entrada/saída de fase, se disponíveis)
 *   - area: preenchido depois por enriquecerRPAComArea() via match de nome contra App.bots
 */
export function interpretarRPA(){
  const wb = App.planilhaRPA;
  App.avisoRPA = '';
  // Procura a aba que parece guardar os chamados: precisa ter colunas características.
  // Testa cada aba e escolhe a que mais parece um relatório de chamados.
  let melhorAba = null, melhorScore = -1;
  wb.SheetNames.forEach(sn => {
    const sample = XLSX.utils.sheet_to_json(wb.Sheets[sn], {defval:''}).slice(0,3);
    if(!sample.length) return;
    const cols = Object.keys(sample[0]).map(c => c.trim().toLowerCase());
    // colunas que identificam um relatório de chamados do Pipefy
    let score = 0;
    if(cols.some(c=>c==='código'||c==='codigo')) score++;
    if(cols.some(c=>c==='fase atual')) score++;
    if(cols.some(c=>c==='processo')) score++;
    if(cols.some(c=>c.includes('qual é o problema'))) score++;
    if(cols.some(c=>c==='criado em')) score++;
    if(score > melhorScore){ melhorScore = score; melhorAba = sn; }
  });

  // precisa bater pelo menos 2 colunas características pra ser considerada válida
  if(melhorScore < 2){
    App.chamadosRPA = [];
    App.avisoRPA = 'O arquivo carregado no campo "Chamados RPA" não parece ser um relatório de chamados de manutenção (faltam colunas como Código, Fase atual, Processo). Verifique se subiu o arquivo certo.';
    return;
  }

  const rows = XLSX.utils.sheet_to_json(wb.Sheets[melhorAba], {defval:''});
  App.chamadosRPA = rows.map(r => {
    const criado = paraData(obterValorColuna(r, ['Criado em']));
    const vencRaw = obterValorColuna(r, ['Vencido']);
    const venc = vencRaw===true || String(vencRaw).toLowerCase()==='true' || String(vencRaw).toLowerCase()==='sim';
    return {
      codigo:      String(obterValorColuna(r, ['Código','Codigo'])).trim(),
      titulo:      String(obterValorColuna(r, ['Título','Titulo'])).trim(),
      fase:        String(obterValorColuna(r, ['Fase atual'])).trim(),
      processo:    String(obterValorColuna(r, ['Processo'])).trim() || '(sem processo)',
      problema:    String(obterValorColuna(r, ['Qual é o problema?'])).trim(),
      admiteReexecucao: String(obterValorColuna(r, ['Este robô admite reexecução?'])).trim(),
      internoExterno:   String(obterValorColuna(r, ['O problema é interno ou externo?', 'Interno ou externo?', 'Causa interna ou externa?', 'Causa interna/externa'])).trim(),
      solicitante: String(obterValorColuna(r, ['Nome do solicitante'])).trim(),
      // "Responsáveis" = quem trabalha no chamado (time CoE de RPA), não quem abriu.
      // Pode ter vários nomes separados por vírgula; guardamos como lista pra
      // poder contar cada responsável individualmente.
      responsaveis: String(obterValorColuna(r, ['Responsáveis','Responsável']))
        .split(',').map(s=>s.trim()).filter(Boolean),
      criado,
      dataInicio: criado,                            // Criado em → início do intervalo
      dataFim:    paraData(obterValorColuna(r, ['Finalizado em'])), // Finalizado em → fim do intervalo
      mes: paraChaveAnoMes(criado),
      finalizado: paraData(obterValorColuna(r, ['Finalizado em'])), // alias pra exibição
      vencido:    venc,
      diasIdentificacao:  parseFloat(obterValorColuna(r, ['Tempo total na fase Identificação do problema (dias)']))||null,
      diasDesenvolvimento:parseFloat(obterValorColuna(r, ['Tempo total na fase Desenvolvimento da solução (dias)']))||null,
      diasReexecucao:      parseFloat(obterValorColuna(r, ['Tempo total na fase Reexecução (dias)']))||null
    };
  // FILTRO DE LIXO: mantém só linhas que têm um código real (chamados sempre têm código).
  // Isso evita contar linhas em branco ou de rodapé que algumas exportações incluem.
  }).filter(r => r.codigo);
}

/*
 * areaPorPalavraChave(proc) — regras de fallback por palavra-chave, usadas por
 * enriquecerRPAComArea() quando o nome de um processo não bate com o inventário de bots.
 * ex. "Bank Statements"/"Payment Run" → P2P, "Tax ..." → TAX, etc.
 */
export function areaPorPalavraChave(proc){
  const nomeProc = (proc||'').toLowerCase();
  // P2P — pagamentos, extratos bancários, câmbio
  if(nomeProc.includes('bank statement')) return 'P2P';
  if(nomeProc.includes('payment run')) return 'P2P';
  if(nomeProc.includes('payment order')) return 'P2P';
  if(nomeProc.includes('payments receipt') || nomeProc.includes('payment receipt')) return 'P2P';
  if(nomeProc.includes('exchange rate') || nomeProc.includes('exchange contract')) return 'P2P';
  if(nomeProc.includes('reserve of values')) return 'P2P';
  if(nomeProc.includes('freight')) return 'P2P';
  // TAX — impostos
  if(nomeProc.includes('tax conciliation') || nomeProc.includes('tax checking') || nomeProc.includes('tax payment') || nomeProc.includes('indirect tax') || nomeProc.includes('direct tax')) return 'TAX';
  // H2R — RH / folha / benefícios
  if(nomeProc.includes('vacation') || nomeProc.includes('payroll') || nomeProc.includes('employee') || nomeProc.includes('benefit')) return 'H2R';
  // O2C — crédito / faturamento
  if(nomeProc.includes('credit limit') || nomeProc.includes('settlement statement')) return 'O2C';
  return '';
}

/*
 * enriquecerRPAComArea() — atribui a cada chamado RPA sua área (P2P, O2C, etc.).
 * Chamados não têm campo de área, só o nome do Processo. Usa duas camadas:
 *   1ª) Cruzamento com o Inventário de Bots: match aproximado de nome
 *       (um contém o outro, depois de normalizado) pra herdar a área do bot.
 *   2ª) Se o cruzamento falhar, regras por palavra-chave (areaPorPalavraChave):
 *       recupera processos cujo nome no Pipefy é diferente do inventário.
 * O que não bate em nenhuma camada recebe '(não mapeada)' — tipicamente
 * chamados com o campo Processo vazio. Chamar DEPOIS de interpretarRPA() e interpretarInventario().
 */
export function enriquecerRPAComArea(){
  if(!App.chamadosRPA.length) return;
  const botAreas = App.bots.filter(b=>b.nome && b.area).map(b => ({nomeNorm: normalizarNomeBot(b.nome), area:b.area}));
  App.chamadosRPA.forEach(r => {
    const procNorm = normalizarNomeBot(r.processo);
    let area = '';
    // 1ª camada: cruzamento com o inventário de bots
    if(procNorm && botAreas.length){
      const hit = botAreas.find(b => nomesBatem(b.nomeNorm, procNorm));
      if(hit) area = hit.area;
    }
    // 2ª camada: regras por palavra-chave (recupera nomes diferentes do inventário)
    if(!area) area = areaPorPalavraChave(r.processo);
    r.area = area || '(não mapeada)';
  });
}
