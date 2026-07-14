// ─── MODULE: parsers/gov.js ────────────────────────────────────────────────
// Parsers for the Governance Base workbook (App.gov): Pipefy_Melhorias,
// Projetos, Analytics and Inventario_RPA.
// ─────────────────────────────────────────────────────────────────────────────

import { App } from '../state.js';
import { findSheet, getColumnValue } from '../utils/helpers.js';
import { toDate } from '../utils/date.js';
import { classeStatus, classeStatusMelhoria } from '../utils/classify.js';

/*
 * parseGov() — parser for the Governance Base (main Excel file).
 *
 * Reads:  App.gov (workbook loaded by the user via SheetJS)
 * Writes: App.P.improvements → normalized Pipefy improvements
 *          App.P.proj → normalized projects
 *          App.P.ana  → normalized Analytics activities
 * Called by: generate()
 *
 * TOLERANCE FOR VARIATIONS:
 *   - Tab names: fragment search, case-insensitive and underline-insensitive
 *   - Column names: each field tries multiple alternative names (see getColumnValue())
 *   - Projects layout: automatically detects whether the header is correct
 *     or shuffled (old layout), and reads by position as a fallback
 *
 * To add a new field: add the column name to the array in getColumnValue()
 * and map it to the normalized field in the object returned by .map().
 */
export function parseGov(){
  const wb = App.gov;

  /* --- Pipefy_Melhorias --- */
  // Looks up the tab by name (flexible: accepts "pipefymelhorias" or "melhorias")
  const sMel = findSheet(wb,'pipefymelhorias') || findSheet(wb,'melhorias');
  App.P.improvements = sMel ? XLSX.utils.sheet_to_json(wb.Sheets[sMel], {defval:''}).map(r => ({
    num:      getColumnValue(r, ['Numero']),
    frente:   String(getColumnValue(r, ['Gerencia'])).trim(),      // business area (P2P, O2C, etc.)
    fluxo:    getColumnValue(r, ['NomeFluxo']),                    // process flow name
    atividade:getColumnValue(r, ['Atividade']),                    // improvement description
    statusRaw:String(getColumnValue(r, ['Status'])).trim(),        // original status (spreadsheet text)
    sc:       classeStatusMelhoria(getColumnValue(r, ['Status'])), // normalized status ("Planejamento" counts as 'doing' here)
    resp:     String(getColumnValue(r, ['Responsavel'])).trim().replace(/​/g,''), // owner's name
    champion: String(getColumnValue(r, ['Champion'])).trim(),
    complex:  String(getColumnValue(r, ['Complexidade'])).trim(),
    tipo:     String(getColumnValue(r, ['TipoMelhoriaAjuste'])).trim(),
    // PERIOD FILTER — one column per field, no fallback:
    //   dtInicio → DataInicioDesenvolvimento
    //   dtFim    → DataRealEstimadaConclusaoValidacaoChampion
    // Neither one filled in = not-started backlog → always included (see construirMelhorias).
    dtInicio: toDate(getColumnValue(r, ['DataInicioDesenvolvimento'])),
    dtFim:    toDate(getColumnValue(r, ['DataRealEstimadaConclusaoValidacaoChampion'])),
    horas:    getColumnValue(r, ['QtdHorasEstimadas'])
  })).filter(r => r.num !== '' || r.atividade) : []; // discards fully empty rows

  /* --- Projetos --- */
  const sProj = findSheet(wb,'projetos');
  App.P.proj = [];
  if(sProj){
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sProj], {defval:''});

    // VERSION DETECTION: checks whether the header is correct or shuffled.
    // Takes the first 5 rows and tests whether 'Status' contains recognizable values.
    // If no status is recognized, assumes the base is in the old layout (shuffled columns).
    const sample = rows.slice(0,5);
    const headerLooksRight = sample.some(r => classeStatus(getColumnValue(r,['Status'])) !== 'other');

    if(headerLooksRight){
      // NEW LAYOUT (Universal base): well-defined fields
      App.P.proj = rows.map(r => ({
        num:        getColumnValue(r, ['Numero']),
        titulo:     String(getColumnValue(r, ['Titulo'])).trim(),
        resp:       String(getColumnValue(r, ['Responsavel'])).trim(),
        // AreaCliente is the new field name; 'Frente' is the fallback for the old base
        frente:     String(getColumnValue(r, ['AreaCliente','Frente'])).trim(),
        focal:      String(getColumnValue(r, ['PontoFocal'])).trim(),
        statusRaw:  String(getColumnValue(r, ['Status'])).trim(),
        sc:         classeStatus(getColumnValue(r, ['Status'])),
        // PERIOD FILTER — reference: PrazoConclusão (there's no start date in the spreadsheet)
        dtFim:      toDate(getColumnValue(r, ['PrazoConclusão','PrazoConclusao','DataFechamento'])),
        proximos:   String(getColumnValue(r, ['ProximosPassos'])).trim(),
        // Rich fields — filled in on the Universal spreadsheet, shown when expanding a project in the list
        equipes:    String(getColumnValue(r, ['EquipesEnvolvidas'])).trim(),
        descricao:  String(getColumnValue(r, ['DescricaoProjeto'])).trim(),
        atvConcl:   String(getColumnValue(r, ['AtividadesConcluidas'])).trim(),
        atvAndam:   String(getColumnValue(r, ['AtividadesAndamento'])).trim(),
        comentarios:String(getColumnValue(r, ['Comentarios'])).trim(),
        prog: (()=>{
          const rawProg = getColumnValue(r, ['ProgressoPct','Progresso']);
          return typeof rawProg === 'number' ? rawProg : (parseFloat(rawProg)||null);
        })() // progress 0.0 to 1.0 (ex: 0.75 = 75%)
      })).filter(p => p.titulo); // discards rows without a title
    } else {
      // OLD SHUFFLED LAYOUT: the headers don't match the columns' actual content.
      // In this case we read by position (column index), not by header name.
      // Mapping discovered via direct inspection of the original spreadsheet:
      //   col0=Numero, col1=Titulo, col2=Responsavel(was in Status), col3=Frente(in Responsavel),
      //   col4=PontoFocal(in Frente), col5=Status(in PontoFocal), col6=DataFechamento, col7=ProximosPassos
      const raw = XLSX.utils.sheet_to_json(wb.Sheets[sProj], {defval:'', header:1});
      for(let i=1; i<raw.length; i++){
        const row = raw[i];
        if(row[0]==='' && row[1]==='') continue;
        if(!String(row[1]||'').trim()) continue;
        App.P.proj.push({
          num:row[0], titulo:String(row[1]).trim(), resp:String(row[2]||'').trim(),
          frente:String(row[3]||'').trim(), focal:String(row[4]||'').trim(),
          statusRaw:String(row[5]||'').trim(), sc:classeStatus(row[5]),
          dtFim:toDate(row[6]), proximos:String(row[7]||'').trim(),
          equipes:'', descricao:'', atvConcl:'', atvAndam:'', comentarios:'',
          prog: typeof row[8]==='number' ? row[8] : (parseFloat(row[8])||null)
        });
      }
    }
  }

  /* --- Analytics --- */
  const sAna = findSheet(wb,'analytics');
  App.P.ana = sAna ? XLSX.utils.sheet_to_json(wb.Sheets[sAna], {defval:''}).map(r => ({
    num:      getColumnValue(r, ['Numero']),
    titulo:   String(getColumnValue(r, ['Titulo'])).trim(),
    statusRaw:String(getColumnValue(r, ['Status'])).trim(),
    sc:       classeStatus(getColumnValue(r, ['Status'])),
    prioRaw:  String(getColumnValue(r, ['Prioridade'])).trim(),
    // extracts just the priority number (ex: "Prioridade 2" → 2)
    prio:     (()=>{ const match = String(getColumnValue(r,['Prioridade'])).match(/\d+/); return match ? +match[0] : null; })(),
    frente:   String(getColumnValue(r, ['Frente'])).trim(),
    resp:     String(getColumnValue(r, ['Responsavel'])).trim(),
    // dtInicio = DataAbertura (start); dtFim = DataFechamento (validation completion)
    // With dtInicio set, filtrarPorPeriodo uses ativoNoIntervalo — includes activities in progress during the period.
    dtInicio: toDate(getColumnValue(r, ['DataAbertura'])),
    dtFim:    toDate(getColumnValue(r, ['DataFechamento']))
  })).filter(r => r.titulo) : []; // discards rows without a title (ex: phantom rows from the source)
}

/*
 * parseInv() — processes the Inventario_RPA tab of the governance base.
 * This tab is the catalog of all the area's bots (RPA automations).
 * DIFFERENT DATE FILTER: here the filter uses AnoPRD (the year the bot went live),
 * not an action date. Implemented directly in buildBots().
 */
export function parseInv(){
  const wb = App.gov;
  if(!wb){ App.B = []; return; }
  const sn = findSheet(wb,'inventariorpa') || findSheet(wb,'inventario');
  if(!sn){ App.B = []; return; }
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], {defval:''});
  App.B = rows.map(r => ({
    nome:        String(getColumnValue(r, ['NomeRPA','NOME DO RPA','Nome do RPA'])).trim(),
    perimetro:   String(getColumnValue(r, ['Perimetro','PERIMETRO','Perímetro'])).trim(),
    area:        String(getColumnValue(r, ['Area','AREA','Área'])).trim(),
    status:      String(getColumnValue(r, ['Status','STATUS'])).trim().toUpperCase(), // PRD/DEV/BACKLOG/CANCELADO
    anoPrd:      getColumnValue(r, ['AnoPRD','ANO PRD']), // year the bot went live
    desc:        String(getColumnValue(r, ['Descricao','DESCRIÇÃO'])).trim(),
    dev:         String(getColumnValue(r, ['Desenvolvedor','DESENVOLVEDOR'])).trim(),
    suporte:     String(getColumnValue(r, ['Suporte','SUPORTE / SUSTENTAÇÃO'])).trim(),
    criticidade: (()=>{ const rawValue = getColumnValue(r,['Criticidade','CRITICIDADE']); const parsed = parseInt(rawValue); return isNaN(parsed)?null:parsed; })(),
    freq:        String(getColumnValue(r, ['Frequencia','FREQUENCIA','Frequência'])).trim().toLowerCase(),
    fte:         parseFloat(getColumnValue(r, ['FTE']))||0,               // FTEs saved by this bot
    vol:         parseFloat(getColumnValue(r, ['VolumetriaMensal','VOLUMETRIA MENSAL']))||0, // transactions/month
    nBots:       parseFloat(getColumnValue(r, ['NumeroBots','NUMERO DE BOTS']))||0,
    areaCliente: String(getColumnValue(r, ['AreaCliente','AREA CLIENTE'])).trim(),
    sap:         String(getColumnValue(r, ['SAP'])).trim()
  })).filter(b => b.nome);
}
