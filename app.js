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
  projOpen: new Set(),
  // filtros rápidos da aba Projetos (chips): mostrar só atrasados / só risco alto
  projChips: { atraso:false, risco:false }
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
 * Verifica se um item esteve ATIVO durante o período do filtro, considerando
 * um intervalo [início, fim] em vez de uma data única. Usado para o Pipefy,
 * onde uma melhoria tem início e conclusão do desenvolvimento.
 * Regras (modo custom):
 *   - tem início e fim → passa se o intervalo do item cruza o intervalo do filtro
 *   - só tem início (em andamento) → passa se começou até o fim do filtro
 *     (considera-se ativa do início até hoje)
 *   - só tem fim → cai no comportamento de data única (inDateRange no fim)
 *   - sem nenhuma data → fora (contabilizado como "sem data")
 * Retorna 'in' | 'out' | 'nodate'.
 */
function activeInRange(ini, fim){
  const dr = App.dateRange;
  if(dr.mode === 'all') return 'in';
  if(!ini && !fim) return 'nodate';
  // limites do filtro (qualquer um pode ser nulo = aberto daquele lado)
  const fFrom = dr.from || new Date(-8640000000000000);
  const fTo   = dr.to   || new Date( 8640000000000000);
  // limites do item: se falta início, usa o fim; se falta fim, considera "até hoje" (em curso)
  const iIni = ini || fim;
  const iFim = fim || HOJE;
  // sobreposição de intervalos: começa antes do fim do filtro E termina depois do início
  return (iIni <= fTo && iFim >= fFrom) ? 'in' : 'out';
}

/*
 * Aplica o filtro de data a um array inteiro.
 * Retorna: { kept: [...itens que passaram], noDate: N (quantidade sem data) }
 * Para itens que têm dtInicio (ex: Pipefy), usa a lógica de "ativo no período"
 * (intervalo início→fim). Para os demais, usa a data única de refDate.
 * Os itens sem data não são perdidos — ficam fora do recorte e o número é
 * exibido na nota de transparência da interface.
 */
function applyDate(arr){
  if(App.dateRange.mode === 'all') return { kept: arr, noDate: 0 };
  const kept = [], noDate = [];
  arr.forEach(x => {
    // se o item tem conceito de intervalo (dtInicio definido), usa activeInRange
    if(x.dtInicio !== undefined){
      const r = activeInRange(x.dtInicio, x.dtFim);
      if(r === 'nodate') noDate.push(x);
      else if(r === 'in') kept.push(x);
    } else {
      const d = refDate(x);
      if(!d) noDate.push(x);
      else if(inDateRange(d)) kept.push(x);
    }
  });
  return { kept, noDate: noDate.length };
}


/* ============================================================
   CONSTANTES E CLASSIFICADOR DE STATUS
   ============================================================ */

const MESES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

/* SVG inline — não depende de font loading, funciona em HTML dinâmico */
const _SVG = {
  list:    '<line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/><circle cx="5" cy="6" r="1" fill="currentColor"/><circle cx="5" cy="12" r="1" fill="currentColor"/><circle cx="5" cy="18" r="1" fill="currentColor"/>',
  check:   '<polyline points="20 6 9 17 4 12"/>',
  clock:   '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 15"/>',
  stack:   '<polyline points="12 4 4 8 12 12 20 8 12 4"/><polyline points="4 12 12 16 20 12"/><polyline points="4 16 12 20 20 16"/>',
  dots:    '<circle cx="5" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="19" cy="12" r="1.5" fill="currentColor"/>',
  folders: '<path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-4l-2-3z"/>',
  play:    '<polygon points="5 3 19 12 5 21 5 3" fill="currentColor" opacity=".35"/><polygon points="5 3 19 12 5 21 5 3"/>',
  flag:    '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>',
  flame:   '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><circle cx="9" cy="11" r=".8" fill="currentColor"/><circle cx="13" cy="11" r=".8" fill="currentColor"/>',
  lock:    '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  branch:  '<line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
  chartbar:'<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/><line x1="2" y1="20" x2="22" y2="20"/>',
  minus:   '<line x1="5" y1="12" x2="19" y2="12"/>',
  ticket:  '<path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2z"/>',
  alert:   '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><circle cx="12" cy="16" r=".8" fill="currentColor"/>',
  refresh: '<polyline points="1 4 1 10 7 10"/><polyline points="23 20 23 14 17 14"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4-4.64 4.36A9 9 0 0 1 3.51 15"/>',
  robot:   '<rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><line x1="12" y1="7" x2="12" y2="11"/><circle cx="8" cy="16" r="1" fill="currentColor"/><circle cx="16" cy="16" r="1" fill="currentColor"/>',
  rocket:  '<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>',
  code:    '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
};
function kpiIcon(name){
  const p = _SVG[name] || '';
  if(!p) return '';
  return `<svg class="kico" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
}
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
  // Remove prefixo numérico de ordenação, se houver.
  // Ex: "6. Encerramento" → "encerramento", "3 - Planejamento" → "planejamento"
  const t = (s || '').toString().trim().toLowerCase().replace(/^\s*\d+\s*[.\-)]\s*/, '');

  if (['suporte pipefy', 'encaminhado ao fornecedor', 'pipefy'].includes(t))
    return 'vendor';

  if (['concluído', 'concluido', 'finalizados', 'finalizado', 'tema concluído.', 'tema concluído'].includes(t))
    return 'done';

  if (['em andamento', 'em execução', 'execução', 'execucao', 'desenvolvimento',
       'em validação', 'em validacao', 'aguardando validação', 'aguardando validacao'].includes(t))
    return 'doing';

  if (['encerramento'].includes(t))  return 'closing';
  if (['monitoramento'].includes(t)) return 'monitor';

  if (['planejamento', 'diagnóstico', 'diagnostico', 'não iniciado', 'nao iniciado', 'backlog'].includes(t))
    return 'todo';

  if (['bloqueado', 'pausado'].includes(t))  return 'blocked';
  if (['cancelado'].includes(t))             return 'cancel';

  return 'other';
}

// Rótulos em português para exibição na interface
const STATUS_PT = {
  done:    'Concluído',
  doing:   'Em andamento',
  closing: 'Em encerramento',
  monitor: 'Monitoramento',
  todo:    'Não iniciado',
  blocked: 'Bloqueado',
  cancel:  'Cancelado',
  vendor:  'Suporte Pipefy',
  other:   'Outro'
};

// Classe CSS do badge de cada status (ver CSS: .badge.ok, .badge.info, etc.)
const STATUS_BADGE = {
  done:    'ok',
  doing:   'info',
  closing: 'warn',
  monitor: 'info',
  todo:    'neu',
  blocked: 'warn',
  cancel:  'red',
  vendor:  'blue',
  other:   'neu'
};

// Cor pura para gráficos — paleta Saint-Gobain
const STATUS_COLOR = {
  done:    '#4DB1B3',  // teal        — concluído
  doing:   '#0195D6',  // azul vivo   — em andamento
  closing: '#E66407',  // laranja     — em encerramento
  monitor: '#0F5299',  // azul marca  — monitoramento
  todo:    '#9CA3AF',  // cinza       — não iniciado
  blocked: '#E83430',  // vermelho    — bloqueado
  cancel:  '#C5284C',  // rosa-verm.  — cancelado
  vendor:  '#8B6FD4',  // roxo        — suporte Pipefy
  other:   '#9CA3AF'   // cinza
};

/*
 * EQUIPE_COE — membros da equipe do CoE, organizados pela frente em que atuam.
 * Usado APENAS na aba Governança para filtrar "Ações abertas por responsável"
 * (mostra só a equipe interna; quem não é CoE não aparece nesse gráfico).
 *
 * Cada item tem um 'match' = lista de termos distintivos para reconhecer a
 * pessoa nos dados, tolerando variações de escrita. Usamos sobrenomes/termos
 * únicos de propósito, para NÃO confundir homônimos de primeiro nome
 * (ex: "Gustavo" pegaria "Matheus Gustavo Germano", que não é CoE; por isso
 * usamos "archangelo"). O 'nome' é o rótulo exibido no gráfico.
 */
const EQUIPE_COE = [
  // --- Projetos ---
  { nome:'Gabriel Hirata',    match:['gabriel hirata','hirata'] },
  { nome:'Maiara',            match:['maiara'] },
  { nome:'Vinícius Milagres', match:['milagres','vinícius marchi','vinicius marchi'] },
  { nome:'Isabelly Vidal',    match:['isabelly'] },
  { nome:'Daniel Torres',     match:['daniel torres'] },
  { nome:'Adely Canizal',     match:['adely'] },
  // --- RPA ---
  { nome:'Lucas Oliveira',    match:['lucas oliveira','lucas alvarenga','alvarenga'] },
  { nome:'Caio Pucci',        match:['caio pucci','pucci'] },
  { nome:'Francisco Prestes', match:['francisco prestes','prestes'] },
  { nome:'Fernando Sanches',  match:['fernando sanches','sanches'] },
  { nome:'Igor Henrique',     match:['igor henrique'] },
  { nome:'Esteban Menendez',  match:['esteban'] },
  { nome:'Jesus Axel',        match:['axel'] },
  // --- Pipefy ---
  { nome:'Gustavo Archangelo',match:['archangelo'] },
  { nome:'Vinícius Domingues',match:['vinícius domingues','vinicius domingues'] },
  { nome:'Felipe Cordeiro',   match:['felipe cordeiro','cordeiro'] },
  { nome:'William Maciel',    match:['william maciel','willian maciel','souza maciel'] }
];

/*
 * coeNomePadrao(resp) — recebe o nome do responsável como está nos dados e,
 * se for da equipe CoE, retorna o nome padronizado (rótulo). Senão, retorna null.
 * Usa os termos 'match' de cada membro (case-insensitive, sem acento).
 */
function coeNomePadrao(resp){
  if(!resp) return null;
  const t = resp.toString().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,''); // remove acentos para comparar
  for(const m of EQUIPE_COE){
    for(const termo of m.match){
      const termoNorm = termo.normalize('NFD').replace(/[\u0300-\u036f]/g,'');
      if(t.includes(termoNorm)) return m.nome;
    }
  }
  return null;
}

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

/*
 * projAtrasado(p) — true se o projeto está com prazo vencido e ainda não foi
 * entregue/cancelado. Considera-se "não atrasável" quem está concluído,
 * em monitoramento (pós go-live) ou cancelado.
 */
function projAtrasado(p){
  return !!(p.dtFim && p.dtFim < HOJE && p.sc!=='done' && p.sc!=='cancel' && p.sc!=='monitor');
}

/*
 * projRisco(p) — score de risco automático (0 a 100) de um projeto.
 * Combina três fatores objetivos, sem precisar de campo manual na planilha:
 *   1) ATRASO (peso maior): dias de prazo vencido. Quanto mais atrasado, maior.
 *   2) FASE: projetos em fases iniciais (Diagnóstico/Planejamento) com prazo
 *      apertado são mais arriscados que os já em Encerramento.
 *   3) PROXIMIDADE DO PRAZO: prazo chegando (mesmo sem atraso) eleva o risco.
 * Projetos concluídos/cancelados/monitoramento têm risco 0 (não estão "em jogo").
 * Retorna { score, nivel, motivos[] } — nivel ∈ {alto, medio, baixo}.
 */
function projRisco(p){
  if(p.sc==='done' || p.sc==='cancel' || p.sc==='monitor'){
    return { score:0, nivel:'baixo', motivos:[] };
  }
  let score = 0;
  const motivos = [];
  const fase = projFase(p.statusRaw) || 2;

  // 1) Atraso — o fator mais forte. Atraso relevante já leva a projeto a risco alto.
  if(p.dtFim){
    const dias = Math.round((HOJE - p.dtFim)/86400000);
    if(dias > 0){
      // 15 pontos de base + ~1/dia, saturando em 70; ~40 dias já cruza o limite de "alto"
      score += Math.min(70, 15 + dias*1.2);
      motivos.push(`${dias} ${dias===1?'dia':'dias'} de atraso`);
    } else {
      // 2) Proximidade do prazo (ainda não venceu)
      const faltam = -dias;
      if(faltam <= 15){ score += 18; motivos.push(`prazo em ${faltam} ${faltam===1?'dia':'dias'}`); }
      else if(faltam <= 30){ score += 10; motivos.push('prazo próximo'); }
    }
  } else {
    // sem prazo definido em projeto ativo = risco de falta de controle
    score += 14; motivos.push('sem prazo definido');
  }

  // 3) Fase — peso por estágio (fases iniciais = mais caminho pela frente = mais risco)
  if(p.sc==='blocked'){ score += 30; motivos.push('bloqueado'); }
  const pesoFase = {1:18, 2:14, 3:9, 4:4, 5:0}[fase] || 9;
  score += pesoFase;
  if(fase<=2 && p.sc!=='blocked') motivos.push(`fase inicial (${p.statusRaw})`);

  score = Math.min(100, Math.round(score));
  const nivel = score>=55 ? 'alto' : (score>=30 ? 'medio' : 'baixo');
  return { score, nivel, motivos };
}


/* ============================================================
   MODELO DE DADOS NORMALIZADO
   ============================================================
   Cada parser lê uma aba do Excel e produz um array de objetos
   com campos padronizados. Este bloco documenta o formato de
   cada objeto para facilitar a manutenção.

   ── App.P.mel[]  (Pipefy Melhorias) ─────────────────────────
   {
     num:       número ou id da melhoria
     frente:    gerência/área responsável (P2P, O2C, H2R…)
     fluxo:     nome do fluxo de processo no Pipefy
     atividade: descrição resumida da melhoria
     statusRaw: texto original da planilha (ex: "Em andamento")
     sc:        código interno normalizado → ver STATUS_COLOR
     resp:      nome do responsável pelo desenvolvimento
     champion:  nome do champion/solicitante
     complex:   complexidade declarada (Baixa, Média, Alta)
     tipo:      tipo de melhoria ou ajuste
     dtInicio:  Date — início do desenvolvimento (pode ser null)
     dtFim:     Date — conclusão/previsão de conclusão (pode ser null)
     horas:     estimativa de horas
   }

   ── App.P.proj[]  (Projetos) ────────────────────────────────
   {
     num:        número ou código do projeto
     titulo:     nome do projeto
     resp:       responsável pelo projeto (equipe CoE)
     frente:     área cliente ou frente de negócio
     focal:      ponto focal do lado do negócio
     statusRaw:  texto original do status na planilha
     sc:         código interno normalizado
     dtFim:      Date — prazo de conclusão (pode ser null)
     proximos:   próximos passos (texto livre)
     equipes:    equipes envolvidas
     descricao:  descrição do projeto
     atvConcl:   atividades já concluídas
     atvAndam:   atividades em andamento
     comentarios:comentários gerais
     prog:       número 0.0–1.0 representando % de progresso (pode ser null)
   }

   ── App.P.ana[]  (Analytics) ────────────────────────────────
   {
     titulo:    nome ou descrição da atividade
     resp:      responsável
     frente:    área de negócio
     statusRaw: texto original
     sc:        código interno normalizado
     dtFim:     Date — data de fechamento/conclusão (pode ser null)
     criado:    Date — data de abertura (pode ser null)
     prio:      número 1–4 (prioridade declarada)
     tipo:      tipo de atividade
     fonte:     sempre 'Analytics' (para identificar a origem no painel executivo)
   }

   ── App.R[]  (Chamados RPA) ──────────────────────────────────
   {
     cod:           código/id do chamado no Pipefy
     processo:      nome do processo (bot) relacionado
     solicitante:   quem abriu o chamado
     responsaveis:  array de nomes de quem atendeu
     problema:      tipo de problema relatado
     reexec:        texto indicando se admite reexecução (ou null)
     fase:          fase atual do chamado no fluxo do Pipefy
     mes:           string "YYYY-MM" da data de abertura
     criado:        Date — data de abertura do chamado
     vencido:       boolean — prazo de SLA vencido?
     tIdent:        número de dias na fase Identificação (pode ser null)
     tDesenv:       número de dias na fase Desenvolvimento (pode ser null)
     tReexec:       número de dias na fase Reexecução (pode ser null)
     area:          área do bot (enriquecido por enrichRPAComArea, pode ser null)
   }

   ── App.B[]  (Inventário de Bots) ───────────────────────────
   {
     nome:       nome do bot/automação
     perimetro:  perímetro geográfico (Brasil, MEX, ARG…)
     area:       área funcional (P2P, TAX, H2R…)
     status:     'PRD' | 'DEV' | 'BACKLOG' | 'CANCELADO' | 'DESATIVADO'
     anoPrd:     ano de entrada em produção (número ou string)
     desc:       descrição do que o bot faz
     dev:        desenvolvedor responsável
     suporte:    responsável por suporte/sustentação
     criticidade:número 1–4 (1=crítico, 4=baixo)
     freq:       frequência de execução (diária, semanal…)
     fte:        FTEs economizados (número)
     vol:        volumetria mensal de transações (número)
     nBots:      número de bots no processo
     areaCliente:área do cliente atendida
     sap:        módulo SAP relacionado (se houver)
   }
   ============================================================ */


/* ============================================================
   NAVEGAÇÃO
   ============================================================ */

/*
 * Alterna entre as abas principais do dashboard.
 * Funciona togglando a classe 'active' no item de nav e na section correspondente.
 */
function setNav(id){
  ['upload','gov','proj','mel','rpa','ana'].forEach(n => {
    const ni = document.getElementById('nav-'+n);
    const pg = document.getElementById('page-'+n);
    if(ni) ni.classList.toggle('active', n === id);
    if(pg) pg.classList.toggle('active', n === id);
  });
}

/*
 * Alterna entre as sub-abas da aba RPA & Bots
 * (Visão geral, Top bots, Tipos de problema, Tempo de resolução, Chamados, Inventário de bots)
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
    // mostra abas encontradas
    let html = '<b>Abas lidas:</b> ' + want.map(w => {
      const ok = found.some(f => f.toLowerCase().replace(/[_ ]/g,'').includes(w.toLowerCase().replace(/[_ ]/g,'')));
      return `<span class="badge ${ok?'ok':'warn'}" style="margin:2px">${w}${ok?'':' (?)'}</span>`;
    }).join('');
    // diagnóstico de colunas da aba Pipefy_Melhorias — ajuda a identificar o nome correto da coluna de data
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
 * parseGov() — parser da Base Governança (arquivo Excel principal).
 *
 * Lê:     App.gov (workbook SheetJS carregado pelo usuário)
 * Escreve: App.P.mel  → melhorias Pipefy normalizadas
 *          App.P.proj → projetos normalizados
 *          App.P.ana  → atividades de Analytics normalizadas
 * Chamada por: generate()
 *
 * TOLERÂNCIA A VARIAÇÕES:
 *   - Nomes de aba: busca por fragmento, insensível a maiúsculas e underlines
 *   - Nomes de coluna: cada campo tenta múltiplos nomes alternativos (ver get())
 *   - Layout de Projetos: detecta automaticamente se o cabeçalho está correto
 *     ou embaralhado (layout antigo), e lê por posição como fallback
 *
 * Para adicionar um novo campo: adicione o nome da coluna no array do get()
 * e mapeie para o campo normalizado no objeto retornado pelo .map().
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
    // FILTRO DE PERÍODO — uma coluna por campo, sem fallback:
    //   dtInicio → DataInicioDesenvolvimento
    //   dtFim    → DataRealEstimadaConclusaoValidacaoChampion
    // Sem nenhuma das duas = backlog não iniciado → incluído sempre (ver buildMel).
    dtInicio: toDate(get(r, ['DataInicioDesenvolvimento'])),
    dtFim:    toDate(get(r, ['DataRealEstimadaConclusaoValidacaoChampion'])),
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
        // FILTRO DE PERÍODO — referência: PrazoConclusão (não há data de início na planilha)
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
    // dtInicio = DataAbertura (início); dtFim = DataFechamento (conclusão da validação)
    // Com dtInicio definido, applyDate usa activeInRange — inclui atividades em curso no período.
    dtInicio: toDate(get(r, ['DataAbertura'])),
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
/*
 * parseRPA() — parser do relatório de chamados de manutenção RPA.
 *
 * Lê:     App.rpa (workbook SheetJS carregado pelo usuário)
 * Escreve: App.R → chamados RPA normalizados
 * Chamada por: generate()
 *
 * DETECÇÃO AUTOMÁTICA DE ABA:
 *   Testa cada aba do arquivo e escolhe a que tem colunas típicas de chamados
 *   (Código, Processo, Fase…). Se nenhuma aba parecer um relatório de chamados,
 *   registra App.rpaWarn e deixa App.R vazio — evita gerar lixo na tela.
 *
 * CAMPOS CALCULADOS:
 *   - mes:    string "YYYY-MM" derivada de criado, para agrupamento mensal
 *   - vencido: true se a fase não é "Concluído" e criado > 30 dias atrás
 *   - tIdent / tDesenv / tReexec: dias em cada fase (calculados a partir de
 *     colunas de data de entrada/saída de fase, se disponíveis)
 *   - area: preenchido posteriormente por enrichRPAComArea() via match com App.B
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
      // "Responsáveis" = quem trabalha no chamado (equipe CoE de RPA), não quem abriu.
      // Pode ter vários nomes separados por vírgula; guardamos como lista para contar
      // cada responsável individualmente.
      responsaveis: String(get(r, ['Responsáveis','Responsável']))
        .split(',').map(s=>s.trim()).filter(Boolean),
      criado,
      dtInicio: criado,                            // Criado em → início do intervalo
      dtFim:    toDate(get(r, ['Finalizado em'])), // Finalizado em → fim do intervalo
      mes: ym(criado),
      dow: criado ? (criado.getDay() + 6) % 7 : -1,
      finalizado: toDate(get(r, ['Finalizado em'])), // alias para display
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
 * enrichRPAComArea() — associa a cada chamado RPA a área (P2P, O2C, etc.).
 * Os chamados não têm campo de área, só o nome do Processo. Usa duas camadas:
 *   1ª) Cruzamento com o Inventário de Bots: match aproximado de nomes
 *       (um contém o outro, após normalização) para herdar a área do bot.
 *   2ª) Se o cruzamento falhar, regras por palavra-chave (areaPorPalavra):
 *       ex. "Bank Statements"/"Payment Run" → P2P, "Tax ..." → TAX, etc.
 *       Isso recupera processos cujo nome no Pipefy difere do inventário.
 * O que não casar em nenhuma das duas fica '(não mapeada)' — tipicamente
 * chamados com o campo Processo vazio. Chamar DEPOIS de parseRPA() e parseInv().
 */
function areaPorPalavra(proc){
  const t = (proc||'').toLowerCase();
  // P2P — pagamentos, extratos bancários, câmbio
  if(t.includes('bank statement')) return 'P2P';
  if(t.includes('payment run')) return 'P2P';
  if(t.includes('payment order')) return 'P2P';
  if(t.includes('payments receipt') || t.includes('payment receipt')) return 'P2P';
  if(t.includes('exchange rate') || t.includes('exchange contract')) return 'P2P';
  if(t.includes('reserve of values')) return 'P2P';
  if(t.includes('freight')) return 'P2P';
  // TAX — impostos
  if(t.includes('tax conciliation') || t.includes('tax checking') || t.includes('tax payment') || t.includes('indirect tax') || t.includes('direct tax')) return 'TAX';
  // H2R — RH / folha / benefícios
  if(t.includes('vacation') || t.includes('payroll') || t.includes('employee') || t.includes('benefit')) return 'H2R';
  // O2C — crédito / faturamento
  if(t.includes('credit limit') || t.includes('settlement statement')) return 'O2C';
  return '';
}

function enrichRPAComArea(){
  if(!App.R.length) return;
  const norm = s => s.toLowerCase().replace(/^\[.*?\]/,'').replace(/[^a-z0-9]/g,'');
  const botAreas = App.B.filter(b=>b.nome && b.area).map(b => ({n:norm(b.nome), area:b.area}));
  App.R.forEach(r => {
    const pn = norm(r.processo);
    let area = '';
    // 1ª camada: cruzamento com o inventário de bots
    if(pn && botAreas.length){
      const hit = botAreas.find(b => b.n && (b.n.includes(pn) || pn.includes(b.n)));
      if(hit) area = hit.area;
    }
    // 2ª camada: regras por palavra-chave (recupera nomes que diferem do inventário)
    if(!area) area = areaPorPalavra(r.processo);
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
   GRÁFICOS — Chart.js
   ============================================================
   Padrão de uso:
     1. Funções de gráfico retornam um <canvas id="..."> como
        parte da string HTML e registram o config em _pendingCharts.
     2. Após cada injeção via innerHTML, flushCharts() instancia
        todos os gráficos pendentes.
     3. Instâncias anteriores são destruídas antes de recriar
        (evita o erro "Canvas already in use").
   ============================================================ */

// Fila de configurações aguardando inicialização após injeção de HTML
let _pendingCharts = [];

// Instâncias Chart.js ativas, indexadas pelo id do canvas
const _chartInstances = {};

// Contador para IDs únicos de canvas por ciclo de render
let _chartSeq = 0;
function _cid(prefix) { return `ch-${prefix}-${++_chartSeq}`; }

/*
 * flushCharts() — instancia todos os gráficos pendentes.
 * Chamar logo após cada atribuição de innerHTML.
 */
function flushCharts() {
  _pendingCharts.forEach(({ id, config }) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (_chartInstances[id]) _chartInstances[id].destroy();
    _chartInstances[id] = new Chart(el, config);
  });
  _pendingCharts = [];
}

// Defaults globais do Chart.js
Chart.defaults.font.family = "'Inter', system-ui, sans-serif";
Chart.defaults.font.size   = 11;
Chart.defaults.color       = '#6B7280';


// Paleta Saint-Gobain em hex (CSS vars não funcionam dentro do Chart.js)
const C = {
  brand:  '#0F5299',  // azul escuro
  accent: '#0195D6',  // azul vivo
  teal:   '#4DB1B3',  // teal
  orange: '#E66407',  // laranja
  red:    '#E83430',  // vermelho
  ok:     '#0d8f91',  // teal escuro (texto ok)
  warn:   '#C55800',  // laranja escuro (texto warn)
  err:    '#C5284C',  // rosa-vermelho
  ink:    '#111827',
  ink2:   '#374151',
  ink3:   '#6B7280',
  ink4:   '#9CA3AF',
  rule:   'rgba(15,82,153,0.07)',
};

// Resolve variáveis CSS do tema para hex — necessário para passar cores ao Chart.js
function resolveColor(c) {
  const map = {
    'var(--brand)':  C.brand,
    'var(--accent)': C.accent,
    'var(--ok)':     C.ok,
    'var(--warn)':   C.warn,
    'var(--err)':    C.err,
    'var(--info)':   C.brand,
    'var(--neu)':    '#9CA3AF',
    'var(--ink)':    C.ink,
    'var(--ink2)':   C.ink2,
    'var(--ink3)':   C.ink3,
    'var(--ink4)':   C.ink4,
  };
  return map[c] || c;
}

/*
 * donut(data, opts) — gráfico de rosca via Chart.js
 * data: array de { label, value, color }
 */
function donut(data, opts = {}) {
  const filtered = data.filter(d => d.value > 0);
  const total    = filtered.reduce((s, d) => s + d.value, 0);
  if (!total) return '<div style="font-size:12px;color:var(--ink4)">Sem dados</div>';

  const id = _cid('donut');

  _pendingCharts.push({
    id,
    config: {
      type: 'doughnut',
      data: {
        labels: filtered.map(d => d.label),
        datasets: [{
          data:            filtered.map(d => d.value),
          backgroundColor: filtered.map(d => resolveColor(d.color)),
          borderWidth:     0,
          hoverOffset:     4,
        }]
      },
      options: {
        cutout:     '68%',
        responsive: false,
        animation:  { duration: 400 },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: ctx => ` ${ctx.label}: ${ctx.parsed}  (${pct(ctx.parsed, total)}%)`
            }
          }
        }
      }
    }
  });

  const legend = filtered.map(d =>
    `<div class="dleg">
      <span class="dleg-dot" style="background:${d.color}"></span>
      ${d.label}
      <b>${d.value}</b>
      <span class="dpct">${pct(d.value, total)}%</span>
    </div>`
  ).join('');

  return `<div class="donut-wrap">
    <div style="position:relative;width:130px;height:130px;flex-shrink:0">
      <canvas id="${id}" width="130" height="130"></canvas>
      <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;pointer-events:none">
        <div style="font-family:'Syne',sans-serif;font-size:26px;font-weight:600;color:var(--ink);line-height:1">${total}</div>
        <div style="font-size:9px;color:var(--ink4);letter-spacing:1px;margin-top:2px">TOTAL</div>
      </div>
    </div>
    <div class="donut-legend">${legend}</div>
  </div>`;
}

/*
 * hbars(entries, opts) — barras horizontais via Chart.js
 * entries: array de [label, value]
 * opts: { max, tot, color, showTotal, totLabel }
 * lw e fixedLabel são ignorados — o Chart.js gerencia o tamanho dos labels.
 */
function hbars(entries, opts = {}) {
  const items = entries.slice(0, opts.max || 10);
  if (!items.length) return '<div style="font-size:12px;color:var(--ink4)">Sem dados</div>';

  const id  = _cid('hbar');
  const col = resolveColor(opts.color || 'var(--accent)');
  const tot = opts.tot || null;

  _pendingCharts.push({
    id,
    config: {
      type: 'bar',
      data: {
        labels: items.map(([l]) => l),
        datasets: [{
          data:            items.map(([, v]) => v),
          backgroundColor: col,
          borderRadius:    3,
          borderSkipped:   false,
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 300 },
        plugins: {
          legend:  { display: false },
          tooltip: { display: false },
        },
        layout: {
          padding: { right: tot ? 76 : 40 }
        },
        scales: {
          x: {
            grid:   { color: C.rule },
            border: { display: false },
            ticks:  { display: false }
          },
          y: {
            grid:   { display: false },
            border: { display: false },
            ticks:  { color: C.ink2, font: { size: 11 } }
          }
        }
      },
      plugins: [{
        id: 'hbarLabels',
        afterDatasetsDraw(chart) {
          const { ctx, data } = chart;
          const meta = chart.getDatasetMeta(0);
          ctx.save();
          ctx.fillStyle    = C.ink2;
          ctx.font         = `500 11px 'Inter', system-ui, sans-serif`;
          ctx.textAlign    = 'left';
          ctx.textBaseline = 'middle';
          data.datasets[0].data.forEach((value, i) => {
            const bar   = meta.data[i];
            const label = tot
              ? `${value}  (${pct(value, tot)}%)`
              : String(value);
            ctx.fillText(label, bar.x + 6, bar.y);
          });
          ctx.restore();
        }
      }]
    }
  });

  const height = Math.max(items.length * 30 + 16, 60);
  const header = opts.showTotal
    ? `<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid var(--rule)">
        <span style="font-size:11px;color:var(--ink4)">${opts.totLabel || 'Total'}</span>
        <span style="font-family:'Syne';font-size:18px;font-weight:600;color:var(--ink)">${opts.showTotal}</span>
      </div>`
    : '';

  return `${header}<div style="position:relative;height:${height}px"><canvas id="${id}"></canvas></div>`;
}


/*
 * clusteredBars(groups, series) — gráfico de barras clusterizado (agrupado).
 * Cada GRUPO (ex: uma fase) vira um bloco com um título; dentro dele há uma
 * BARRA fina para cada série (ex: tipo de problema), com a cor da série.
 * Todas as barras compartilham a mesma escala (maxVal global) para comparação.
 * groups: array de { label, color, valores: {serieKey: n} }
 * series: array ordenado de { key, label, color }
 * Barras com valor 0 são omitidas dentro do grupo, para não poluir.
 */
function clusteredBars(groups, series){
  if(!groups.length) return '<div style="font-size:12px;color:var(--ink4)">Sem dados</div>';
  // escala global: maior valor entre todas as barras de todos os grupos
  let maxVal = 1;
  groups.forEach(g => series.forEach(s => { maxVal = Math.max(maxVal, g.valores[s.key]||0); }));
  const corpo = groups.map(g => {
    const totGrupo = series.reduce((acc,s)=>acc+(g.valores[s.key]||0),0);
    const barras = series.map(s => {
      const n = g.valores[s.key]||0;
      if(!n) return ''; // omite séries zeradas dentro do grupo
      const w = Math.round(n/maxVal*100);
      return `<div class="clu-bar-row">
        <span class="clu-bar-lbl" title="${String(s.label).replace(/"/g,'')}">${s.label}</span>
        <div class="clu-bar-track"><div class="clu-bar-fill" style="width:${w}%;background:${s.color}"></div></div>
        <span class="clu-bar-val">${n}</span>
      </div>`;
    }).join('');
    return `<div class="clu-group">
      <div class="clu-group-title"><span class="clu-gt-dot" style="background:${g.color||'var(--ink3)'}"></span>${g.label}<span class="clu-gt-tot">${totGrupo} no total</span></div>
      ${barras || '<div class="clu-bar-row"><span style="font-size:11px;color:var(--ink4);padding-left:17px">nenhum chamado nesta fase</span></div>'}
    </div>`;
  }).join('');
  const legenda = series.map(s =>
    `<div class="clu-leg"><span class="clu-leg-dot" style="background:${s.color}"></span>${s.label}</div>`
  ).join('');
  return corpo + `<div class="clu-legend">${legenda}</div>`;
}

/*
 * lineChart(points, opts) — gráfico de linha via Chart.js
 * points: array de { label, value }
 * opts: { pctAxis, max, min, fmt }
 *
 * NOTA: o gráfico plota apenas meses até o mês atual.
 * Se o último ponto está em abril/26, é porque não há conclusões
 * mais recentes na planilha — avança automaticamente ao atualizar a base.
 */
function lineChart(points, opts = {}) {
  if (points.length < 2)
    return '<div style="font-size:12px;color:var(--ink4)">Dados insuficientes para tendência</div>';

  const id = _cid('line');

  _pendingCharts.push({
    id,
    config: {
      type: 'line',
      data: {
        labels: points.map(p => p.label),
        datasets: [{
          data:                 points.map(p => p.value),
          borderColor:          C.brand,
          backgroundColor:      'rgba(15,82,153,0.07)',
          borderWidth:          2,
          pointRadius:          3,
          pointBackgroundColor: '#fff',
          pointBorderColor:     C.brand,
          pointBorderWidth:     2,
          fill:                 true,
          tension:              0.3,
        }]
      },
      options: {
        responsive:          true,
        maintainAspectRatio: false,
        animation:           { duration: 400 },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: ctx => opts.fmt
                ? ` ${opts.fmt(ctx.parsed.y)}`
                : ` ${ctx.parsed.y}`
            }
          }
        },
        scales: {
          x: {
            grid:   { display: false },
            border: { display: false },
            ticks:  { color: C.ink4, font: { size: 9 }, maxTicksLimit: 8 }
          },
          y: {
            min:    opts.min ?? 0,
            max:    opts.max,
            grid:   { color: C.rule },
            border: { display: false },
            ticks: {
              color:    C.ink4,
              font:     { size: 9 },
              callback: v => opts.pctAxis ? v + '%' : v
            }
          }
        }
      }
    }
  });

  return `<div style="position:relative;height:160px"><canvas id="${id}"></canvas></div>`;
}

/*
 * chartVBars(meses, porMes, porMesV) — barras verticais empilhadas de volume mensal.
 * Dois datasets: chamados normais (azul brand) e vencidos (vermelho), empilhados.
 * meses: array de chaves "YYYY-MM" ordenadas
 * porMes / porMesV: objetos { "YYYY-MM": count }
 */
function chartVBars(meses, porMes, porMesV) {
  const id      = _cid('vbar');
  const labels  = meses.map(m => ymLabel(m));
  const totais  = meses.map(m => porMes[m]  || 0);
  const vencArr = meses.map(m => porMesV[m] || 0);
  const normais = totais.map((t, i) => t - vencArr[i]);

  _pendingCharts.push({
    id,
    config: {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label:           'Chamados',
            data:            normais,
            backgroundColor: 'rgba(15,82,153,0.25)',
            borderRadius:    { topLeft: 3, topRight: 3 },
            stack:           'vol',
          },
          {
            label:           'Vencidos',
            data:            vencArr,
            backgroundColor: 'rgba(197,40,76,0.75)',
            borderRadius:    { topLeft: 3, topRight: 3 },
            stack:           'vol',
          }
        ]
      },
      options: {
        responsive:          true,
        maintainAspectRatio: false,
        animation:           { duration: 300 },
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              boxWidth: 10, boxHeight: 10,
              borderRadius: 2, useBorderRadius: true,
              color: C.ink4, padding: 14,
            }
          },
          tooltip: {
            callbacks: {
              footer: items => `Total: ${items.reduce((s, i) => s + i.parsed.y, 0)}`
            }
          }
        },
        scales: {
          x: {
            stacked: true,
            grid:    { display: false },
            border:  { display: false },
            ticks:   { color: C.ink4, font: { size: 9 } }
          },
          y: {
            stacked: true,
            grid:    { color: C.rule },
            border:  { display: false },
            ticks:   { color: C.ink4 }
          }
        }
      }
    }
  });

  return `<div style="position:relative;height:200px"><canvas id="${id}"></canvas></div>`;
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
    const op = (0.12 + t * 0.78).toFixed(2); // opacidade de 12% a 90% conforme intensidade
    return `rgba(1, 149, 214, ${op})`; // azul accent Saint-Gobain
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
  App.P.mel.forEach(m => out.push({fonte:'Pipefy', sc:m.sc, frente:m.frente, resp:m.resp, dtInicio:m.dtInicio, dtFim:m.dtFim, prog:null, prio:null}));
  App.P.ana.forEach(a => out.push({fonte:'Analytics', sc:a.sc, frente:a.frente, resp:a.resp, dtInicio:a.dtInicio, dtFim:a.dtFim, prog:null, prio:a.prio}));
  App.R.forEach(r => out.push({
    fonte:'Chamados RPA',
    sc: r.fase.toLowerCase().includes('conclu') ? 'done' : 'doing',
    frente:null, resp:r.solicitante,
    // activeInRange(criado, finalizado) — ativo em algum momento do período
    dtInicio:r.criado, dtFim:r.dtFim, criado:r.criado,
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
 * buildGov() — Painel de Controle (visão executiva).
 *
 * Lê:     App.P.mel, App.P.proj, App.P.ana, App.R (todas as fontes)
 * Escreve: #gov-content
 * Chama:  allActionsFiltered(), buildHeatmap(), buildEvolucao(), flushCharts()
 * Chamada por: generate() e renderAll() (quando filtro de data muda)
 *
 * Produz:
 *  - KPIs de composição: Concluídas / Em andamento / Backlog / Outros
 *  - Donut de status unificado com segmento "Impedimentos"
 *  - Barras por responsável (equipe CoE) e por frente
 *  - Heatmap de prioridade × frente (Analytics)
 *  - Gráfico de evolução do % concluído mês a mês
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
      ` Para ver tudo, limpe os campos de data no topo.
      <br><span style="font-size:10px;opacity:.6;font-style:italic">Referência por fonte: prazo de conclusão (Projetos) · início/conclusão do desenvolvimento (Pipefy) · data de abertura ou fechamento (Analytics) · data de abertura (RPA)</span>
      </div></div>`;
  }

  // KPIs por fonte — calcula total e concluídas de cada uma individualmente
  const fontes = ['Projetos','Pipefy','Analytics','Chamados RPA'];
  const porFonte = fontes.map(f => {
    const sub = A.filter(a => a.fonte === f);
    const sd = sub.filter(a => a.sc === 'done').length;
    return {f, total:sub.length, done:sd};
  }).filter(x => x.total > 0); // exibe só fontes com dados

  // KPIs de composição (Concluídas + Em andamento + Backlog + Outros = 100%).
  let html = `<div class="sh">Painel de Controle — visão executiva</div>
  ${dateNote}
  ${aiBar('gov')}
  <div class="krow k5">
    <div class="kpi il">${kpiIcon('list')}<div class="knum">${total}</div><div class="klbl">Total de ações CoE</div>
      <div class="ksub">${fontes.filter(f=>A.some(a=>a.fonte===f)).length} fontes integradas</div></div>
    <div class="kpi gl">${kpiIcon('check')}<div class="knum">${pct(done,total)}%</div><div class="klbl">Concluídas</div>
      <div class="ksub">${done} de ${total}</div></div>
    <div class="kpi">${kpiIcon('clock')}<div class="knum">${pct(doing,total)}%</div><div class="klbl">Em andamento</div>
      <div class="ksub">${doing} de ${total}</div></div>
    <div class="kpi">${kpiIcon('stack')}<div class="knum">${pct(backlog,total)}%</div><div class="klbl">Backlog / não iniciadas</div>
      <div class="ksub">${backlog} de ${total}</div></div>
    <div class="kpi">${kpiIcon('dots')}<div class="knum">${pct(outros,total)}%</div><div class="klbl">Outros</div>
      <div class="ksub">${outrosDesc||'—'}</div></div>
  </div>`;


  // Donut de status — unifica Encerramento + Monitoramento numa fatia só
  // ("Em encerramento" = fase final / entregue) e usa uma paleta com lógica:
  //   verde escuro = concluído · verde claro = em encerramento (fase final) ·
  //   azul = em andamento · cinza = não iniciado · âmbar = bloqueado ·
  //   vermelho = cancelado · roxo = suporte/fornecedor.
  // Ordem do mais avançado/positivo para o menos. O total mostrado bate com o
  // "Total de ações CoE" porque todos os status estão contemplados.
  const scAll = count(A, a => a.sc);
  const donutDefs = [
    {label:'Concluído',       value: scAll.done    || 0,                          color:'#4DB1B3'},
    {label:'Em encerramento', value:(scAll.closing || 0) + (scAll.monitor || 0),  color:'#E66407'},
    {label:'Em andamento',    value: scAll.doing   || 0,                          color:'#0195D6'},
    {label:'Não iniciado',    value: scAll.todo    || 0,                          color:'#9CA3AF'},
    {label:'Impedimentos',    value:(scAll.blocked || 0) + (scAll.vendor  || 0)
                                  +(scAll.cancel  || 0) + (scAll.other   || 0),   color:'#C5284C'},
  ];
  const donutData = donutDefs.filter(d => d.value > 0);

  // Detalha o que compõe "Impedimentos" (só exibe categorias com valor > 0)
  const impedimentosDesc = [
    scAll.blocked ? `${scAll.blocked} bloqueado${scAll.blocked > 1 ? 's' : ''}` : '',
    scAll.cancel  ? `${scAll.cancel} cancelado${scAll.cancel  > 1 ? 's' : ''}` : '',
    scAll.vendor  ? `${scAll.vendor} suporte/fornec.`                           : '',
    scAll.other   ? `${scAll.other} outro${scAll.other > 1 ? 's' : ''}`         : '',
  ].filter(Boolean).join(' · ');

  // Total de ações por responsável da equipe CoE (TODAS — abertas, concluídas, canceladas).
  // Mostra SÓ a equipe CoE (ver EQUIPE_COE), somando pelo nome padronizado.
  // IMPORTANTE: cada fonte tem seu campo de responsável:
  //   - Projetos/Pipefy/Analytics: campo 'resp' (1 responsável por item)
  //   - Chamados RPA: campo 'responsaveis' (lista — quem trabalha no chamado, não o
  //     solicitante; um chamado pode ter vários responsáveis, conta para cada um).
  // Respeita o filtro de período de cada fonte (applyDate).
  const respCoE = {};
  const addResp = nomeRaw => {
    const nome = coeNomePadrao(nomeRaw);
    if(nome) respCoE[nome] = (respCoE[nome]||0) + 1;
  };
  applyDate(App.P.proj).kept.forEach(p => addResp(p.resp));
  applyDate(App.P.mel).kept.forEach(m => addResp(m.resp));
  applyDate(App.P.ana).kept.forEach(a => addResp(a.resp));
  applyDate(App.R).kept.forEach(r => (r.responsaveis||[]).forEach(addResp));
  const respTop = Object.entries(respCoE).sort((a,b) => b[1]-a[1]);
  const totalRespCoE = respTop.reduce((s,e)=>s+e[1],0); // base para o percentual

  const frCount = count(A.filter(a => a.frente), a => a.frente);
  const fonteInfo = porFonte.map(x =>
    `<span><b style="color:var(--ink2)">${x.f}</b> ${x.total} <span style="color:var(--ink4)">(${pct(x.done,x.total)}% concl.)</span></span>`
  ).join(' &thinsp;·&thinsp; ');
  html += `<div class="g3">
    <div class="card"><div class="card-title"><i class="ti ti-chart-pie"></i> Status das ações</div>
      ${donut(donutData)}
      ${impedimentosDesc ? `<div style="margin-top:10px;padding:7px 10px;background:rgba(197,40,76,0.07);border-radius:var(--r);font-size:11px;color:var(--err)">
        <b>Impedimentos:</b> ${impedimentosDesc}
      </div>` : ''}
      <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--rule);font-size:11px;color:var(--ink3);line-height:2">${fonteInfo}</div></div>
    <div class="card"><div class="card-title"><i class="ti ti-user-bolt"></i> Por responsável <span class="rt">equipe CoE</span></div>
      ${respTop.length ? hbars(respTop, {max:12, lw:130, tot:totalRespCoE}) : '<div style="font-size:12px;color:var(--ink4)">Sem dados da equipe CoE.</div>'}</div>
    <div class="card"><div class="card-title"><i class="ti ti-building"></i> Por frente</div>
      ${hbars(Object.entries(frCount).sort((a,b)=>b[1]-a[1]), {max:8, lw:60, tot:Object.values(frCount).reduce((s,v)=>s+v,0)})}</div>
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
  html += `<div style="font-size:10px;color:var(--ink4);margin-top:18px;padding-top:12px;border-top:1px solid var(--rule)">
    Contagem por fonte (total sem filtro de data): ${diag}. Total combinado: ${App.P.mel.length+App.P.proj.length+App.P.ana.length+App.R.length} ações.</div>`;

  document.getElementById('gov-content').innerHTML = html;
  flushCharts();
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

/*
 * buildProj() — aba Projetos.
 *
 * Lê:     App.P.proj
 * Escreve: #proj-content  (estrutura + filtros)
 *          #proj-list      (lista de itens, via renderProjList())
 * Chamada por: generate() e renderAll()
 *
 * Produz:
 *  - KPIs: total, em execução, fase final, atrasados, risco alto
 *  - Donut por status e barras por frente/área cliente
 *  - Lista filtrável com expand inline (detalhes do projeto)
 *  - Score de risco automático 0–100 por projeto
 */
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
  const atrasados = P.filter(projAtrasado);                // prazo vencido e não entregue
  const criticos = P.filter(p => projRisco(p).nivel==='alto').length; // risco alto

  const dnProj = App.dateRange.mode !== 'all'
    ? `<div class="note" style="background:var(--neu-bg);color:var(--ink3)"><i class="ti ti-calendar-stats"></i><div>
        Período aplicado: <b>${P.length} projetos</b> no recorte.${noDate > 0 ? ` ${noDate} sem prazo definido não entram no filtro.` : ''}
        <br><span style="font-size:10px;opacity:.6;font-style:italic">Referência de data: prazo de conclusão do projeto</span>
        </div></div>` : '';

  let html = `<div class="sh">Projetos</div>
  ${dnProj}
  ${aiBar('proj')}
  <div class="krow k5">
    <div class="kpi">${kpiIcon('folders')}<div class="knum">${P.length}</div><div class="klbl">Total</div></div>
    <div class="kpi il">${kpiIcon('play')}<div class="knum">${doing}</div><div class="klbl">Em execução</div></div>
    <div class="kpi gl">${kpiIcon('flag')}<div class="knum">${finalizando}</div><div class="klbl">Em fase final</div>
      <div class="ksub">encerramento / monit.</div></div>
    <div class="kpi dl">${kpiIcon('clock')}<div class="knum">${atrasados.length}</div><div class="klbl">Atrasados</div>
      <div class="ksub">prazo vencido</div></div>
    <div class="kpi wl">${kpiIcon('flame')}<div class="knum">${criticos}</div><div class="klbl">Risco alto</div>
      <div class="ksub">score de risco</div></div>
  </div>`;

  // Frente vem do campo AreaCliente (novo) ou Frente (legado)
  const frCount = count(P.filter(p => p.frente), p => p.frente);
  // donut: cada status com cor distinta e coerente com o avanço no fluxo
  //   Não iniciado = cinza | Em andamento = azul | Encerr./Monit. = verde (fase final/entregue)
  //   Concluído = verde escuro | Bloqueado = âmbar | Cancelado = vermelho
  const donutProj = [
    {label:'Concluído',      value:P.filter(p=>p.sc==='done').length,                       color:'#4DB1B3'},
    {label:'Em andamento',   value:P.filter(p=>p.sc==='doing').length,                      color:'#0195D6'},
    {label:'Em encerramento',value:P.filter(p=>p.sc==='closing'||p.sc==='monitor').length,  color:'#E66407'},
    {label:'Não iniciado',   value:P.filter(p=>p.sc==='todo').length,                       color:'#9CA3AF'},
    {label:'Bloqueado',      value:P.filter(p=>p.sc==='blocked').length,                    color:'#E83430'},
    {label:'Cancelado',      value:P.filter(p=>p.sc==='cancel').length,                     color:'#C5284C'}
  ].filter(d=>d.value);
  html += `<div class="two">
    <div class="card"><div class="card-title"><i class="ti ti-chart-pie"></i> Por status</div>
      ${donut(donutProj)}</div>
    <div class="card"><div class="card-title"><i class="ti ti-building"></i> Por frente / área cliente</div>
      ${Object.keys(frCount).length ? hbars(Object.entries(frCount).sort((a,b)=>b[1]-a[1]),{max:8,lw:80,tot:P.length}) : '<div style="font-size:12px;color:var(--ink4)">Sem dados de área</div>'}</div>
  </div>`;

  html += `<div class="note" style="background:var(--neu-bg);border-color:var(--rule);color:var(--ink3)"><i class="ti ti-info-circle"></i><div>
    <b>Cálculo de risco automático (score 0–100):</b>
    <b>Atraso</b> — fator principal, 15pts base + ~1pt/dia, teto 70pts (≈40 dias já é risco alto).
    <b>Fase</b> — projetos em Diagnóstico/Planejamento pontuam mais (18/14pts) pois têm mais caminho pela frente.
    <b>Prazo</b> — vence em ≤15 dias = +18pts · ≤30 dias = +10pts · sem prazo definido = +14pts.
    Nível: <b>alto ≥ 55</b> · <b>médio ≥ 30</b> · <b>baixo &lt; 30</b>. Concluídos e em monitoramento sempre têm risco 0.
  </div></div>`;
  // Monta os selects de filtro dinamicamente a partir dos valores presentes nos dados
  const pessoas = [...new Set(P.map(p => p.resp).filter(Boolean))].sort();
  html += `<div class="filters" style="margin-top:4px">
    <input type="text" id="proj-q" placeholder="Buscar projeto, responsável, frente..." oninput="renderProjList()" style="flex:1;max-width:280px">
    <button class="chip" id="proj-chip-atraso" onclick="toggleProjChip('atraso')">⚠ Só atrasados</button>
    <button class="chip" id="proj-chip-risco" onclick="toggleProjChip('risco')">Risco alto</button>
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
  html += `<div class="card np"><div class="ilist" id="proj-list" style="border:none;border-radius:0"></div></div>`;
  document.getElementById('proj-content').innerHTML = html;
  flushCharts();
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
  const chips = App.projChips || {atraso:false, risco:false};
  // busca em título, responsável, frente, descrição e próximos passos
  let vis = P.filter(p =>
    (!q || (p.titulo+' '+p.resp+' '+p.frente+' '+(p.descricao||'')+' '+(p.proximos||'')).toLowerCase().includes(q)) &&
    (!fp || p.resp===fp) && (!fs || p.statusRaw===fs) && (!ff || p.frente===ff) &&
    (!chips.atraso || projAtrasado(p)) &&
    (!chips.risco  || projRisco(p).nivel==='alto')
  );
  // ordena por score de risco (mais crítico primeiro); empate vai pelo mais avançado
  vis.sort((a,b) => {
    const ra = projRisco(a).score, rb = projRisco(b).score;
    if(rb !== ra) return rb - ra;
    return (b.prog||0) - (a.prog||0);
  });
  const cnt = document.getElementById('proj-count');
  if(cnt) cnt.textContent = `${vis.length} de ${P.length}`;
  if(!App.projOpen) App.projOpen = new Set();
  let itensProjeto = vis.map(p => {
    const bd = STATUS_BADGE[p.sc];
    const lateTag = projAtrasado(p);
    const risco = projRisco(p); // { score, nivel, motivos }
    const key = String(p.num||p.titulo); // chave única para o estado aberto/fechado
    const open = App.projOpen.has(key);
    const fase = projFase(p.statusRaw); // número da fase (1 a 5) — usado no aviso de atraso
    // badge exibe o status exatamente como está na base (que já traz a numeração da fase)
    const badgeTxt = p.statusRaw;
    // indicador de status: bolinha colorida em CSS puro (não depende de fonte de ícone)
    const dotColor = {
      done:'#3fa46a', doing:'#4a90d9', closing:'#d49a4a', monitor:'#6fa0e0',
      todo:'#9a9a92', blocked:'#d4a93c', cancel:'#d46a6a', vendor:'#8f6fd0', other:'#9a9a92'
    };
    const dc = dotColor[p.sc] || dotColor.other;
    // badge de risco (só para nível médio/alto, para não poluir os de baixo risco)
    const riscoBadge = risco.nivel==='alto'
      ? `<span class="badge red" title="${risco.motivos.join(' · ')}">risco alto</span>`
      : (risco.nivel==='medio' ? `<span class="badge warn" title="${risco.motivos.join(' · ')}">risco médio</span>` : '');
    return `<div class="proj-row ${open?'open':''}" data-k="${key.replace(/"/g,'')}">
      <div class="icard" onclick="toggleProj('${key.replace(/'/g,"\\'").replace(/"/g,'&quot;')}')" style="cursor:pointer">
        <div class="iico" style="background:${lateTag?'var(--err-bg)':'var(--neu-bg)'}">
          <span style="width:11px;height:11px;border-radius:50%;background:${dc};display:block"></span>
        </div>
        <div class="imain"><div class="ititle">${p.titulo}</div>
          <div class="isub">
            ${p.frente?`<span class="apill">${p.frente}</span>`:''}
            ${lateTag?`<span style="font-size:10px;color:var(--err);font-weight:500">⚠ atrasado</span>`:''}
            ${p.prog!=null?`<span style="font-size:10px;color:var(--ink4)">${Math.round(p.prog*100)}% concluído</span>`:''}
          </div>
        </div>
        <div class="iright">
          ${riscoBadge}
          <span class="badge ${bd}" style="font-size:9px">${badgeTxt}</span>
          <span style="color:var(--ink4);font-size:11px;margin-left:4px;transition:transform .15s;transform:rotate(${open?'90deg':'0deg'})">▶</span>
        </div>
      </div>
      ${open ? projDetails(p) : ''}
    </div>`;
  }).join('');
  const el = document.getElementById('proj-list');
  if(el) el.innerHTML = itensProjeto || '<div class="empty" style="padding:24px">Nenhum projeto neste filtro</div>';
}

/*
 * toggleProjChip(qual) — liga/desliga um filtro rápido (atraso / risco alto)
 * da aba Projetos e re-renderiza a lista, atualizando o destaque visual do chip.
 */
function toggleProjChip(qual){
  if(!App.projChips) App.projChips = {atraso:false, risco:false};
  App.projChips[qual] = !App.projChips[qual];
  const map = {atraso:'proj-chip-atraso', risco:'proj-chip-risco'};
  const btn = document.getElementById(map[qual]);
  if(btn) btn.classList.toggle('active', App.projChips[qual]);
  renderProjList();
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
  if(p.resp)        blocks.push({lbl:'Responsável',             val:p.resp});
  if(p.dtFim)       blocks.push({lbl:'Prazo de conclusão',      val:`${p.dtFim.toLocaleDateString('pt-BR')}${projAtrasado(p)?' &nbsp;<span style="color:var(--err)">⚠ prazo vencido</span>':''}`});
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
/*
 * buildMel() — aba Pipefy Melhorias.
 *
 * Lê:     App.P.mel
 * Escreve: #mel-content
 * Chamada por: generate() e renderAll()
 *
 * ATENÇÃO — lógica especial de filtro de data:
 *   Usa dtInicio + dtFim (intervalo de desenvolvimento), não uma data única.
 *   Melhorias de backlog sem data são SEMPRE incluídas, mesmo com filtro ativo
 *   (elas representam trabalho pendente, não histórico).
 *
 * Produz:
 *  - KPIs: total, concluídas, backlog, bloqueadas, fluxos distintos
 *  - Donut de status, barras por frente, complexidade e responsável
 */
function buildMel(){
  const {kept: Mfiltrado} = applyDate(App.P.mel);
  // Backlog sem data = trabalho pendente, não histórico. Sempre incluído.
  const backlogSemData = App.dateRange.mode !== 'all'
    ? App.P.mel.filter(m => !m.dtInicio && !m.dtFim && m.sc === 'todo')
    : [];
  const M = [...Mfiltrado, ...backlogSemData];
  document.getElementById('mel-empty').style.display  = App.P.mel.length ? 'none' : 'block';
  document.getElementById('mel-content').style.display = App.P.mel.length ? 'block' : 'none';
  if(!App.P.mel.length) return;
  const done    = M.filter(m => m.sc==='done').length;
  const backlog = M.filter(m => m.sc==='todo').length;
  const blocked = M.filter(m => m.sc==='blocked').length;

  let dn = '';
  if(App.dateRange.mode !== 'all'){
    dn = `<div class="note" style="background:var(--neu-bg);color:var(--ink3)"><i class="ti ti-calendar-stats"></i><div>
      Período aplicado: <b>${M.length} melhorias</b> no recorte${backlogSemData.length > 0 ? ` (inclui <b>${backlogSemData.length} backlog</b> sem data)` : ''}.
      <br><span style="font-size:10px;opacity:.6;font-style:italic">Referência de data: início e conclusão do desenvolvimento — inclui melhorias ativas no período, mesmo que iniciadas antes dele</span>
      </div></div>`;
  }

  // "Fluxos (processos)" = número de NomeFluxo únicos no recorte atual
  // Isso responde "quantos processos distintos foram tratados no período"
  const fluxosUnicos = new Set(M.map(m => m.fluxo).filter(Boolean)).size;

  let html = dn + `<div class="sh">Pipefy — Melhorias & Ajustes</div>
  ${aiBar('mel')}
  <div class="krow k5">
    <div class="kpi">${kpiIcon('message')}<div class="knum">${M.length}</div><div class="klbl">Total melhorias</div></div>
    <div class="kpi gl">${kpiIcon('check')}<div class="knum">${done}</div><div class="klbl">Concluídas</div><div class="ksub">${pct(done,M.length)}% do total</div></div>
    <div class="kpi">${kpiIcon('stack')}<div class="knum">${backlog}</div><div class="klbl">Backlog</div></div>
    <div class="kpi wl">${kpiIcon('lock')}<div class="knum">${blocked}</div><div class="klbl">Bloqueadas</div></div>
    <div class="kpi il">${kpiIcon('branch')}<div class="knum">${fluxosUnicos}</div><div class="klbl">Fluxos (processos)</div><div class="ksub">distintos no recorte</div></div>
  </div>`;

  html += `<div class="two">
    <div class="card"><div class="card-title"><i class="ti ti-chart-pie"></i> Status</div>
      ${donut(['done','doing','todo','vendor','blocked','cancel'].map(k=>({label:STATUS_PT[k],value:M.filter(m=>m.sc===k).length,color:STATUS_COLOR[k]})).filter(d=>d.value))}</div>
    <div class="card"><div class="card-title"><i class="ti ti-building"></i> Por frente</div>
      ${hbars(Object.entries(count(M,m=>m.frente)).sort((a,b)=>b[1]-a[1]),{max:8,lw:60,tot:M.length})}</div>
  </div>`;
  html += `<div class="two">
    <div class="card"><div class="card-title"><i class="ti ti-stack-2"></i> Por complexidade</div>
      ${hbars(Object.entries(count(M.filter(m=>m.complex),m=>m.complex)).sort((a,b)=>b[1]-a[1]),{max:6,lw:90})}</div>
    <div class="card"><div class="card-title"><i class="ti ti-user-code"></i> Por responsável</div>
      ${(() => {
        const EQUIPE_MEL = ['willian','vinícius','vinicius','felipe','gustavo','caio'];
        const ehEquipe = nome => EQUIPE_MEL.some(p => nome.toLowerCase().includes(p));
        const dados = Object.entries(count(M.filter(m=>m.resp && ehEquipe(m.resp)), m=>m.resp)).sort((a,b)=>b[1]-a[1]);
        return hbars(dados,{max:8,lw:130});
      })()}</div>
  </div>`;
  document.getElementById('mel-content').innerHTML = html;
  flushCharts();
  setBadge('nb-mel', M.length, '');
}


/* ============================================================
   VIEW: ANALYTICS
   ============================================================
   FILTRO DE DATA: usa DataAbertura (início do desenvolvimento)
   ou DataFechamento (término da validação) como fallback.
   Muitas atividades não têm data preenchida — a interface exibe quantas ficaram fora do recorte.
   ============================================================ */
/*
 * buildAna() — aba Analytics.
 *
 * Lê:     App.P.ana
 * Escreve: #ana-content
 * Chamada por: generate() e renderAll()
 *
 * ATENÇÃO — cobertura de datas baixa:
 *   Muitas atividades não têm data preenchida na planilha.
 *   Com filtro ativo, apenas atividades COM data entram no recorte.
 *   A interface exibe quantas ficaram de fora para transparência.
 *
 * Produz:
 *  - KPIs: total, concluídas, em andamento, não iniciadas
 *  - Donut de status, barras por prioridade, frente e responsável
 *  - Heatmap de prioridade × frente (chamado via buildHeatmap em buildGov)
 */
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
      (noDate>0 ? ` ${noDate} sem data não entram no filtro.` : '') +
      `<br><span style="font-size:10px;opacity:.6;font-style:italic">Referência de data: data de abertura da atividade (ou fechamento como fallback)</span>
      </div></div>`;
  } else if(comData < A.length){
    // sem filtro ativo: avisa quantas têm data (relevante para o gráfico de evolução)
    dn = `<div class="note"><i class="ti ti-info-circle"></i><div>${comData} de ${A.length} atividades têm data registrada. As ${A.length-comData} restantes não têm data preenchida na base, então não entram nos cálculos por período.</div></div>`;
  }

  // só prioridades de 1 a 5 (valores fora dessa faixa são descartados do gráfico)
  const prioCount = count(A.filter(a => a.prio && a.prio>=1 && a.prio<=5), a => 'Prioridade '+a.prio);
  let html = dn + `<div class="sh">Analytics</div>
  ${aiBar('ana')}
  <div class="krow">
    <div class="kpi">${kpiIcon('chartbar')}<div class="knum">${A.length}</div><div class="klbl">Total</div></div>
    <div class="kpi gl">${kpiIcon('check')}<div class="knum">${done}</div><div class="klbl">Concluídas</div><div class="ksub">${pct(done,A.length)}%</div></div>
    <div class="kpi il">${kpiIcon('clock')}<div class="knum">${doing}</div><div class="klbl">Em andamento</div></div>
    <div class="kpi">${kpiIcon('minus')}<div class="knum">${todo}</div><div class="klbl">Não iniciadas</div></div>
  </div>`;
  html += `<div class="g3">
    <div class="card"><div class="card-title"><i class="ti ti-chart-pie"></i> Status</div>
      ${donut(['done','doing','todo','blocked','cancel'].map(k=>({label:STATUS_PT[k],value:A.filter(a=>a.sc===k).length,color:STATUS_COLOR[k]})).filter(d=>d.value))}</div>
    <div class="card"><div class="card-title"><i class="ti ti-flag"></i> Por prioridade</div>
      ${hbars(Object.entries(prioCount).sort((a,b)=>{const na=+a[0].match(/\d+/),nb=+b[0].match(/\d+/);return na-nb;}),{max:10,lw:90})}</div>
    <div class="card"><div class="card-title"><i class="ti ti-building"></i> Por frente</div>
      ${hbars(Object.entries(count(A.filter(a=>a.frente),a=>a.frente)).sort((a,b)=>b[1]-a[1]),{max:8,lw:60,tot:A.length})}</div>
  </div>`;
  html += `<div class="two">
    <div class="card"><div class="card-title"><i class="ti ti-user"></i> Por responsável</div>
      ${hbars(Object.entries(count(A.filter(a=>a.resp),a=>a.resp)).sort((a,b)=>b[1]-a[1]),{max:8,lw:140})}</div>
    ${buildHeatmap()}
  </div>`;
  document.getElementById('ana-content').innerHTML = html;
  flushCharts();
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
   Todos os chamados têm essa data preenchida (campo obrigatório no Pipefy).
   Sub-abas: Visão geral, Top bots, Tipos de problema, Tempo de resolução, Chamados.
   ============================================================ */
/*
 * buildRPAChamados() — aba RPA & Bots (sub-abas de chamados).
 *
 * Lê:     App.R (chamados), App.B (inventário, via areaPorProc)
 * Escreve: #rpa-empty / #rpa-content  (visibilidade)
 *          #rpage-visao   → estrutura + chama renderRPAStatus()
 *          #rpage-bots    → top bots por volume de manutenções
 *          #rpage-prob    → tipos de problema × fase (clusteredBars)
 *          #rpage-tempo   → tempo médio por bot
 *          #rpage-lista   → tabela paginada com busca
 * Chamada por: generate() e renderAll()
 *
 * ESTRUTURA DA FUNÇÃO:
 *   1. Validação e nota de filtro de data
 *   2. Sub-aba Visão Geral  → htmlVisao + renderRPAStatus()
 *   3. Sub-aba Top Bots     → htmlTopBots
 *   4. Sub-aba Tipos Problema → htmlProblemas
 *   5. Sub-aba Tempo        → htmlTempo
 *   6. Sub-aba Lista        → htmlLista + renderRPALista()
 */
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
      (noDate>0 ? ` ${noDate} sem data de criação não entram no filtro.` : '') +
      `<br><span style="font-size:10px;opacity:.6;font-style:italic">Referência de data: data de abertura do chamado</span>
      </div></div>`;
  }

  // Filtro local por status (fase) — opções derivadas das fases presentes nos dados
  const fasesDisp = [...new Set(R.map(r=>r.fase).filter(Boolean))].sort();
  const filtroStatus = `<div class="filters" style="margin-bottom:14px">
    <label>Status do chamado</label>
    <select id="rpa-fs" onchange="renderRPAStatus()"><option value="">Todos</option>
      ${fasesDisp.map(f=>`<option>${f}</option>`).join('')}</select>
    <span style="font-size:11px;color:var(--ink4);margin-left:auto" id="rpa-fs-count"></span>
  </div>`;

  let htmlVisao = dn + aiBar('rpa') + filtroStatus + `<div id="rpa-visao-kpis"></div>`;
  document.getElementById('rpage-visao').innerHTML = htmlVisao;
  // os KPIs e gráficos são renderizados por renderRPAStatus (respeita o filtro de status)
  renderRPAStatus();

  // Mapa processo → área (a área já foi atribuída a cada chamado em enrichRPAComArea).
  // Usado para exibir a área ao lado do nome do bot nos gráficos de Top Bots e Tempo médio.
  const areaPorProc = {};
  R.forEach(r => { if(r.processo && !areaPorProc[r.processo]) areaPorProc[r.processo] = r.area; });
  // formata "Nome do bot  ·  [ÁREA]" para usar como rótulo
  const labelComArea = proc => {
    const a = areaPorProc[proc];
    return a && a !== '(não mapeada)' ? `${proc}  ·  ${a}` : proc;
  };

  // ── Sub-aba: Top Bots ─────────────────────────────────────────
  const porProcV = count(R, r => r.processo);
  const procList = Object.entries(porProcV).filter(e=>e[0]!=='(sem processo)').sort((a,b)=>b[1]-a[1])
    .map(([proc,n]) => [labelComArea(proc), n]); // adiciona a área ao rótulo
  let htmlTopBots = `<div class="card"><div class="card-title"><i class="ti ti-trophy"></i> Top bots por nº de manutenções<span class="rt">${procList.length} processos</span></div>
    ${hbars(procList,{max:15,lw:300,color:'var(--err)',fixedLabel:true})}</div>`;
  document.getElementById('rpage-bots').innerHTML = htmlTopBots;
  flushCharts();

  // ── Sub-aba: Tipos de Problema ───────────────────────────────
  const porProb = count(R, r => r.problema);
  const porReexec = count(R.filter(r=>r.reexec), r => r.reexec);
  // fases (grupos), na ordem do fluxo do chamado
  const fasesDef = [
    {key:'Backlog',                    label:'Backlog',         color:'#9CA3AF'},
    {key:'Identificação do problema',  label:'Identificação',   color:'#E66407'},
    {key:'Desenvolvimento da solução', label:'Desenvolvimento', color:'#0195D6'},
    {key:'Reexecução',                 label:'Reexecução',      color:'#4DB1B3'},
    {key:'Concluído',                  label:'Concluído',       color:'#0F5299'}
  ];
  // tipos de problema (séries / barras dentro de cada grupo), ordenados por volume
  const probsOrd = Object.entries(porProb).sort((a,b)=>b[1]-a[1]).map(e=>e[0]);
  const paletaProb = ['#0195D6','#E66407','#4DB1B3','#C5284C','#E83430','#0F5299','#8B6FD4'];
  const serieProb = probsOrd.map((pr,i) => ({key:pr, label:pr, color:paletaProb[i%paletaProb.length]}));
  // monta os grupos: para cada fase, a contagem de cada tipo de problema
  const grupos = fasesDef.map(f => {
    const sub = R.filter(r => r.fase===f.key);
    const valores = {};
    probsOrd.forEach(pr => { valores[pr] = sub.filter(r=>r.problema===pr).length; });
    return {label:f.label, color:f.color, valores};
  });
  let htmlProblemas = `<div class="two">
    <div class="card"><div class="card-title"><i class="ti ti-alert-circle"></i> Tipos de problema <span class="rt">por fase do chamado</span></div>
      ${clusteredBars(grupos, serieProb)}</div>
    <div class="card"><div class="card-title"><i class="ti ti-refresh"></i> Admite reexecução?</div>
      ${donut(Object.entries(porReexec).map(([k,vv],i)=>({label:k,value:vv,color:i===0?'var(--ok)':'var(--warn)'})))}
      <div class="note" style="margin-top:14px;margin-bottom:0;background:var(--neu-bg);color:var(--ink3)"><i class="ti ti-info-circle"></i><div>
        <b>O que é reexecução?</b> Indica se o bot pode ser rodado novamente após uma falha sem risco de duplicar transações.
        <b>Admite:</b> basta re-executar — o resultado é o mesmo.
        <b>Não admite:</b> é preciso investigar até onde processou antes de qualquer ação (ex: evitar pagamento duplo ou lançamento duplicado no SAP).
      </div></div></div>
  </div>`;
  document.getElementById('rpage-prob').innerHTML = htmlProblemas;
  flushCharts();

  // ── Sub-aba: Tempo de Resolução ──────────────────────────────
  const avg = (arr,k) => { const v=arr.filter(r=>r[k]!=null).map(r=>r[k]); return v.length?(v.reduce((s,x)=>s+x,0)/v.length).toFixed(1):'—'; };
  let htmlTempo = `<div class="krow">
    <div class="kpi">${kpiIcon('clock')}<div class="knum sm">${avg(R,'tIdent')}</div><div class="klbl">Média dias · Identificação</div></div>
    <div class="kpi">${kpiIcon('clock')}<div class="knum sm">${avg(R,'tDesenv')}</div><div class="klbl">Média dias · Desenvolvimento</div></div>
    <div class="kpi">${kpiIcon('clock')}<div class="knum sm">${avg(R,'tReexec')}</div><div class="klbl">Média dias · Reexecução</div></div>
    <div class="kpi">${kpiIcon('chartbar')}<div class="knum sm">${R.filter(r=>r.tIdent!=null||r.tDesenv!=null).length}</div><div class="klbl">Chamados com tempo medido</div></div>
  </div>`;
  // tempo médio por bot (só bots com 3+ chamados para ter significância estatística)
  const procTempo={};
  R.forEach(r=>{ const tt=(r.tIdent||0)+(r.tDesenv||0); if(tt>0){if(!procTempo[r.processo])procTempo[r.processo]={s:0,n:0};procTempo[r.processo].s+=tt;procTempo[r.processo].n++;} });
  const procAvg = Object.entries(procTempo).filter(e=>e[0]!=='(sem processo)'&&e[1].n>=3).map(([k,v])=>[labelComArea(k),+(v.s/v.n).toFixed(1)]).sort((a,b)=>b[1]-a[1]);
  // bots com apenas 1 chamado: mostramos o tempo daquele único chamado (não é "média")
  const procUm = Object.entries(procTempo).filter(e=>e[0]!=='(sem processo)'&&e[1].n===1).map(([k,v])=>[labelComArea(k),+v.s.toFixed(1)]).sort((a,b)=>b[1]-a[1]);
  const _noteAvg = `<div class="note" style="margin-top:14px;margin-bottom:0;background:var(--neu-bg);color:var(--ink3)"><i class="ti ti-info-circle"></i><div>Soma dos dias em <b>Identificação</b> + <b>Desenvolvimento</b> dividida pelo nº de chamados do bot. Só bots com <b>3+ chamados</b> entram (evita distorção de amostra única).</div></div>`;
  const _cardAvg = `<div class="card"><div class="card-title"><i class="ti ti-clock"></i> Tempo médio por bot<span class="rt">dias · 3+ chamados</span></div>
    ${hbars(procAvg,{max:12,lw:180,color:'var(--warn)',fixedLabel:true})}${_noteAvg}</div>`;
  if(procUm.length){
    htmlTempo += `<div class="two">${_cardAvg}<div class="card"><div class="card-title"><i class="ti ti-clock-hour-4"></i> Bots com 1 chamado<span class="rt">dias · ${procUm.length} bots</span></div>
      ${hbars(procUm,{max:20,lw:180,color:'#5aa0a0',fixedLabel:true})}
      <div class="note" style="margin-top:14px;margin-bottom:0;background:var(--neu-bg);color:var(--ink3)"><i class="ti ti-info-circle"></i><div>Um único chamado — não é média, serve de referência.</div></div></div></div>`;
  } else {
    htmlTempo += _cardAvg;
  }
  document.getElementById('rpage-tempo').innerHTML = htmlTempo;
  flushCharts();

  // ── Sub-aba: Lista de Chamados ───────────────────────────────
  let htmlLista = `<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
    <input type="text" id="rsearch" placeholder="Buscar por código, processo, solicitante..." oninput="renderRPALista()" style="flex:1;max-width:360px">
    <span style="font-size:11px;color:var(--ink4)" id="rlista-count">${total} chamados</span></div>
    <div class="card np"><div style="overflow-x:auto"><table class="tbl" style="margin:0">
    <thead><tr><th style="padding-left:20px">Código</th><th>Processo</th><th>Problema</th><th>Fase</th><th>Mês</th><th style="padding-right:20px">Status</th></tr></thead>
    <tbody id="rlista-body"></tbody></table></div></div>`;
  document.getElementById('rpage-lista').innerHTML = htmlLista;
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

  let htmlKpis = `<div class="krow k5">
    <div class="kpi">${kpiIcon('ticket')}<div class="knum">${total}</div><div class="klbl">Total chamados</div><div class="ksub">${procUnicos} processos distintos</div></div>
    <div class="kpi gl">${kpiIcon('check')}<div class="knum">${concl}</div><div class="klbl">Concluídos</div><div class="ksub">${pct(concl,total)}%</div></div>
    <div class="kpi il">${kpiIcon('clock')}<div class="knum">${abertos}</div><div class="klbl">Abertos</div></div>
    <div class="kpi dl">${kpiIcon('alert')}<div class="knum">${venc}</div><div class="klbl">Vencidos</div><div class="ksub">${pctVenc}% do total</div></div>
    <div class="kpi wl">${kpiIcon('refresh')}<div class="knum">${reexec}</div><div class="klbl">Reexecuções</div></div>
  </div>`;

  // Volume mensal (barras empilhadas: chamados normais + vencidos)
  const porMes={}, porMesV={};
  R.forEach(r => {
    if (r.mes) {
      porMes[r.mes]  = (porMes[r.mes]  || 0) + 1;
      if (r.vencido) porMesV[r.mes] = (porMesV[r.mes] || 0) + 1;
    }
  });
  const meses = Object.keys(porMes).sort().slice(-12);
  const vol   = chartVBars(meses, porMes, porMesV);

  // Volume mensal + donut de fase lado a lado (visão temporal + estado atual)
  htmlKpis += `<div class="two">
    <div class="card"><div class="card-title"><i class="ti ti-chart-bar"></i> Volume mensal</div>${vol}</div>
    <div class="card"><div class="card-title"><i class="ti ti-chart-pie"></i> Status (fase) dos chamados</div>
      ${donut(Object.entries(count(R,r=>r.fase)).map(([k,vv],i)=>({label:k,value:vv,color:['var(--ok)','var(--info)','var(--warn)','var(--err)','#7c5cbf','var(--ink4)'][i%6]})))}</div>
  </div>`;

  // Tickets por área (área herdada do inventário de bots via match de nome).
  // As frentes principais ficam visíveis; as demais (PAM, CI, IT, ARG, etc.)
  // são somadas em "Outros" para não poluir o gráfico com fatias minúsculas.
  const AREAS_PRINCIPAIS = ['P2P','TAX','H2R','O2C','R2R'];
  const porArea = count(R, r => r.area || '(não mapeada)');
  let outrosArea = 0;
  const areaEntries = [];
  Object.entries(porArea).forEach(([area, n]) => {
    const up = area.toUpperCase();
    if(AREAS_PRINCIPAIS.includes(up) || area === '(não mapeada)'){
      areaEntries.push([area, n]);
    } else {
      outrosArea += n; // PAM, CI, IT, ARG e quaisquer outras pequenas
    }
  });
  areaEntries.sort((a,b)=>b[1]-a[1]);
  if(outrosArea > 0) areaEntries.push(['Outros', outrosArea]); // "Outros" sempre por último
  htmlKpis += `<div class="card"><div class="card-title"><i class="ti ti-building"></i> Tickets por área</div>
    ${hbars(areaEntries,{max:12,lw:120,tot:total,fixedLabel:true})}</div>`;

  document.getElementById('rpa-visao-kpis').innerHTML = htmlKpis;
  flushCharts();
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
  let linhasChamados = vis.slice(0,1000).map(r => {
    const concl = r.fase.toLowerCase().includes('conclu');
    return `<tr>
      <td style="padding-left:20px;font-family:monospace;font-size:11px;color:var(--ink3)">${r.cod}</td>
      <td style="font-size:11px">${r.processo}</td>
      <td style="font-size:11px;color:var(--ink3)">${r.problema}</td>
      <td><span class="badge ${concl?'ok':'info'}" style="font-size:9px">${r.fase}</span></td>
      <td style="font-size:11px;color:var(--ink4)">${ymLabel(r.mes)}</td>
      <td style="padding-right:20px">${r.vencido?'<span class="badge red">Vencido</span>':'<span class="badge neu">No prazo</span>'}</td></tr>`;
  }).join('');
  if(vis.length > 1000) linhasChamados += `<tr><td colspan="6" style="text-align:center;padding:16px;color:var(--ink4);font-size:12px">Exibindo 1000 de ${vis.length} — use a busca para refinar</td></tr>`;
  const corpoTabela = document.getElementById('rlista-body');
  if(corpoTabela) corpoTabela.innerHTML = linhasChamados;
}


/* ============================================================
   VIEW: INVENTÁRIO DE BOTS
   ============================================================
   FILTRO DE DATA DIFERENTE: usa o ANO de entrada em produção (AnoPRD),
   não uma data de ação. Ao filtrar "2026", mostra apenas bots que
   entraram em PRD em 2026 (não chamados nem melhorias de 2026).
   ============================================================ */
/*
 * buildBots() — aba Inventário de Bots (dentro de RPA & Bots).
 *
 * Lê:     App.B (inventário), App.R (para cruzamento de chamados, se disponível)
 * Escreve: #bots-empty / #bots-content
 *          #bots-list  → lista filtrável de bots, via renderBotsList()
 * Chamada por: generate() e renderAll()
 *
 * FILTRO DE DATA DIFERENTE:
 *   Usa o AnoPRD (ano de entrada em produção), não datas de ação.
 *   "Filtrar por 2026" mostra bots que foram ao ar em 2026, não chamados de 2026.
 *
 * Produz:
 *  - KPIs: total de bots, em PRD, em DEV, backlog
 *  - Barras por área e donut por perímetro (bots em PRD)
 *  - Barras por criticidade e frequência
 *  - Tabela de cruzamento inventário × chamados (se App.R disponível)
 *  - Lista filtrada com expand inline (detalhes do bot)
 */
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
      (semAno>0 ? ` ${semAno} bots sem ano de PRD não entram no filtro.` : '') +
      `<br><span style="font-size:10px;opacity:.6;font-style:italic">Referência de data: ano de entrada em produção (AnoPRD) — filtra por ano, não por data exata</span>
      </div></div>`;
  }
  document.getElementById('bots-empty').style.display  = App.B.length ? 'none' : 'block';
  document.getElementById('bots-content').style.display = App.B.length ? 'block' : 'none';
  if(!App.B.length) return;

  const prd       = B.filter(b=>b.status==='PRD').length;
  const dev       = B.filter(b=>b.status==='DEV').length;
  const backlog   = B.filter(b=>b.status==='BACKLOG').length;
  const cancel    = B.filter(b=>b.status==='CANCELADO'||b.status==='DESATIVADO').length;

  let html = dn + `<div class="sh">Inventário de Bots — RPA</div>
  ${aiBar('bots')}
  <div class="krow">
    <div class="kpi">${kpiIcon('robot')}<div class="knum">${B.length}</div><div class="klbl">Total de bots</div></div>
    <div class="kpi gl">${kpiIcon('rocket')}<div class="knum">${prd}</div><div class="klbl">Em produção</div><div class="ksub">${pct(prd,B.length)}% do total</div></div>
    <div class="kpi wl">${kpiIcon('code')}<div class="knum">${dev}</div><div class="klbl">Em desenvolvimento</div></div>
    <div class="kpi">${kpiIcon('stack')}<div class="knum">${backlog}</div><div class="klbl">Backlog</div></div>
  </div>`;

  const prdBots = B.filter(b=>b.status==='PRD');
  // As 5 frentes principais ficam visíveis; as demais (MEX, PAM, IT, etc.)
  // são somadas em "Outros" para que a soma das barras feche com o total de bots em PRD.
  const AREAS_PRINCIPAIS = ['P2P','TAX','H2R','O2C','R2R'];
  const porAreaPrd = count(prdBots, b => b.area);
  let outrosPrd = 0;
  const areaBots = [];
  Object.entries(porAreaPrd).forEach(([area, n]) => {
    if(AREAS_PRINCIPAIS.includes(area.toUpperCase())) areaBots.push([area, n]);
    else outrosPrd += n;
  });
  areaBots.sort((a,b) => b[1]-a[1]);
  if(outrosPrd > 0) areaBots.push(['Outros', outrosPrd]); // "Outros" por último
  html += `<div class="two">
    <div class="card"><div class="card-title"><i class="ti ti-building"></i> Bots em PRD por área</div>
      ${hbars(areaBots,{max:6,lw:60,tot:prd})}</div>
    <div class="card"><div class="card-title"><i class="ti ti-world"></i> Por perímetro</div>
      ${donut(Object.entries(count(prdBots,b=>b.perimetro)).map(([k,v],i)=>({label:k,value:v,color:['var(--info)','var(--ok)','var(--warn)','var(--err)'][i%4]})))}</div>
  </div>`;
  html += `<div class="two">
    <div class="card"><div class="card-title"><i class="ti ti-alert-octagon"></i> Por criticidade</div>
      ${hbars([1,2,3,4].map(c=>['Criticidade '+c,prdBots.filter(b=>b.criticidade===c).length]).filter(e=>e[1]),{max:4,lw:100})}
      <div class="note" style="margin-top:14px;margin-bottom:0;background:var(--neu-bg);color:var(--ink3)"><i class="ti ti-info-circle"></i><div>
        <b>Critérios de criticidade:</b><br>
        <b>1 — Crítica:</b> processo essencial; falha gera impacto financeiro/fiscal imediato ou para a operação.<br>
        <b>2 — Alta:</b> processo importante com prazo sensível; falha causa atraso relevante.<br>
        <b>3 — Média:</b> processo recorrente; falha tem impacto moderado e contornável.<br>
        <b>4 — Baixa:</b> processo de apoio; falha tem baixo impacto e pode esperar.</div></div></div>
    <div class="card"><div class="card-title"><i class="ti ti-repeat"></i> Por frequência</div>
      ${hbars(Object.entries(count(prdBots.filter(b=>b.freq),b=>b.freq)).sort((a,b)=>b[1]-a[1]),{max:6,lw:80})}</div>
  </div>`;

  // Cruzamento inventário × chamados (só se o relatório de RPA estiver carregado)
  if(App.R.length) html += buildBotsCruzamento(B);

  // Lista filtrada por status e área
  html += `<div class="filters" style="margin-top:8px">
    <label>Status</label><select id="bot-fs" onchange="renderBotsList()"><option value="">Todos</option>
      <option>PRD</option><option>DEV</option><option>BACKLOG</option><option>CANCELADO</option><option>DESATIVADO</option></select>
    <label>Área</label><select id="bot-fa" onchange="renderBotsList()"><option value="">Todas</option>
      ${[...new Set(B.map(b=>b.area))].filter(Boolean).sort().map(a=>`<option>${a}</option>`).join('')}</select></div>
    <div class="card np"><div class="ilist" id="bots-list" style="border:none;border-radius:0"></div></div>`;
  document.getElementById('bots-content').innerHTML = html;
  flushCharts();
  renderBotsList();
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
  if(!App.botsOpen) App.botsOpen = new Set();
  let B = source.filter(b => (!fs||b.status===fs) && (!fa||b.area===fa));
  const sb = {PRD:'ok', DEV:'info', BACKLOG:'neu', CANCELADO:'red', DESATIVADO:'red'};
  const botDot = {PRD:'#4DB1B3', DEV:'#0195D6', BACKLOG:'#9CA3AF', CANCELADO:'#C5284C', DESATIVADO:'#E83430'};
  const critLabel = {1:'Crítica',2:'Alta',3:'Média',4:'Baixa'};
  const critBadge = {1:'err',2:'warn',3:'neu',4:'neu'};
  let itensBots = B.slice(0,200).map(b => {
    const key = b.nome;
    const open = App.botsOpen.has(key);
    const safeKey = key.replace(/'/g,"\\'").replace(/"/g,'&quot;');
    return `<div class="proj-row ${open?'open':''}">
      <div class="icard" onclick="toggleBot('${safeKey}')" style="cursor:pointer">
        <div class="iico" style="background:var(--neu-bg);flex-direction:column;gap:4px">
          <span style="width:11px;height:11px;border-radius:50%;background:${botDot[b.status]||'#9a9a92'};display:block"></span>
        </div>
        <div class="imain">
          <div class="ititle">${b.nome}</div>
          <div class="isub">
            ${b.area?`<span class="apill">${b.area}</span>`:''}
            ${b.perimetro&&b.perimetro!=='Brasil'?`<span class="apill">${b.perimetro}</span>`:''}
            ${b.areaCliente&&b.areaCliente&&b.areaCliente!==b.area?`<span style="color:var(--ink4);font-size:10px">→ ${b.areaCliente}</span>`:''}
            ${b.freq?`<span style="color:var(--ink4)">${b.freq}</span>`:''}
            ${b.fte?`<span class="badge ok" style="font-size:9px;padding:1px 5px">${b.fte} FTE</span>`:''}
            ${b.vol?`<span style="color:var(--ink4);font-size:10px">${b.vol.toLocaleString('pt-BR')}/mês</span>`:''}
          </div>
        </div>
        <div class="iright">
          ${b.anoPrd&&b.status==='PRD'?`<span style="font-size:10px;color:var(--ink4)">PRD ${b.anoPrd}</span>`:''}
          ${b.criticidade?`<span class="badge ${critBadge[b.criticidade]||'neu'}" style="font-size:9px" title="Criticidade ${b.criticidade}: ${critLabel[b.criticidade]}">${critLabel[b.criticidade]||'Crit '+b.criticidade}</span>`:''}
          <span class="badge ${sb[b.status]||'neu'}" style="font-size:9px">${b.status}</span>
          <span style="color:var(--ink4);font-size:11px;margin-left:4px;transition:transform .15s;transform:rotate(${open?'90deg':'0deg'})">▶</span>
        </div>
      </div>
      ${open ? botDetails(b) : ''}
    </div>`;
  }).join('');
  if(B.length>200) itensBots += `<div class="icard" style="justify-content:center;color:var(--ink4);font-size:12px">Exibindo 200 de ${B.length}</div>`;
  const listaBots = document.getElementById('bots-list');
  if(listaBots) listaBots.innerHTML = itensBots || '<div class="empty" style="padding:24px">Nenhum bot neste filtro</div>';
}


function toggleBot(key){
  if(!App.botsOpen) App.botsOpen = new Set();
  if(App.botsOpen.has(key)) App.botsOpen.delete(key);
  else App.botsOpen.add(key);
  renderBotsList();
}

function botDetails(b){
  const row = (lbl, val) => val ? `<div class="pd-block"><div class="pd-lbl">${lbl}</div><div class="pd-val">${val}</div></div>` : '';
  const critDesc = {1:'Falha gera impacto financeiro/fiscal imediato ou para a operação.',2:'Processo com prazo sensível — falha causa atraso relevante.',3:'Falha tem impacto moderado e contornável.',4:'Processo de apoio — falha tem baixo impacto.'};
  const critTxt = b.criticidade ? `${b.criticidade} — ${['Crítica','Alta','Média','Baixa'][b.criticidade-1]||''}: ${critDesc[b.criticidade]||''}` : '';
  return `<div class="proj-detail">
    ${row('Desenvolvedor', b.dev)}
    ${row('Suporte / Sustentação', b.suporte)}
    ${row('Descrição', b.desc)}
    ${row('Área cliente', b.areaCliente)}
    ${row('Sistema SAP', b.sap)}
    ${row('Criticidade', critTxt)}
    ${row('FTEs economizados', b.fte ? b.fte+' FTE' : '')}
    ${row('Volumetria mensal', b.vol ? b.vol.toLocaleString('pt-BR')+' transações/mês' : '')}
    ${row('Nº de robôs', b.nBots ? String(b.nBots) : '')}
  </div>`;
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
  // Se o chip clicado já está ativo, limpa o filtro (toggle)
  const chip = document.getElementById('dfc-' + mode);
  if (chip && chip.classList.contains('active')) {
    clearDateFilter();
    return;
  }

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
   ANÁLISE AUTOMÁTICA ("IA" de insights calculados)
   ============================================================
   Gera leituras analíticas a partir dos dados, 100% no navegador —
   nada é enviado para servidor algum. Não é um modelo de linguagem:
   são análises programadas (concentração, tendência, gargalos, outliers)
   que produzem frases dinâmicas, sempre recalculadas conforme a planilha
   e o filtro de período ativos.

   Cada aba tem uma função analise<Aba>() que retorna uma lista de
   insights no formato { tipo, texto }, onde tipo ∈ {pos, neg, warn, neu}
   controla a cor/ícone. renderAnalise() monta o painel e aiBar() o botão.
   ============================================================ */

// Ícone (SVG inline) de "faísca/análise" — não depende de fonte externa
const AI_SPARK = '<svg class="ai-spark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2z"/></svg>';

/*
 * aiBar(aba) — gera o HTML do botão "Gerar análise" de uma aba.
 * O id do container do painel é ai-panel-<aba>, preenchido por gerarAnalise().
 */
function aiBar(aba){
  return `<div class="ai-bar">
    <button class="ai-btn" id="ai-btn-${aba}" onclick="gerarAnalise('${aba}')">${AI_SPARK} Gerar análise</button>
    <span class="ai-hint">leitura automática dos números deste recorte · 100% local</span>
  </div><div id="ai-panel-${aba}"></div>`;
}

/*
 * gerarAnalise(aba) — calcula os insights da aba e renderiza o painel.
 * Mostra um estado de "analisando" breve (puramente visual) e então o resultado.
 * Se clicar de novo, recolhe o painel (toggle).
 */
function gerarAnalise(aba){
  const panel = document.getElementById('ai-panel-'+aba);
  const btn = document.getElementById('ai-btn-'+aba);
  if(!panel) return;
  // toggle: se já está aberto, recolhe
  if(panel.dataset.open === '1'){
    panel.innerHTML = ''; panel.dataset.open = '0';
    return;
  }
  if(btn) btn.classList.add('loading');
  // pequeno atraso só para dar sensação de processamento (sem travar nada)
  setTimeout(() => {
    const fn = {
      gov: analiseGov, proj: analiseProj, mel: analiseMel,
      ana: analiseAna, rpa: analiseRPA, bots: analiseBots
    }[aba];
    const insights = (fn ? fn() : []).filter(Boolean);
    const corpo = insights.length
      ? insights.map(i => `<div class="ai-item ${i.tipo}"><div class="ai-ico">${i.ico||'•'}</div><div>${i.texto}</div></div>`).join('')
      : `<div class="ai-item neu"><div class="ai-ico">•</div><div>Não há dados suficientes neste recorte para gerar uma análise. Tente limpar o filtro de período.</div></div>`;
    panel.innerHTML = `<div class="ai-panel">
      <div class="ai-panel-head">${AI_SPARK}<span class="ai-panel-title">Análise automática</span>
        <span class="ai-panel-sub">${insights.length} ${insights.length===1?'observação':'observações'} · recalculado dos dados atuais</span></div>
      ${corpo}</div>`;
    panel.dataset.open = '1';
    if(btn) btn.classList.remove('loading');
  }, 280);
}

// helper: maior entrada {chave,valor} de um objeto de contagem
function topEntry(obj, excluir=[]){
  const e = Object.entries(obj).filter(([k]) => !excluir.includes(k)).sort((a,b)=>b[1]-a[1]);
  return e[0] || null;
}

/* --- Análise: GOVERNANÇA --- */
function analiseGov(){
  const {kept:A} = allActionsFiltered();
  const tot = A.length;
  if(!tot) return [];
  const ins = [];
  const done = A.filter(a=>a.sc==='done').length;
  const doing = A.filter(a=>a.sc==='doing'||a.sc==='closing').length;
  const backlog = A.filter(a=>a.sc==='todo').length;
  const taxa = pct(done,tot);

  // 1. Leitura geral da conclusão
  ins.push({tipo: taxa>=60?'pos':(taxa>=35?'neu':'warn'), ico:'%',
    texto:`<b>${taxa}% das ${tot} ações estão concluídas</b> (${done}). Em andamento: ${doing}. Backlog/não iniciadas: ${backlog} (${pct(backlog,tot)}%).`});

  // 2. Qual fonte concentra o backlog em aberto
  const fontes = ['Projetos','Pipefy','Analytics','Chamados RPA'];
  const backlogPorFonte = {};
  fontes.forEach(f => { backlogPorFonte[f] = A.filter(a=>a.fonte===f && (a.sc==='todo'||a.sc==='doing'||a.sc==='closing')).length; });
  const topBacklog = topEntry(backlogPorFonte);
  if(topBacklog && topBacklog[1]>0){
    ins.push({tipo:'neu', ico:'≡',
      texto:`A fonte com mais ações em aberto é <b>${topBacklog[0]}</b>, com ${topBacklog[1]} ${topBacklog[1]===1?'ação':'ações'} (em andamento ou backlog).`});
  }

  // 3. Concentração de ações abertas por responsável (só equipe CoE, igual ao gráfico)
  const abertasPorResp = {};
  A.filter(a=>a.resp && a.sc!=='done' && a.sc!=='cancel').forEach(a=>{
    const nome = coeNomePadrao(a.resp);
    if(nome) abertasPorResp[nome] = (abertasPorResp[nome]||0)+1;
  });
  const totalAbertas = Object.values(abertasPorResp).reduce((s,v)=>s+v,0);
  const topResp = topEntry(abertasPorResp);
  if(topResp && totalAbertas>0){
    ins.push({tipo: topResp[1]/totalAbertas>0.3?'warn':'neu', ico:'@',
      texto:`Na equipe CoE, <b>${topResp[0]}</b> concentra ${topResp[1]} ações abertas (${pct(topResp[1],totalAbertas)}% do total da equipe) — ${topResp[1]/totalAbertas>0.3?'possível gargalo de capacidade':'maior carga individual'}.`});
  }

  // 4. Canceladas (sinaliza se for relevante)
  const cancel = A.filter(a=>a.sc==='cancel').length;
  if(cancel>0 && pct(cancel,tot)>=5){
    ins.push({tipo:'warn', ico:'×',
      texto:`<b>${cancel} ações canceladas</b> (${pct(cancel,tot)}% do total) — vale revisar o motivo para reduzir retrabalho de planejamento.`});
  }
  return ins;
}

/* --- Análise: PROJETOS --- */
function analiseProj(){
  const {kept:P} = applyDate(App.P.proj);
  const tot = P.length;
  if(!tot) return [];
  const ins = [];
  const exec = P.filter(p=>p.sc==='doing').length;
  const fin = P.filter(p=>p.sc==='closing'||p.sc==='monitor').length;
  const atrasados = P.filter(projAtrasado);

  // 1. Situação geral
  ins.push({tipo:'neu', ico:'≡',
    texto:`<b>${tot} projetos</b> no recorte: ${exec} em execução, ${fin} em fase final (encerramento/monitoramento).`});

  // 2. Atrasados — lista NOMINAL de quais são (ordenados por dias de atraso)
  if(atrasados.length>0){
    const comDias = atrasados.map(p => ({
      titulo: p.titulo,
      dias: Math.round((HOJE - p.dtFim)/86400000),
      fase: projFase(p.statusRaw), statusRaw: p.statusRaw
    })).sort((a,b)=>b.dias-a.dias);
    const lista = comDias.map(p => `<b>${p.titulo}</b> (${p.dias}d, ${p.statusRaw})`).join('; ');
    ins.push({tipo:'neg', ico:'!',
      texto:`<b>${atrasados.length} ${atrasados.length===1?'projeto atrasado':'projetos atrasados'}</b>: ${lista}.`});
  } else {
    ins.push({tipo:'pos', ico:'✓', texto:`Nenhum projeto com prazo vencido neste recorte.`});
  }

  // 3. Projeto mais crítico pelo score de risco automático
  const comRisco = P.map(p => ({p, r:projRisco(p)})).filter(x=>x.r.score>0).sort((a,b)=>b.r.score-a.r.score);
  if(comRisco.length){
    const top = comRisco[0];
    ins.push({tipo: top.r.nivel==='alto'?'neg':'warn', ico:'▲',
      texto:`Projeto mais crítico: <b>${top.p.titulo}</b> (risco ${top.r.nivel}, score ${top.r.score}) — ${top.r.motivos.join(', ')}.`});
    const altos = comRisco.filter(x=>x.r.nivel==='alto').length;
    if(altos>1){
      ins.push({tipo:'warn', ico:'▲',
        texto:`<b>${altos} projetos</b> estão em risco alto e merecem atenção prioritária.`});
    }
  }

  // 4. Frente com mais projetos
  const porFrente = count(P.filter(p=>p.frente), p=>p.frente);
  const topFr = topEntry(porFrente);
  if(topFr){
    ins.push({tipo:'neu', ico:'#',
      texto:`A frente com mais projetos é <b>${topFr[0]}</b> (${topFr[1]}).`});
  }

  // 5. Projetos não iniciados
  const naoIni = P.filter(p=>p.sc==='todo').length;
  if(naoIni>0){
    ins.push({tipo: pct(naoIni,tot)>30?'warn':'neu', ico:'○',
      texto:`<b>${naoIni} ${naoIni===1?'projeto não iniciado':'projetos não iniciados'}</b> (${pct(naoIni,tot)}% da carteira) aguardando início.`});
  }
  return ins;
}

/* --- Análise: PIPEFY MELHORIAS --- */
function analiseMel(){
  const {kept:M} = applyDate(App.P.mel);
  const tot = M.length;
  if(!tot) return [];
  const ins = [];
  const done = M.filter(m=>m.sc==='done').length;
  const backlog = M.filter(m=>m.sc==='todo').length;
  const blocked = M.filter(m=>m.sc==='blocked').length;

  ins.push({tipo: pct(done,tot)>=60?'pos':'neu', ico:'%',
    texto:`<b>${pct(done,tot)}% das ${tot} melhorias concluídas</b> (${done}). Backlog: ${backlog}.`});

  // complexidade dominante
  const porCplx = count(M.filter(m=>m.complex), m=>m.complex);
  const topC = topEntry(porCplx);
  if(topC){
    ins.push({tipo:'neu', ico:'≡',
      texto:`Complexidade predominante: <b>${topC[0]}</b> (${topC[1]} melhorias, ${pct(topC[1],tot)}%).`});
  }

  // frente com mais melhorias
  const porFr = count(M.filter(m=>m.frente), m=>m.frente);
  const topFr = topEntry(porFr);
  if(topFr){
    ins.push({tipo:'neu', ico:'#',
      texto:`A frente que mais demanda melhorias é <b>${topFr[0]}</b> (${topFr[1]}).`});
  }

  if(blocked>0){
    ins.push({tipo:'warn', ico:'!',
      texto:`<b>${blocked} ${blocked===1?'melhoria bloqueada':'melhorias bloqueadas'}</b> — vale destravar para liberar o fluxo.`});
  }
  return ins;
}

/* --- Análise: ANALYTICS --- */
function analiseAna(){
  const {kept:A} = applyDate(App.P.ana);
  const tot = A.length;
  if(!tot) return [];
  const ins = [];
  const done = A.filter(a=>a.sc==='done').length;

  ins.push({tipo: pct(done,tot)>=50?'pos':'neu', ico:'%',
    texto:`<b>${pct(done,tot)}% das ${tot} atividades concluídas</b> (${done}).`});

  // prioridade 1 ainda aberta — alerta
  const p1aberta = A.filter(a=>a.prio===1 && a.sc!=='done' && a.sc!=='cancel').length;
  if(p1aberta>0){
    ins.push({tipo:'neg', ico:'!',
      texto:`<b>${p1aberta} ${p1aberta===1?'atividade de Prioridade 1 em aberto':'atividades de Prioridade 1 em aberto'}</b> — foco máximo de atenção.`});
  }

  // frente mais demandada
  const porFr = count(A.filter(a=>a.frente), a=>a.frente);
  const topFr = topEntry(porFr);
  if(topFr){
    ins.push({tipo:'neu', ico:'#',
      texto:`A frente com mais atividades de Analytics é <b>${topFr[0]}</b> (${topFr[1]}).`});
  }

  // sem data (transparência)
  const semData = A.filter(a=>!a.dtFim && !a.dtInicio).length;
  if(semData>0){
    ins.push({tipo:'neu', ico:'○',
      texto:`${semData} de ${tot} atividades não têm data registrada, então não entram nos cálculos por período.`});
  }
  return ins;
}

/* --- Análise: CHAMADOS RPA --- */
function analiseRPA(){
  const {kept:R} = applyDate(App.R);
  const tot = R.length;
  if(!tot) return [];
  const ins = [];
  const venc = R.filter(r=>r.vencido).length;
  const concl = R.filter(r=>r.fase.toLowerCase().includes('conclu')).length;

  // 1. Concentração nos top bots
  const porProc = count(R.filter(r=>r.processo!=='(sem processo)'), r=>r.processo);
  const ordenado = Object.entries(porProc).sort((a,b)=>b[1]-a[1]);
  const totalProc = ordenado.reduce((s,e)=>s+e[1],0);
  if(ordenado.length>=3){
    const top3 = ordenado.slice(0,3);
    const soma3 = top3.reduce((s,e)=>s+e[1],0);
    ins.push({tipo: soma3/totalProc>0.4?'warn':'neu', ico:'≡',
      texto:`Os 3 processos com mais manutenções (<b>${top3.map(e=>e[0]).join(', ')}</b>) concentram <b>${pct(soma3,totalProc)}%</b> dos chamados. Estabilizá-los reduz bastante o volume de suporte.`});
  }

  // 2. Taxa de vencidos
  ins.push({tipo: pct(venc,tot)>25?'neg':(pct(venc,tot)>0?'warn':'pos'), ico: pct(venc,tot)>25?'!':'%',
    texto:`<b>${pct(venc,tot)}% dos ${tot} chamados venceram o prazo</b> (${venc}). Concluídos: ${pct(concl,tot)}%.`});

  // 3. Problema mais comum
  const porProb = count(R, r=>r.problema);
  const topProb = topEntry(porProb, ['']);
  if(topProb && topProb[0]){
    ins.push({tipo:'neu', ico:'?',
      texto:`Problema mais frequente: <b>"${topProb[0]}"</b> (${topProb[1]} chamados, ${pct(topProb[1],tot)}%).`});
  }

  // 4. Tendência mês a mês (compara últimos 3 meses com 3 anteriores)
  const porMes = {};
  R.forEach(r=>{ if(r.mes) porMes[r.mes]=(porMes[r.mes]||0)+1; });
  const meses = Object.keys(porMes).sort();
  if(meses.length>=4){
    const metade = Math.floor(meses.length/2);
    const recentes = meses.slice(-metade).reduce((s,m)=>s+porMes[m],0)/metade;
    const antigos = meses.slice(0,metade).reduce((s,m)=>s+porMes[m],0)/metade;
    const variacao = antigos>0 ? Math.round((recentes-antigos)/antigos*100) : 0;
    if(Math.abs(variacao)>=15){
      ins.push({tipo: variacao>0?'warn':'pos', ico: variacao>0?'↑':'↓',
        texto:`O volume de chamados está <b>${variacao>0?'subindo':'caindo'}</b>: média recente ${recentes.toFixed(0)}/mês vs ${antigos.toFixed(0)}/mês no início do período (${variacao>0?'+':''}${variacao}%).`});
    }
  }

  // 5. Área que mais abre chamados (se mapeada)
  const porArea = count(R.filter(r=>r.area && r.area!=='(não mapeada)'), r=>r.area);
  const topArea = topEntry(porArea);
  if(topArea){
    ins.push({tipo:'neu', ico:'#',
      texto:`A área que mais abre chamados é <b>${topArea[0]}</b> (${topArea[1]}).`});
  }
  return ins;
}

/* --- Análise: INVENTÁRIO DE BOTS --- */
function analiseBots(){
  // bots usam filtro por AnoPRD; aqui analisamos o conjunto total carregado
  const B = App.B;
  if(!B.length) return [];
  const ins = [];
  const prd = B.filter(b=>b.status==='PRD').length;
  const dev = B.filter(b=>b.status==='DEV').length;
  const backlog = B.filter(b=>b.status==='BACKLOG').length;

  ins.push({tipo:'neu', ico:'≡',
    texto:`<b>${B.length} bots no inventário</b>: ${prd} em produção (${pct(prd,B.length)}%), ${dev} em desenvolvimento, ${backlog} em backlog.`});

  // cobertura por área (entre as frentes principais)
  const prdBots = B.filter(b=>b.status==='PRD');
  const porArea = count(prdBots, b=>b.area);
  const topArea = topEntry(porArea);
  if(topArea){
    ins.push({tipo:'neu', ico:'#',
      texto:`A área com mais automações em produção é <b>${topArea[0]}</b> (${topArea[1]} bots, ${pct(topArea[1],prd)}%).`});
  }

  // bots críticos
  const criticos = prdBots.filter(b=>b.criticidade && b.criticidade<=2).length;
  if(criticos>0){
    ins.push({tipo:'warn', ico:'!',
      texto:`<b>${criticos} bots em produção são de criticidade alta</b> (nível 1-2) — priorize monitoramento e plano de contingência.`});
  }

  // cruzamento com chamados, se disponível
  if(App.R.length){
    const norm = s => s.toLowerCase().replace(/^\[.*?\]/,'').replace(/[^a-z0-9]/g,'');
    const chamPorProc = count(App.R, r=>r.processo);
    let maxCh = 0, botMaisCh = '';
    prdBots.forEach(b => {
      const bn = norm(b.nome);
      let ch = 0;
      Object.entries(chamPorProc).forEach(([proc, n]) => {
        const pn = norm(proc);
        if (pn && bn && (bn.includes(pn) || pn.includes(bn))) ch += n;
      });
      if (ch > maxCh) { maxCh = ch; botMaisCh = b.nome; }
    });
    if(maxCh>0){
      ins.push({tipo:'warn', ico:'⚙',
        texto:`O bot em produção com mais manutenções é <b>${botMaisCh}</b> (${maxCh} chamados) — forte candidato a refatoração.`});
    }
  }
  return ins;
}


/* ============================================================
   GENERATE — PONTO DE ENTRADA PRINCIPAL
   ============================================================
   Chamado quando o usuário clica em "Gerar dashboard".
   Orquestra: parsers → descobre range de datas → constrói todas as views → navega.
   ============================================================ */
function generate(){
  // Destroi instâncias Chart.js anteriores e reseta o contador de IDs
  // para evitar o erro "Canvas already in use" a cada re-geração do dashboard
  Object.values(_chartInstances).forEach(ch => { try { ch.destroy(); } catch(_){} });
  Object.keys(_chartInstances).forEach(k => delete _chartInstances[k]);
  _chartSeq = 0;

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
  const src = [App.loaded.gov?'Base Governança':'', App.loaded.rpa?'Chamados RPA':''].filter(Boolean).join(' · ');
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

// Botão "voltar ao topo": aparece após 300px de scroll, some quando no topo
window.addEventListener('scroll', () => {
  const btn = document.getElementById('btn-top');
  if (btn) btn.classList.toggle('visible', window.scrollY > 300);
});