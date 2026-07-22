// parsers/gov.js — parsers da planilha Base de Governança (App.planilhaGovernanca):
// Pipefy_Melhorias, Projetos, Analytics e Inventario_RPA.

import { App } from '../state.js';
import { buscarAba, obterValorColuna } from '../utils/helpers.js';
import { paraData } from '../utils/date.js';
import { classeStatus, classeStatusMelhoria } from '../utils/classify.js';

/*
 * interpretarGov() — parser da Base de Governança (planilha Excel principal).
 *
 * Lê:      App.planilhaGovernanca (planilha carregada pelo usuário via SheetJS)
 * Escreve: App.dadosGovernanca.melhorias → melhorias Pipefy normalizadas
 *          App.dadosGovernanca.projetos → projetos normalizados
 *          App.dadosGovernanca.analytics  → atividades de Analytics normalizadas
 * Chamada por: gerarDashboard()
 *
 * TOLERÂNCIA A VARIAÇÕES:
 *   - Nome das abas: busca por fragmento, sem diferenciar maiúsculas/minúsculas ou underline
 *   - Nome das colunas: cada campo tenta vários nomes alternativos (ver obterValorColuna())
 *   - Layout de Projetos: detecta automaticamente se o cabeçalho está correto
 *     ou embaralhado (layout antigo), e lê por posição como fallback
 *
 * Pra adicionar um campo novo: acrescentar o nome da coluna no array de obterValorColuna()
 * e mapear pro campo normalizado no objeto retornado por .map().
 */
export function interpretarGov(){
  const wb = App.planilhaGovernanca;

  /* --- Pipefy_Melhorias --- */
  // Busca a aba pelo nome (flexível: aceita "pipefymelhorias" ou "melhorias")
  const sMel = buscarAba(wb,'pipefymelhorias') || buscarAba(wb,'melhorias');
  App.dadosGovernanca.melhorias = sMel ? XLSX.utils.sheet_to_json(wb.Sheets[sMel], {defval:''}).map(r => {
    const codigoStatus = classeStatusMelhoria(obterValorColuna(r, ['Status']));
    return {
      numero:      obterValorColuna(r, ['Numero']),
      frente:      String(obterValorColuna(r, ['Gerencia'])).trim(),      // área de negócio (P2P, O2C, etc.)
      fluxo:       obterValorColuna(r, ['NomeFluxo']),                    // nome do fluxo/processo
      atividade:   obterValorColuna(r, ['Atividade']),                    // descrição da melhoria
      statusRaw:   String(obterValorColuna(r, ['Status'])).trim(),        // status original (texto da planilha)
      codigoStatus,                                                      // status normalizado ("Planejamento" conta como 'doing' aqui)
      responsavel: String(obterValorColuna(r, ['Responsavel'])).trim().replace(/​/g,''), // nome do responsável
      champion:    String(obterValorColuna(r, ['Champion'])).trim(),
      complexidade:String(obterValorColuna(r, ['Complexidade'])).trim(),
      tipo:        String(obterValorColuna(r, ['TipoMelhoriaAjuste'])).trim(),
      // FILTRO DE PERÍODO — uma coluna por campo, sem fallback:
      //   dataInicio → DataInicioDesenvolvimento
      //   dataFim    → DataRealEstimadaConclusaoValidacaoChampion, mas só para concluídas.
      //     Essa coluna guarda a data ESTIMADA enquanto a melhoria ainda não fechou e
      //     só passa a valer como data REAL depois que o champion valida a conclusão —
      //     por isso só é confiável como "data de conclusão" quando codigoStatus==='done'.
      //     Para as demais, ficaria fora do prazo real de forma enganosa, então fica null.
      // Nenhum dos dois preenchido = backlog não iniciado → sempre incluído (ver construirMelhorias).
      dataInicio: paraData(obterValorColuna(r, ['DataInicioDesenvolvimento'])),
      dataFim:    codigoStatus === 'done' ? paraData(obterValorColuna(r, ['DataRealEstimadaConclusaoValidacaoChampion'])) : null,
      horas:      obterValorColuna(r, ['QtdHorasEstimadas'])
    };
  }).filter(r => r.numero !== '' || r.atividade) : []; // descarta linhas totalmente vazias

  /* --- Projetos --- */
  const sProj = buscarAba(wb,'projetos');
  App.dadosGovernanca.projetos = [];
  if(sProj){
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sProj], {defval:''});

    // DETECÇÃO DE VERSÃO: checa se o cabeçalho está correto ou embaralhado.
    // Pega as primeiras 5 linhas e testa se 'Status' contém valores reconhecíveis.
    // Se nenhum status é reconhecido, assume que a base está no layout antigo (colunas trocadas).
    const sample = rows.slice(0,5);
    const headerLooksRight = sample.some(r => classeStatus(obterValorColuna(r,['Status'])) !== 'other');

    if(headerLooksRight){
      // LAYOUT NOVO (base Universal): campos bem definidos
      App.dadosGovernanca.projetos = rows.map(r => ({
        numero:      obterValorColuna(r, ['Numero']),
        titulo:      String(obterValorColuna(r, ['Titulo'])).trim(),
        responsavel: String(obterValorColuna(r, ['Responsavel'])).trim(),
        // AreaCliente é o nome novo do campo; 'Frente' é o fallback da base antiga
        frente:      String(obterValorColuna(r, ['AreaCliente','Frente'])).trim(),
        pontoFocal:  String(obterValorColuna(r, ['PontoFocal'])).trim(),
        statusRaw:   String(obterValorColuna(r, ['Status'])).trim(),
        codigoStatus:classeStatus(obterValorColuna(r, ['Status'])),
        // FILTRO DE PERÍODO — referência: PrazoConclusão (não há data de início na planilha)
        dataFim:     paraData(obterValorColuna(r, ['PrazoConclusão','PrazoConclusao','DataFechamento'])),
        proximosPassos: String(obterValorColuna(r, ['ProximosPassos'])).trim(),
        // Campos ricos — preenchidos na planilha Universal, exibidos ao expandir um projeto na lista
        equipes:     String(obterValorColuna(r, ['EquipesEnvolvidas'])).trim(),
        descricao:   String(obterValorColuna(r, ['DescricaoProjeto'])).trim(),
        atividadesConcluidas: String(obterValorColuna(r, ['AtividadesConcluidas'])).trim(),
        atividadesAndamento:  String(obterValorColuna(r, ['AtividadesAndamento'])).trim(),
        comentarios: String(obterValorColuna(r, ['Comentarios'])).trim(),
        progresso: (()=>{
          const rawProg = obterValorColuna(r, ['ProgressoPct','Progresso']);
          return typeof rawProg === 'number' ? rawProg : (parseFloat(rawProg)||null);
        })() // progresso de 0.0 a 1.0 (ex: 0.75 = 75%)
      })).filter(p => p.titulo); // descarta linhas sem título
    } else {
      // LAYOUT ANTIGO EMBARALHADO: os cabeçalhos não batem com o conteúdo real das colunas.
      // Nesse caso lemos por posição (índice da coluna), não pelo nome do cabeçalho.
      // Mapeamento descoberto por inspeção direta da planilha original:
      //   col0=Numero, col1=Titulo, col2=Responsavel(estava em Status), col3=Frente(em Responsavel),
      //   col4=PontoFocal(em Frente), col5=Status(em PontoFocal), col6=DataFechamento, col7=ProximosPassos
      const raw = XLSX.utils.sheet_to_json(wb.Sheets[sProj], {defval:'', header:1});
      for(let i=1; i<raw.length; i++){
        const row = raw[i];
        if(row[0]==='' && row[1]==='') continue;
        if(!String(row[1]||'').trim()) continue;
        App.dadosGovernanca.projetos.push({
          numero:row[0], titulo:String(row[1]).trim(), responsavel:String(row[2]||'').trim(),
          frente:String(row[3]||'').trim(), pontoFocal:String(row[4]||'').trim(),
          statusRaw:String(row[5]||'').trim(), codigoStatus:classeStatus(row[5]),
          dataFim:paraData(row[6]), proximosPassos:String(row[7]||'').trim(),
          equipes:'', descricao:'', atividadesConcluidas:'', atividadesAndamento:'', comentarios:'',
          progresso: typeof row[8]==='number' ? row[8] : (parseFloat(row[8])||null)
        });
      }
    }
  }

  /* --- Analytics --- */
  const sAna = buscarAba(wb,'analytics');
  App.dadosGovernanca.analytics = sAna ? XLSX.utils.sheet_to_json(wb.Sheets[sAna], {defval:''}).map(r => ({
    numero:      obterValorColuna(r, ['Numero']),
    titulo:      String(obterValorColuna(r, ['Titulo'])).trim(),
    statusRaw:   String(obterValorColuna(r, ['Status'])).trim(),
    codigoStatus:classeStatus(obterValorColuna(r, ['Status'])),
    textoPrioridade: String(obterValorColuna(r, ['Prioridade'])).trim(),
    // extrai só o número da prioridade (ex: "Prioridade 2" → 2)
    prioridade:  (()=>{ const match = String(obterValorColuna(r,['Prioridade'])).match(/\d+/); return match ? +match[0] : null; })(),
    frente:      String(obterValorColuna(r, ['Frente'])).trim(),
    responsavel: String(obterValorColuna(r, ['Responsavel'])).trim(),
    // dataInicio = DataAbertura (início); dataFim = DataFechamento (conclusão da validação)
    // Com dataInicio preenchido, filtrarPorPeriodo usa ativoNoIntervalo — inclui atividades em andamento durante o período.
    dataInicio: paraData(obterValorColuna(r, ['DataAbertura'])),
    dataFim:    paraData(obterValorColuna(r, ['DataFechamento']))
  })).filter(r => r.titulo) : []; // descarta linhas sem título (ex: linhas fantasma da fonte)
}

/*
 * interpretarInventario() — processa a aba Inventario_RPA da base de governança.
 * Essa aba é o catálogo de todos os bots (automações RPA) da área.
 * FILTRO DE DATA DIFERENTE: aqui o filtro usa AnoPRD (o ano em que o bot entrou em produção),
 * não uma data de ação. Implementado diretamente em construirBots().
 */
export function interpretarInventario(){
  const wb = App.planilhaGovernanca;
  if(!wb){ App.bots = []; return; }
  const sn = buscarAba(wb,'inventariorpa') || buscarAba(wb,'inventario');
  if(!sn){ App.bots = []; return; }
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], {defval:''});
  App.bots = rows.map(r => ({
    nome:        String(obterValorColuna(r, ['NomeRPA','NOME DO RPA','Nome do RPA'])).trim(),
    perimetro:   String(obterValorColuna(r, ['Perimetro','PERIMETRO','Perímetro'])).trim(),
    area:        String(obterValorColuna(r, ['Area','AREA','Área'])).trim(),
    status:      String(obterValorColuna(r, ['Status','STATUS'])).trim().toUpperCase(), // PRD/DEV/BACKLOG/CANCELADO
    anoPrd:      obterValorColuna(r, ['AnoPRD','ANO PRD']), // ano em que o bot entrou em produção
    descricao:   String(obterValorColuna(r, ['Descricao','DESCRIÇÃO'])).trim(),
    desenvolvedor: String(obterValorColuna(r, ['Desenvolvedor','DESENVOLVEDOR'])).trim(),
    suporte:     String(obterValorColuna(r, ['Suporte','SUPORTE / SUSTENTAÇÃO'])).trim(),
    criticidade: (()=>{ const rawValue = obterValorColuna(r,['Criticidade','CRITICIDADE']); const parsed = parseInt(rawValue); return isNaN(parsed)?null:parsed; })(),
    frequencia:  String(obterValorColuna(r, ['Frequencia','FREQUENCIA','Frequência'])).trim().toLowerCase(),
    fte:         parseFloat(obterValorColuna(r, ['FTE']))||0,               // FTEs economizados por esse bot
    volumetria:  parseFloat(obterValorColuna(r, ['VolumetriaMensal','VOLUMETRIA MENSAL']))||0, // transações/mês
    numeroBots:  parseFloat(obterValorColuna(r, ['NumeroBots','NUMERO DE BOTS']))||0,
    areaCliente: String(obterValorColuna(r, ['AreaCliente','AREA CLIENTE'])).trim(),
    sap:         String(obterValorColuna(r, ['SAP'])).trim()
  })).filter(b => b.nome);
}
