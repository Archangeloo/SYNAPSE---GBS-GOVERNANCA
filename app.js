/* ============================================================
   SYNAPSE · Governança GBS — motor de dados + dashboard
   ============================================================
   Arquitetura geral:
   O site roda 100% no navegador, sem servidor nem banco de dados.
   Fluxo principal:
     1. Usuário sobe as planilhas → readFile() lê via FileReader
     2. generate() aciona os parsers de cada fonte
     3. Cada parser normaliza os dados brutos em objetos simples
     4. As funções build*() calculam KPIs e geram HTML
     5. O HTML é injetado direto nas divs da página

   Fontes de dados:
   - Base_Governanca_GBS (abas: Pipefy_Melhorias, Projetos, Analytics, Inventario_RPA)
   - relatório_completo (aba Report = chamados de manutenção RPA do Pipefy)
   ============================================================ */


/* ============================================================
   ESTADO GLOBAL DA APLICAÇÃO
   ============================================================ */

const App = {
  // Workbooks brutos lidos pelo SheetJS (null até o usuário subir o arquivo)
  gov: null,
  rpa: null,

  // Dados normalizados após parsing (arrays de objetos simples)
  P: {
    mel: [],   // Pipefy_Melhorias — melhorias e ajustes do Pipefy
    proj: [],  // Projetos — portfólio de projetos da área
    ana: []    // Analytics — atividades de Analytics
  },
  R: [],       // Chamados RPA — chamados de manutenção dos bots
  B: [],       // Inventário de Bots — catálogo de automações (sem filtro de data; usa AnoPRD)

  // Controle de quais arquivos já foram carregados
  loaded: { gov: false, rpa: false },

  // Filtros legados (não usados ativamente; mantidos por compatibilidade)
  filt: { rpaFrente: '', rpaProb: '', rpaFase: '' },

  // Filtro global de período (aplicado em todas as abas ao mesmo tempo)
  // mode: 'all' = sem filtro | 'custom' = range manual de data
  dateRange: { mode: 'all', from: null, to: null },

  // Set de projetos expandidos na lista (chave = num ou titulo)
  projOpen: new Set()
};


/* ============================================================
   FILTRO GLOBAL DE DATA
   ============================================================
   Cada fonte tem uma data diferente que faz sentido:
   - Pipefy Melhorias: DataConclusaoRealDesenvolvimento (data de entrega do dev)
   - Projetos: PrazoConclusão (prazo de entrega do projeto)
   - Analytics: DataAbertura ou DataFechamento
   - Chamados RPA: criado (data de abertura do chamado)
   - Inventário de Bots: NÃO filtra por data de ação; usa AnoPRD separadamente

   ATENÇÃO: itens sem data ficam FORA do filtro quando ele está ativo.
   Isso é intencional e transparente — a app exibe o aviso.
   Nunca inventamos zero para itens sem data.
   ============================================================ */

/*
 * Retorna a data de referência de um item normalizado.
 * A prioridade é: data de conclusão (dtFim) > data de criação (criado).
 * Para Chamados RPA, criado é a data de abertura do chamado.
 */
function refDate(item){
  return item.dtFim || item.criado || null;
}

/*
 * Verifica se uma data passa no filtro global de período.
 * Retorna true se: modo=all, ou data dentro do range.
 * Retorna false se: modo=custom e sem data (item não entra no filtro).
 */
function inDateRange(d){
  const dr = App.dateRange;
  if(dr.mode === 'all') return true;        // sem filtro: passa tudo
  if(!d) return false;                       // sem data: não entra em período específico
  if(dr.from && d < dr.from) return false;  // antes do início: fora
  if(dr.to && d > dr.to) return false;      // depois do fim: fora
  return true;
}

/*
 * Aplica o filtro de data a um array inteiro.
 * Retorna: { kept: [...itens que passaram], noDate: N (quantidade sem data) }
 * Os itens sem data (noDate) não são perdidos — ficam de fora do recorte
 * e o número é exibido na nota de transparência da interface.
 */
function applyDate(arr){
  if(App.dateRange.mode === 'all') return { kept: arr, noDate: 0 };
  const kept = [], noDate = [];
  arr.forEach(x => {
    const d = refDate(x);
    if(!d) noDate.push(x);
    else if(inDateRange(d)) kept.push(x);
  });
  return { kept, noDate: noDate.length };
}


/* ============================================================
   CONSTANTES E CLASSIFICADOR DE STATUS
   ============================================================ */

const MESES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
const DOW   = ['Seg','Ter','Qua','Qui','Sex','Sáb','Dom'];
const HOJE  = new Date(); // data atual no momento do carregamento da página

/*
 * Converte o texto bruto de status (vindo da planilha) em um código interno.
 * Isso normaliza variações de digitação ("Concluido" vs "Concluído"), sinônimos
 * e os status específicos do GBS (Encerramento, Monitoramento).
 *
 * Fluxo de Projetos GBS:
 *   Diagnóstico → Planejamento → Execução → Encerramento → Monitoramento
 *   (Nenhum desses é "done" — "done" só aparece quando um projeto fechar de verdade)
 *
 * Mapeamento para código interno:
 *   done    = concluído de fato (não existe ainda nos projetos)
 *   doing   = em andamento / em desenvolvimento
 *   closing = em processo de encerramento (pode estar atrasado se prazo venceu)
 *   monitor = entregue, em monitoramento pós go-live (não conta como atrasado)
 *   todo    = não iniciado / backlog / planejamento
 *   blocked = bloqueado / pausado
 *   cancel  = cancelado
 *   vendor  = encaminhado ao suporte da Pipefy (fornecedor externo)
 *   other   = qualquer valor não reconhecido
 */
function statusClass(s){
  const t = (s||'').toString().trim().toLowerCase();
  if(['suporte pipefy','encaminhado ao fornecedor','pipefy'].includes(t)) return 'vendor';
  if(['concluído','concluido','finalizados','finalizado','tema concluído.','tema concluído'].includes(t)) return 'done';
  if(['em andamento','em execução','execução','execucao','desenvolvimento','em validação','em validacao','aguardando validação','aguardando validacao'].includes(t)) return 'doing';
  if(['encerramento'].includes(t)) return 'closing';
  if(['monitoramento'].includes(t)) return 'monitor';
  if(['planejamento','diagnóstico','diagnostico','não iniciado','nao iniciado','backlog'].includes(t)) return 'todo';
  if(['bloqueado','pausado'].includes(t)) return 'blocked';
  if(['cancelado'].includes(t)) return 'cancel';
  return 'other';
}

// Rótulos em português para exibição na interface
const STATUS_PT = {
  done:'Concluído', doing:'Em andamento', closing:'Em encerramento',
  monitor:'Monitoramento', todo:'Não iniciado', blocked:'Bloqueado',
  cancel:'Cancelado', vendor:'Suporte Pipefy', other:'Outro'
};

// Classe CSS do badge de cada status (ver CSS: .badge.ok, .badge.info, etc.)
const STATUS_BADGE = {
  done:'ok', doing:'info', closing:'warn', monitor:'info',
  todo:'neu', blocked:'warn', cancel:'red', vendor:'blue', other:'neu'
};

// Cor pura (para gráficos SVG que não usam classe CSS)
const STATUS_COLOR = {
  done:'var(--ok)', doing:'var(--info)', closing:'#c08438',
  monitor:'#5a8fd9', todo:'var(--neu)', blocked:'var(--warn)',
  cancel:'var(--err)', vendor:'#7c5cbf', other:'var(--ink4)'
};

/*
 * Número da fase no ciclo de vida de um Projeto GBS.
 * Quanto maior o número, mais perto do término.
 * Fluxo: Diagnóstico(1) → Planejamento(2) → Execução(3) → Encerramento(4) → Monitoramento(5)
 * Retorna null para status fora do fluxo (cancelado, bloqueado).
 */
function projFase(statusRaw){
  const t = (statusRaw||'').toString().trim().toLowerCase();
  if(t.includes('diagn')) return 1;
  if(t.includes('planej')) return 2;
  if(t.includes('execu')) return 3;
  if(t.includes('encerr')) return 4;
  if(t.includes('monitor')) return 5;
  if(t.includes('conclu')) return 5;
  return null;
}


/* ============================================================
   NAVEGAÇÃO
   ============================================================ */

/*
 * Alterna entre as abas principais do dashboard.
 * Funciona togglando a classe 'active' no item de nav e na section correspondente.
 */
function setNav(id){
  ['upload','gov','proj','mel','rpa','bots','ana'].forEach(n => {
    const ni = document.getElementById('nav-'+n);
    const pg = document.getElementById('page-'+n);
    if(ni) ni.classList.toggle('active', n === id);
    if(pg) pg.classList.toggle('active', n === id);
  });
}

/*
 * Alterna entre as sub-abas da aba Chamados RPA
 * (Visão geral, Top bots, Tipos de problema, Tempo de resolução, Chamados)
 */
function rpaPage(id){
  document.querySelectorAll('#page-rpa .pip-sub-page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('#page-rpa .pip-nav-item').forEach(n => n.classList.remove('active'));
  const pg = document.getElementById('rpage-'+id);
  const nv = document.getElementById('rnav-'+id);
  if(pg) pg.classList.add('active');
  if(nv) nv.classList.add('active');
}


/* ============================================================
   UPLOAD DE ARQUIVOS
   ============================================================ */

// Drag & drop: eventos de arrastar sobre a zona (over), sair (leave), soltar (drop)
function dzO(e,id){ e.preventDefault(); document.getElementById(id).classList.add('over'); }
function dzL(id){ document.getElementById(id).classList.remove('over'); }
function dzD(e,t){
  e.preventDefault();
  document.getElementById('dz-'+t).classList.remove('over');
  const f = e.dataTransfer.files[0];
  if(f) readFile(f, t);
}

// Handler do input file (clique no botão de seleção de arquivo)
function hf(i,t){ if(i.files[0]) readFile(i.files[0], t); }

/*
 * Lê um arquivo Excel (.xlsx) do disco usando FileReader.
 * Usa a biblioteca SheetJS (XLSX) para parsear o binário.
 * cellDates:true faz o SheetJS retornar objetos Date nativos (não serial do Excel).
 * Após leitura, armazena o workbook em App.gov ou App.rpa conforme o tipo.
 */
function readFile(file, type){
  const rd = new FileReader();
  rd.onload = e => {
    const wb = XLSX.read(new Uint8Array(e.target.result), {type:'array', cellDates:true});
    if(type === 'gov') App.gov = wb;
    else App.rpa = wb;
    App.loaded[type] = true;
    showOk(type, file.name, wb);
    updateBar();
  };
  rd.readAsArrayBuffer(file);
}

/*
 * Atualiza a UI do card de upload após leitura bem-sucedida.
 * Para a base de governança, verifica quais abas esperadas foram encontradas
 * e exibe badges verdes/amarelos para cada uma.
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
    tg.innerHTML = '<b>Abas lidas:</b> ' + want.map(w => {
      // busca insensível a maiúsculas, underlines e espaços
      const ok = found.some(f => f.toLowerCase().replace(/[_ ]/g,'').includes(w.toLowerCase().replace(/[_ ]/g,'')));
      return `<span class="badge ${ok?'ok':'warn'}" style="margin:2px">${w}${ok?'':' (?)'}</span>`;
    }).join('');
  } else {
    // para o relatório de RPA, mostra nome da aba e total de chamados
    const ws = wb.Sheets[wb.SheetNames[0]];
    const n = XLSX.utils.sheet_to_json(ws, {defval:''}).length;
    tg.innerHTML = `<b>Aba lida:</b> <span class="badge ok" style="margin:2px">${wb.SheetNames[0]} · ${n} chamados</span>`;
  }
}

/*
 * Atualiza o contador "X de 2 bases carregadas" e habilita/desabilita o botão "Gerar dashboard".
 */
function updateBar(){
  const n = Object.values(App.loaded).filter(Boolean).length;
  document.getElementById('abar-status').innerHTML = `<strong style="color:var(--ink)">${n} de 2</strong> bases carregadas`;
  document.getElementById('btn-gen').disabled = n === 0;
}


/* ============================================================
   FUNÇÕES AUXILIARES (HELPERS)
   ============================================================ */

/*
 * Busca uma aba num workbook por fragmento de nome.
 * Insensível a maiúsculas, underlines e espaços.
 * Ex: findSheet(wb, 'melhorias') encontra 'Pipefy_Melhorias'.
 */
function findSheet(wb, frag){
  const f = frag.toLowerCase().replace(/[_ ]/g,'');
  return wb.SheetNames.find(s => s.toLowerCase().replace(/[_ ]/g,'').includes(f));
}

/*
 * Converte qualquer tipo de valor para Date (ou null se inválido).
 * Necessário porque o Excel pode guardar datas como:
 *   - objeto Date (quando cellDates:true e o SheetJS consegue parsear)
 *   - número serial do Excel (ex: 45678 = dias desde 01/01/1900)
 *   - string de data (ex: "2026-04-24")
 */
function toDate(v){
  if(!v) return null;
  if(v instanceof Date) return isNaN(v) ? null : v;
  if(typeof v === 'number'){
    // converte serial do Excel: (serial - 25569) * 86400000 ms
    const d = new Date(Math.round((v - 25569) * 864e5));
    return isNaN(d) ? null : d;
  }
  if(typeof v === 'string' && v.length > 4){
    const d = new Date(v);
    return isNaN(d) ? null : d;
  }
  return null;
}

// Formata Date para string "YYYY-MM" (usada como chave de agrupamento mensal)
function ym(d){ return d ? `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}` : ''; }

// Converte "YYYY-MM" em rótulo legível "Mmm/AA" (ex: "2026-04" → "Abr/26")
function ymLabel(m){
  if(!m) return '';
  const p = m.split('-');
  return `${MESES[+p[1]-1]}/${p[0].slice(2)}`;
}

/*
 * Busca o valor de uma coluna numa linha do SheetJS, aceitando múltiplos
 * nomes possíveis (pois o nome da coluna pode variar entre versões da planilha).
 * A comparação é insensível a maiúsculas e espaços extras.
 * Retorna '' se nenhuma das chaves for encontrada.
 */
function get(row, keys){
  const rk = Object.keys(row);
  for(const k of keys){
    for(const r of rk){
      if(r.trim().toLowerCase() === k.toLowerCase()){
        const v = row[r];
        return v == null ? '' : v;
      }
    }
  }
  return '';
}

/*
 * Conta a frequência de um valor em um array de objetos.
 * fn: função que extrai a chave a contar (ex: r => r.frente)
 * Retorna: { 'P2P': 42, 'O2C': 33, ... }
 */
function count(arr, fn){
  const m = {};
  arr.forEach(x => { const k = fn(x) || '—'; m[k] = (m[k]||0) + 1; });
  return m;
}

// Calcula percentual arredondado. Retorna 0 se divisor=0 (nunca divide por zero).
function pct(a, b){ return b ? Math.round(a/b*100) : 0; }


/* ============================================================
   PARSERS — LEITURA E NORMALIZAÇÃO DAS PLANILHAS
   ============================================================
   Cada parser lê uma aba do Excel e transforma as linhas em
   objetos JavaScript com nomes de campo padronizados.
   Isso desacopla o resto do código dos nomes de coluna da planilha.
   ============================================================ */

/*
 * parseGov() — processa as 3 abas da Base Governança:
 *   Pipefy_Melhorias, Projetos e Analytics.
 * Chamado por generate() após o usuário clicar em "Gerar dashboard".
 */
function parseGov(){
  const wb = App.gov;

  /* --- Pipefy_Melhorias --- */
  // Busca a aba pelo nome (flexível: aceita "pipefymelhorias" ou "melhorias")
  const sMel = findSheet(wb,'pipefymelhorias') || findSheet(wb,'melhorias');
  App.P.mel = sMel ? XLSX.utils.sheet_to_json(wb.Sheets[sMel], {defval:''}).map(r => ({
    num:      get(r, ['Numero']),
    frente:   String(get(r, ['Gerencia'])).trim(),      // frente/gerência (P2P, O2C, etc.)
    fluxo:    get(r, ['NomeFluxo']),                    // nome do fluxo do processo
    atividade:get(r, ['Atividade']),                    // descrição da melhoria
    statusRaw:String(get(r, ['Status'])).trim(),        // status original (texto da planilha)
    sc:       statusClass(get(r, ['Status'])),          // status normalizado (código interno)
    resp:     String(get(r, ['Responsavel'])).trim().replace(/​/g,''), // nome do responsável
    champion: String(get(r, ['Champion'])).trim(),
    complex:  String(get(r, ['Complexidade'])).trim(),
    tipo:     String(get(r, ['TipoMelhoriaAjuste'])).trim(),
    // DATA USADA NO FILTRO DE PERÍODO: data real/estimada de conclusão do desenvolvimento
    // IMPORTANTE: a maioria das melhorias em backlog/planejamento NÃO tem essa data.
    // Por isso, ao filtrar por período, muitas melhorias ficam fora (é o comportamento correto).
    dtFim:    toDate(get(r, ['DataConclusaoRealDesenvolvimento'])),
    horas:    get(r, ['QtdHorasEstimadas'])
  })).filter(r => r.num !== '' || r.atividade) : []; // descarta linhas totalmente vazias

  /* --- Projetos --- */
  const sProj = findSheet(wb,'projetos');
  App.P.proj = [];
  if(sProj){
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sProj], {defval:''});

    // DETECÇÃO DE VERSÃO: verifica se o header está correto ou embaralhado.
    // Pega as 5 primeiras linhas e testa se 'Status' contém valores reconhecíveis.
    // Se não reconhece nenhum status, assume que a base está no layout antigo (colunas embaralhadas).
    const sample = rows.slice(0,5);
    const headerLooksRight = sample.some(r => statusClass(get(r,['Status'])) !== 'other');

    if(headerLooksRight){
      // LAYOUT NOVO (base Universal): campos bem definidos
      App.P.proj = rows.map(r => ({
        num:        get(r, ['Numero']),
        titulo:     String(get(r, ['Titulo'])).trim(),
        resp:       String(get(r, ['Responsavel'])).trim(),
        // AreaCliente é o nome novo do campo; 'Frente' é o fallback para a base antiga
        frente:     String(get(r, ['AreaCliente','Frente'])).trim(),
        focal:      String(get(r, ['PontoFocal'])).trim(),
        statusRaw:  String(get(r, ['Status'])).trim(),
        sc:         statusClass(get(r, ['Status'])),
        // PrazoConclusão é o nome novo; fallbacks para versões anteriores da planilha
        dtFim:      toDate(get(r, ['PrazoConclusão','PrazoConclusao','DataFechamento'])),
        proximos:   String(get(r, ['ProximosPassos'])).trim(),
        // Campos ricos — preenchidos na planilha Universal, aparecem ao expandir o projeto na lista
        equipes:    String(get(r, ['EquipesEnvolvidas'])).trim(),
        descricao:  String(get(r, ['DescricaoProjeto'])).trim(),
        atvConcl:   String(get(r, ['AtividadesConcluidas'])).trim(),
        atvAndam:   String(get(r, ['AtividadesAndamento'])).trim(),
        comentarios:String(get(r, ['Comentarios'])).trim(),
        prog: (()=>{
          const v = get(r, ['ProgressoPct','Progresso']);
          return typeof v === 'number' ? v : (parseFloat(v)||null);
        })() // progresso 0.0 a 1.0 (ex: 0.75 = 75%)
      })).filter(p => p.titulo); // descarta linhas sem título
    } else {
      // LAYOUT ANTIGO EMBARALHADO: os cabeçalhos não batem com o conteúdo das colunas.
      // Nesse caso lemos por posição (índice da coluna), não pelo nome do cabeçalho.
      // Mapeamento descoberto via inspeção direta da planilha original:
      //   col0=Numero, col1=Titulo, col2=Responsavel(estava em Status), col3=Frente(em Responsavel),
      //   col4=PontoFocal(em Frente), col5=Status(em PontoFocal), col6=DataFechamento, col7=ProximosPassos
      const raw = XLSX.utils.sheet_to_json(wb.Sheets[sProj], {defval:'', header:1});
      for(let i=1; i<raw.length; i++){
        const c = raw[i];
        if(c[0]==='' && c[1]==='') continue;
        if(!String(c[1]||'').trim()) continue;
        App.P.proj.push({
          num:c[0], titulo:String(c[1]).trim(), resp:String(c[2]||'').trim(),
          frente:String(c[3]||'').trim(), focal:String(c[4]||'').trim(),
          statusRaw:String(c[5]||'').trim(), sc:statusClass(c[5]),
          dtFim:toDate(c[6]), proximos:String(c[7]||'').trim(),
          equipes:'', descricao:'', atvConcl:'', atvAndam:'', comentarios:'',
          prog: typeof c[8]==='number' ? c[8] : (parseFloat(c[8])||null)
        });
      }
    }
  }

  /* --- Analytics --- */
  const sAna = findSheet(wb,'analytics');
  App.P.ana = sAna ? XLSX.utils.sheet_to_json(wb.Sheets[sAna], {defval:''}).map(r => ({
    num:      get(r, ['Numero']),
    titulo:   String(get(r, ['Titulo'])).trim(),
    statusRaw:String(get(r, ['Status'])).trim(),
    sc:       statusClass(get(r, ['Status'])),
    prioRaw:  String(get(r, ['Prioridade'])).trim(),
    // extrai só o número da prioridade (ex: "Prioridade 2" → 2)
    prio:     (()=>{ const m = String(get(r,['Prioridade'])).match(/\d+/); return m ? +m[0] : null; })(),
    frente:   String(get(r, ['Frente'])).trim(),
    resp:     String(get(r, ['Responsavel'])).trim(),
    // DATA USADA NO FILTRO DE PERÍODO: DataAbertura (início do desenvolvimento)
    // Se não tiver abertura, usa DataFechamento (término da validação)
    // ~49 de 161 atividades têm DataAbertura preenchida; 36 têm DataFechamento
    dtAbre:   toDate(get(r, ['DataAbertura'])),
    dtFim:    toDate(get(r, ['DataFechamento']))
  })).filter(r => r.titulo) : []; // descarta linhas sem título (ex: linhas fantasma da origem)
}

/*
 * parseRPA() — processa o relatório de chamados de manutenção RPA (export do Pipefy).
 * ROBUSTO: procura a aba correta entre todas (pode não ser a primeira), valida se tem
 * as colunas esperadas, e descarta linhas-lixo (sem qualquer identificador real).
 * Se o arquivo não parecer um relatório de chamados, registra um aviso em App.rpaWarn
 * e deixa App.R vazio (em vez de gerar centenas de linhas-lixo).
 */
function parseRPA(){
  const wb = App.rpa;
  App.rpaWarn = '';
  // Procura a aba que parece ser de chamados: precisa ter colunas características.
  // Testa cada aba e escolhe a que tem mais "cara" de relatório de chamados.
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

  // precisa bater pelo menos 2 colunas características para ser considerado válido
  if(melhorScore < 2){
    App.R = [];
    App.rpaWarn = 'O arquivo carregado no campo "Chamados RPA" não parece ser um relatório de chamados de manutenção (faltam colunas como Código, Fase atual, Processo). Verifique se subiu o arquivo certo.';
    return;
  }

  const rows = XLSX.utils.sheet_to_json(wb.Sheets[melhorAba], {defval:''});
  App.R = rows.map(r => {
    const criado = toDate(get(r, ['Criado em']));
    const vencRaw = get(r, ['Vencido']);
    const venc = vencRaw===true || String(vencRaw).toLowerCase()==='true' || String(vencRaw).toLowerCase()==='sim';
    return {
      cod:        String(get(r, ['Código','Codigo'])).trim(),
      titulo:     String(get(r, ['Título','Titulo'])).trim(),
      fase:       String(get(r, ['Fase atual'])).trim(),
      processo:   String(get(r, ['Processo'])).trim() || '(sem processo)',
      problema:   String(get(r, ['Qual é o problema?'])).trim(),
      reexec:     String(get(r, ['Este robô admite reexecução?'])).trim(),
      solicitante:String(get(r, ['Nome do solicitante'])).trim(),
      criado, mes: ym(criado),
      dow: criado ? (criado.getDay() + 6) % 7 : -1,
      finalizado: toDate(get(r, ['Finalizado em'])),
      vencido:    venc,
      tIdent:  parseFloat(get(r, ['Tempo total na fase Identificação do problema (dias)']))||null,
      tDesenv: parseFloat(get(r, ['Tempo total na fase Desenvolvimento da solução (dias)']))||null,
      tReexec: parseFloat(get(r, ['Tempo total na fase Reexecução (dias)']))||null
    };
  // FILTRO DE LIXO: mantém só linhas que têm um código real (chamados sempre têm código).
  // Isso evita contar linhas vazias ou de rodapé que algumas exportações incluem.
  }).filter(r => r.cod);
}

/*
 * enrichRPAComArea() — associa a cada chamado RPA a área (P2P, O2C, etc.) do bot.
 * Os chamados não têm campo de área, só o nome do Processo. O inventário de bots tem
 * o nome do bot + a área. Fazemos match aproximado de nomes (um contém o outro, após
 * normalização) para herdar a área. Chamados sem match ficam com área '(não mapeada)'.
 * Deve ser chamada DEPOIS de parseRPA() e parseInv().
 */
function enrichRPAComArea(){
  if(!App.R.length || !App.B.length) return;
  const norm = s => s.toLowerCase().replace(/^\[.*?\]/,'').replace(/[^a-z0-9]/g,'');
  const botAreas = App.B.filter(b=>b.nome && b.area).map(b => ({n:norm(b.nome), area:b.area}));
  App.R.forEach(r => {
    const pn = norm(r.processo);
    let area = '';
    if(pn){
      const hit = botAreas.find(b => b.n && (b.n.includes(pn) || pn.includes(b.n)));
      if(hit) area = hit.area;
    }
    r.area = area || '(não mapeada)';
  });
}

/*
 * parseInv() — processa a aba Inventario_RPA da base de governança.
 * Essa aba é o catálogo de todos os bots (automações RPA) da área.
 * FILTRO DE DATA DIFERENTE: aqui o filtro usa o AnoPRD (ano que o bot entrou em produção),
 * não uma data de ação. Implementado diretamente em buildBots().
 */
function parseInv(){
  const wb = App.gov;
  if(!wb){ App.B = []; return; }
  const sn = findSheet(wb,'inventariorpa') || findSheet(wb,'inventario');
  if(!sn){ App.B = []; return; }
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], {defval:''});
  App.B = rows.map(r => ({
    nome:        String(get(r, ['NomeRPA','NOME DO RPA','Nome do RPA'])).trim(),
    perimetro:   String(get(r, ['Perimetro','PERIMETRO','Perímetro'])).trim(),
    area:        String(get(r, ['Area','AREA','Área'])).trim(),
    status:      String(get(r, ['Status','STATUS'])).trim().toUpperCase(), // PRD/DEV/BACKLOG/CANCELADO
    anoPrd:      get(r, ['AnoPRD','ANO PRD']), // ano de entrada em produção
    desc:        String(get(r, ['Descricao','DESCRIÇÃO'])).trim(),
    dev:         String(get(r, ['Desenvolvedor','DESENVOLVEDOR'])).trim(),
    suporte:     String(get(r, ['Suporte','SUPORTE / SUSTENTAÇÃO'])).trim(),
    criticidade: (()=>{ const v = get(r,['Criticidade','CRITICIDADE']); const n = parseInt(v); return isNaN(n)?null:n; })(),
    freq:        String(get(r, ['Frequencia','FREQUENCIA','Frequência'])).trim().toLowerCase(),
    fte:         parseFloat(get(r, ['FTE']))||0,               // FTEs economizados por esse bot
    vol:         parseFloat(get(r, ['VolumetriaMensal','VOLUMETRIA MENSAL']))||0, // transações/mês
    nBots:       parseFloat(get(r, ['NumeroBots','NUMERO DE BOTS']))||0,
    areaCliente: String(get(r, ['AreaCliente','AREA CLIENTE'])).trim(),
    sap:         String(get(r, ['SAP'])).trim()
  })).filter(b => b.nome);
}


/* ============================================================
   COMPONENTES DE GRÁFICO (SVG puro, sem bibliotecas externas)
   ============================================================
   Todos os gráficos são gerados como strings HTML/SVG e injetados
   diretamente via innerHTML. Isso mantém zero dependências externas
   (além do SheetJS para leitura de Excel).
   ============================================================ */

/*
 * donut(data, opts) — gráfico de rosca (donut chart)
 * data: array de { label, value, color }
 *
 * Como funciona o SVG:
 *   - Usa <circle> com stroke-dasharray para desenhar cada segmento
 *   - stroke-dasharray="X Y" onde X = comprimento do arco, Y = espaço restante
 *   - stroke-dashoffset desloca o início de cada segmento para continuar onde o anterior terminou
 *   - O círculo começa no ponto direito (3h); rotate(-90) no transform move para 12h
 */
function donut(data, opts={}){
  const total = data.reduce((s,d) => s+d.value, 0);
  if(!total) return '<div style="font-size:12px;color:var(--ink4)">Sem dados</div>';
  const R=54, C=2*Math.PI*R, sw=22; // R=raio, C=circunferência, sw=espessura do anel
  let off = 0; // offset acumulado para posicionar cada segmento
  const segs = data.filter(d => d.value > 0).map(d => {
    const frac = d.value/total, len = frac*C; // comprimento do arco desse segmento
    const s = `<circle r="${R}" cx="64" cy="64" fill="none" stroke="${d.color}" stroke-width="${sw}"
      stroke-dasharray="${len} ${C-len}" stroke-dashoffset="${-off}" transform="rotate(-90 64 64)"/>`;
    off += len;
    return s;
  }).join('');
  const legend = data.filter(d => d.value > 0).map(d =>
    `<div class="dleg"><span class="dleg-dot" style="background:${d.color}"></span>${d.label}
     <b>${d.value}</b><span class="dpct">${pct(d.value,total)}%</span></div>`).join('');
  return `<div class="donut-wrap">
    <svg width="128" height="128" viewBox="0 0 128 128" style="flex-shrink:0">${segs}
      <text x="64" y="60" text-anchor="middle" font-family="Syne" font-size="26" font-weight="600" fill="var(--ink)">${total}</text>
      <text x="64" y="78" text-anchor="middle" font-size="9" fill="var(--ink4)" letter-spacing="1">TOTAL</text>
    </svg>
    <div class="donut-legend">${legend}</div></div>`;
}

/*
 * hbars(entries, opts) — barras horizontais simples
 * entries: array de [label, value]
 * opts: { max (máx de itens), lw (largura mínima do label), tot (total para % lateral), color }
 * A largura de cada barra é proporcional ao maior valor (sempre 100% para o topo).
 */
function hbars(entries, opts={}){
  const items = entries.slice(0, opts.max||10);
  const mx = items.length ? Math.max(...items.map(e => e[1])) : 1;
  const lw = opts.lw || 90;
  // fixedLabel: quando true, o label tem largura FIXA (não só mínima),
  // garantindo que todas as barras comecem exatamente no mesmo ponto.
  // O texto longo é truncado com reticências.
  const labelStyle = opts.fixedLabel
    ? `width:${lw}px;min-width:${lw}px;max-width:${lw}px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap`
    : `min-width:${lw}px`;
  const h = items.map(([l,v]) => {
    const w = Math.round(v/mx*100);
    const p = opts.tot ? `<span class="hbar-pct">${pct(v,opts.tot)}%</span>` : '';
    const col = opts.color || 'var(--ink)';
    return `<div class="hbar-row"><span class="hbar-lbl" style="${labelStyle}" title="${String(l).replace(/"/g,'')}">${l}</span>
      <div class="hbar-track"><div class="hbar-fill" style="width:${w}%;background:${col}"></div></div>
      <span class="hbar-val">${v}</span>${p}</div>`;
  }).join('');
  return h || '<div style="font-size:12px;color:var(--ink4)">Sem dados</div>';
}

/*
 * lineChart(points, opts) — gráfico de linha SVG responsivo
 * points: array de { label, value }
 *
 * Como funciona:
 *   - Calcula coordenadas x e y para cada ponto no espaço do SVG
 *   - Desenha o caminho da linha com <path d="M... L... L...">
 *   - Desenha a área preenchida com um path fechado (vai ao fundo e volta)
 *   - Adiciona <circle> em cada ponto e <text> com o valor (quando não há sobreposição)
 *   - Labels do eixo X: exibe apenas a cada N passos para evitar sobreposição
 *     O último label é suprimido se ficar muito perto do penúltimo exibido.
 *   - Grid horizontal: 5 linhas nos valores 0%, 25%, 50%, 75%, 100%
 *
 * IMPORTANTE sobre o gráfico de evolução:
 *   O gráfico só plota meses ATÉ o mês atual (não projeta futuro).
 *   Se o último ponto está em abril/26, é porque não há conclusões registradas
 *   após abril/26 na planilha — o gráfico avança automaticamente quando a base é atualizada.
 */
function lineChart(points, opts={}){
  if(points.length < 2) return '<div style="font-size:12px;color:var(--ink4)">Dados insuficientes para tendência</div>';
  const W=opts.w||560, H=opts.h||140, pad={l:32,r:12,t:12,b:24};
  const iw = W-pad.l-pad.r, ih = H-pad.t-pad.b;
  const max = opts.max!=null ? opts.max : Math.max(...points.map(p=>p.value), 1);
  const min = opts.min!=null ? opts.min : 0;
  // funções de conversão valor→coordenada SVG
  const x = i => pad.l + (i/(points.length-1)) * iw;
  const y = v => pad.t + ih - ((v-min)/(max-min||1)) * ih;
  const path = points.map((p,i) => `${i?'L':'M'}${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(' ');
  const area = `${path} L${x(points.length-1)} ${pad.t+ih} L${pad.l} ${pad.t+ih} Z`;
  const dots = points.map((p,i) => {
    const step = Math.ceil(points.length/7);
    // exibe o valor numérico sobre o ponto a cada 'step' posições, e sempre no último
    const showVal = points.length<=7 || i%step===0 || i===points.length-1;
    return `<circle cx="${x(i)}" cy="${y(p.value)}" r="3" fill="var(--surface)" stroke="var(--info)" stroke-width="2"/>
    ${showVal ? `<text x="${x(i)}" y="${y(p.value)-9}" text-anchor="middle" font-size="9" font-weight="600" fill="var(--ink2)">${opts.fmt?opts.fmt(p.value):p.value}</text>` : ''}`;
  }).join('');
  const xl = points.map((p,i) => {
    const step = Math.ceil(points.length/7);
    const isShown = points.length<=7 || i%step===0;
    const isLast = i === points.length-1;
    // suprime o último label se ele ficaria muito próximo do penúltimo exibido
    const lastShownByStep = Math.floor((points.length-1)/step)*step;
    const lastTooClose = isLast && (points.length-1 - lastShownByStep) < step*0.6;
    if(!isShown && !(isLast && !lastTooClose)) return '';
    if(isLast && lastTooClose) return '';
    return `<text x="${x(i)}" y="${H-6}" text-anchor="middle" font-size="9" fill="var(--ink4)">${p.label}</text>`;
  }).join('');
  const grid = [0,.25,.5,.75,1].map(f => {
    const yy = pad.t + ih - f*ih;
    const val = Math.round(min + f*(max-min));
    return `<line x1="${pad.l}" y1="${yy}" x2="${W-pad.r}" y2="${yy}" stroke="var(--rule)" stroke-width="1"/>
      <text x="${pad.l-6}" y="${yy+3}" text-anchor="end" font-size="8" fill="var(--ink4)">${opts.pctAxis?val+'%':val}</text>`;
  }).join('');
  return `<svg width="100%" viewBox="0 0 ${W} ${H}" style="overflow:visible">
    ${grid}<path d="${area}" fill="var(--info)" opacity="0.08"/>
    <path d="${path}" fill="none" stroke="var(--info)" stroke-width="2" stroke-linejoin="round"/>${dots}${xl}</svg>`;
}

/*
 * heatmap(matrix, rowLabels, colLabels) — tabela de calor
 * matrix[r][c] = valor numérico
 * A intensidade da cor vai de quase branco (valor baixo) a vermelho (valor máximo).
 * Usa rgba() com opacidade variável (compatível com qualquer navegador).
 * Valores zero ficam com fundo neutro (sem cor de calor).
 */
function heatmap(matrix, rowLabels, colLabels, opts={}){
  const flat = matrix.flat().filter(v => v > 0);
  const mx = flat.length ? Math.max(...flat) : 1;
  const color = v => {
    if(!v) return 'var(--neu-bg)';
    const t = v/mx;
    const op = (0.12 + t*0.78).toFixed(2); // opacidade de 12% a 90% conforme intensidade
    // vermelho do tema (#c0392b aprox) com transparência — rgba funciona em todo navegador
    return `rgba(199, 93, 93, ${op})`;
  };
  let html = '<table class="hm"><thead><tr><th class="rh"></th>'+colLabels.map(c=>`<th>${c}</th>`).join('')+'</tr></thead><tbody>';
  matrix.forEach((row,r) => {
    html += `<tr><td class="rl">${rowLabels[r]}</td>` + row.map(v =>
      `<td><div class="cell" style="background:${color(v)};color:${v/mx>0.55?'#fff':'var(--ink2)'}">${v||''}</div></td>`
    ).join('') + '</tr>';
  });
  html += '</tbody></table>';
  return html;
}


/* ============================================================
   VIEW: GOVERNANÇA (executiva)
   ============================================================
   A aba Governança é a visão unificada de todas as fontes.
   Ela combina Projetos + Pipefy Melhorias + Analytics + Chamados RPA
   num único conjunto de KPIs e gráficos.
   ============================================================ */

/*
 * allActions() — unifica as 4 fontes num único array de "ações".
 * Cada ação tem: fonte, sc (status normalizado), frente, responsável,
 * dtFim (data de referência para filtros e gráficos) e campos específicos.
 *
 * Para Chamados RPA:
 *   - sc é derivado da fase atual (contém "conclu" → done, senão → doing)
 *   - dtFim = data de finalização do chamado
 *   - criado = data de abertura (usada como fallback no refDate)
 *   - vencido = flag booleana do Pipefy
 */
function allActions(){
  const out = [];
  App.P.proj.forEach(p => out.push({fonte:'Projetos', sc:p.sc, frente:p.frente, resp:p.resp, dtFim:p.dtFim, prog:p.prog, prio:null}));
  App.P.mel.forEach(m => out.push({fonte:'Pipefy', sc:m.sc, frente:m.frente, resp:m.resp, dtFim:m.dtFim, prog:null, prio:null}));
  App.P.ana.forEach(a => out.push({fonte:'Analytics', sc:a.sc, frente:a.frente, resp:a.resp, dtFim:a.dtFim, prog:null, prio:a.prio}));
  App.R.forEach(r => out.push({
    fonte:'Chamados RPA',
    sc: r.fase.toLowerCase().includes('conclu') ? 'done' : 'doing',
    frente:null, resp:r.solicitante,
    dtFim:r.finalizado, criado:r.criado,
    prog:null, prio:null, vencido:r.vencido
  }));
  return out;
}

// Versão filtrada: aplica o filtro global de data antes de retornar
function allActionsFiltered(){
  return applyDate(allActions());
}

/*
 * isLate(a) — determina se uma ação está atrasada.
 * Retorna: true (atrasada), false (não atrasada), null (sem base para calcular)
 *
 * Regras por fonte:
 *   Chamados RPA: atrasado se vencido=true E não concluído
 *   Projetos: atrasado se prazo passou E não está concluído/cancelado/monitoramento
 *   Pipefy/Analytics: retorna null (sem prazo preenchido na base → não entra no cálculo)
 *
 * A distinção null vs false é importante: null significa "não sei",
 * não "não está atrasado". Isso evita que fontes sem prazo puxem o % para baixo.
 */
function isLate(a){
  if(a.fonte === 'Chamados RPA') return a.vencido && a.sc !== 'done';
  if(a.fonte === 'Projetos' && a.dtFim) return a.dtFim < HOJE && a.sc !== 'done' && a.sc !== 'cancel' && a.sc !== 'monitor';
  return null;
}

/*
 * buildGov() — monta a aba Governança (visão executiva).
 * Calcula todos os KPIs cruzados, gera o HTML e injeta em #gov-content.
 * É chamada pelo generate() inicial e pelo renderAll() quando o filtro de data muda.
 */
function buildGov(){
  const any = App.loaded.gov || App.loaded.rpa;
  document.getElementById('gov-empty').style.display = any ? 'none' : 'block';
  document.getElementById('gov-content').style.display = any ? 'block' : 'none';
  if(!any) return;

  const {kept:A, noDate} = allActionsFiltered();
  const total = A.length;
  const done = A.filter(a => a.sc==='done').length;
  const doing = A.filter(a => a.sc==='doing' || a.sc==='closing').length; // em andamento (inclui encerramento)
  const backlog = A.filter(a => a.sc==='todo').length; // backlog / não iniciado
  // "Outros" = tudo que não é concluída/andamento/backlog (cancelado, bloqueado, monitoramento, suporte).
  // Garante que os percentuais de composição sempre fechem 100%.
  const outros = total - done - doing - backlog;
  const nCancel = A.filter(a=>a.sc==='cancel').length;
  const nBlocked = A.filter(a=>a.sc==='blocked').length;
  const nMonitor = A.filter(a=>a.sc==='monitor').length;
  const nVendor = A.filter(a=>a.sc==='vendor').length;
  // monta a descrição do que entra em "Outros" (só os que têm contagem > 0)
  const outrosDesc = [
    nCancel?`${nCancel} cancel.`:'',
    nBlocked?`${nBlocked} bloq.`:'',
    nMonitor?`${nMonitor} monit.`:'',
    nVendor?`${nVendor} suporte`:''
  ].filter(Boolean).join(' · ');

  // Aviso de filtro ativo — mostra período, total de ações no recorte, e quantas ficaram de fora
  let dateNote = '';
  if(App.dateRange.mode !== 'all'){
    const fmt = d => d ? d.toLocaleDateString('pt-BR') : '∞';
    dateNote = `<div class="note" style="background:var(--neu-bg);color:var(--ink3)"><i class="ti ti-calendar-stats"></i><div>
      Período <b>${fmt(App.dateRange.from)} → ${fmt(App.dateRange.to)}</b>: <b>${total} ações</b> no recorte.`+
      (noDate>0 ? ` (${noDate} ações sem data não entram no filtro.)` : '')+
      ` Para ver tudo, limpe os campos de data no topo.</div></div>`;
  }

  // KPIs por fonte — calcula total e concluídas de cada uma individualmente
  const fontes = ['Projetos','Pipefy','Analytics','Chamados RPA'];
  const porFonte = fontes.map(f => {
    const sub = A.filter(a => a.fonte === f);
    const sd = sub.filter(a => a.sc === 'done').length;
    return {f, total:sub.length, done:sd};
  }).filter(x => x.total > 0); // exibe só fontes com dados

  // KPIs de composição (Concluídas + Em andamento + Backlog + Outros = 100%).
  let h = `<div class="sh">Visão executiva — todas as frentes</div>
  ${dateNote}
  <div class="krow k5">
    <div class="kpi il"><div class="knum">${total}</div><div class="klbl">Total de ações</div>
      <div class="ksub">${fontes.filter(f=>A.some(a=>a.fonte===f)).length} fontes integradas</div></div>
    <div class="kpi gl"><div class="knum">${pct(done,total)}%</div><div class="klbl">Concluídas</div>
      <div class="ksub">${done} de ${total}</div></div>
    <div class="kpi"><div class="knum">${pct(doing,total)}%</div><div class="klbl">Em andamento</div>
      <div class="ksub">${doing} de ${total}</div></div>
    <div class="kpi"><div class="knum">${pct(backlog,total)}%</div><div class="klbl">Backlog / não iniciadas</div>
      <div class="ksub">${backlog} de ${total}</div></div>
    <div class="kpi"><div class="knum">${pct(outros,total)}%</div><div class="klbl">Outros</div>
      <div class="ksub">${outrosDesc||'—'}</div></div>
  </div>`;

  h += `<div class="sh mt">Por fonte</div><div class="krow k5" style="grid-template-columns:repeat(${porFonte.length},1fr)">`;
  porFonte.forEach(x => {
    h += `<div class="kpi"><div class="knum sm">${x.total}</div><div class="klbl">${x.f}</div>
      <div class="ksub">${pct(x.done,x.total)}% concl.</div></div>`;
  });
  h += `</div>`;

  // Pizza de status: agrupa todos os itens pelos status codes internos
  const scAll = count(A, a => a.sc);
  const donutData = ['done','doing','todo','vendor','blocked','cancel','other'].map(k => (
    {label:STATUS_PT[k], value:scAll[k]||0, color:STATUS_COLOR[k]}
  )).filter(d => d.value > 0);

  // Barra de ações abertas por responsável (para cobrança — exclui concluídas e canceladas)
  const respCount = count(A.filter(a => a.resp && a.sc!=='done' && a.sc!=='cancel'), a => a.resp);
  const respTop = Object.entries(respCount).sort((a,b) => b[1]-a[1]);

  h += `<div class="two">
    <div class="card"><div class="card-title"><i class="ti ti-chart-pie"></i> Status das ações</div>${donut(donutData)}</div>
    <div class="card"><div class="card-title"><i class="ti ti-user-bolt"></i> Ações abertas por responsável<span class="rt">para cobrança</span></div>
      ${hbars(respTop, {max:8, lw:130})}</div>
  </div>`;

  const frCount = count(A.filter(a => a.frente), a => a.frente);
  h += `<div class="two">
    <div class="card"><div class="card-title"><i class="ti ti-building"></i> Ações por frente</div>
      ${hbars(Object.entries(frCount).sort((a,b)=>b[1]-a[1]), {max:8, lw:60, tot:Object.values(frCount).reduce((s,v)=>s+v,0)})}</div>
    <div class="card"><div class="card-title"><i class="ti ti-source-code"></i> Ações por fonte</div>
      ${hbars(fontes.map(f=>[f,A.filter(a=>a.fonte===f).length]).filter(e=>e[1]), {max:6, lw:100, tot:total})}</div>
  </div>`;

  // Rodapé de diagnóstico — mostra de onde vem cada número (auditoria).
  // Ajuda a identificar rapidamente se alguma fonte está com contagem inesperada.
  const diag = [
    `Pipefy: ${App.P.mel.length}`,
    `Projetos: ${App.P.proj.length}`,
    `Analytics: ${App.P.ana.length}`,
    `Chamados RPA: ${App.R.length}`,
    `Bots: ${App.B.length}`
  ].join(' · ');
  h += `<div style="font-size:10px;color:var(--ink4);margin-top:18px;padding-top:12px;border-top:1px solid var(--rule)">
    Contagem por fonte (total sem filtro de data): ${diag}. Total combinado: ${App.P.mel.length+App.P.proj.length+App.P.ana.length+App.R.length} ações.</div>`;

  document.getElementById('gov-content').innerHTML = h;
}

/*
 * buildHeatmap() — heatmap de ações Analytics abertas por prioridade × frente.
 * Linhas = prioridades 1 a 4. Colunas = frentes/áreas.
 * Células com mais ações abertas ficam mais vermelhas.
 * Só é exibido se houver dados de Analytics com prioridade preenchida.
 */
function buildHeatmap(){
  const {kept:anaF} = applyDate(App.P.ana);
  const {kept:projF} = applyDate(App.P.proj);
  const frentes = [...new Set([...anaF,...projF].map(x=>x.frente).filter(Boolean))].sort();
  if(!anaF.length || !frentes.length) return '';
  const prios = [1,2,3,4];
  const matrix = prios.map(p => frentes.map(f =>
    anaF.filter(a => a.prio===p && a.frente===f && a.sc!=='done').length
  ));
  if(!matrix.flat().some(v => v > 0)) return '';
  return `<div class="card"><div class="card-title"><i class="ti ti-grid-dots"></i> Ações Analytics abertas — prioridade × frente
    <span class="rt">foco executivo</span></div>
    <div style="overflow-x:auto">${heatmap(matrix, prios.map(p=>`Prioridade ${p}`), frentes)}</div></div>`;
}

/*
 * buildEvolucao(A) — gráfico de linha: % concluído acumulado mês a mês.
 *
 * COMO FUNCIONA:
 *   1. Filtra só ações que têm dtFim preenchida (sem data, não dá pra posicionar no tempo)
 *   2. Filtra só meses ATÉ o mês atual (evita plotar meses futuros com zero conclusões,
 *      o que achataria a curva artificialmente e causaria o bug visual do gráfico "parado")
 *   3. Para cada mês, conta quantas ações têm sc='done' e dtFim naquele mês
 *   4. Acumula progressivamente: cada ponto mostra o total de concluídas até aquele mês
 *   5. Divide pelo total de ações com data (denominador fixo) para obter o percentual
 *
 * POR QUE O GRÁFICO PODE PARAR ANTES DE HOJE:
 *   Se a última conclusão registrada na planilha foi em abril/26, o último ponto será abril/26.
 *   O gráfico avança automaticamente quando a base é atualizada com conclusões mais recentes.
 */
function buildEvolucao(A){
  const comData = A.filter(a => a.dtFim);
  if(comData.length < 3) return ''; // insuficiente para um gráfico útil
  const mesAtual = ym(HOJE);
  // exclui datas futuras (prazo de projetos ainda não entregues)
  const passadas = comData.filter(a => ym(a.dtFim) <= mesAtual);
  if(passadas.length < 3) return '';
  const meses = [...new Set(passadas.map(a => ym(a.dtFim)))].sort().filter(m => m <= mesAtual);
  if(meses.length < 2) return '';
  const denom = passadas.length; // denominador: total de ações com data no período
  let acum = 0;
  const pts = meses.map(m => {
    acum += passadas.filter(a => a.sc==='done' && ym(a.dtFim)===m).length;
    return {label: ymLabel(m), value: pct(acum, denom)};
  });
  const ultimoPct = pts[pts.length-1].value;
  return `<div class="card"><div class="card-title"><i class="ti ti-trending-up"></i> Evolução do % concluído
    <span class="rt">para comitê</span></div>
    ${lineChart(pts, {pctAxis:true, max:100, fmt:v=>v+'%'})}
    <div style="font-size:10px;color:var(--ink4);margin-top:8px">Conclusões acumuladas sobre ${denom} ações com data de conclusão registrada, de ${pts[0].label} a ${pts[pts.length-1].label}. Atinge ${ultimoPct}% no período medido.</div></div>`;
}


/* ============================================================
   VIEW: PROJETOS
   ============================================================
   Apresenta o portfólio de projetos da área com:
   - KPIs pelo fluxo real do GBS (Diagnóstico→Planejamento→Execução→Encerramento→Monitoramento)
   - Donut por status, barras por frente/área cliente
   - Lista com filtros (busca, responsável, status, frente)
   - Expand inline ao clicar: revela campos ricos da planilha (descrição, equipes, etc.)
   ============================================================ */

function buildProj(){
  const {kept:P, noDate} = applyDate(App.P.proj);
  document.getElementById('proj-empty').style.display = (P.length||noDate) ? 'none' : 'block';
  document.getElementById('proj-content').style.display = (P.length||noDate) ? 'block' : 'none';
  if(!P.length && !noDate) return;

  // Contagens por código de status — respeitam o fluxo real do GBS
  const done    = P.filter(p => p.sc==='done').length;     // concluído (ainda não existe na base)
  const doing   = P.filter(p => p.sc==='doing').length;    // em execução
  // Encerramento + Monitoramento agrupados (ambos = projeto entregue / em fase final)
  const finalizando = P.filter(p => p.sc==='closing' || p.sc==='monitor').length;

  let h = `<div class="sh">Projetos</div>
  <div class="krow">
    <div class="kpi"><div class="knum">${P.length}</div><div class="klbl">Total</div></div>
    <div class="kpi il"><div class="knum">${doing}</div><div class="klbl">Em execução</div></div>
    <div class="kpi gl"><div class="knum">${finalizando}</div><div class="klbl">Em fase de encerramento</div>
      <div class="ksub">encerramento / monitoramento</div></div>
    <div class="kpi"><div class="knum">${pct(done+finalizando,P.length)}%</div><div class="klbl">Entregues ou em fase final</div>
      <div class="ksub">${done+finalizando} de ${P.length}</div></div>
  </div>`;

  // Frente vem do campo AreaCliente (novo) ou Frente (legado)
  const frCount = count(P.filter(p => p.frente), p => p.frente);
  // donut: cada status com cor distinta e coerente com o avanço no fluxo
  //   Não iniciado = cinza | Em andamento = azul | Encerr./Monit. = verde (fase final/entregue)
  //   Concluído = verde escuro | Bloqueado = âmbar | Cancelado = vermelho
  const donutProj = [
    {label:'Concluído',     value:P.filter(p=>p.sc==='done').length,                       color:'#2f7d4f'},
    {label:'Em andamento',  value:P.filter(p=>p.sc==='doing').length,                      color:'#3b82c4'},
    {label:'Encerr./Monit.',value:P.filter(p=>p.sc==='closing'||p.sc==='monitor').length,  color:'#5bbd7a'},
    {label:'Não iniciado',  value:P.filter(p=>p.sc==='todo').length,                       color:'#b8bcc2'},
    {label:'Bloqueado',     value:P.filter(p=>p.sc==='blocked').length,                    color:'#d89b3c'},
    {label:'Cancelado',     value:P.filter(p=>p.sc==='cancel').length,                     color:'#c75d5d'}
  ].filter(d=>d.value);
  h += `<div class="two">
    <div class="card"><div class="card-title"><i class="ti ti-chart-pie"></i> Por status</div>
      ${donut(donutProj)}</div>
    <div class="card"><div class="card-title"><i class="ti ti-building"></i> Por frente / área cliente</div>
      ${Object.keys(frCount).length ? hbars(Object.entries(frCount).sort((a,b)=>b[1]-a[1]),{max:8,lw:80,tot:P.length}) : '<div style="font-size:12px;color:var(--ink4)">Sem dados de área</div>'}</div>
  </div>`;

  // Monta os selects de filtro dinamicamente a partir dos valores presentes nos dados
  const pessoas = [...new Set(P.map(p => p.resp).filter(Boolean))].sort();
  h += `<div class="filters" style="margin-top:4px">
    <input type="text" id="proj-q" placeholder="Buscar projeto, responsável, frente..." oninput="renderProjList()" style="flex:1;max-width:300px">
    <label>Responsável</label>
    <select id="proj-fp" onchange="renderProjList()"><option value="">Todos</option>
      ${pessoas.map(p=>`<option>${p}</option>`).join('')}</select>
    <label>Status</label>
    <select id="proj-fs" onchange="renderProjList()"><option value="">Todos</option>
      ${[...new Set(P.map(p=>p.statusRaw).filter(Boolean))].sort().map(s=>`<option>${s}</option>`).join('')}</select>
    <label>Frente</label>
    <select id="proj-ff" onchange="renderProjList()"><option value="">Todas</option>
      ${[...new Set(P.map(p=>p.frente).filter(Boolean))].sort().map(f=>`<option>${f}</option>`).join('')}</select>
    <span style="font-size:11px;color:var(--ink4);margin-left:auto" id="proj-count"></span>
  </div>`;
  h += `<div class="card np"><div class="ilist" id="proj-list" style="border:none;border-radius:0"></div></div>`;
  document.getElementById('proj-content').innerHTML = h;
  renderProjList();
  setBadge('nb-proj', P.length+' proj', '');
}

/*
 * renderProjList() — renderiza a lista filtrada de projetos.
 * Chamado por buildProj() e sempre que um filtro muda (busca, responsável, status, frente).
 * Aplica o filtro de data global + os filtros locais da aba.
 * Mantém o estado de projetos expandidos (App.projOpen) entre re-renderizações.
 */
function renderProjList(){
  const {kept:P} = applyDate(App.P.proj);
  const q  = (document.getElementById('proj-q')?.value||'').toLowerCase();
  const fp = document.getElementById('proj-fp')?.value||'';
  const fs = document.getElementById('proj-fs')?.value||'';
  const ff = document.getElementById('proj-ff')?.value||'';
  // busca em título, responsável, frente, descrição e próximos passos
  const vis = P.filter(p =>
    (!q || (p.titulo+' '+p.resp+' '+p.frente+' '+(p.descricao||'')+' '+(p.proximos||'')).toLowerCase().includes(q)) &&
    (!fp || p.resp===fp) && (!fs || p.statusRaw===fs) && (!ff || p.frente===ff)
  ).sort((a,b) => (b.prog||0) - (a.prog||0)); // ordena do mais avançado para o menos
  const cnt = document.getElementById('proj-count');
  if(cnt) cnt.textContent = `${vis.length} de ${P.length}`;
  if(!App.projOpen) App.projOpen = new Set();
  let h = vis.map(p => {
    const bd = STATUS_BADGE[p.sc];
    const lateTag = p.dtFim && p.dtFim<HOJE && p.sc!=='done' && p.sc!=='cancel' && p.sc!=='monitor';
    const key = String(p.num||p.titulo); // chave única para o estado aberto/fechado
    const open = App.projOpen.has(key);
    const fase = projFase(p.statusRaw); // número da fase (1 a 5)
    // badge no formato "3 · Execução" quando há fase mapeada
    const badgeTxt = fase ? `${fase} · ${p.statusRaw}` : p.statusRaw;
    // indicador de status: bolinha colorida em CSS puro (não depende de fonte de ícone)
    // a bolinha tem cor fixa por status; o fundo do quadrado usa variável de tema
    // (--neu-bg) para se adaptar a claro/escuro sem virar mancha branca no dark mode
    const dotColor = {
      done:'#3fa46a', doing:'#4a90d9', closing:'#d49a4a', monitor:'#6fa0e0',
      todo:'#9a9a92', blocked:'#d4a93c', cancel:'#d46a6a', vendor:'#8f6fd0', other:'#9a9a92'
    };
    const dc = dotColor[p.sc] || dotColor.other;
    return `<div class="proj-row ${open?'open':''}" data-k="${key.replace(/"/g,'')}">
      <div class="icard" onclick="toggleProj('${key.replace(/'/g,"\\'").replace(/"/g,'&quot;')}')" style="cursor:pointer">
        <div class="iico" style="background:var(--neu-bg)">
          <span style="width:11px;height:11px;border-radius:50%;background:${dc};display:block"></span>
        </div>
        <div class="imain"><div class="ititle">${p.titulo}</div>
          <div class="isub">
            ${p.frente?`<span class="apill">${p.frente}</span>`:''}
            ${p.resp?`<span>${p.resp}</span>`:''}
            ${p.dtFim?`<span style="color:${lateTag?'var(--err)':'var(--ink4)'}">· ${p.dtFim.toLocaleDateString('pt-BR')}${lateTag?` ⚠ atrasado na fase ${fase} (${p.statusRaw})`:''}</span>`:''}
          </div>
          ${p.prog!=null?`<div class="stk" style="max-width:280px"><div style="width:${Math.round(p.prog*100)}%;background:var(--info)"></div></div>`:''}
        </div>
        <div class="iright">
          ${p.prog!=null?`<span style="font-size:11px;color:var(--ink3);font-weight:600">${Math.round(p.prog*100)}%</span>`:''}
          <span class="badge ${bd}">${badgeTxt}</span>
          <span style="color:var(--ink4);font-size:11px;margin-left:6px;display:inline-block;transition:transform .15s;transform:rotate(${open?'90deg':'0deg'})">▶</span>
        </div>
      </div>
      ${open ? projDetails(p) : ''}
    </div>`;
  }).join('');
  const el = document.getElementById('proj-list');
  if(el) el.innerHTML = h || '<div class="empty" style="padding:24px">Nenhum projeto neste filtro</div>';
}

/*
 * toggleProj(key) — abre ou fecha o painel de detalhes de um projeto.
 * Usa um Set (App.projOpen) para manter quais projetos estão expandidos.
 * Se a chave já está no Set → remove (fecha). Se não está → adiciona (abre).
 * Re-renderiza a lista após para refletir a mudança.
 */
function toggleProj(key){
  if(!App.projOpen) App.projOpen = new Set();
  if(App.projOpen.has(key)) App.projOpen.delete(key);
  else App.projOpen.add(key);
  renderProjList();
}

/*
 * projDetails(p) — gera o HTML do painel expandido de detalhes de um projeto.
 * Só renderiza os blocos de campos que estão preenchidos na planilha.
 * Campos vazios não aparecem (nem como placeholder vazio).
 * O layout é em grid 2 colunas (ou 1 coluna em mobile).
 */
function projDetails(p){
  const fmt = txt => String(txt||'').trim().replace(/\n/g,'<br>');
  const blocks = [];
  if(p.descricao)   blocks.push({lbl:'Descrição',              val:fmt(p.descricao)});
  if(p.equipes)     blocks.push({lbl:'Equipes envolvidas',     val:fmt(p.equipes)});
  if(p.focal)       blocks.push({lbl:'Ponto focal',            val:p.focal});
  if(p.atvConcl)    blocks.push({lbl:'Atividades concluídas',  val:fmt(p.atvConcl)});
  if(p.atvAndam)    blocks.push({lbl:'Atividades em andamento',val:fmt(p.atvAndam)});
  if(p.proximos)    blocks.push({lbl:'Próximos passos',        val:fmt(p.proximos)});
  if(p.comentarios) blocks.push({lbl:'Comentários',           val:fmt(p.comentarios)});
  if(!blocks.length) return `<div class="proj-detail"><div style="font-size:12px;color:var(--ink4);font-style:italic">Sem detalhes preenchidos na planilha.</div></div>`;
  return `<div class="proj-detail">` + blocks.map(b =>
    `<div class="pd-block"><div class="pd-lbl">${b.lbl}</div><div class="pd-val">${b.val}</div></div>`
  ).join('') + `</div>`;
}


/* ============================================================
   VIEW: PIPEFY MELHORIAS
   ============================================================
   FILTRO DE DATA: usa DataConclusaoRealDesenvolvimento.
   A maioria das melhorias em backlog/planejamento NÃO tem essa data.
   Ao filtrar por período, elas ficam fora — comportamento correto e documentado.
   Para ver todas as melhorias, use o filtro de Status dentro da aba.
   ============================================================ */
function buildMel(){
  const {kept:M, noDate} = applyDate(App.P.mel);
  document.getElementById('mel-empty').style.display  = App.P.mel.length ? 'none' : 'block';
  document.getElementById('mel-content').style.display = App.P.mel.length ? 'block' : 'none';
  if(!App.P.mel.length) return;
  const done    = M.filter(m => m.sc==='done').length;
  const backlog = M.filter(m => m.sc==='todo').length;
  const blocked = M.filter(m => m.sc==='blocked').length;

  // Nota de período: explica quantas melhorias ficaram de fora por não ter data de conclusão
  let dn = '';
  if(App.dateRange.mode !== 'all'){
    dn = `<div class="note" style="background:var(--neu-bg);color:var(--ink3)"><i class="ti ti-calendar-stats"></i><div>
      Período aplicado: <b>${M.length} melhorias</b> com conclusão no recorte.` +
      (noDate>0 ? ` ${noDate} sem data de conclusão não entram no filtro.` : '') + `</div></div>`;
  }

  // "Fluxos (processos)" = número de NomeFluxo únicos no recorte atual
  // Isso responde "quantos processos distintos foram tratados no período"
  const fluxosUnicos = new Set(M.map(m => m.fluxo).filter(Boolean)).size;

  let h = dn + `<div class="sh">Pipefy — Melhorias & Ajustes</div>
  <div class="krow k5">
    <div class="kpi"><div class="knum">${M.length}</div><div class="klbl">Total melhorias</div></div>
    <div class="kpi gl"><div class="knum">${done}</div><div class="klbl">Concluídas</div><div class="ksub">${pct(done,M.length)}% do total</div></div>
    <div class="kpi"><div class="knum">${backlog}</div><div class="klbl">Backlog</div></div>
    <div class="kpi wl"><div class="knum">${blocked}</div><div class="klbl">Bloqueadas</div></div>
    <div class="kpi il"><div class="knum">${fluxosUnicos}</div><div class="klbl">Fluxos (processos)</div><div class="ksub">distintos no recorte</div></div>
  </div>`;

  h += `<div class="two">
    <div class="card"><div class="card-title"><i class="ti ti-chart-pie"></i> Status</div>
      ${donut(['done','doing','todo','vendor','blocked','cancel'].map(k=>({label:STATUS_PT[k],value:M.filter(m=>m.sc===k).length,color:STATUS_COLOR[k]})).filter(d=>d.value))}</div>
    <div class="card"><div class="card-title"><i class="ti ti-building"></i> Por frente</div>
      ${hbars(Object.entries(count(M,m=>m.frente)).sort((a,b)=>b[1]-a[1]),{max:8,lw:60,tot:M.length})}</div>
  </div>`;
  h += `<div class="two">
    <div class="card"><div class="card-title"><i class="ti ti-stack-2"></i> Por complexidade</div>
      ${hbars(Object.entries(count(M.filter(m=>m.complex),m=>m.complex)).sort((a,b)=>b[1]-a[1]),{max:6,lw:90})}</div>
    <div class="card"><div class="card-title"><i class="ti ti-user-code"></i> Por responsável</div>
      ${hbars(Object.entries(count(M.filter(m=>m.resp),m=>m.resp)).sort((a,b)=>b[1]-a[1]),{max:8,lw:130})}</div>
  </div>`;
  document.getElementById('mel-content').innerHTML = h;
  setBadge('nb-mel', M.length, '');
}


/* ============================================================
   VIEW: ANALYTICS
   ============================================================
   FILTRO DE DATA: usa DataAbertura (início do desenvolvimento)
   ou DataFechamento (término da validação) como fallback.
   ~49 de 161 atividades têm DataAbertura; 36 têm DataFechamento.
   As demais (~76) não têm data na planilha de origem.
   ============================================================ */
function buildAna(){
  const {kept:A, noDate} = applyDate(App.P.ana);
  document.getElementById('ana-empty').style.display  = App.P.ana.length ? 'none' : 'block';
  document.getElementById('ana-content').style.display = App.P.ana.length ? 'block' : 'none';
  if(!App.P.ana.length) return;
  const done  = A.filter(a => a.sc==='done').length;
  const doing = A.filter(a => a.sc==='doing').length;
  const todo  = A.filter(a => a.sc==='todo').length;
  const comData = A.filter(a => a.dtFim).length;

  // Nota informativa: quantas atividades têm data vs. quantas não têm
  let dn = '';
  if(App.dateRange.mode !== 'all'){
    dn = `<div class="note" style="background:var(--neu-bg);color:var(--ink3)"><i class="ti ti-calendar-stats"></i><div>
      Período aplicado: <b>${A.length} atividades</b> no recorte.` +
      (noDate>0 ? ` ${noDate} sem data não entram no filtro.` : '') + `</div></div>`;
  } else if(comData < A.length){
    // sem filtro ativo: avisa quantas têm data (relevante para o gráfico de evolução)
    dn = `<div class="note"><i class="ti ti-info-circle"></i><div>${comData} de ${A.length} atividades têm data registrada. As ${A.length-comData} restantes não têm data preenchida na base, então não entram nos cálculos por período.</div></div>`;
  }

  const prioCount = count(A.filter(a => a.prio), a => 'Prioridade '+a.prio);
  let h = dn + `<div class="sh">Analytics</div>
  <div class="krow">
    <div class="kpi"><div class="knum">${A.length}</div><div class="klbl">Total</div></div>
    <div class="kpi gl"><div class="knum">${done}</div><div class="klbl">Concluídas</div><div class="ksub">${pct(done,A.length)}%</div></div>
    <div class="kpi il"><div class="knum">${doing}</div><div class="klbl">Em andamento</div></div>
    <div class="kpi"><div class="knum">${todo}</div><div class="klbl">Não iniciadas</div></div>
  </div>`;
  h += `<div class="two">
    <div class="card"><div class="card-title"><i class="ti ti-chart-pie"></i> Status</div>
      ${donut(['done','doing','todo','blocked','cancel'].map(k=>({label:STATUS_PT[k],value:A.filter(a=>a.sc===k).length,color:STATUS_COLOR[k]})).filter(d=>d.value))}</div>
    <div class="card"><div class="card-title"><i class="ti ti-flag"></i> Por prioridade</div>
      ${hbars(Object.entries(prioCount).sort((a,b)=>{const na=+a[0].match(/\d+/),nb=+b[0].match(/\d+/);return na-nb;}),{max:10,lw:90})}</div>
  </div>`;
  h += `<div class="two">
    <div class="card"><div class="card-title"><i class="ti ti-building"></i> Por frente</div>
      ${hbars(Object.entries(count(A.filter(a=>a.frente),a=>a.frente)).sort((a,b)=>b[1]-a[1]),{max:8,lw:60,tot:A.length})}</div>
    <div class="card"><div class="card-title"><i class="ti ti-user"></i> Por responsável</div>
      ${hbars(Object.entries(count(A.filter(a=>a.resp),a=>a.resp)).sort((a,b)=>b[1]-a[1]),{max:8,lw:140})}</div>
  </div>`;
  // Heatmap prioridade × frente (movido da Governança para cá)
  h += buildHeatmap();
  document.getElementById('ana-content').innerHTML = h;
  setBadge('nb-ana', A.length, '');
}

// Helper: atualiza o badge numérico de uma aba no menu de navegação
function setBadge(id, txt, cls){
  const e = document.getElementById(id);
  if(e){ e.textContent=txt; e.className='nb'+(cls?' '+cls:''); }
}


/* ============================================================
   VIEW: CHAMADOS RPA (5 sub-abas)
   ============================================================
   FILTRO DE DATA: usa 'criado' (data de abertura do chamado).
   Todos os 625 chamados têm essa data preenchida.
   Sub-abas: Visão geral, Top bots, Tipos de problema, Tempo de resolução, Chamados.
   ============================================================ */
function buildRPAChamados(){
  const {kept:R, noDate} = applyDate(App.R);
  const emptyEl = document.getElementById('rpa-empty');
  emptyEl.style.display  = App.R.length ? 'none' : 'block';
  document.getElementById('rpa-content').style.display = App.R.length ? 'block' : 'none';
  // se houve aviso de arquivo errado, mostra mensagem específica em vez do texto padrão
  if(!App.R.length){
    emptyEl.innerHTML = App.rpaWarn
      ? `<i class="ti ti-alert-triangle" style="color:var(--warn)"></i>${App.rpaWarn}`
      : `<i class="ti ti-robot"></i>Carregue o relatório de Chamados RPA`;
    return;
  }

  const total  = R.length;
  const venc   = R.filter(r => r.vencido).length;
  const concl  = R.filter(r => r.fase.toLowerCase().includes('conclu')).length;
  const abertos= total - concl;
  const reexec = R.filter(r => r.problema.toLowerCase().includes('reexecu')).length;

  // Insight dinâmico: texto varia conforme o percentual real de vencidos
  // "Processos distintos" = número de bots/processos únicos que geraram chamados
  const procUnicos = new Set(R.map(r=>r.processo).filter(p=>p&&p!=='(sem processo)')).size;

  let dn = '';
  if(App.dateRange.mode !== 'all'){
    dn = `<div class="note" style="background:var(--neu-bg);color:var(--ink3)"><i class="ti ti-calendar-stats"></i><div>
      Período aplicado: <b>${total} chamados</b> abertos no recorte.` +
      (noDate>0 ? ` ${noDate} sem data de criação não entram no filtro.` : '') + `</div></div>`;
  }

  // Filtro local por status (fase) — opções derivadas das fases presentes nos dados
  const fasesDisp = [...new Set(R.map(r=>r.fase).filter(Boolean))].sort();
  const filtroStatus = `<div class="filters" style="margin-bottom:14px">
    <label>Status do chamado</label>
    <select id="rpa-fs" onchange="renderRPAStatus()"><option value="">Todos</option>
      ${fasesDisp.map(f=>`<option>${f}</option>`).join('')}</select>
    <span style="font-size:11px;color:var(--ink4);margin-left:auto" id="rpa-fs-count"></span>
  </div>`;

  let v = dn + filtroStatus + `<div id="rpa-visao-kpis"></div>`;
  document.getElementById('rpage-visao').innerHTML = v;
  // os KPIs e gráficos são renderizados por renderRPAStatus (respeita o filtro de status)
  renderRPAStatus();

  // Sub-aba: Top Bots (processos com mais chamados de manutenção)
  const porProcV = count(R, r => r.processo);
  const procList = Object.entries(porProcV).filter(e=>e[0]!=='(sem processo)').sort((a,b)=>b[1]-a[1]);
  let b = `<div class="card"><div class="card-title"><i class="ti ti-trophy"></i> Top bots por nº de manutenções<span class="rt">${procList.length} processos</span></div>
    ${hbars(procList,{max:15,lw:240,color:'var(--err)',fixedLabel:true})}</div>`;
  document.getElementById('rpage-bots').innerHTML = b;

  // Sub-aba: Tipos de problema + tabela problema × fase
  const porProb = count(R, r => r.problema);
  const porReexec = count(R.filter(r=>r.reexec), r => r.reexec);
  let p = `<div class="card"><div class="card-title"><i class="ti ti-alert-circle"></i> Tipos de problema</div>
      ${hbars(Object.entries(porProb).sort((a,b)=>b[1]-a[1]),{max:8,lw:320,tot:total,fixedLabel:true})}</div>
    <div class="card"><div class="card-title"><i class="ti ti-refresh"></i> Admite reexecução?</div>
      ${donut(Object.entries(porReexec).map(([k,vv],i)=>({label:k,value:vv,color:i===0?'var(--ok)':'var(--warn)'})))}</div>`;
  const fases = [...new Set(R.map(r=>r.fase))];
  const probs = Object.entries(porProb).sort((a,b)=>b[1]-a[1]).slice(0,5).map(e=>e[0]);
  let tbl = '<table class="tbl"><thead><tr><th>Problema</th>'+fases.map(f=>`<th>${f}</th>`).join('')+'<th>Total</th></tr></thead><tbody>';
  probs.forEach(pr => {
    const sub = R.filter(r=>r.problema===pr);
    tbl += `<tr><td style="color:var(--ink)">${pr}</td>`+fases.map(f=>`<td>${sub.filter(r=>r.fase===f).length||'—'}</td>`).join('')+`<td style="font-weight:600">${sub.length}</td></tr>`;
  });
  tbl += '</tbody></table>';
  p += `<div class="card"><div class="card-title"><i class="ti ti-table"></i> Problema × fase atual</div><div style="overflow-x:auto">${tbl}</div></div>`;
  document.getElementById('rpage-prob').innerHTML = p;

  // Sub-aba: Tempo de resolução por fase e por bot
  const avg = (arr,k) => { const v=arr.filter(r=>r[k]!=null).map(r=>r[k]); return v.length?(v.reduce((s,x)=>s+x,0)/v.length).toFixed(1):'—'; };
  let t = `<div class="krow">
    <div class="kpi"><div class="knum sm">${avg(R,'tIdent')}</div><div class="klbl">Média dias · Identificação</div></div>
    <div class="kpi"><div class="knum sm">${avg(R,'tDesenv')}</div><div class="klbl">Média dias · Desenvolvimento</div></div>
    <div class="kpi"><div class="knum sm">${avg(R,'tReexec')}</div><div class="klbl">Média dias · Reexecução</div></div>
    <div class="kpi"><div class="knum sm">${R.filter(r=>r.tIdent!=null||r.tDesenv!=null).length}</div><div class="klbl">Chamados com tempo medido</div></div>
  </div>`;
  // tempo médio por bot (só bots com 3+ chamados para ter significância estatística)
  const procTempo={};
  R.forEach(r=>{ const tt=(r.tIdent||0)+(r.tDesenv||0); if(tt>0){if(!procTempo[r.processo])procTempo[r.processo]={s:0,n:0};procTempo[r.processo].s+=tt;procTempo[r.processo].n++;} });
  const procAvg = Object.entries(procTempo).filter(e=>e[0]!=='(sem processo)'&&e[1].n>=3).map(([k,v])=>[k,+(v.s/v.n).toFixed(1)]).sort((a,b)=>b[1]-a[1]);
  t += `<div class="card"><div class="card-title"><i class="ti ti-clock"></i> Tempo médio de resolução por bot (dias, mín. 3 chamados)</div>
    ${hbars(procAvg,{max:12,lw:240,color:'var(--warn)',fixedLabel:true})}</div>`;
  document.getElementById('rpage-tempo').innerHTML = t;

  // Sub-aba: Lista paginada de chamados com busca
  let l = `<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
    <input type="text" id="rsearch" placeholder="Buscar por código, processo, solicitante..." oninput="renderRPALista()" style="flex:1;max-width:360px">
    <span style="font-size:11px;color:var(--ink4)" id="rlista-count">${total} chamados</span></div>
    <div class="card np"><div style="overflow-x:auto"><table class="tbl" style="margin:0">
    <thead><tr><th style="padding-left:20px">Código</th><th>Processo</th><th>Problema</th><th>Fase</th><th>Mês</th><th style="padding-right:20px">Status</th></tr></thead>
    <tbody id="rlista-body"></tbody></table></div></div>`;
  document.getElementById('rpage-lista').innerHTML = l;
  renderRPALista();
  setBadge('nb-rpa', venc>0 ? venc+' venc' : total, venc>0?'warn':'');
}

/*
 * renderRPAStatus() — renderiza os KPIs e gráficos da visão geral de Chamados RPA,
 * respeitando o filtro de data global E o filtro local de status (fase).
 * Inclui: KPIs, volume mensal, abertura por dia útil (seg-sex) e tickets por área.
 */
function renderRPAStatus(){
  const {kept:R0} = applyDate(App.R);
  const fs = document.getElementById('rpa-fs')?.value || '';
  const R = fs ? R0.filter(r => r.fase === fs) : R0;

  const total  = R.length;
  const venc   = R.filter(r => r.vencido).length;
  const concl  = R.filter(r => r.fase.toLowerCase().includes('conclu')).length;
  const abertos= total - concl;
  const reexec = R.filter(r => r.problema.toLowerCase().includes('reexecu')).length;
  const pctVenc = pct(venc, total);
  const procUnicos = new Set(R.map(r=>r.processo).filter(p=>p&&p!=='(sem processo)')).size;

  const cnt = document.getElementById('rpa-fs-count');
  if(cnt) cnt.textContent = fs ? `${total} chamados em "${fs}"` : `${total} chamados`;

  let v = `<div class="krow k5">
    <div class="kpi"><div class="knum">${total}</div><div class="klbl">Total chamados</div><div class="ksub">${procUnicos} processos distintos</div></div>
    <div class="kpi gl"><div class="knum">${concl}</div><div class="klbl">Concluídos</div><div class="ksub">${pct(concl,total)}%</div></div>
    <div class="kpi il"><div class="knum">${abertos}</div><div class="klbl">Abertos</div></div>
    <div class="kpi dl"><div class="knum">${venc}</div><div class="klbl">Vencidos</div><div class="ksub">${pctVenc}% do total</div></div>
    <div class="kpi wl"><div class="knum">${reexec}</div><div class="klbl">Reexecuções</div></div>
  </div>`;

  // Volume mensal (barras cinza=total, vermelho=vencidos)
  const porMes={}, porMesV={};
  R.forEach(r=>{ if(r.mes){ porMes[r.mes]=(porMes[r.mes]||0)+1; if(r.vencido) porMesV[r.mes]=(porMesV[r.mes]||0)+1; } });
  const meses = Object.keys(porMes).sort();
  const mx = Math.max(...meses.map(m=>porMes[m]), 1);
  let vol = '<div class="vchart">';
  meses.slice(-12).forEach(m => {
    const t=porMes[m]||0, vv=porMesV[m]||0;
    vol += `<div class="vcol"><div class="vcol-bars">
      <div class="vbar-total" style="height:${Math.round(t/mx*100)}%"></div>
      <div class="vbar-inc" style="height:${Math.round(vv/mx*100)}%"></div>
    </div><div class="vcol-lbl">${ymLabel(m)}</div></div>`;
  });
  vol += '</div><div class="vlegend"><div class="vleg"><div class="vleg-dot" style="background:var(--ink);opacity:.3"></div>Total</div><div class="vleg"><div class="vleg-dot" style="background:var(--err)"></div>Vencidos</div></div>';

  v += `<div class="two">
    <div class="card"><div class="card-title"><i class="ti ti-chart-bar"></i> Volume mensal</div>${vol}</div>
    <div class="card"><div class="card-title"><i class="ti ti-calendar"></i> Abertura por dia da semana</div>
      ${hbars(DOW.slice(0,5).map((d,i)=>[d,R.filter(r=>r.dow===i).length]),{max:5,lw:40})}</div>
  </div>`;

  // Tickets por área (área herdada do inventário de bots via match de nome)
  const porArea = count(R, r => r.area || '(não mapeada)');
  const areaEntries = Object.entries(porArea).sort((a,b)=>b[1]-a[1]);
  v += `<div class="two">
    <div class="card"><div class="card-title"><i class="ti ti-building"></i> Tickets por área</div>
      ${hbars(areaEntries,{max:12,lw:120,tot:total,fixedLabel:true})}</div>
    <div class="card"><div class="card-title"><i class="ti ti-chart-pie"></i> Status (fase) dos chamados</div>
      ${donut(Object.entries(count(R,r=>r.fase)).map(([k,vv],i)=>({label:k,value:vv,color:['var(--ok)','var(--info)','var(--warn)','var(--err)','#7c5cbf','var(--ink4)'][i%6]})))}</div>
  </div>`;

  document.getElementById('rpa-visao-kpis').innerHTML = v;
}

/*
 * renderRPALista() — renderiza a lista paginada de chamados.
 * Aplica filtro de data global + busca por texto.
 * Exibe até 1000 chamados; avisa se houver mais.
 */
function renderRPALista(){
  const {kept:R} = applyDate(App.R);
  const q = (document.getElementById('rsearch')?.value||'').toLowerCase();
  const vis = q ? R.filter(r=>(r.cod+r.processo+r.solicitante+r.problema).toLowerCase().includes(q)) : R;
  const cnt = document.getElementById('rlista-count');
  if(cnt) cnt.textContent = vis.length+' chamados';
  let h = vis.slice(0,1000).map(r => {
    const concl = r.fase.toLowerCase().includes('conclu');
    return `<tr>
      <td style="padding-left:20px;font-family:monospace;font-size:11px;color:var(--ink3)">${r.cod}</td>
      <td style="font-size:11px">${r.processo}</td>
      <td style="font-size:11px;color:var(--ink3)">${r.problema}</td>
      <td><span class="badge ${concl?'ok':'info'}" style="font-size:9px">${r.fase}</span></td>
      <td style="font-size:11px;color:var(--ink4)">${ymLabel(r.mes)}</td>
      <td style="padding-right:20px">${r.vencido?'<span class="badge red">Vencido</span>':'<span class="badge neu">No prazo</span>'}</td></tr>`;
  }).join('');
  if(vis.length > 1000) h += `<tr><td colspan="6" style="text-align:center;padding:16px;color:var(--ink4);font-size:12px">Exibindo 1000 de ${vis.length} — use a busca para refinar</td></tr>`;
  const b = document.getElementById('rlista-body');
  if(b) b.innerHTML = h;
}


/* ============================================================
   VIEW: INVENTÁRIO DE BOTS
   ============================================================
   FILTRO DE DATA DIFERENTE: usa o ANO de entrada em produção (AnoPRD),
   não uma data de ação. Ao filtrar "2026", mostra apenas bots que
   entraram em PRD em 2026 (não chamados nem melhorias de 2026).
   ============================================================ */
function buildBots(){
  // Filtro especial por AnoPRD (extrai apenas o ano do range de datas selecionado)
  const dr = App.dateRange;
  let B = App.B;
  let dn = '';
  if(dr.mode !== 'all'){
    const yFrom = dr.from ? dr.from.getFullYear() : null;
    const yTo   = dr.to   ? dr.to.getFullYear()   : null;
    B = App.B.filter(b => {
      const y = parseInt(b.anoPrd);
      if(isNaN(y)) return false;            // sem AnoPRD: fica fora do filtro
      if(yFrom!=null && y<yFrom) return false;
      if(yTo!=null   && y>yTo)   return false;
      return true;
    });
    const semAno = App.B.filter(b => isNaN(parseInt(b.anoPrd))).length;
    dn = `<div class="note" style="background:var(--neu-bg);color:var(--ink3)"><i class="ti ti-calendar-stats"></i><div>
      Período aplicado: <b>${B.length} bots</b> que entraram em produção entre ${yFrom||'∞'} e ${yTo||'∞'}.` +
      (semAno>0 ? ` ${semAno} bots sem ano de PRD não entram no filtro.` : '') + `</div></div>`;
  }
  document.getElementById('bots-empty').style.display  = App.B.length ? 'none' : 'block';
  document.getElementById('bots-content').style.display = App.B.length ? 'block' : 'none';
  if(!App.B.length) return;

  const prd       = B.filter(b=>b.status==='PRD').length;
  const dev       = B.filter(b=>b.status==='DEV').length;
  const backlog   = B.filter(b=>b.status==='BACKLOG').length;
  const cancel    = B.filter(b=>b.status==='CANCELADO'||b.status==='DESATIVADO').length;

  let h = dn + `<div class="sh">Inventário de Bots — RPA</div>
  <div class="krow">
    <div class="kpi"><div class="knum">${B.length}</div><div class="klbl">Total de bots</div></div>
    <div class="kpi gl"><div class="knum">${prd}</div><div class="klbl">Em produção</div><div class="ksub">${pct(prd,B.length)}% do total</div></div>
    <div class="kpi wl"><div class="knum">${dev}</div><div class="klbl">Em desenvolvimento</div></div>
    <div class="kpi"><div class="knum">${backlog}</div><div class="klbl">Backlog</div></div>
  </div>`;

  const prdBots = B.filter(b=>b.status==='PRD');
  // Áreas exibidas no gráfico — apenas as 5 frentes principais do GBS
  const AREAS_PRINCIPAIS = ['P2P','TAX','H2R','O2C','R2R'];
  const areaBots = Object.entries(count(prdBots, b => b.area))
    .filter(([area]) => AREAS_PRINCIPAIS.includes(area.toUpperCase()))
    .sort((a,b) => b[1]-a[1]);
  h += `<div class="two">
    <div class="card"><div class="card-title"><i class="ti ti-building"></i> Bots em PRD por área</div>
      ${hbars(areaBots,{max:5,lw:60,tot:prd})}</div>
    <div class="card"><div class="card-title"><i class="ti ti-world"></i> Por perímetro</div>
      ${donut(Object.entries(count(prdBots,b=>b.perimetro)).map(([k,v],i)=>({label:k,value:v,color:['var(--info)','var(--ok)','var(--warn)','var(--err)'][i%4]})))}</div>
  </div>`;
  h += `<div class="two">
    <div class="card"><div class="card-title"><i class="ti ti-alert-octagon"></i> Por criticidade</div>
      ${hbars([1,2,3,4].map(c=>['Criticidade '+c,prdBots.filter(b=>b.criticidade===c).length]).filter(e=>e[1]),{max:4,lw:100})}</div>
    <div class="card"><div class="card-title"><i class="ti ti-repeat"></i> Por frequência</div>
      ${hbars(Object.entries(count(prdBots.filter(b=>b.freq),b=>b.freq)).sort((a,b)=>b[1]-a[1]),{max:6,lw:80})}</div>
  </div>`;

  // Cruzamento inventário × chamados (só se o relatório de RPA estiver carregado)
  if(App.R.length) h += buildBotsCruzamento(B);

  // Lista filtrada por status e área
  h += `<div class="filters" style="margin-top:8px">
    <label>Status</label><select id="bot-fs" onchange="renderBotsList()"><option value="">Todos</option>
      <option>PRD</option><option>DEV</option><option>BACKLOG</option><option>CANCELADO</option><option>DESATIVADO</option></select>
    <label>Área</label><select id="bot-fa" onchange="renderBotsList()"><option value="">Todas</option>
      ${[...new Set(B.map(b=>b.area))].filter(Boolean).sort().map(a=>`<option>${a}</option>`).join('')}</select></div>
    <div class="ilist" id="bots-list"></div>`;
  document.getElementById('bots-content').innerHTML = h;
  renderBotsList();
  setBadge('nb-bots', prd+' PRD', 'ok');
}

/*
 * buildBotsCruzamento(Bf) — tabela de cruzamento inventário × chamados RPA.
 * Tenta casar o nome do bot (inventário) com o nome do processo (chamados)
 * usando match aproximado (um contém o outro, após normalização).
 * Mostra os 10 bots em PRD com mais chamados de manutenção — candidatos à refatoração.
 *
 * LIMITAÇÃO: o match por nome é heurístico. Se o nome do bot no inventário
 * for muito diferente do nome do processo no Pipefy, o cruzamento pode errar.
 */
function buildBotsCruzamento(Bf){
  const norm = s => s.toLowerCase().replace(/^\[.*?\]/,'').replace(/[^a-z0-9]/g,'');
  const {kept:Rf} = applyDate(App.R); // aplica filtro de data nos chamados também
  const chamPorProc = count(Rf, r => r.processo);
  const rows = Bf.filter(b=>b.status==='PRD').map(b=>{
    const bn = norm(b.nome);
    let ch = 0;
    Object.entries(chamPorProc).forEach(([proc,n])=>{
      const pn = norm(proc);
      if(pn && bn && (bn.includes(pn) || pn.includes(bn))) ch += n;
    });
    return {nome:b.nome, area:b.area, crit:b.criticidade, ch};
  }).filter(r=>r.ch>0).sort((a,b)=>b.ch-a.ch).slice(0,10);
  if(!rows.length) return '';
  let tbl = '<table class="tbl"><thead><tr><th>Bot</th><th>Área</th><th>Criticidade</th><th>Chamados manut.</th></tr></thead><tbody>';
  rows.forEach(r=>{
    tbl += `<tr><td style="color:var(--ink)">${r.nome}</td><td>${r.area}</td>
    <td>${r.crit?'Crit '+r.crit:'—'}</td><td><span class="badge ${r.ch>10?'red':'warn'}">${r.ch}</span></td></tr>`;
  });
  tbl += '</tbody></table>';
  return `<div class="card"><div class="card-title"><i class="ti ti-link"></i> Bots em produção × chamados de manutenção
    <span class="rt">cruzamento inventário × Pipefy</span></div>
    <div style="font-size:11px;color:var(--ink4);margin-bottom:12px">Bots com mais manutenções são candidatos a refatoração. Match por nome do processo.</div>
    <div style="overflow-x:auto">${tbl}</div></div>`;
}

/*
 * renderBotsList() — lista filtrada de bots com filtros locais (status, área).
 * Aplica filtro de data por AnoPRD antes dos filtros locais.
 * Exibe até 200 bots; avisa se houver mais.
 */
function renderBotsList(){
  const fs = document.getElementById('bot-fs')?.value||'';
  const fa = document.getElementById('bot-fa')?.value||'';
  const dr = App.dateRange;
  let source = App.B;
  // filtro de data especial: por AnoPRD (não por data de ação)
  if(dr.mode !== 'all'){
    const yFrom = dr.from ? dr.from.getFullYear() : null;
    const yTo   = dr.to   ? dr.to.getFullYear()   : null;
    source = App.B.filter(b=>{
      const y = parseInt(b.anoPrd);
      if(isNaN(y)) return false;
      if(yFrom!=null && y<yFrom) return false;
      if(yTo!=null   && y>yTo)   return false;
      return true;
    });
  }
  let B = source.filter(b => (!fs||b.status===fs) && (!fa||b.area===fa));
  const sb = {PRD:'ok', DEV:'info', BACKLOG:'neu', CANCELADO:'red', DESATIVADO:'red'};
  // cor da bolinha de status do bot (CSS puro); fundo do quadrado segue o tema (--neu-bg)
  const botDot = {PRD:'#3fa46a', DEV:'#4a90d9', BACKLOG:'#9a9a92', CANCELADO:'#d46a6a', DESATIVADO:'#d46a6a'};
  let h = B.slice(0,200).map(b => `<div class="icard">
    <div class="iico" style="background:var(--neu-bg)"><span style="width:11px;height:11px;border-radius:50%;background:${botDot[b.status]||'#9a9a92'};display:block"></span></div>
    <div class="imain"><div class="ititle">${b.nome}</div>
      <div class="isub">
        ${b.area?`<span class="apill">${b.area}</span>`:''}
        ${b.perimetro&&b.perimetro!=='Brasil'?`<span class="apill">${b.perimetro}</span>`:''}
        ${b.dev?`<span>${b.dev}</span>`:''}
        ${b.freq?`<span style="color:var(--ink4)">· ${b.freq}</span>`:''}
        ${b.vol?`<span style="color:var(--ink4)">· ${b.vol.toLocaleString('pt-BR')}/mês</span>`:''}
      </div></div>
    <div class="iright">
      ${b.criticidade?`<span style="font-size:10px;color:var(--ink4)">Crit ${b.criticidade}</span>`:''}
      <span class="badge ${sb[b.status]||'neu'}">${b.status}</span>
    </div></div>`).join('');
  if(B.length>200) h += `<div class="icard" style="justify-content:center;color:var(--ink4);font-size:12px">Exibindo 200 de ${B.length}</div>`;
  const el = document.getElementById('bots-list');
  if(el) el.innerHTML = h || '<div class="empty" style="padding:24px">Nenhum bot neste filtro</div>';
}


/* ============================================================
   FILTRO DE DATA GLOBAL — CONTROLES DO HEADER
   ============================================================ */

/*
 * applyDateFilter() — chamado quando o usuário muda qualquer um dos campos de data no header.
 * Lê os dois inputs (de/até), atualiza App.dateRange, e chama renderAll() para
 * redesenhar todas as abas com o novo recorte.
 *
 * Se ambos os campos estiverem vazios → volta para modo 'all' (sem filtro).
 * A hora é fixada: 'from' começa em 00:00:00 e 'to' termina em 23:59:59
 * para incluir o dia completo em ambas as extremidades.
 */
/*
 * setQuickRange(mode) — aplica um atalho de período (mês/trimestre/ano atual).
 * Calcula as datas de início e fim com base na data de hoje e preenche os
 * campos de data, depois aciona o filtro. Marca o chip ativo visualmente.
 */
function setQuickRange(mode){
  const y = HOJE.getFullYear();
  const m = HOJE.getMonth();
  let from, to;
  if(mode==='month'){
    from = new Date(y, m, 1);
    to   = new Date(y, m+1, 0); // último dia do mês atual
  } else if(mode==='quarter'){
    const q = Math.floor(m/3);  // 0,1,2,3
    from = new Date(y, q*3, 1);
    to   = new Date(y, q*3+3, 0); // último dia do trimestre
  } else if(mode==='year'){
    from = new Date(y, 0, 1);
    to   = new Date(y, 11, 31);
  }
  const iso = d => d.toISOString().slice(0,10);
  document.getElementById('df-from').value = iso(from);
  document.getElementById('df-to').value   = iso(to);
  // marca o chip ativo
  ['month','quarter','year'].forEach(k=>{
    const c = document.getElementById('dfc-'+k);
    if(c) c.classList.toggle('active', k===mode);
  });
  applyDateFilter(true); // true = não limpar os chips (já marcamos acima)
}

/*
 * applyDateFilter(fromChip) — chamado quando o usuário muda os campos de data
 * ou clica num atalho. Atualiza App.dateRange e redesenha tudo.
 * fromChip: se false (mudança manual), desmarca os chips de atalho.
 */
function applyDateFilter(fromChip){
  const dr = App.dateRange;
  const ff = document.getElementById('df-from').value;
  const tt = document.getElementById('df-to').value;
  if(!ff && !tt){
    dr.mode='all'; dr.from=null; dr.to=null;
  } else {
    dr.mode = 'custom';
    dr.from = ff ? new Date(ff+'T00:00:00') : null;
    dr.to   = tt ? new Date(tt+'T23:59:59') : null;
  }
  // mudança manual nos campos desmarca os atalhos rápidos
  if(fromChip!==true){
    ['month','quarter','year'].forEach(k=>{
      const c=document.getElementById('dfc-'+k); if(c) c.classList.remove('active');
    });
  }
  const wrap = document.getElementById('date-filter');
  if(wrap) wrap.classList.toggle('active', dr.mode!=='all');
  renderAll();
}

// Limpa os dois campos de data, desmarca atalhos e volta para modo 'all'
function clearDateFilter(){
  document.getElementById('df-from').value = '';
  document.getElementById('df-to').value   = '';
  ['month','quarter','year'].forEach(k=>{
    const c=document.getElementById('dfc-'+k); if(c) c.classList.remove('active');
  });
  applyDateFilter();
}

/*
 * renderAll() — redesenha todas as abas com o estado atual (filtros incluídos).
 * É chamado sempre que o filtro de data muda.
 * Cada função build*() aplica internamente o filtro de data antes de calcular.
 */
function renderAll(){
  buildGov();
  if(App.P.proj.length) buildProj();
  if(App.P.mel.length) buildMel();
  if(App.P.ana.length) buildAna();
  if(App.R.length) buildRPAChamados();
  if(App.B.length) buildBots();
  updateDateBadge();
}

/*
 * updateDateBadge() — atualiza o texto de status no header (topbar).
 * Quando há filtro ativo, acrescenta "· período: DD/MM/AAAA → DD/MM/AAAA".
 * Usa dataset.base para guardar o texto original (horário de atualização + fontes)
 * e não sobrescrever ao atualizar o período.
 */
function updateDateBadge(){
  const dr = App.dateRange;
  const base = document.getElementById('sync-lbl').dataset.base || '';
  let periodo = '';
  if(dr.mode !== 'all'){
    const fmt = d => d ? d.toLocaleDateString('pt-BR') : '∞';
    periodo = ` · período: ${fmt(dr.from)} → ${fmt(dr.to)}`;
  }
  document.getElementById('sync-lbl').textContent = base + periodo;
}


/* ============================================================
   GENERATE — PONTO DE ENTRADA PRINCIPAL
   ============================================================
   Chamado quando o usuário clica em "Gerar dashboard".
   Orquestra: parsers → descobre range de datas → constrói todas as views → navega.
   ============================================================ */
function generate(){
  // 1. Parseia cada fonte (converte Excel bruto em objetos normalizados)
  if(App.gov) parseGov();   // base de governança: Pipefy, Projetos, Analytics
  if(App.gov) parseInv();   // inventário de bots (aba separada dentro da base de governança)
  if(App.rpa) parseRPA();   // relatório de chamados de manutenção RPA
  enrichRPAComArea();       // associa área dos bots aos chamados (via match de nome)

  // 2. Descobre o range global de datas (mínimo e máximo entre todas as fontes)
  //    Isso define os limites min/max dos inputs de data no header,
  //    impedindo o usuário de selecionar datas fora do alcance dos dados.
  const all = [...App.P.mel, ...App.P.proj, ...App.P.ana, ...App.R];
  const dates = all.map(refDate).filter(Boolean).map(d => d.getTime());
  if(dates.length){
    const min = new Date(Math.min(...dates));
    const max = new Date(Math.max(...dates));
    const iso = d => d.toISOString().slice(0,10);
    ['df-from','df-to'].forEach(id => {
      const el = document.getElementById(id);
      if(el){ el.min=iso(min); el.max=iso(max); }
    });
  }

  // 3. Constrói todas as views (só as que têm dados)
  buildGov();
  if(App.P.proj.length) buildProj();
  if(App.P.mel.length) buildMel();
  if(App.P.ana.length) buildAna();
  if(App.R.length) buildRPAChamados();
  if(App.B.length) buildBots();

  // 4. Atualiza badges de navegação e texto de status
  if(App.P.mel.length) setBadge('nb-mel', App.P.mel.length, '');
  const now = new Date();
  const ts  = `Atualizado ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  const src = [App.loaded.gov?'Governança':'', App.loaded.rpa?'Chamados RPA':''].filter(Boolean).join(' · ');
  const lbl = document.getElementById('sync-lbl');
  lbl.textContent = `${ts} · ${src}`;
  lbl.dataset.base = `${ts} · ${src}`; // guarda para o updateDateBadge não sobrescrever

  // 5. Revela o filtro de data (fica escondido até o primeiro generate)
  const df = document.getElementById('date-filter');
  if(df) df.style.display = 'flex';

  // 6. Navega para a aba Governança (visão executiva)
  setNav('gov');
}

// Inicializa na tela de Upload ao carregar a página
setNav('upload');