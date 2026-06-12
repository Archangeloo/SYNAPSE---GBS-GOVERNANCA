import { App } from '../state.js';
import { findSheet, get } from '../utils/helpers.js';
import { toDate, ym } from '../utils/date.js';

// ─── MÓDULO: parsers/rpa.js ──────────────────────────────────────────────────
// Parser do relatório de chamados RPA + Inventário de Bots.
//
// Exporta:
//   parseRPA()            — chamados de manutenção → App.R
//   parseInv()            — inventário de bots     → App.B
//   enrichRPAComArea()    — associa área a cada chamado (match bot × chamado)
//   areaPorPalavra(proc)  — regra de fallback: área pelo nome do processo
//
// NOTA sobre nomes em inglês em areaPorPalavra():
//   Os processos no Pipefy têm nomes em inglês (BankStatement, PaymentRun…)
//   porque seguem a nomenclatura internacional do ERP SAP usado pelo grupo.
//   As strings de comparação devem permanecer em inglês para casar com os dados.
// ─────────────────────────────────────────────────────────────────────────────

// ─── parseRPA ─────────────────────────────────────────────────────────────────
// Processa o relatório de chamados de manutenção RPA (export do Pipefy).
//
// DETECÇÃO AUTOMÁTICA DE ABA:
//   O arquivo pode ter várias abas (histórico de exports, múltiplos relatórios).
//   Em vez de assumir que é a primeira aba, avaliamos cada uma com um sistema
//   de pontuação: cada coluna esperada encontrada vale +1 ponto.
//
//   Colunas que buscamos:
//     "código"          → identifica o chamado (obrigatório)
//     "fase atual"      → status do chamado no fluxo
//     "processo"        → bot relacionado
//     "qual é o problema" → tipo de ocorrência
//     "criado em"       → data de abertura
//
//   A aba que tiver mais pontos (≥ 2) é a escolhida.
//   Score < 2 significa que o arquivo não parece um relatório de chamados.
export function parseRPA() {
  const wb = App.rpa;
  App.rpaWarn = '';

  // ── Encontra a aba mais provável de ser o relatório de chamados ────────────
  let melhorAba = null, melhorScore = -1;

  wb.SheetNames.forEach(sn => {
    // Lê só as 3 primeiras linhas para verificar os cabeçalhos (mais rápido)
    const sample = XLSX.utils.sheet_to_json(wb.Sheets[sn], { defval: '' }).slice(0, 3);
    if (!sample.length) return;

    const cols = Object.keys(sample[0]).map(c => c.trim().toLowerCase());
    let score  = 0;

    // Cada coluna esperada encontrada soma 1 ponto
    if (cols.some(c => c === 'código' || c === 'codigo'))         score++;
    if (cols.some(c => c === 'fase atual'))                       score++;
    if (cols.some(c => c === 'processo'))                         score++;
    if (cols.some(c => c.includes('qual é o problema')))          score++;
    if (cols.some(c => c === 'criado em'))                        score++;

    if (score > melhorScore) { melhorScore = score; melhorAba = sn; }
  });

  // Se nenhuma aba atingiu o mínimo de 2 colunas esperadas, arquivo errado
  if (melhorScore < 2) {
    App.R = [];
    App.rpaWarn = 'O arquivo carregado no campo "Chamados RPA" não parece ser um relatório de chamados de manutenção (faltam colunas como Código, Fase atual, Processo). Verifique se subiu o arquivo certo.';
    return;
  }

  // ── Normaliza cada linha em um objeto padronizado ──────────────────────────
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[melhorAba], { defval: '' });

  App.R = rows.map(r => {
    const criado = toDate(get(r, ['Criado em']));

    // O campo "Vencido" pode vir como boolean (true/false) ou string ("Sim"/"True")
    const vencRaw = get(r, ['Vencido']);
    const venc    = vencRaw === true || String(vencRaw).toLowerCase() === 'true' || String(vencRaw).toLowerCase() === 'sim';

    return {
      cod:         String(get(r, ['Código', 'Codigo'])).trim(),
      titulo:      String(get(r, ['Título', 'Titulo'])).trim(),
      fase:        String(get(r, ['Fase atual'])).trim(),
      processo:    String(get(r, ['Processo'])).trim() || '(sem processo)',
      problema:    String(get(r, ['Qual é o problema?'])).trim(),
      reexec:      String(get(r, ['Este robô admite reexecução?'])).trim(),
      solicitante: String(get(r, ['Nome do solicitante'])).trim(),
      // Responsáveis: campo multi-valor separado por vírgula (vários podem trabalhar no mesmo chamado)
      responsaveis: String(get(r, ['Responsáveis', 'Responsável']))
        .split(',').map(s => s.trim()).filter(Boolean),
      criado,
      mes: ym(criado), // string "YYYY-MM" para agrupamento mensal
      // dow: dia da semana (0=Segunda…6=Domingo). getDay() retorna 0=Dom, então (+6)%7 converte.
      dow: criado ? (criado.getDay() + 6) % 7 : -1,
      finalizado: toDate(get(r, ['Finalizado em'])),
      vencido:    venc,
      // Tempos em dias por fase do chamado (podem ser null se o chamado ainda não passou pela fase)
      tIdent:  parseFloat(get(r, ['Tempo total na fase Identificação do problema (dias)'])) || null,
      tDesenv: parseFloat(get(r, ['Tempo total na fase Desenvolvimento da solução (dias)'])) || null,
      tReexec: parseFloat(get(r, ['Tempo total na fase Reexecução (dias)'])) || null
    };
  }).filter(r => r.cod); // descarta linhas vazias (exportações do Pipefy costumam ter linhas-lixo no final)
}

// ─── parseInv ─────────────────────────────────────────────────────────────────
// Processa a aba Inventario_RPA da base de governança → App.B (bots).
//
// FILTRO DE DATA DIFERENTE:
//   Bots não têm uma "data de ação" — eles têm um "AnoPRD" (ano em que foram
//   ao ar em produção). Por isso o filtro global de período usa o ano, não uma
//   data completa, e é aplicado em buildBots() em vez de applyDate().
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
    status:      String(get(r, ['Status', 'STATUS'])).trim().toUpperCase(), // padroniza em maiúsculas
    anoPrd:      get(r, ['AnoPRD', 'ANO PRD']),
    desc:        String(get(r, ['Descricao', 'DESCRIÇÃO'])).trim(),
    dev:         String(get(r, ['Desenvolvedor', 'DESENVOLVEDOR'])).trim(),
    suporte:     String(get(r, ['Suporte', 'SUPORTE / SUSTENTAÇÃO'])).trim(),
    // parseInt para garantir que seja número (pode vir como string "3")
    criticidade: (() => { const v = get(r, ['Criticidade', 'CRITICIDADE']); const n = parseInt(v); return isNaN(n) ? null : n; })(),
    freq:        String(get(r, ['Frequencia', 'FREQUENCIA', 'Frequência'])).trim().toLowerCase(),
    fte:         parseFloat(get(r, ['FTE'])) || 0,
    vol:         parseFloat(get(r, ['VolumetriaMensal', 'VOLUMETRIA MENSAL'])) || 0,
    nBots:       parseFloat(get(r, ['NumeroBots', 'NUMERO DE BOTS'])) || 0,
    areaCliente: String(get(r, ['AreaCliente', 'AREA CLIENTE'])).trim(),
    sap:         String(get(r, ['SAP'])).trim()
  })).filter(b => b.nome); // descarta linhas sem nome de bot (linhas-lixo)
}

// ─── enrichRPAComArea ─────────────────────────────────────────────────────────
// Enriquece cada chamado RPA com a área do bot (P2P, O2C, H2R, TAX, R2R).
//
// DUAS CAMADAS DE ENRIQUECIMENTO:
//
//   1ª CAMADA — Match contra o Inventário de Bots:
//     Normaliza o nome do processo do chamado e o nome do bot para letras
//     minúsculas sem pontuação. Se o nome do processo está contido no nome do
//     bot (ou vice-versa), considera um match e copia a área do bot.
//
//     Por que busca em AMBAS as direções (inclui A em B ou B em A)?
//       Os nomes no Pipefy podem ser mais curtos que no inventário, ou o
//       contrário. "PaymentRun" pode aparecer como "Payment Run SAP Biz" no
//       inventário — a busca bidirecional captura os dois casos.
//
//   2ª CAMADA — Regras por palavra-chave (areaPorPalavra):
//     Para processos que têm nomes muito diferentes do inventário, usamos
//     regras explícitas baseadas em palavras-chave dos nomes dos processos.
//
//   Se nenhuma camada encontrar, a área fica "(não mapeada)".
export function enrichRPAComArea() {
  if (!App.R.length) return;

  // Normaliza um nome: minúsculas, remove prefixo "[P2P]" etc., remove pontuação
  const norm = s => s.toLowerCase().replace(/^\[.*?\]/, '').replace(/[^a-z0-9]/g, '');

  // Monta índice dos bots que têm área definida para busca rápida
  const botAreas = App.B.filter(b => b.nome && b.area).map(b => ({ n: norm(b.nome), area: b.area }));

  App.R.forEach(r => {
    const pn  = norm(r.processo); // nome normalizado do processo no chamado
    let area  = '';

    // 1ª camada: tenta match contra o inventário
    if (pn && botAreas.length) {
      const hit = botAreas.find(b => b.n && (b.n.includes(pn) || pn.includes(b.n)));
      if (hit) area = hit.area;
    }

    // 2ª camada: fallback por palavra-chave
    if (!area) area = areaPorPalavra(r.processo);

    r.area = area || '(não mapeada)';
  });
}

// ─── areaPorPalavra ───────────────────────────────────────────────────────────
// Regras de fallback: identifica a área pelo nome do processo quando o match
// com o inventário falha. Nomes em inglês porque são os nomes dos processos no SAP.
export function areaPorPalavra(proc) {
  const t = (proc || '').toLowerCase();

  // P2P — Procure to Pay (contas a pagar, pagamentos, conciliações bancárias)
  if (t.includes('bank statement'))                               return 'P2P';
  if (t.includes('payment run'))                                  return 'P2P';
  if (t.includes('payment order'))                                return 'P2P';
  if (t.includes('payments receipt') || t.includes('payment receipt')) return 'P2P';
  if (t.includes('exchange rate') || t.includes('exchange contract'))  return 'P2P';
  if (t.includes('reserve of values'))                            return 'P2P';
  if (t.includes('freight'))                                      return 'P2P';

  // TAX — impostos e obrigações fiscais
  if (t.includes('tax conciliation') || t.includes('tax checking') ||
      t.includes('tax payment')      || t.includes('indirect tax') ||
      t.includes('direct tax'))                                   return 'TAX';

  // H2R — Hire to Retire (RH, folha de pagamento, benefícios)
  if (t.includes('vacation') || t.includes('payroll') ||
      t.includes('employee') || t.includes('benefit'))            return 'H2R';

  // O2C — Order to Cash (faturamento, crédito, recebíveis)
  if (t.includes('credit limit') || t.includes('settlement statement')) return 'O2C';

  return ''; // não identificada por palavra-chave
}
