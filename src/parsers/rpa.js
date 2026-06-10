import { App } from '../state.js';
import { findSheet, get } from '../utils/helpers.js';
import { toDate, ym } from '../utils/date.js';

// ─── parseRPA ─────────────────────────────────────────────────────────────────
// Processa o relatório de chamados de manutenção RPA (export do Pipefy).
// Robusto: procura a aba correta entre todas (pode não ser a primeira), valida
// colunas esperadas, descarta linhas-lixo (sem código real).
// Se o arquivo não parecer um relatório de chamados, registra App.rpaWarn.
export function parseRPA() {
  const wb = App.rpa;
  App.rpaWarn = '';

  // Escolhe a aba com mais "cara" de relatório de chamados
  let melhorAba = null, melhorScore = -1;
  wb.SheetNames.forEach(sn => {
    const sample = XLSX.utils.sheet_to_json(wb.Sheets[sn], { defval: '' }).slice(0, 3);
    if (!sample.length) return;
    const cols = Object.keys(sample[0]).map(c => c.trim().toLowerCase());
    let score = 0;
    if (cols.some(c => c === 'código' || c === 'codigo')) score++;
    if (cols.some(c => c === 'fase atual')) score++;
    if (cols.some(c => c === 'processo')) score++;
    if (cols.some(c => c.includes('qual é o problema'))) score++;
    if (cols.some(c => c === 'criado em')) score++;
    if (score > melhorScore) { melhorScore = score; melhorAba = sn; }
  });

  if (melhorScore < 2) {
    App.R = [];
    App.rpaWarn = 'O arquivo carregado no campo "Chamados RPA" não parece ser um relatório de chamados de manutenção (faltam colunas como Código, Fase atual, Processo). Verifique se subiu o arquivo certo.';
    return;
  }

  const rows = XLSX.utils.sheet_to_json(wb.Sheets[melhorAba], { defval: '' });
  App.R = rows.map(r => {
    const criado = toDate(get(r, ['Criado em']));
    const vencRaw = get(r, ['Vencido']);
    const venc = vencRaw === true || String(vencRaw).toLowerCase() === 'true' || String(vencRaw).toLowerCase() === 'sim';
    return {
      cod:         String(get(r, ['Código', 'Codigo'])).trim(),
      titulo:      String(get(r, ['Título', 'Titulo'])).trim(),
      fase:        String(get(r, ['Fase atual'])).trim(),
      processo:    String(get(r, ['Processo'])).trim() || '(sem processo)',
      problema:    String(get(r, ['Qual é o problema?'])).trim(),
      reexec:      String(get(r, ['Este robô admite reexecução?'])).trim(),
      solicitante: String(get(r, ['Nome do solicitante'])).trim(),
      // Responsáveis = equipe CoE que trabalha no chamado (pode ser vários)
      responsaveis: String(get(r, ['Responsáveis', 'Responsável']))
        .split(',').map(s => s.trim()).filter(Boolean),
      criado, mes: ym(criado),
      dow: criado ? (criado.getDay() + 6) % 7 : -1,
      finalizado: toDate(get(r, ['Finalizado em'])),
      vencido: venc,
      tIdent:  parseFloat(get(r, ['Tempo total na fase Identificação do problema (dias)'])) || null,
      tDesenv: parseFloat(get(r, ['Tempo total na fase Desenvolvimento da solução (dias)'])) || null,
      tReexec: parseFloat(get(r, ['Tempo total na fase Reexecução (dias)'])) || null
    };
  }).filter(r => r.cod); // descarta linhas sem código (linhas vazias de exportação)
}

// ─── parseInv ─────────────────────────────────────────────────────────────────
// Processa a aba Inventario_RPA da base de governança.
// FILTRO DE DATA DIFERENTE: usa AnoPRD (ano de entrada em produção), não uma
// data de ação. Aplicado diretamente em buildBots() em vez de applyDate().
export function parseInv() {
  const wb = App.gov;
  if (!wb) { App.B = []; return; }
  const sn = findSheet(wb, 'inventariorpa') || findSheet(wb, 'inventario');
  if (!sn) { App.B = []; return; }
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { defval: '' });
  App.B = rows.map(r => ({
    nome:        String(get(r, ['NomeRPA', 'NOME DO RPA', 'Nome do RPA'])).trim(),
    perimetro:   String(get(r, ['Perimetro', 'PERIMETRO', 'Perímetro'])).trim(),
    area:        String(get(r, ['Area', 'AREA', 'Área'])).trim(),
    status:      String(get(r, ['Status', 'STATUS'])).trim().toUpperCase(),
    anoPrd:      get(r, ['AnoPRD', 'ANO PRD']),
    desc:        String(get(r, ['Descricao', 'DESCRIÇÃO'])).trim(),
    dev:         String(get(r, ['Desenvolvedor', 'DESENVOLVEDOR'])).trim(),
    suporte:     String(get(r, ['Suporte', 'SUPORTE / SUSTENTAÇÃO'])).trim(),
    criticidade: (() => { const v = get(r, ['Criticidade', 'CRITICIDADE']); const n = parseInt(v); return isNaN(n) ? null : n; })(),
    freq:        String(get(r, ['Frequencia', 'FREQUENCIA', 'Frequência'])).trim().toLowerCase(),
    fte:         parseFloat(get(r, ['FTE'])) || 0,
    vol:         parseFloat(get(r, ['VolumetriaMensal', 'VOLUMETRIA MENSAL'])) || 0,
    nBots:       parseFloat(get(r, ['NumeroBots', 'NUMERO DE BOTS'])) || 0,
    areaCliente: String(get(r, ['AreaCliente', 'AREA CLIENTE'])).trim(),
    sap:         String(get(r, ['SAP'])).trim()
  })).filter(b => b.nome);
}

// ─── Enriquecimento de área nos chamados RPA ──────────────────────────────────
// Associa a cada chamado RPA a área (P2P, O2C, etc.) usando duas camadas:
//   1ª) Cruzamento com o Inventário de Bots por match aproximado de nomes
//   2ª) Regras por palavra-chave para processos que diferem do inventário
// Chamado após parseRPA() e parseInv().
export function enrichRPAComArea() {
  if (!App.R.length) return;
  const norm = s => s.toLowerCase().replace(/^\[.*?\]/, '').replace(/[^a-z0-9]/g, '');
  const botAreas = App.B.filter(b => b.nome && b.area).map(b => ({ n: norm(b.nome), area: b.area }));
  App.R.forEach(r => {
    const pn = norm(r.processo);
    let area = '';
    if (pn && botAreas.length) {
      const hit = botAreas.find(b => b.n && (b.n.includes(pn) || pn.includes(b.n)));
      if (hit) area = hit.area;
    }
    if (!area) area = areaPorPalavra(r.processo);
    r.area = area || '(não mapeada)';
  });
}

// Regras de fallback por palavra-chave (recupera processos cujo nome no Pipefy
// difere do inventário de bots).
export function areaPorPalavra(proc) {
  const t = (proc || '').toLowerCase();
  if (t.includes('bank statement')) return 'P2P';
  if (t.includes('payment run')) return 'P2P';
  if (t.includes('payment order')) return 'P2P';
  if (t.includes('payments receipt') || t.includes('payment receipt')) return 'P2P';
  if (t.includes('exchange rate') || t.includes('exchange contract')) return 'P2P';
  if (t.includes('reserve of values')) return 'P2P';
  if (t.includes('freight')) return 'P2P';
  if (t.includes('tax conciliation') || t.includes('tax checking') || t.includes('tax payment') || t.includes('indirect tax') || t.includes('direct tax')) return 'TAX';
  if (t.includes('vacation') || t.includes('payroll') || t.includes('employee') || t.includes('benefit')) return 'H2R';
  if (t.includes('credit limit') || t.includes('settlement statement')) return 'O2C';
  return '';
}
