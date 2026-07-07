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
    improvements: [], // Pipefy_Melhorias — melhorias e ajustes do Pipefy
    proj: [],         // Projetos — portfólio de projetos da área
    ana: []           // Analytics — atividades de Analytics
  },
  R: [],       // Chamados RPA — chamados de manutenção dos bots
  B: [],       // Inventário de Bots — catálogo de automações (sem filtro de data; usa AnoPRD)

  // Controle de quais arquivos já foram carregados
  loaded: { gov: false, rpa: false },

  // Filtro global de período (aplicado em todas as abas ao mesmo tempo)
  // mode: 'all' = sem filtro | 'custom' = range manual de data
  dateRange: { mode: 'all', from: null, to: null },

  // Set de projetos expandidos na lista (chave = num ou titulo)
  projOpen: new Set(),
  // filtros rápidos da aba Projetos (chips): mostrar só atrasados / só risco alto
  projChips: { atraso:false, risco:false },

  // Filtro de frente ativo na aba Governança ('' = todas as frentes)
  govFrente: ''
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
 * Converts the raw status text (from the spreadsheet) into an internal code.
 * This normalizes spelling variants ("Concluido" vs "Concluído"), synonyms,
 * and GBS-specific statuses (Encerramento, Monitoramento).
 *
 * GBS Project flow:
 *   Diagnóstico → Planejamento → Execução → Encerramento → Monitoramento
 *   (none of these is "done" — "done" only appears once a project truly closes)
 *
 * Mapping to internal code:
 *   done    = actually completed (doesn't exist yet for projects)
 *   doing   = in progress / in development
 *   closing = in the closing process (can be overdue if the deadline passed)
 *   monitor = delivered, in post go-live monitoring (does not count as overdue)
 *   todo    = not started / backlog / planning
 *   blocked = blocked / paused
 *   cancel  = cancelled
 *   vendor  = forwarded to Pipefy support (external vendor)
 *   other   = any unrecognized value
 */
function statusClass(s){
  // Removes the numeric ordering prefix, if any.
  // Ex: "6. Encerramento" → "encerramento", "3 - Planejamento" → "planejamento"
  const normalized = (s || '').toString().trim().toLowerCase().replace(/^\s*\d+\s*[.\-)]\s*/, '');

  if (['suporte pipefy', 'encaminhado ao fornecedor', 'pipefy'].includes(normalized))
    return 'vendor';

  if (['concluído', 'concluido', 'finalizados', 'finalizado', 'tema concluído.', 'tema concluído'].includes(normalized))
    return 'done';

  if (['em andamento', 'em execução', 'execução', 'execucao', 'desenvolvimento',
       'em validação', 'em validacao', 'aguardando validação', 'aguardando validacao'].includes(normalized))
    return 'doing';

  if (['encerramento'].includes(normalized))  return 'closing';
  if (['monitoramento'].includes(normalized)) return 'monitor';

  if (['planejamento', 'diagnóstico', 'diagnostico', 'não iniciado', 'nao iniciado', 'backlog'].includes(normalized))
    return 'todo';

  if (['bloqueado', 'pausado'].includes(normalized))  return 'blocked';
  if (['cancelado'].includes(normalized))             return 'cancel';

  return 'other';
}

/*
 * statusClass specific to Improvements (Pipefy_Melhorias).
 * There, "Planejamento" is already an item pulled out of the backlog (active
 * work), so it's counted together with "doing" — this is what feeds the
 * "Dev + Planej." column of the Overview and the "Backlog" KPI on the
 * Improvements tab.
 * Do not use for Projects/Analytics: there "Planejamento" is phase 2 of the
 * flow (Diagnóstico→Planejamento→Execução...) and must stay 'todo'.
 */
function improvementStatusClass(s){
  const normalized = (s || '').toString().trim().toLowerCase().replace(/^\s*\d+\s*[.\-)]\s*/, '');
  if (normalized === 'planejamento') return 'doing';
  return statusClass(s);
}

// Portuguese labels for display in the interface
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

// CSS badge class for each status (see CSS: .badge.ok, .badge.info, etc.)
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

// Solid color for charts — Saint-Gobain palette
const STATUS_COLOR = {
  done:    '#4DB1B3',  // teal        — done
  doing:   '#0195D6',  // bright blue — in progress
  closing: '#E66407',  // orange      — closing
  monitor: '#0F5299',  // brand blue  — monitoring
  todo:    '#9CA3AF',  // gray        — not started
  blocked: '#E83430',  // red         — blocked
  cancel:  '#C5284C',  // pink-red    — cancelled
  vendor:  '#8B6FD4',  // purple      — Pipefy support
  other:   '#9CA3AF'   // gray
};

/*
 * COE_TEAM — CoE team members, organized by the area they work in.
 * Used ONLY on the Governance tab to filter "Open actions by owner"
 * (shows only the internal team; non-CoE people don't appear on that chart).
 *
 * Each entry has a 'match' list of distinctive terms to recognize the
 * person in the data, tolerating spelling variations. We deliberately use
 * surnames/unique terms to AVOID confusing first-name homonyms
 * (ex: "Gustavo" would also match "Matheus Gustavo Germano", who is not
 * CoE; that's why we use "archangelo"). 'name' is the label shown on the chart.
 */
const COE_TEAM = [
  // --- Projects ---
  { name:'Gabriel Hirata',    match:['gabriel hirata','hirata'] },
  { name:'Maiara',            match:['maiara'] },
  { name:'Vinícius Milagres', match:['milagres','vinícius marchi','vinicius marchi'] },
  { name:'Isabelly Vidal',    match:['isabelly'] },
  { name:'Daniel Torres',     match:['daniel torres'] },
  { name:'Adely Canizal',     match:['adely'] },
  // --- RPA ---
  { name:'Lucas Oliveira',    match:['lucas oliveira','lucas alvarenga','alvarenga'] },
  { name:'Caio Pucci',        match:['caio pucci','pucci'] },
  { name:'Francisco Prestes', match:['francisco prestes','prestes'] },
  { name:'Fernando Sanches',  match:['fernando sanches','sanches'] },
  { name:'Igor Henrique',     match:['igor henrique'] },
  { name:'Esteban Menendez',  match:['esteban'] },
  { name:'Jesus Axel',        match:['axel'] },
  // --- Pipefy ---
  { name:'Gustavo Archangelo',match:['archangelo'] },
  { name:'Vinícius Domingues',match:['vinícius domingues','vinicius domingues'] },
  { name:'Felipe Cordeiro',   match:['felipe cordeiro','cordeiro'] },
  { name:'William Maciel',    match:['william maciel','willian maciel','souza maciel'] }
];

/*
 * getStandardCoeName(resp) — takes the responsible person's name as it
 * appears in the data and, if they are a CoE team member, returns the
 * standardized name (label). Otherwise returns null.
 * Uses each member's 'match' terms (case-insensitive, accent-insensitive).
 */
function getStandardCoeName(resp){
  if(!resp) return null;
  const normalized = resp.toString().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,''); // strip accents for comparison
  for(const member of COE_TEAM){
    for(const term of member.match){
      const termNorm = term.normalize('NFD').replace(/[\u0300-\u036f]/g,'');
      if(normalized.includes(termNorm)) return member.name;
    }
  }
  return null;
}

/*
 * Phase number in the lifecycle of a GBS Project.
 * The higher the number, the closer to completion.
 * Flow: Diagnóstico(1) → Planejamento(2) → Execução(3) → Encerramento(4) → Monitoramento(5)
 * Returns null for statuses outside the flow (cancelled, blocked).
 */
function getProjectPhase(statusRaw){
  const normalized = (statusRaw||'').toString().trim().toLowerCase();
  if(normalized.includes('diagn')) return 1;
  if(normalized.includes('planej')) return 2;
  if(normalized.includes('execu')) return 3;
  if(normalized.includes('encerr')) return 4;
  if(normalized.includes('monitor')) return 5;
  if(normalized.includes('conclu')) return 5;
  return null;
}

/*
 * isProjectOverdue(p) — true if the project has a past-due deadline and
 * hasn't been delivered/cancelled yet. Considered "not overdue-eligible":
 * completed, in monitoring (post go-live), or cancelled projects.
 */
function isProjectOverdue(p){
  return !!(p.dtFim && p.dtFim < HOJE && p.sc!=='done' && p.sc!=='cancel' && p.sc!=='monitor');
}

/*
 * getProjectRisk(p) — automatic risk score (0 to 100) for a project.
 * Combines three objective factors, with no manual field needed in the spreadsheet:
 *   1) DELAY (heaviest weight): days past the deadline. The more overdue, the higher.
 *   2) PHASE: projects in early phases (Diagnóstico/Planejamento) with a tight
 *      deadline are riskier than ones already in Encerramento.
 *   3) DEADLINE PROXIMITY: an approaching deadline (even without a delay) raises risk.
 * Completed/cancelled/monitoring projects have risk 0 (no longer "in play").
 * Returns { score, level, reasons[] } — level ∈ {high, medium, low}.
 */
function getProjectRisk(p){
  if(p.sc==='done' || p.sc==='cancel' || p.sc==='monitor'){
    return { score:0, level:'low', reasons:[] };
  }
  let score = 0;
  const reasons = [];
  const phase = getProjectPhase(p.statusRaw) || 2;

  // 1) Delay — the strongest factor. A meaningful delay alone already pushes to high risk.
  if(p.dtFim){
    const days = daysBetween(HOJE, p.dtFim);
    if(days > 0){
      // 15 base points + ~1/day, capping at 70; ~40 days already crosses the "high" threshold
      score += Math.min(70, 15 + days*1.2);
      reasons.push(`${days} ${days===1?'dia':'dias'} de atraso`);
    } else {
      // 2) Deadline proximity (not yet overdue)
      const daysLeft = -days;
      if(daysLeft <= 15){ score += 18; reasons.push(`prazo em ${daysLeft} ${daysLeft===1?'dia':'dias'}`); }
      else if(daysLeft <= 30){ score += 10; reasons.push('prazo próximo'); }
    }
  } else {
    // no deadline set on an active project = lack-of-control risk
    score += 14; reasons.push('sem prazo definido');
  }

  // 3) Phase — weight by stage (earlier phases = more road ahead = more risk)
  if(p.sc==='blocked'){ score += 30; reasons.push('bloqueado'); }
  const phaseWeight = {1:18, 2:14, 3:9, 4:4, 5:0}[phase] || 9;
  score += phaseWeight;
  if(phase<=2 && p.sc!=='blocked') reasons.push(`fase inicial (${p.statusRaw})`);

  score = Math.min(100, Math.round(score));
  const level = score>=55 ? 'high' : (score>=30 ? 'medium' : 'low');
  return { score, level, reasons };
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
     area:          área do bot (enriquecido por enrichRPAWithArea, pode ser null)
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
   NAVIGATION
   ============================================================ */

/*
 * Switches between the dashboard's main tabs.
 * Works by toggling the 'active' class on the nav item and the matching section.
 */
function setNav(id){
  ['upload','gov','proj','mel','rpa','ana'].forEach(n => {
    const ni = document.getElementById('nav-'+n);
    const pg = document.getElementById('page-'+n);
    if(ni) ni.classList.toggle('active', n === id);
    if(pg) pg.classList.toggle('active', n === id);
  });
  // Animates the KPIs of the tab that just became visible
  const pg = document.getElementById('page-'+id);
  if(pg) pg.querySelectorAll('.knum').forEach(el => {
    delete el.dataset.an;
    _animateNum(el);
  });
}

/*
 * Switches between the RPA & Bots tab's sub-tabs
 * (Overview, Top bots, Problem types, Resolution time, Tickets, Bot inventory)
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
   FILE UPLOAD
   ============================================================ */

// Drag & drop: drag-over (over), drag-leave (leave), drop events
function dzO(e,id){ e.preventDefault(); document.getElementById(id).classList.add('over'); }
function dzL(id){ document.getElementById(id).classList.remove('over'); }
function dzD(e,t){
  e.preventDefault();
  document.getElementById('dz-'+t).classList.remove('over');
  const f = e.dataTransfer.files[0];
  if(f) readFile(f, t);
}

// File input handler (click on the file selection button)
function hf(i,t){ if(i.files[0]) readFile(i.files[0], t); }

/*
 * Reads an Excel (.xlsx) file from disk using FileReader.
 * Uses the SheetJS (XLSX) library to parse the binary.
 * cellDates:true makes SheetJS return native Date objects (not Excel serials).
 * After reading, stores the workbook in App.gov or App.rpa depending on the type.
 */
function readFile(file, type){
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


/* ============================================================
   HELPER FUNCTIONS
   ============================================================ */

/*
 * Looks up a sheet in a workbook by a name fragment.
 * Case-insensitive, and ignores underscores and spaces.
 * Ex: findSheet(wb, 'melhorias') finds 'Pipefy_Melhorias'.
 */
function findSheet(wb, frag){
  const fragNorm = frag.toLowerCase().replace(/[_ ]/g,'');
  return wb.SheetNames.find(nome => nome.toLowerCase().replace(/[_ ]/g,'').includes(fragNorm));
}

/*
 * Converts any value type to a Date (or null if invalid).
 * Needed because Excel can store dates as:
 *   - a Date object (when cellDates:true and SheetJS manages to parse it)
 *   - an Excel serial number (ex: 45678 = days since 1900-01-01)
 *   - a date string (ex: "2026-04-24")
 */
function toDate(rawValue){
  if(!rawValue) return null;
  if(rawValue instanceof Date) return isNaN(rawValue) ? null : rawValue;
  if(typeof rawValue === 'number'){
    const d = new Date(Math.round((rawValue - EXCEL_EPOCH_OFFSET) * 864e5));
    return isNaN(d) ? null : d;
  }
  if(typeof rawValue === 'string' && rawValue.length > 4){
    const d = new Date(rawValue);
    return isNaN(d) ? null : d;
  }
  return null;
}

// Formats a Date as a "YYYY-MM" string (used as the monthly grouping key)
function ym(d){ return d ? `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}` : ''; }

// Converts "YYYY-MM" into a readable "Mmm/AA" label (ex: "2026-04" → "Abr/26")
function ymLabel(m){
  if(!m) return '';
  const partes = m.split('-');
  return `${MESES[+partes[1]-1]}/${partes[0].slice(2)}`;
}

/*
 * Looks up a column's value in a SheetJS row, accepting multiple
 * possible names (since the column name can vary between spreadsheet versions).
 * The comparison is case-insensitive and ignores extra spaces.
 * Returns '' if none of the keys are found.
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
 * Counts the frequency of a value across an array of objects.
 * fn: function that extracts the key to count (ex: r => r.frente)
 * Returns: { 'P2P': 42, 'O2C': 33, ... }
 */
function count(arr, fn){
  const freq = {};
  arr.forEach(x => { const chave = fn(x) || '—'; freq[chave] = (freq[chave]||0) + 1; });
  return freq;
}

// Calculates a rounded percentage. Returns 0 if the divisor is 0 (never divides by zero).
function pct(a, b){ return b ? Math.round(a/b*100) : 0; }

// Converts a Date to a "YYYY-MM-DD" string (ISO format, used in date inputs).
// Defined here to avoid the duplicated `iso = d => ...` lambda in setQuickRange and generate().
function toIsoDate(d){ return d.toISOString().slice(0, 10); }

// Calculates the average of a numeric field across an array, ignoring nulls.
// Returns the value as a string with 1 decimal, or '—' if there's no data.
// Extracted from buildRPATickets() for reuse in other analysis modules.
function avgField(arr, campo){
  const valores = arr.filter(r => r[campo] != null).map(r => r[campo]);
  return valores.length ? (valores.reduce((soma, v) => soma + v, 0) / valores.length).toFixed(1) : '—';
}

// Normalizes a bot or process name for approximate (fuzzy) comparison.
// Strips bracketed prefixes (ex: "[P2P]"), lowercases, and
// removes anything that isn't a letter or digit.
// Used in enrichRPAWithArea(), buildBotsCruzamento() and analyzeBots().
function normBotName(s){ return s.toLowerCase().replace(/^\[.*?\]/, '').replace(/[^a-z0-9]/g, ''); }

// Main GBS business areas — used to filter RPA and bot charts.
// Secondary inventory areas (PAM, CI, IT, ARG, MEX etc.) are grouped into "Outros"
// to avoid cluttering the charts with low-volume slices.
const MAIN_RPA_AREAS = ['P2P', 'TAX', 'H2R', 'O2C', 'R2R'];

// Team responsible for developing Pipefy improvements (excludes requesters/champions).
// Used in buildImprovements() to filter the "Por responsável" chart.
const PIPEFY_TEAM = ['willian', 'vinícius', 'vinicius', 'felipe', 'gustavo', 'caio'];
function isPipefyTeamMember(nome){ return PIPEFY_TEAM.some(p => nome.toLowerCase().includes(p)); }

// Calculates the number of days between two dates.
// Positive = date1 is more recent than date2 (ex: today - deadline = days overdue).
const MS_PER_DAY = 86_400_000;
const EXCEL_EPOCH_OFFSET = 25569; // days between 1900-01-01 (Excel epoch) and 1970-01-01 (Unix epoch)
function daysBetween(data1, data2){ return Math.round((data1 - data2) / MS_PER_DAY); }

/*
 * Counts how many items in an array have each status code.
 * Eliminates the repeated pattern: arr.filter(x => x.sc === 'done').length
 * Usage: const { done, todo: backlog, blocked } = statusCounts(arr);
 */
function statusCounts(arr) {
  const codes = ['done', 'doing', 'todo', 'blocked', 'cancel', 'vendor', 'closing', 'monitor'];
  const result = {};
  codes.forEach(code => { result[code] = arr.filter(x => x.sc === code).length; });
  return result;
}

/*
 * Groups arr by keyFn, counts frequencies, and returns [key, count] pairs
 * sorted from most to least frequent.
 * Eliminates the repeated pattern: Object.entries(count(arr, fn)).sort((a,b) => b[1]-a[1])
 */
function sortedCountEntries(arr, keyFn) {
  return Object.entries(count(arr, keyFn)).sort((a, b) => b[1] - a[1]);
}


/* ============================================================
   PARSERS — SPREADSHEET READING AND NORMALIZATION
   ============================================================
   Each parser reads an Excel tab and turns the rows into
   JavaScript objects with standardized field names.
   This decouples the rest of the code from the spreadsheet's column names.
   ============================================================ */

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
 *   - Column names: each field tries multiple alternative names (see get())
 *   - Projects layout: automatically detects whether the header is correct
 *     or shuffled (old layout), and reads by position as a fallback
 *
 * To add a new field: add the column name to the array in get()
 * and map it to the normalized field in the object returned by .map().
 */
function parseGov(){
  const wb = App.gov;

  /* --- Pipefy_Melhorias --- */
  // Looks up the tab by name (flexible: accepts "pipefymelhorias" or "melhorias")
  const sMel = findSheet(wb,'pipefymelhorias') || findSheet(wb,'melhorias');
  App.P.improvements = sMel ? XLSX.utils.sheet_to_json(wb.Sheets[sMel], {defval:''}).map(r => ({
    num:      get(r, ['Numero']),
    frente:   String(get(r, ['Gerencia'])).trim(),      // business area (P2P, O2C, etc.)
    fluxo:    get(r, ['NomeFluxo']),                    // process flow name
    atividade:get(r, ['Atividade']),                    // improvement description
    statusRaw:String(get(r, ['Status'])).trim(),        // original status (spreadsheet text)
    sc:       improvementStatusClass(get(r, ['Status'])), // normalized status ("Planejamento" counts as 'doing' here)
    resp:     String(get(r, ['Responsavel'])).trim().replace(/​/g,''), // owner's name
    champion: String(get(r, ['Champion'])).trim(),
    complex:  String(get(r, ['Complexidade'])).trim(),
    tipo:     String(get(r, ['TipoMelhoriaAjuste'])).trim(),
    // PERIOD FILTER — one column per field, no fallback:
    //   dtInicio → DataInicioDesenvolvimento
    //   dtFim    → DataRealEstimadaConclusaoValidacaoChampion
    // Neither one filled in = not-started backlog → always included (see buildImprovements).
    dtInicio: toDate(get(r, ['DataInicioDesenvolvimento'])),
    dtFim:    toDate(get(r, ['DataRealEstimadaConclusaoValidacaoChampion'])),
    horas:    get(r, ['QtdHorasEstimadas'])
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
    const headerLooksRight = sample.some(r => statusClass(get(r,['Status'])) !== 'other');

    if(headerLooksRight){
      // NEW LAYOUT (Universal base): well-defined fields
      App.P.proj = rows.map(r => ({
        num:        get(r, ['Numero']),
        titulo:     String(get(r, ['Titulo'])).trim(),
        resp:       String(get(r, ['Responsavel'])).trim(),
        // AreaCliente is the new field name; 'Frente' is the fallback for the old base
        frente:     String(get(r, ['AreaCliente','Frente'])).trim(),
        focal:      String(get(r, ['PontoFocal'])).trim(),
        statusRaw:  String(get(r, ['Status'])).trim(),
        sc:         statusClass(get(r, ['Status'])),
        // PERIOD FILTER — reference: PrazoConclusão (there's no start date in the spreadsheet)
        dtFim:      toDate(get(r, ['PrazoConclusão','PrazoConclusao','DataFechamento'])),
        proximos:   String(get(r, ['ProximosPassos'])).trim(),
        // Rich fields — filled in on the Universal spreadsheet, shown when expanding a project in the list
        equipes:    String(get(r, ['EquipesEnvolvidas'])).trim(),
        descricao:  String(get(r, ['DescricaoProjeto'])).trim(),
        atvConcl:   String(get(r, ['AtividadesConcluidas'])).trim(),
        atvAndam:   String(get(r, ['AtividadesAndamento'])).trim(),
        comentarios:String(get(r, ['Comentarios'])).trim(),
        prog: (()=>{
          const rawProg = get(r, ['ProgressoPct','Progresso']);
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
          statusRaw:String(row[5]||'').trim(), sc:statusClass(row[5]),
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
    num:      get(r, ['Numero']),
    titulo:   String(get(r, ['Titulo'])).trim(),
    statusRaw:String(get(r, ['Status'])).trim(),
    sc:       statusClass(get(r, ['Status'])),
    prioRaw:  String(get(r, ['Prioridade'])).trim(),
    // extracts just the priority number (ex: "Prioridade 2" → 2)
    prio:     (()=>{ const m = String(get(r,['Prioridade'])).match(/\d+/); return m ? +m[0] : null; })(),
    frente:   String(get(r, ['Frente'])).trim(),
    resp:     String(get(r, ['Responsavel'])).trim(),
    // dtInicio = DataAbertura (start); dtFim = DataFechamento (validation completion)
    // With dtInicio set, applyDate uses activeInRange — includes activities in progress during the period.
    dtInicio: toDate(get(r, ['DataAbertura'])),
    dtFim:    toDate(get(r, ['DataFechamento']))
  })).filter(r => r.titulo) : []; // discards rows without a title (ex: phantom rows from the source)
}

/*
 * parseRPA() — processes the RPA maintenance ticket report (Pipefy export).
 * ROBUST: looks for the right tab among all of them (may not be the first), validates
 * that it has the expected columns, and discards junk rows (with no real identifier).
 * If the file doesn't look like a ticket report, logs a warning in App.rpaWarn
 * and leaves App.R empty (instead of generating hundreds of junk rows).
 */
/*
 * parseRPA() — parser for the RPA maintenance ticket report.
 *
 * Reads:  App.rpa (workbook loaded by the user via SheetJS)
 * Writes: App.R → normalized RPA tickets
 * Called by: generate()
 *
 * AUTOMATIC TAB DETECTION:
 *   Tests every tab in the file and picks the one with columns typical of tickets
 *   (Código, Processo, Fase…). If no tab looks like a ticket report,
 *   logs App.rpaWarn and leaves App.R empty — avoids generating junk on screen.
 *
 * COMPUTED FIELDS:
 *   - mes:    "YYYY-MM" string derived from criado, for monthly grouping
 *   - vencido: true if the phase isn't "Concluído" and criado is > 30 days ago
 *   - tIdent / tDesenv / tReexec: days in each phase (calculated from
 *     phase entry/exit date columns, if available)
 *   - area: filled in later by enrichRPAWithArea() via matching against App.B
 */
function parseRPA(){
  const wb = App.rpa;
  App.rpaWarn = '';
  // Looks for the tab that looks like it holds tickets: it needs to have characteristic columns.
  // Tests each tab and picks the one that looks most like a ticket report.
  let melhorAba = null, melhorScore = -1;
  wb.SheetNames.forEach(sn => {
    const sample = XLSX.utils.sheet_to_json(wb.Sheets[sn], {defval:''}).slice(0,3);
    if(!sample.length) return;
    const cols = Object.keys(sample[0]).map(c => c.trim().toLowerCase());
    // columns that identify a Pipefy ticket report
    let score = 0;
    if(cols.some(c=>c==='código'||c==='codigo')) score++;
    if(cols.some(c=>c==='fase atual')) score++;
    if(cols.some(c=>c==='processo')) score++;
    if(cols.some(c=>c.includes('qual é o problema'))) score++;
    if(cols.some(c=>c==='criado em')) score++;
    if(score > melhorScore){ melhorScore = score; melhorAba = sn; }
  });

  // needs to match at least 2 characteristic columns to be considered valid
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
      intext:     String(get(r, ['O problema é interno ou externo?', 'Interno ou externo?', 'Causa interna ou externa?', 'Causa interna/externa'])).trim(),
      solicitante:String(get(r, ['Nome do solicitante'])).trim(),
      // "Responsáveis" = who works the ticket (RPA CoE team), not who opened it.
      // Can have several names separated by commas; we store it as a list so we
      // can count each owner individually.
      responsaveis: String(get(r, ['Responsáveis','Responsável']))
        .split(',').map(s=>s.trim()).filter(Boolean),
      criado,
      dtInicio: criado,                            // Criado em → start of the interval
      dtFim:    toDate(get(r, ['Finalizado em'])), // Finalizado em → end of the interval
      mes: ym(criado),
      dow: criado ? (criado.getDay() + 6) % 7 : -1,
      finalizado: toDate(get(r, ['Finalizado em'])), // alias for display
      vencido:    venc,
      tIdent:  parseFloat(get(r, ['Tempo total na fase Identificação do problema (dias)']))||null,
      tDesenv: parseFloat(get(r, ['Tempo total na fase Desenvolvimento da solução (dias)']))||null,
      tReexec: parseFloat(get(r, ['Tempo total na fase Reexecução (dias)']))||null
    };
  // JUNK FILTER: keeps only rows that have a real code (tickets always have a code).
  // This avoids counting blank rows or footer rows that some exports include.
  }).filter(r => r.cod);
}

/*
 * enrichRPAWithArea() — assigns each RPA ticket its area (P2P, O2C, etc.).
 * Tickets have no area field, only the Processo name. Uses two layers:
 *   1st) Cross-reference with the Bot Inventory: approximate name match
 *       (one contains the other, after normalization) to inherit the bot's area.
 *   2nd) If the cross-reference fails, keyword rules (areaByKeyword):
 *       ex. "Bank Statements"/"Payment Run" → P2P, "Tax ..." → TAX, etc.
 *       This recovers processes whose name in Pipefy differs from the inventory.
 * Whatever doesn't match either layer gets '(não mapeada)' — typically
 * tickets with an empty Processo field. Call AFTER parseRPA() and parseInv().
 */
function areaByKeyword(proc){
  const nomeProc = (proc||'').toLowerCase();
  // P2P — payments, bank statements, exchange
  if(nomeProc.includes('bank statement')) return 'P2P';
  if(nomeProc.includes('payment run')) return 'P2P';
  if(nomeProc.includes('payment order')) return 'P2P';
  if(nomeProc.includes('payments receipt') || nomeProc.includes('payment receipt')) return 'P2P';
  if(nomeProc.includes('exchange rate') || nomeProc.includes('exchange contract')) return 'P2P';
  if(nomeProc.includes('reserve of values')) return 'P2P';
  if(nomeProc.includes('freight')) return 'P2P';
  // TAX — taxes
  if(nomeProc.includes('tax conciliation') || nomeProc.includes('tax checking') || nomeProc.includes('tax payment') || nomeProc.includes('indirect tax') || nomeProc.includes('direct tax')) return 'TAX';
  // H2R — HR / payroll / benefits
  if(nomeProc.includes('vacation') || nomeProc.includes('payroll') || nomeProc.includes('employee') || nomeProc.includes('benefit')) return 'H2R';
  // O2C — credit / billing
  if(nomeProc.includes('credit limit') || nomeProc.includes('settlement statement')) return 'O2C';
  return '';
}

function enrichRPAWithArea(){
  if(!App.R.length) return;
  const botAreas = App.B.filter(b=>b.nome && b.area).map(b => ({nomeNorm: normBotName(b.nome), area:b.area}));
  App.R.forEach(r => {
    const procNorm = normBotName(r.processo);
    let area = '';
    // 1st layer: cross-reference with the bot inventory
    if(procNorm && botAreas.length){
      const hit = botAreas.find(b => b.nomeNorm && (b.nomeNorm.includes(procNorm) || procNorm.includes(b.nomeNorm)));
      if(hit) area = hit.area;
    }
    // 2nd layer: keyword rules (recovers names that differ from the inventory)
    if(!area) area = areaByKeyword(r.processo);
    r.area = area || '(não mapeada)';
  });
}

/*
 * parseInv() — processes the Inventario_RPA tab of the governance base.
 * This tab is the catalog of all the area's bots (RPA automations).
 * DIFFERENT DATE FILTER: here the filter uses AnoPRD (the year the bot went live),
 * not an action date. Implemented directly in buildBots().
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
    anoPrd:      get(r, ['AnoPRD','ANO PRD']), // year the bot went live
    desc:        String(get(r, ['Descricao','DESCRIÇÃO'])).trim(),
    dev:         String(get(r, ['Desenvolvedor','DESENVOLVEDOR'])).trim(),
    suporte:     String(get(r, ['Suporte','SUPORTE / SUSTENTAÇÃO'])).trim(),
    criticidade: (()=>{ const v = get(r,['Criticidade','CRITICIDADE']); const n = parseInt(v); return isNaN(n)?null:n; })(),
    freq:        String(get(r, ['Frequencia','FREQUENCIA','Frequência'])).trim().toLowerCase(),
    fte:         parseFloat(get(r, ['FTE']))||0,               // FTEs saved by this bot
    vol:         parseFloat(get(r, ['VolumetriaMensal','VOLUMETRIA MENSAL']))||0, // transactions/month
    nBots:       parseFloat(get(r, ['NumeroBots','NUMERO DE BOTS']))||0,
    areaCliente: String(get(r, ['AreaCliente','AREA CLIENTE'])).trim(),
    sap:         String(get(r, ['SAP'])).trim()
  })).filter(b => b.nome);
}


/* ============================================================
   CHARTS — Chart.js
   ============================================================
   Usage pattern:
     1. Chart functions return a <canvas id="..."> as part of the
        HTML string and register the config in _pendingCharts.
     2. After each innerHTML injection, flushCharts() instantiates
        all pending charts.
     3. Previous instances are destroyed before recreating
        (avoids the "Canvas already in use" error).
   ============================================================ */

// Queue of configs waiting to be initialized after HTML injection
let _pendingCharts = [];

// Active Chart.js instances, indexed by canvas id
const _chartInstances = {};

// Counter for unique canvas ids per render cycle
let _chartSeq = 0;
function _cid(prefix) { return `ch-${prefix}-${++_chartSeq}`; }

/*
 * flushCharts() — instantiates all pending charts.
 * Call right after every innerHTML assignment.
 */
function flushCharts() {
  _pendingCharts.forEach(({ id, config }) => {
    const el = document.getElementById(id);
    if (!el) return;
    try {
      if (_chartInstances[id]) _chartInstances[id].destroy();
      _chartInstances[id] = new Chart(el, config);
    } catch (e) {
      console.error(`flushCharts: falha ao criar gráfico ${id}`, e);
    }
  });
  _pendingCharts = [];

  // Animates freshly rendered KPIs (the data-an attribute avoids re-animating)
  document.querySelectorAll('.knum:not([data-an])').forEach(el => {
    el.dataset.an = '1';
    _animateNum(el);
  });
}

/*
 * _animateNum(el) — counts the number from 0 up to the displayed value over ~850ms.
 * Extracts the number from the text (int or float), animates with a cubic
 * ease-out, and restores the exact original text at the end.
 * Values smaller than 2 are skipped (0 and 1 don't need animating).
 */
function _animateNum(el) {
  const raw = el.textContent.trim();
  const m   = raw.match(/^(\d+\.?\d*)(.*)/);
  if (!m) return;
  const target  = parseFloat(m[1]);
  const suffix  = m[2];
  const isFloat = m[1].includes('.');
  if (!target || target < 2) return;

  const duration = 850;
  const start    = performance.now();

  (function frame(now) {
    const t     = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - t, 3); // cubic ease-out: starts fast, decelerates
    el.textContent = (isFloat ? (target * eased).toFixed(1) : Math.round(target * eased)) + suffix;
    if (t < 1) requestAnimationFrame(frame);
    else el.textContent = raw; // restores the exact text (avoids residual rounding)
  })(start);
}

// Global Chart.js defaults
Chart.defaults.font.family = "'Inter', system-ui, sans-serif";
Chart.defaults.font.size   = 11;
Chart.defaults.color       = '#6B7280';


// Saint-Gobain palette in hex (CSS vars don't work inside Chart.js)
const C = {
  brand:  '#0F5299',  // dark blue
  accent: '#0195D6',  // bright blue
  teal:   '#4DB1B3',  // teal
  orange: '#E66407',  // orange
  red:    '#E83430',  // red
  ok:     '#0d8f91',  // dark teal (ok text)
  warn:   '#C55800',  // dark orange (warn text)
  err:    '#C5284C',  // pink-red
  ink:    '#111827',
  ink2:   '#374151',
  ink3:   '#6B7280',
  ink4:   '#9CA3AF',
  rule:   'rgba(15,82,153,0.07)',
};

// Resolves theme CSS variables to hex — needed to pass colors to Chart.js
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
 * donut(data, opts) — donut chart via Chart.js
 * data: array of { label, value, color }
 */
function donut(data, opts = {}) {
  const filtered   = data.filter(d => d.value > 0);
  const total      = filtered.reduce((s, d) => s + d.value, 0);
  const totalLabel = opts.total != null ? opts.total : total; // total shown in the center (can be overridden)
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
        <div style="font-family:'Syne',sans-serif;font-size:26px;font-weight:600;color:var(--ink);line-height:1">${totalLabel}</div>
        <div style="font-size:9px;color:var(--ink4);letter-spacing:1px;margin-top:2px">TOTAL</div>
      </div>
    </div>
    <div class="donut-legend">${legend}</div>
  </div>`;
}

/*
 * hbars(entries, opts) — horizontal bars via Chart.js
 * entries: array of [label, value]
 * opts: { max, tot, color, showTotal, totLabel, lw }
 * lw: minimum Y-axis width (calculated automatically; opts.lw is used as an extra minimum).
 */
function hbars(entries, opts = {}) {
  const items = entries.slice(0, opts.max || 10);
  if (!items.length) return '<div style="font-size:12px;color:var(--ink4)">Sem dados</div>';

  const id  = _cid('hbar');
  const col = resolveColor(opts.color || 'var(--accent)');
  const tot = opts.tot || null;

  // Splits labels on the "  ·  " separator to show bot and area on two lines
  const splitLabel = l => {
    const parts = String(l).split(/\s+·\s+/);
    return parts.length > 1 ? parts : l;
  };

  // For labels with a "·" separator (bot  ·  area): computes the minimum needed to avoid clipping.
  // For other labels: uses opts.lw exactly, with no automatic expansion.
  const hasMultiline = items.some(([l]) => String(l).includes('·'));
  const minLwDots = hasMultiline ? Math.ceil(Math.max(...items.map(([l]) => {
    const parts = String(l).split(/\s+·\s+/);
    return Math.max(...parts.map(p => p.length));
  })) * 6.5) + 24 : 0;
  const lw = opts.lw ? Math.max(opts.lw, minLwDots) : (minLwDots || undefined);

  _pendingCharts.push({
    id,
    config: {
      type: 'bar',
      data: {
        labels: items.map(([l]) => splitLabel(l)),
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
          padding: { right: tot ? 90 : 52 }
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
            ticks:  { color: C.ink2, font: { size: 11 } },
            afterFit(scale) { if (lw) scale.width = lw; }
          }
        }
      },
      plugins: [{
        id: 'hbarLabels',
        afterDatasetsDraw(chart) {
          const { ctx, chartArea, data } = chart;
          const meta = chart.getDatasetMeta(0);
          ctx.save();
          ctx.fillStyle    = C.ink2;
          ctx.font         = `500 11px 'Inter', system-ui, sans-serif`;
          ctx.textAlign    = 'left';
          ctx.textBaseline = 'middle';
          // All labels stay aligned in the same X column (right after the longest bar)
          // avoids labels of short bars ending up in the middle of the chart
          const xBase = chartArea.right + 6;
          data.datasets[0].data.forEach((value, i) => {
            const bar   = meta.data[i];
            const label = tot
              ? `${value}  (${pct(value, tot)}%)`
              : String(value);
            ctx.fillText(label, xBase, bar.y);
          });
          ctx.restore();
        }
      }]
    }
  });

  const heightPerBar = hasMultiline ? 56 : (opts.lw ? 48 : 36);
  const height = Math.max(items.length * heightPerBar + 20, 70);
  const header = opts.showTotal
    ? `<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid var(--rule)">
        <span style="font-size:11px;color:var(--ink4)">${opts.totLabel || 'Total'}</span>
        <span style="font-family:'Syne';font-size:18px;font-weight:600;color:var(--ink)">${opts.showTotal}</span>
      </div>`
    : '';

  return `${header}<div style="position:relative;height:${height}px"><canvas id="${id}"></canvas></div>`;
}


/*
 * clusteredBars(groups, series) — clustered (grouped) bar chart.
 * Each GROUP (ex: a phase) becomes a block with a title; inside it there's a
 * thin BAR for each series (ex: problem type), colored by the series.
 * All bars share the same scale (global maxVal) for comparison.
 * groups: array of { label, color, valores: {serieKey: n} }
 * series: ordered array of { key, label, color }
 * Bars with a value of 0 are omitted within the group, to avoid clutter.
 */
function clusteredBars(groups, series){
  if(!groups.length) return '<div style="font-size:12px;color:var(--ink4)">Sem dados</div>';
  // global scale: largest value across all bars of all groups
  let maxVal = 1;
  groups.forEach(g => series.forEach(s => { maxVal = Math.max(maxVal, g.valores[s.key]||0); }));
  const corpo = groups.map(g => {
    const totGrupo = series.reduce((acc,s)=>acc+(g.valores[s.key]||0),0);
    const barras = series.map(s => {
      const n = g.valores[s.key]||0;
      if(!n) return ''; // omits zeroed-out series within the group
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
 * lineChart(points, opts) — line chart via Chart.js
 * points: array of { label, value }
 * opts: { pctAxis, max, min, fmt }
 *
 * NOTE: the chart only plots months up to the current one.
 * If the last point is in Apr/26, it's because there are no more
 * recent completions in the spreadsheet — it advances automatically once the base is updated.
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
 * chartVBars(meses, porMes, porMesV) — stacked vertical bars of monthly volume.
 * Two datasets: normal tickets (brand blue) and overdue (red), stacked.
 * meses: array of ordered "YYYY-MM" keys
 * porMes / porMesV: objects { "YYYY-MM": count }
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
 * heatmap(matrix, rowLabels, colLabels) — heat map table
 * matrix[r][c] = numeric value
 * Color intensity goes from near-white (low value) to red (max value).
 * Uses rgba() with variable opacity (works in any browser).
 * Zero values get a neutral background (no heat color).
 */
function heatmap(matrix, rowLabels, colLabels, opts={}){
  const flat = matrix.flat().filter(v => v > 0);
  const mx = flat.length ? Math.max(...flat) : 1;
  const HEATMAP_MIN_OPACITY   = 0.12;
  const HEATMAP_OPACITY_RANGE = 0.78; // min + range = 0.90 (maximum intensity)
  const color = v => {
    if(!v) return 'var(--neu-bg)';
    const op = (HEATMAP_MIN_OPACITY + (v / mx) * HEATMAP_OPACITY_RANGE).toFixed(2);
    return `rgba(1, 149, 214, ${op})`; // Saint-Gobain accent blue
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
   VIEW: GOVERNANCE (executive)
   ============================================================
   The Governance tab is the unified view of all sources.
   It combines Projects + Pipefy Improvements + Analytics + RPA Tickets
   into a single set of KPIs and charts.
   ============================================================ */

/*
 * allActions() — merges the 4 sources into a single "actions" array.
 * Each action has: source, sc (normalized status), frente, owner,
 * dtFim (reference date for filters and charts) and source-specific fields.
 *
 * For RPA Tickets:
 *   - sc is derived from the current phase (contains "conclu" → done, else → doing)
 *   - dtFim = ticket completion date
 *   - criado = opening date (used as a refDate fallback)
 *   - vencido = boolean flag from Pipefy
 */
function allActions(){
  const out = [];
  App.P.proj.forEach(p => out.push({source:'Projetos', sc:p.sc, frente:p.frente, resp:p.resp, dtFim:p.dtFim, prog:p.prog, prio:null}));
  App.P.improvements.forEach(m => out.push({source:'Pipefy', sc:m.sc, frente:m.frente, resp:m.resp, dtInicio:m.dtInicio, dtFim:m.dtFim, prog:null, prio:null}));
  App.P.ana.forEach(a => out.push({source:'Analytics', sc:a.sc, frente:a.frente, resp:a.resp, dtInicio:a.dtInicio, dtFim:a.dtFim, prog:null, prio:a.prio}));
  App.R.forEach(r => out.push({
    source:'Chamados RPA',
    sc: r.fase.toLowerCase().includes('conclu') ? 'done' : 'doing',
    // frente = bot's main business area (P2P, O2C, R2R, TAX, H2R), resolved by enrichRPAWithArea()
    // Secondary inventory areas (Arg, CI, IT, PAM…) are not business areas → null
    frente: ['P2P','O2C','R2R','TAX','H2R'].includes(r.area) ? r.area : null,
    resp:r.solicitante,
    dtInicio:r.criado, dtFim:r.dtFim, criado:r.criado,
    prog:null, prio:null, vencido:r.vencido
  }));
  return out;
}

// Filtered version: applies the global date filter before returning
function allActionsFiltered(){
  return applyDate(allActions());
}

/*
 * isLate(a) — determines whether an action is overdue.
 * Returns: true (overdue), false (not overdue), null (no basis to calculate)
 *
 * Rules per source:
 *   RPA Tickets: overdue if vencido=true AND not completed
 *   Projects: overdue if the deadline passed AND not completed/cancelled/monitoring
 *   Pipefy/Analytics: returns null (no deadline field in the base → excluded from the calc)
 *
 * The null vs false distinction matters: null means "unknown",
 * not "not overdue". This keeps sources without a deadline from dragging the % down.
 */
function isLate(a){
  if(a.source === 'Chamados RPA') return a.vencido && a.sc !== 'done';
  if(a.source === 'Projetos' && a.dtFim) return a.dtFim < HOJE && a.sc !== 'done' && a.sc !== 'cancel' && a.sc !== 'monitor';
  return null;
}

/*
 * buildGovernance() — Control Panel (executive view).
 *
 * Reads:  App.P.improvements, App.P.proj, App.P.ana, App.R (all sources)
 * Writes: #gov-content
 * Calls:  allActionsFiltered(), buildHeatmap(), flushCharts()
 * Called by: generate() and renderAll() (when the date filter changes)
 *
 * Produces:
 *  - Composition KPIs: Completed / In progress / Backlog / Other
 *  - Unified status donut with an "Impediments" segment
 *  - Bars by owner (CoE team) and by area
 *  - Priority × area heatmap (Analytics)
 *  - Line chart of % completed over time
 */
function buildGovernance(){
  const any = App.loaded.gov || App.loaded.rpa;
  document.getElementById('gov-empty').style.display = any ? 'none' : 'block';
  document.getElementById('gov-content').style.display = any ? 'block' : 'none';
  if(!any) return;

  const {kept:A, noDate} = allActionsFiltered();

  // Available areas (only items with an area defined — RPA tickets have no area)
  const todasFrentes = [...new Set(A.filter(a => a.frente).map(a => a.frente))].sort();
  // Validate: if the stored area no longer exists in the current data, reset it
  const frenteAtiva  = App.govFrente && todasFrentes.includes(App.govFrente) ? App.govFrente : '';
  if (!frenteAtiva) App.govFrente = '';
  const acoesFiltradas = frenteAtiva ? A.filter(a => a.frente === frenteAtiva) : A;

  const total = acoesFiltradas.length;
  const sc = statusCounts(acoesFiltradas);
  const done    = sc.done;
  const doing   = sc.doing + sc.closing;
  const backlog = sc.todo;
  const outros  = total - done - doing - backlog;
  const nCancel  = sc.cancel;
  const nBlocked = sc.blocked;
  const nMonitor = sc.monitor;
  const nVendor  = sc.vendor;
  // builds the description of what goes into "Other" (only categories with count > 0)
  const outrosDesc = [
    nCancel?`${nCancel} cancel.`:'',
    nBlocked?`${nBlocked} bloq.`:'',
    nMonitor?`${nMonitor} monit.`:'',
    nVendor?`${nVendor} suporte`:''
  ].filter(Boolean).join(' · ');

  // Active-filter notice — shows the period, total actions in range, and how many were excluded
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

  const sources = ['Projetos','Pipefy','Analytics','Chamados RPA'];
  const bySource = sources.map(source => {
    const subAcoes = acoesFiltradas.filter(a => a.source === source);
    const subDone  = subAcoes.filter(a => a.sc === 'done').length;
    return {f: source, total: subAcoes.length, done: subDone};
  }).filter(x => x.total > 0);

  // Area filter chips — no inline onclick, listeners added after innerHTML
  const frenteChips = todasFrentes.length > 1
    ? `<div class="filters" id="gov-frente-chips" style="margin-bottom:16px">
        <span style="font-size:11px;color:var(--ink4);text-transform:uppercase;letter-spacing:.04em">Frente</span>
        <button class="chip${!frenteAtiva ? ' active' : ''}" data-gf="">Todas</button>
        ${todasFrentes.map(f =>
          `<button class="chip${frenteAtiva === f ? ' active' : ''}" data-gf="${f.replace(/"/g,'&quot;')}">${f}</button>`
        ).join('')}
      </div>` : '';


  // Composition KPIs
  let html = `<div class="sh">Painel de Controle — visão executiva</div>
  ${frenteChips}${dateNote}
  ${aiBar('gov')}
  <div class="krow k5">
    <div class="kpi il">${kpiIcon('list')}<div class="knum">${total}</div><div class="klbl">Total de ações CoE</div>
      <div class="ksub">${sources.filter(f=>A.some(a=>a.source===f)).length} fontes integradas</div></div>
    <div class="kpi gl">${kpiIcon('check')}<div class="knum">${pct(done,total)}%</div><div class="klbl">Concluídas</div>
      <div class="ksub">${done} de ${total}</div></div>
    <div class="kpi">${kpiIcon('clock')}<div class="knum">${pct(doing,total)}%</div><div class="klbl">Em andamento</div>
      <div class="ksub">${doing} de ${total}</div></div>
    <div class="kpi">${kpiIcon('stack')}<div class="knum">${pct(backlog,total)}%</div><div class="klbl">Backlog / não iniciadas</div>
      <div class="ksub">${backlog} de ${total}</div></div>
    <div class="kpi">${kpiIcon('dots')}<div class="knum">${pct(outros,total)}%</div><div class="klbl">Outros</div>
      <div class="ksub">${outrosDesc||'—'}</div></div>
  </div>`;


  // Status donut — merges Encerramento + Monitoramento into a single slice
  // ("Em encerramento" = final phase / delivered) and uses a deliberate palette:
  //   dark green = done · light green = closing (final phase) ·
  //   blue = in progress · gray = not started · amber = blocked ·
  //   red = cancelled · purple = vendor support.
  // Ordered from most advanced/positive to least. The total shown matches
  // "Total de ações CoE" because every status is included.
  const scAll = count(acoesFiltradas, a => a.sc);
  const donutDefs = [
    {label:'Concluído',       value: scAll.done    || 0,                          color:'#4DB1B3'},
    {label:'Em encerramento', value:(scAll.closing || 0) + (scAll.monitor || 0),  color:'#E66407'},
    {label:'Em andamento',    value: scAll.doing   || 0,                          color:'#0195D6'},
    {label:'Não iniciado',    value: scAll.todo    || 0,                          color:'#9CA3AF'},
    {label:'Impedimentos',    value:(scAll.blocked || 0) + (scAll.vendor  || 0)
                                  +(scAll.cancel  || 0) + (scAll.other   || 0),   color:'#C5284C'},
  ];
  const donutData = donutDefs.filter(d => d.value > 0);

  // Details what makes up "Impedimentos" (only shows categories with a value > 0)
  const impedimentosDesc = [
    scAll.blocked ? `${scAll.blocked} bloqueado${scAll.blocked > 1 ? 's' : ''}` : '',
    scAll.cancel  ? `${scAll.cancel} cancelado${scAll.cancel  > 1 ? 's' : ''}` : '',
    scAll.vendor  ? `${scAll.vendor} suporte/fornec.`                           : '',
    scAll.other   ? `${scAll.other} outro${scAll.other > 1 ? 's' : ''}`         : '',
  ].filter(Boolean).join(' · ');

  // Total actions per CoE team owner (ALL — open, completed, cancelled).
  // Shows ONLY the CoE team (see COE_TEAM), summed by standardized name.
  // IMPORTANT: each source has its own owner field:
  //   - Projetos/Pipefy/Analytics: 'resp' field (1 owner per item)
  //   - RPA Tickets: 'responsaveis' field (list — who works the ticket, not the
  //     requester; a ticket can have several owners, each one counts).
  // Respects each source's period filter (applyDate).
  const respCoE = {};
  const addResp = nomeRaw => {
    const nome = getStandardCoeName(nomeRaw);
    if(nome) respCoE[nome] = (respCoE[nome]||0) + 1;
  };
  // When an area filter is active: filters each source by area; RPA has no area → excluded
  applyDate(App.P.proj).kept.filter(p => !frenteAtiva || p.frente === frenteAtiva).forEach(p => addResp(p.resp));
  applyDate(App.P.improvements).kept.filter(m => !frenteAtiva || m.frente === frenteAtiva).forEach(m => addResp(m.resp));
  applyDate(App.P.ana).kept.filter(a => !frenteAtiva || a.frente === frenteAtiva).forEach(a => addResp(a.resp));
  // RPA: always included (no filter), or when the bot's area matches the active area
  applyDate(App.R).kept.filter(r => !frenteAtiva || r.area === frenteAtiva).forEach(r => (r.responsaveis||[]).forEach(addResp));
  const respTop = Object.entries(respCoE).sort((a,b) => b[1]-a[1]);
  const totalRespCoE = respTop.reduce((s,e)=>s+e[1],0); // base for the percentage

  // "By area" always shows the full picture (A, not acoesFiltradas) for comparison
  const frCount = count(A.filter(a => a.frente), a => a.frente);
  const fonteInfo = bySource.map(x =>
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

  // Diagnostic footer — shows where each number comes from (audit trail).
  // Helps quickly spot if any source has an unexpected count.
  const diag = [
    `Pipefy: ${App.P.improvements.length}`,
    `Projetos: ${App.P.proj.length}`,
    `Analytics: ${App.P.ana.length}`,
    `Chamados RPA: ${App.R.length}`,
    `Bots: ${App.B.length}`
  ].join(' · ');
  html += `<div style="font-size:10px;color:var(--ink4);margin-top:18px;padding-top:12px;border-top:1px solid var(--rule)">
    Contagem por fonte (total sem filtro de data): ${diag}. Total combinado: ${App.P.improvements.length+App.P.proj.length+App.P.ana.length+App.R.length} ações.</div>`;

  document.getElementById('gov-content').innerHTML = html;

  // Area chip listeners — no inline onclick, zero escaping risk
  document.querySelectorAll('[data-gf]').forEach(btn => {
    btn.addEventListener('click', () => { App.govFrente = btn.dataset.gf; buildGovernance(); });
  });

  flushCharts();
}


/*
 * buildHeatmap() — heatmap of open Analytics actions by priority × area.
 * Rows = priorities 1 to 4. Columns = areas.
 * Cells with more open actions turn more red.
 * Only shown if there is Analytics data with priority filled in.
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

// TODO: revisar — buildEvolutionChart() não é chamada em nenhum lugar do
// código atual (nem por buildGovernance, apesar do que dizia o comentário
// antigo). Pode ser código morto; confirmar com o time antes de remover.
/*
 * buildEvolutionChart(A) — line chart: cumulative % completed, month by month.
 *
 * HOW IT WORKS:
 *   1. Filters to only actions with dtFim set (without a date, it can't be placed in time)
 *   2. Filters to only months UP TO the current month (avoids plotting future months
 *      with zero completions, which would artificially flatten the curve and cause
 *      the "stuck" chart visual bug)
 *   3. For each month, counts how many actions have sc='done' and dtFim in that month
 *   4. Accumulates progressively: each point shows the total completed up to that month
 *   5. Divides by the total actions with a date (fixed denominator) to get the percentage
 *
 * WHY THE CHART MIGHT STOP BEFORE TODAY:
 *   If the latest completion recorded in the spreadsheet was in Apr/26, the last point
 *   will be Apr/26. The chart advances automatically once the base is updated with
 *   more recent completions.
 */
function buildEvolutionChart(A){
  const comData = A.filter(a => a.dtFim);
  if(comData.length < 3) return ''; // not enough for a useful chart
  const mesAtual = ym(HOJE);
  // excludes future dates (deadlines of projects not yet delivered)
  const passadas = comData.filter(a => ym(a.dtFim) <= mesAtual);
  if(passadas.length < 3) return '';
  const meses = [...new Set(passadas.map(a => ym(a.dtFim)))].sort().filter(m => m <= mesAtual);
  if(meses.length < 2) return '';
  const denom = passadas.length; // denominator: total actions with a date in the period
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
   VIEW: PROJECTS
   ============================================================
   Presents the area's project portfolio with:
   - KPIs following the real GBS flow (Diagnóstico→Planejamento→Execução→Encerramento→Monitoramento)
   - Status donut, bars by area/client area
   - Filterable list (search, owner, status, area)
   - Inline expand on click: reveals rich spreadsheet fields (description, teams, etc.)
   ============================================================ */

/*
 * buildProjects() — Projects tab.
 *
 * Reads:  App.P.proj
 * Writes: #proj-content  (structure + filters)
 *          #proj-list      (item list, via renderProjectList())
 * Called by: generate() and renderAll()
 *
 * Produces:
 *  - KPIs: total, in execution, final phase, overdue, high risk
 *  - Status donut and bars by area/client area
 *  - Filterable list with inline expand (project details)
 *  - Automatic 0-100 risk score per project
 */
function buildProjects(){
  const {kept:P, noDate} = applyDate(App.P.proj);
  document.getElementById('proj-empty').style.display = (P.length||noDate) ? 'none' : 'block';
  document.getElementById('proj-content').style.display = (P.length||noDate) ? 'block' : 'none';
  if(!P.length && !noDate) return;

  // Contagens por código de status — respeitam o fluxo real do GBS
  const done    = P.filter(p => p.sc==='done').length;     // concluído (ainda não existe na base)
  const doing   = P.filter(p => p.sc==='doing').length;    // em execução
  // Encerramento + Monitoramento agrupados (ambos = projeto entregue / em fase final)
  const finalizando = P.filter(p => p.sc==='closing' || p.sc==='monitor').length;
  const atrasados = P.filter(isProjectOverdue);                // prazo vencido e não entregue
  const criticos = P.filter(p => getProjectRisk(p).level==='high').length; // risco alto

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
    <input type="text" id="proj-q" placeholder="Buscar projeto, responsável, frente..." oninput="renderProjectList()" style="flex:1;max-width:280px">
    <button class="chip" id="proj-chip-atraso" onclick="toggleProjectChip('atraso')">⚠ Só atrasados</button>
    <button class="chip" id="proj-chip-risco" onclick="toggleProjectChip('risco')">Risco alto</button>
    <label>Responsável</label>
    <select id="proj-fp" onchange="renderProjectList()"><option value="">Todos</option>
      ${pessoas.map(p=>`<option>${p}</option>`).join('')}</select>
    <label>Status</label>
    <select id="proj-fs" onchange="renderProjectList()"><option value="">Todos</option>
      ${[...new Set(P.map(p=>p.statusRaw).filter(Boolean))].sort().map(s=>`<option>${s}</option>`).join('')}</select>
    <label>Frente</label>
    <select id="proj-ff" onchange="renderProjectList()"><option value="">Todas</option>
      ${[...new Set(P.map(p=>p.frente).filter(Boolean))].sort().map(f=>`<option>${f}</option>`).join('')}</select>
    <span style="font-size:11px;color:var(--ink4);margin-left:auto" id="proj-count"></span>
  </div>`;
  html += `<div class="card np"><div class="ilist" id="proj-list" style="border:none;border-radius:0"></div></div>`;
  document.getElementById('proj-content').innerHTML = html;
  flushCharts();
  renderProjectList();
  setBadge('nb-proj', P.length+' proj', '');
}

/*
 * renderProjectList() — renders the filtered list of projects.
 * Called by buildProjects() and whenever a filter changes (search, owner, status, area).
 * Applies the global date filter + the tab's local filters.
 * Keeps the expanded-projects state (App.projOpen) across re-renders.
 */
function renderProjectList(){
  const {kept: projetos} = applyDate(App.P.proj);
  const textoBusca       = (document.getElementById('proj-q')?.value||'').toLowerCase();
  const filterPessoa     = document.getElementById('proj-fp')?.value||'';
  const filterStatus     = document.getElementById('proj-fs')?.value||'';
  const filterFrente     = document.getElementById('proj-ff')?.value||'';
  const chips = App.projChips || {atraso:false, risco:false};
  // busca em título, responsável, frente, descrição e próximos passos
  let vis = projetos.filter(p =>
    (!textoBusca || (p.titulo+' '+p.resp+' '+p.frente+' '+(p.descricao||'')+' '+(p.proximos||'')).toLowerCase().includes(textoBusca)) &&
    (!filterPessoa || p.resp===filterPessoa) &&
    (!filterStatus || p.statusRaw===filterStatus) &&
    (!filterFrente || p.frente===filterFrente) &&
    (!chips.atraso || isProjectOverdue(p)) &&
    (!chips.risco  || getProjectRisk(p).level==='high')
  );
  // ordena por score de risco (mais crítico primeiro); empate vai pelo mais avançado
  vis.sort((a,b) => {
    const scoreA = getProjectRisk(a).score, scoreB = getProjectRisk(b).score;
    if(scoreB !== scoreA) return scoreB - scoreA;
    return (b.prog||0) - (a.prog||0);
  });
  const cnt = document.getElementById('proj-count');
  if(cnt) cnt.textContent = `${vis.length} de ${projetos.length}`;
  if(!App.projOpen) App.projOpen = new Set();
  let itensProjeto = vis.map(p => {
    const badgeClass  = STATUS_BADGE[p.sc];
    const estaAtrasado = isProjectOverdue(p);
    const risco        = getProjectRisk(p); // { score, level, reasons }
    const key          = String(p.num||p.titulo); // chave única para o estado aberto/fechado
    const open         = App.projOpen.has(key);
    // indicador de status: bolinha colorida em CSS puro (não depende de fonte de ícone)
    const COR_STATUS = {
      done:'#3fa46a', doing:'#4a90d9', closing:'#d49a4a', monitor:'#6fa0e0',
      todo:'#9a9a92', blocked:'#d4a93c', cancel:'#d46a6a', vendor:'#8f6fd0', other:'#9a9a92'
    };
    const corStatus = COR_STATUS[p.sc] || COR_STATUS.other;
    // badge de risco (só para nível médio/alto, para não poluir os de baixo risco)
    const riscoBadge = risco.level==='high'
      ? `<span class="badge red" title="${risco.reasons.join(' · ')}">risco alto</span>`
      : (risco.level==='medium' ? `<span class="badge warn" title="${risco.reasons.join(' · ')}">risco médio</span>` : '');
    return `<div class="proj-row ${open?'open':''}" data-k="${key.replace(/"/g,'')}">
      <div class="icard" onclick="toggleProject('${key.replace(/'/g,"\\'").replace(/"/g,'&quot;')}')" style="cursor:pointer">
        <div class="iico" style="background:${estaAtrasado?'var(--err-bg)':'var(--neu-bg)'}">
          <span style="width:11px;height:11px;border-radius:50%;background:${corStatus};display:block"></span>
        </div>
        <div class="imain"><div class="ititle">${p.titulo}</div>
          <div class="isub">
            ${p.frente?`<span class="apill">${p.frente}</span>`:''}
            ${estaAtrasado?`<span style="font-size:10px;color:var(--err);font-weight:500">⚠ atrasado</span>`:''}
            ${p.prog!=null?`<span style="font-size:10px;color:var(--ink4)">${Math.round(p.prog*100)}% concluído</span>`:''}
          </div>
        </div>
        <div class="iright">
          ${riscoBadge}
          <span class="badge ${badgeClass}" style="font-size:9px">${p.statusRaw}</span>
          <span style="color:var(--ink4);font-size:11px;margin-left:4px;transition:transform .15s;transform:rotate(${open?'90deg':'0deg'})">▶</span>
        </div>
      </div>
      ${open ? projectDetails(p) : ''}
    </div>`;
  }).join('');
  const el = document.getElementById('proj-list');
  if(el) el.innerHTML = itensProjeto || '<div class="empty" style="padding:24px">Nenhum projeto neste filtro</div>';
}

/*
 * toggleProjectChip(qual) — toggles a quick filter (overdue / high risk)
 * on the Projects tab and re-renders the list, updating the chip's visual highlight.
 */
function toggleProjectChip(qual){
  if(!App.projChips) App.projChips = {atraso:false, risco:false};
  App.projChips[qual] = !App.projChips[qual];
  const map = {atraso:'proj-chip-atraso', risco:'proj-chip-risco'};
  const btn = document.getElementById(map[qual]);
  if(btn) btn.classList.toggle('active', App.projChips[qual]);
  renderProjectList();
}

/*
 * toggleProject(key) — opens or closes a project's details panel.
 * Uses a Set (App.projOpen) to track which projects are expanded.
 * If the key is already in the Set → removes it (closes). If not → adds it (opens).
 * Re-renders the list afterward to reflect the change.
 */
function toggleProject(key){
  if(!App.projOpen) App.projOpen = new Set();
  if(App.projOpen.has(key)) App.projOpen.delete(key);
  else App.projOpen.add(key);
  renderProjectList();
}

/*
 * projectDetails(p) — generates the HTML for a project's expanded details panel.
 * Only renders the field blocks that are filled in on the spreadsheet.
 * Empty fields don't show up (not even as an empty placeholder).
 * The layout is a 2-column grid (or 1 column on mobile).
 */
function projectDetails(p){
  const fmt = txt => String(txt||'').trim().replace(/\n/g,'<br>');
  const blocks = [];
  if(p.resp)        blocks.push({lbl:'Responsável',             val:p.resp});
  if(p.dtFim)       blocks.push({lbl:'Prazo de conclusão',      val:`${p.dtFim.toLocaleDateString('pt-BR')}${isProjectOverdue(p)?' &nbsp;<span style="color:var(--err)">⚠ prazo vencido</span>':''}`});
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


/*
 * buildImprovementEvolutionChart(M) — line chart: Completed × Backlog × Forecast.
 *
 * Line 1 — Completed/month: items with sc='done' grouped by dtFim
 * Line 2 — Backlog/month: reconstructed historically as
 *           items_todo_today + items_completed_after_that_month
 * Line 3 — Forecast (future): average of the last 3 months projected forward
 *
 * Dashed red vertical line marks the current month (past/future divider).
 * Returns '' if there isn't enough data (< 3 months with completions).
 */
// Calculates the data for the three series of the improvement evolution chart.
// Returns null if there isn't enough data (< 3 completed or < 2 historical months).
function calcImprovementEvolutionData(improvements) {
  const completed = improvements.filter(m => m.sc === 'done' && m.dtFim);
  if (completed.length < 3) return null;

  const byMonth        = {};
  completed.forEach(m => { const k = ym(m.dtFim); byMonth[k] = (byMonth[k] || 0) + 1; });
  const currentMonth    = ym(HOJE);
  const historicalMonths = Object.keys(byMonth).sort().filter(k => k <= currentMonth);
  if (historicalMonths.length < 2) return null;

  const advanceMonth = k => {
    const [y, mo] = k.split('-').map(Number);
    return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
  };

  // Final deadline = October of the current year (or the next one, if October already passed)
  const [curY, curMo] = currentMonth.split('-').map(Number);
  const OCT_DEADLINE = `${curMo <= 10 ? curY : curY + 1}-10`;

  let rangeEnd = currentMonth;
  for (let i = 0; i < 6; i++) rangeEnd = advanceMonth(rangeEnd);
  if (rangeEnd > OCT_DEADLINE) rangeEnd = OCT_DEADLINE;

  const allMonths = [];
  let cur = historicalMonths[0];
  while (cur <= rangeEnd) { allMonths.push(cur); cur = advanceMonth(cur); }

  const currentTodoItems  = improvements.filter(m => m.sc === 'todo').length;
  const futureMonths      = allMonths.filter(m => m >= currentMonth);
  const forecastPerMonth  = futureMonths.length > 0 ? Math.max(1, Math.round(currentTodoItems / futureMonths.length)) : 1;

  return {
    labels:         allMonths.map(m => ymLabel(m)),
    currentIndex:   allMonths.indexOf(currentMonth),
    currentTodoItems,
    futureMonths,
    forecastPerMonth,
    completedData: allMonths.map(m => m <= currentMonth ? (byMonth[m] || 0) : null),
    backlogData:   allMonths.map(m => {
      if (m > currentMonth) return null;
      return currentTodoItems + completed.filter(c => ym(c.dtFim) > m).length;
    }),
    forecastData:  allMonths.map(m => m >= currentMonth ? forecastPerMonth : null),
  };
}

// Chart.js plugins for the evolution chart: point labels and the current-month line.
function improvementEvolutionPlugins(currentIndex) {
  const dataLabels = {
    id: 'dataLabels',
    afterDatasetsDraw(chart) {
      const { ctx, data } = chart;
      data.datasets.forEach((dataset, i) => {
        const meta = chart.getDatasetMeta(i);
        if (meta.hidden) return;
        const above = i !== 2; // Forecast (i===2) sits below to avoid overlap
        meta.data.forEach((el, j) => {
          const value = dataset.data[j];
          if (value == null) return;
          ctx.save();
          ctx.fillStyle    = dataset.borderColor;
          ctx.font         = `bold 10px Inter, system-ui, sans-serif`;
          ctx.textAlign    = 'center';
          ctx.textBaseline = above ? 'bottom' : 'top';
          ctx.fillText(value, el.x, el.y + (above ? -5 : 5));
          ctx.restore();
        });
      });
    }
  };
  const todayLine = {
    id: 'todayLine',
    afterDraw(chart) {
      if (currentIndex < 0) return;
      const { ctx, chartArea, scales } = chart;
      const x = scales.x.getPixelForValue(chart.data.labels[currentIndex]);
      ctx.save();
      ctx.beginPath();
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = C.err;
      ctx.lineWidth   = 1.5;
      ctx.moveTo(x, chartArea.top);
      ctx.lineTo(x, chartArea.bottom);
      ctx.stroke();
      ctx.restore();
    }
  };
  return [dataLabels, todayLine];
}

function buildImprovementEvolutionChart(improvements) {
  const evol = calcImprovementEvolutionData(improvements);
  if (!evol) return '';

  const { labels, currentIndex, currentTodoItems, futureMonths, forecastPerMonth,
          completedData, backlogData, forecastData } = evol;
  const id = _cid('mel-evol');

  _pendingCharts.push({
    id,
    config: {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label:               'Concluídas',
            data:                completedData,
            borderColor:         C.ink,
            backgroundColor:     'transparent',
            borderWidth:         2,
            pointRadius:         4,
            pointBackgroundColor: C.ink,
            tension:             0.1,
            spanGaps:            false,
          },
          {
            label:               'Backlog',
            data:                backlogData,
            borderColor:         C.ink,
            backgroundColor:     'transparent',
            borderWidth:         2,
            borderDash:          [6, 4],
            pointRadius:         3,
            pointBackgroundColor: C.ink,
            tension:             0.1,
            spanGaps:            false,
          },
          {
            label:               'Previsão',
            data:                forecastData,
            borderColor:         C.err,
            backgroundColor:     'transparent',
            borderWidth:         1.5,
            pointRadius:         3,
            pointBackgroundColor: C.err,
            tension:             0,
            spanGaps:            false,
          }
        ]
      },
      options: {
        responsive:          true,
        maintainAspectRatio: false,
        animation:           { duration: 400 },
        plugins: {
          legend: {
            position: 'top',
            labels: { color: C.ink3, boxWidth: 20, boxHeight: 2, padding: 20, font: { size: 11 } }
          },
          tooltip: {
            callbacks: {
              label: ctx => ctx.parsed.y != null
                ? ` ${ctx.dataset.label}: ${ctx.parsed.y}`
                : null
            }
          }
        },
        scales: {
          x: {
            grid:   { display: false },
            border: { display: false },
            ticks:  { color: C.ink4, font: { size: 10 }, maxTicksLimit: 14 }
          },
          y: {
            grid:   { color: C.rule },
            border: { display: false },
            ticks:  { color: C.ink4, font: { size: 10 } }
          }
        }
      },
      plugins: improvementEvolutionPlugins(currentIndex)
    }
  });

  return `<div class="card">
    <div class="card-title">
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
      Melhorias Concluídas × Backlog
      <span class="rt">previsão = ${currentTodoItems} pendentes ÷ ${futureMonths.length} meses = ${forecastPerMonth}/mês · linha vermelha = hoje</span>
    </div>
    <div style="position:relative;height:280px"><canvas id="${id}"></canvas></div>
  </div>`;
}


/*
 * overviewByArea(M) — "Overview por categoria" table on the Pipefy Improvements tab.
 *
 * Rows    = business areas (P2P, O2C, TAX…), in the standard order + extras at the end.
 * Columns = Improvements (total) + breakdown by status.
 *
 * "Dev + Planej." and "Validação" are both sc='doing', distinguished by statusRaw:
 *   Validação    → statusRaw contains "validação" or "aguardando"
 *   Dev + Planej → sc='doing' and not validation
 */
function overviewByArea(improvements) {
  const isValidation = m => {
    const statusText = (m.statusRaw || '').toLowerCase();
    return statusText.includes('validação') || statusText.includes('validacao') || statusText.includes('aguardando');
  };

  const COLUMNS = [
    { label: 'Melhorias',     fn: null,                                      cls: '' },
    { label: 'Backlog',       fn: m => m.sc === 'todo',                      cls: '' },
    { label: 'Dev + Planej.', fn: m => m.sc === 'doing' && !isValidation(m), cls: '' },
    { label: 'Validação',     fn: m => isValidation(m),                     cls: '' },
    { label: 'Pipefy',        fn: m => m.sc === 'vendor',                    cls: '' },
    { label: 'Bloqueado',     fn: m => m.sc === 'blocked',                   cls: '' },
    { label: 'Concluídos',    fn: m => m.sc === 'done',                      cls: 'ov-done' },
    { label: 'Cancelados',    fn: m => m.sc === 'cancel',                    cls: 'ov-cancel' },
  ];

  const ORDER  = ['COE','P2P','O2C','R2R','TAX','H2R'];
  const COLORS = { COE:'#0195D6', P2P:'#E83430', O2C:'#4DB1B3', R2R:'#E66407', TAX:'#0F5299', H2R:'#8B6FD4' };

  const todasFrentes = [...new Set(improvements.map(m => m.frente).filter(Boolean))];
  const frentes = [
    ...ORDER.filter(f => todasFrentes.includes(f)),
    ...todasFrentes.filter(f => !ORDER.includes(f)).sort(),
  ];
  if (!frentes.length) return '';

  const cell = n => n
    ? `<td>${n}</td>`
    : `<td class="ov-zero">—</td>`;

  const rows = frentes.map(frente => {
    const itens = improvements.filter(m => m.frente === frente);
    const cor   = COLORS[frente] || 'var(--ink3)';
    const cols  = COLUMNS.map((c, i) => cell(i === 0 ? itens.length : itens.filter(c.fn).length)).join('');
    return `<tr>
      <td><span class="ov-badge" style="background:${cor}">${frente}</span></td>
      ${cols}
    </tr>`;
  }).join('');

  const totals = COLUMNS.map((c, i) =>
    `<td>${i === 0 ? improvements.length : improvements.filter(c.fn).length}</td>`
  ).join('');

  const headers = COLUMNS.map(c =>
    `<th class="${c.cls}">${c.label}</th>`
  ).join('');

  return `<div class="card">
    <div class="card-title">
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/>
      </svg>
      Overview por categoria
    </div>
    <div style="overflow-x:auto">
      <table class="ov-table">
        <thead><tr><th></th>${headers}</tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr>
          <td style="text-align:left">Total</td>
          ${totals}
        </tr></tfoot>
      </table>
    </div>
  </div>`;
}


/* ============================================================
   VIEW: PIPEFY IMPROVEMENTS
   ============================================================
   DATE FILTER: uses DataConclusaoRealDesenvolvimento.
   Most backlog/planning improvements do NOT have this date.
   When filtering by period, they are excluded — correct, documented behavior.
   To see every improvement, use the Status filter inside the tab.
   ============================================================ */
/*
 * buildImprovements() — Pipefy Improvements tab.
 *
 * Reads:  App.P.improvements
 * Writes: #mel-content
 * Called by: generate() and renderAll()
 *
 * ATTENTION — special date-filter logic:
 *   Uses dtInicio + dtFim (development interval), not a single date.
 *   Backlog improvements without a date are ALWAYS included, even with an
 *   active filter (they represent pending work, not history).
 *
 * Produces:
 *  - KPIs: total, completed, backlog, blocked, distinct flows
 *  - Status donut, bars by area, complexity and owner
 */
function buildImprovements(){
  const {kept: filteredImprovements} = applyDate(App.P.improvements);
  // Backlog without a date = pending work, not history. Always included.
  const backlogWithoutDate = App.dateRange.mode !== 'all'
    ? App.P.improvements.filter(m => !m.dtInicio && !m.dtFim && m.sc === 'todo')
    : [];
  const improvements = [...filteredImprovements, ...backlogWithoutDate];
  document.getElementById('mel-empty').style.display  = App.P.improvements.length ? 'none' : 'block';
  document.getElementById('mel-content').style.display = App.P.improvements.length ? 'block' : 'none';
  if(!App.P.improvements.length) return;
  const sc      = statusCounts(improvements);
  const done    = sc.done;
  const backlog = sc.todo;
  const blocked = sc.blocked;

  let dateNote = '';
  if(App.dateRange.mode !== 'all'){
    dateNote = `<div class="note" style="background:var(--neu-bg);color:var(--ink3)"><i class="ti ti-calendar-stats"></i><div>
      Período aplicado: <b>${improvements.length} melhorias</b> no recorte${backlogWithoutDate.length > 0 ? ` (inclui <b>${backlogWithoutDate.length} backlog</b> sem data)` : ''}.
      <br><span style="font-size:10px;opacity:.6;font-style:italic">Referência de data: início e conclusão do desenvolvimento — inclui melhorias ativas no período, mesmo que iniciadas antes dele</span>
      </div></div>`;
  }

  // "Fluxos (processos)" = number of distinct NomeFluxo in the current range
  const uniqueFlows = new Set(App.P.improvements.map(m => m.fluxo).filter(Boolean)).size;

  // Data quality: completed without dtFim = a spreadsheet fill-in error.
  // Non-completed items without dtFim are correct (still in progress/backlog).
  const completedWithoutDate = App.P.improvements.filter(m => m.sc==='done' && !m.dtFim).length;

  let html = dateNote + `<div class="sh">Pipefy — Melhorias & Ajustes</div>
  ${aiBar('mel')}
  <div class="krow k5">
    <div class="kpi">${kpiIcon('message')}<div class="knum">${App.P.improvements.length}</div><div class="klbl">Total melhorias</div>${App.dateRange.mode !== 'all' ? `<div class="ksub">${improvements.length} no recorte</div>` : ''}</div>
    <div class="kpi gl">${kpiIcon('check')}<div class="knum">${done}</div><div class="klbl">Concluídas</div><div class="ksub">${pct(done,App.P.improvements.length)}% do total</div></div>
    <div class="kpi">${kpiIcon('stack')}<div class="knum">${backlog}</div><div class="klbl">Backlog</div></div>
    <div class="kpi wl">${kpiIcon('lock')}<div class="knum">${blocked}</div><div class="klbl">Bloqueadas</div></div>
    <div class="kpi il">${kpiIcon('branch')}<div class="knum">${uniqueFlows}</div><div class="klbl">Fluxos (processos)</div><div class="ksub">distintos no recorte</div></div>
  </div>
  ${completedWithoutDate > 0 ? `<div class="note" style="background:var(--neu-bg);color:var(--ink3)"><i class="ti ti-alert-triangle" style="color:var(--warn)"></i><div>
    <b>${completedWithoutDate} melhorias marcadas como concluídas não têm data de conclusão preenchida.</b>
    Isso é um erro de preenchimento na planilha — preencher o campo <i>DataConclusaoRealDesenvolvimento</i> permite análise temporal correta dessas entregas.
  </div></div>` : ''}`;

  html += `<div class="two">
    <div class="card"><div class="card-title"><i class="ti ti-chart-pie"></i> Status</div>
      ${donut(['done','doing','todo','vendor','blocked','cancel'].map(k=>({label:STATUS_PT[k],value:improvements.filter(m=>m.sc===k).length,color:STATUS_COLOR[k]})).filter(d=>d.value), {total:App.P.improvements.length})}</div>
    <div class="card"><div class="card-title"><i class="ti ti-building"></i> Por frente</div>
      ${hbars(sortedCountEntries(improvements, m=>m.frente),{max:8,lw:60,tot:improvements.length})}</div>
  </div>`;
  html += `<div class="two">
    <div class="card"><div class="card-title"><i class="ti ti-stack-2"></i> Por complexidade</div>
      ${hbars(sortedCountEntries(improvements.filter(m=>m.complex), m=>m.complex),{max:6,lw:90})}</div>
    <div class="card"><div class="card-title"><i class="ti ti-user-code"></i> Por responsável</div>
      ${(() => {
        const dados = sortedCountEntries(improvements.filter(m=>m.resp && isPipefyTeamMember(m.resp)), m=>m.resp);
        return hbars(dados,{max:8,lw:130});
      })()}</div>
  </div>`;
  html += buildImprovementEvolutionChart(improvements);
  html += overviewByArea(improvements);
  html += '<div id="mel-atividades"></div>';
  document.getElementById('mel-content').innerHTML = html;
  flushCharts();
  setBadge('nb-mel', improvements.length, '');
  renderImprovementActivitiesSection();
}


/* ============================================================
   IMPROVEMENTS — MANUAL ACTIVITY LOG
   ============================================================
   "Atividades" card at the end of the Pipefy Improvements tab.

   Unlike the rest of the tab (which comes entirely from the spreadsheet),
   these records are created and maintained manually by the team inside
   the site itself. They exist because the tracking presented to
   management is organized by topic/initiative (ex: "Anticipos v1",
   "Miscelaneas v1"), and those topics have no 1:1 correspondence with
   rows in the Pipefy_Melhorias spreadsheet — so this table can't be
   calculated from App.P.improvements like the rest of the tab.

   PERSISTENCE:
   Records are saved to the browser's localStorage (key
   IMPROVEMENT_ACTIVITIES_STORAGE_KEY), not to any spreadsheet and not
   to a server — consistent with SYNAPSE's 100% local architecture (see
   README). This means:
     - They survive reloading the page and regenerating the dashboard
       with a different spreadsheet (they don't depend on the loaded Excel).
     - They stay restricted to this browser/computer — they don't show up
       for someone opening the site on another machine.
     - They are deleted if the user clears the site's browsing data.

   Exports (indirectly, via window — see the end of the file):
     renderImprovementActivitiesSection() — called by buildImprovements()
     openActivityForm(activityId?)
     closeActivityForm()
     closeActivityFormOnOutsideClick(event)
     saveActivityForm(event)
     confirmDeleteActivity(activityId)
   ============================================================ */

const IMPROVEMENT_ACTIVITIES_STORAGE_KEY = 'synapse.melhorias.atividades';

/*
 * A record in the "Atividades" table on the Pipefy Improvements tab.
 *
 * @typedef {Object} ActivityRecord
 * @property {string} id            unique record identifier
 * @property {string} tema          topic/initiative name (ex: "Anticipos v1")
 * @property {string} atividade     current stage (ex: "Em desenvolvimento")
 * @property {string} observacao    free-form notes on progress
 * @property {string} responsavel   person or team responsible
 */

/*
 * loadImprovementActivities()
 * Reads the list of saved records from localStorage. Returns an empty
 * array both when nothing was ever saved and when the saved content is
 * corrupted — in the second case the error is only logged to the
 * console, without interrupting the dashboard's loading.
 */
function loadImprovementActivities() {
  const savedContent = localStorage.getItem(IMPROVEMENT_ACTIVITIES_STORAGE_KEY);
  if (!savedContent) return [];

  try {
    const savedRecords = JSON.parse(savedContent);
    return Array.isArray(savedRecords) ? savedRecords : [];
  } catch (readError) {
    console.warn('Não foi possível ler as atividades salvas de Melhorias:', readError);
    return [];
  }
}

/*
 * saveImprovementActivities(activityRecords)
 * Writes the full list of records to localStorage. There is no partial
 * update: every create/edit/delete operation rereads the whole list,
 * changes what's needed, and writes it all back.
 */
function saveImprovementActivities(activityRecords) {
  localStorage.setItem(
    IMPROVEMENT_ACTIVITIES_STORAGE_KEY,
    JSON.stringify(activityRecords)
  );
}

/*
 * generateActivityId()
 * Uses crypto.randomUUID() when available. As a fallback (very old
 * browsers or a non-HTTPS context), generates an id from the current
 * timestamp + a random number — good enough here because these records
 * never leave the user's own browser.
 */
function generateActivityId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `atividade-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

/*
 * escapeHtmlText(text)
 * The fields in this table are free text typed by the user (especially
 * "Observação"). Without escaping, characters like < and > would break
 * the table's HTML when rendered. Round-tripping through a temporary
 * element is the standard way the browser does this escaping correctly.
 */
function escapeHtmlText(text) {
  const tempElement = document.createElement('div');
  tempElement.textContent = text || '';
  return tempElement.innerHTML;
}

/*
 * addImprovementActivity(formData)
 * Creates a new record from the form data and appends it to the
 * persisted list.
 */
function addImprovementActivity(formData) {
  const records = loadImprovementActivities();
  records.push({ id: generateActivityId(), ...formData });
  saveImprovementActivities(records);
}

/*
 * updateImprovementActivity(activityId, formData)
 * Replaces the fields of an existing record with the new form values.
 * Does nothing if the id isn't found (the record may have been deleted
 * in another browser tab, for example).
 */
function updateImprovementActivity(activityId, formData) {
  const records = loadImprovementActivities();
  const recordIndex = records.findIndex(record => record.id === activityId);
  if (recordIndex === -1) return;

  records[recordIndex] = { ...records[recordIndex], ...formData };
  saveImprovementActivities(records);
}

/*
 * deleteImprovementActivity(activityId)
 * Permanently removes a record from the persisted list.
 */
function deleteImprovementActivity(activityId) {
  const remainingRecords = loadImprovementActivities()
    .filter(record => record.id !== activityId);
  saveImprovementActivities(remainingRecords);
}

/*
 * buildActivityTableRow(record)
 * Generates a <tr> row for the activities table, with the edit and
 * delete buttons in the last column.
 */
function buildActivityTableRow(record) {
  return `<tr>
    <td>${escapeHtmlText(record.tema)}</td>
    <td>${escapeHtmlText(record.atividade)}</td>
    <td style="white-space:pre-wrap">${escapeHtmlText(record.observacao)}</td>
    <td>${escapeHtmlText(record.responsavel)}</td>
    <td style="text-align:right;white-space:nowrap">
      <button type="button" class="icon-button" title="Editar atividade" onclick="openActivityForm('${record.id}')"><i class="ti ti-pencil"></i></button>
      <button type="button" class="icon-button icon-button-perigo" title="Excluir atividade" onclick="confirmDeleteActivity('${record.id}')"><i class="ti ti-trash"></i></button>
    </td>
  </tr>`;
}

/*
 * buildActivityForm()
 * Builds the modal (hidden by default) used both to create and to edit
 * a record. The same form serves both cases: the hidden
 * "campo-atividade-id" field is empty when creating and filled in when
 * editing — that value is what saveActivityForm() uses to decide
 * between adding or updating.
 */
function buildActivityForm() {
  return `<div class="modal-fundo oculto" id="fundo-formulario-atividade" onclick="closeActivityFormOnOutsideClick(event)">
    <div class="modal-caixa">
      <div class="modal-cabecalho">
        <span class="modal-titulo" id="titulo-formulario-atividade">Adicionar atividade</span>
        <button type="button" class="modal-botao-fechar" onclick="closeActivityForm()" aria-label="Fechar">×</button>
      </div>
      <form id="formulario-atividade" onsubmit="saveActivityForm(event)">
        <input type="hidden" id="campo-atividade-id">
        <label class="modal-campo">
          <span>Tema</span>
          <input type="text" id="campo-atividade-tema" placeholder="Ex: Anticipos v1" required maxlength="120">
        </label>
        <label class="modal-campo">
          <span>Atividade</span>
          <input type="text" id="campo-atividade-etapa" placeholder="Ex: Em desenvolvimento" required maxlength="120">
        </label>
        <label class="modal-campo">
          <span>Observação</span>
          <textarea id="campo-atividade-observacao" rows="4" placeholder="Anotações sobre o andamento, pendências, próximos passos..." maxlength="600"></textarea>
        </label>
        <label class="modal-campo">
          <span>Responsável</span>
          <input type="text" id="campo-atividade-responsavel" placeholder="Ex: Equipe de Projetos Saint Gobain / P2P" required maxlength="120">
        </label>
        <div class="modal-rodape">
          <button type="button" class="btn" onclick="closeActivityForm()">Cancelar</button>
          <button type="submit" class="btn primary">Salvar</button>
        </div>
      </form>
    </div>
  </div>`;
}

/*
 * buildImprovementActivitiesSection()
 * Builds the whole "Atividades" card: title, add button, table
 * (or empty-list message) and the create/edit modal.
 */
function buildImprovementActivitiesSection() {
  const records = loadImprovementActivities();

  const tableBody = records.length
    ? `<table class="tbl"><thead><tr>
         <th>Tema</th><th>Atividade</th><th>Observação</th><th>Responsável</th><th></th>
       </tr></thead>
       <tbody>${records.map(buildActivityTableRow).join('')}</tbody></table>`
    : `<div class="empty" style="padding:32px 20px"><i class="ti ti-clipboard-list"></i>Nenhuma atividade registrada ainda.</div>`;

  return `<div class="card">
    <div class="card-title">
      <i class="ti ti-clipboard-list"></i> Atividades
      <span class="rt">registro manual, salvo neste navegador</span>
    </div>
    <div style="margin-bottom:14px">
      <button type="button" class="btn primary" onclick="openActivityForm()"><i class="ti ti-plus"></i> Adicionar atividade</button>
    </div>
    ${tableBody}
  </div>
  ${buildActivityForm()}`;
}

/*
 * renderImprovementActivitiesSection()
 * Recreates only the content of the #mel-atividades container. Called by
 * buildImprovements() when assembling the tab, and again after any
 * add/edit/delete — without needing to recalculate the rest of the
 * Improvements tab's KPIs and charts.
 */
function renderImprovementActivitiesSection() {
  const container = document.getElementById('mel-atividades');
  if (container) container.innerHTML = buildImprovementActivitiesSection();
}

/*
 * openActivityForm(activityId)
 * With no argument, opens the modal blank (create mode). With the id of
 * an existing record, opens the modal filled with its current values
 * (edit mode).
 */
function openActivityForm(activityId) {
  const existingRecord = activityId
    ? loadImprovementActivities().find(record => record.id === activityId)
    : null;

  document.getElementById('titulo-formulario-atividade').textContent =
    existingRecord ? 'Editar atividade' : 'Adicionar atividade';
  document.getElementById('campo-atividade-id').value         = existingRecord ? existingRecord.id : '';
  document.getElementById('campo-atividade-tema').value        = existingRecord ? existingRecord.tema : '';
  document.getElementById('campo-atividade-etapa').value       = existingRecord ? existingRecord.atividade : '';
  document.getElementById('campo-atividade-observacao').value  = existingRecord ? existingRecord.observacao : '';
  document.getElementById('campo-atividade-responsavel').value = existingRecord ? existingRecord.responsavel : '';

  document.getElementById('fundo-formulario-atividade').classList.remove('oculto');
}

/*
 * closeActivityForm()
 * Just hides the modal — any typed data is discarded, since nothing is
 * saved before the form is submitted.
 */
function closeActivityForm() {
  document.getElementById('fundo-formulario-atividade').classList.add('oculto');
}

/*
 * closeActivityFormOnOutsideClick(event)
 * The modal covers the whole screen with a dimmed background
 * (#fundo-formulario-atividade) behind the white box. Clicking that
 * background closes the modal; clicking inside the box (or its fields)
 * should not close it — hence the click-target check.
 */
function closeActivityFormOnOutsideClick(event) {
  if (event.target.id === 'fundo-formulario-atividade') closeActivityForm();
}

/*
 * saveActivityForm(event)
 * Submit handler for the modal's form. Decides between create or update
 * based on the hidden "campo-atividade-id" field: empty means a new
 * record; filled in means editing an existing one.
 */
function saveActivityForm(event) {
  event.preventDefault();

  const activityId = document.getElementById('campo-atividade-id').value;
  const formData = {
    tema:        document.getElementById('campo-atividade-tema').value.trim(),
    atividade:   document.getElementById('campo-atividade-etapa').value.trim(),
    observacao:  document.getElementById('campo-atividade-observacao').value.trim(),
    responsavel: document.getElementById('campo-atividade-responsavel').value.trim()
  };

  if (activityId) updateImprovementActivity(activityId, formData);
  else addImprovementActivity(formData);

  closeActivityForm();
  renderImprovementActivitiesSection();
}

/*
 * confirmDeleteActivity(activityId)
 * Asks for native browser confirmation before deleting. There is no
 * trash bin or "undo" for these records — hence the explicit confirmation.
 */
function confirmDeleteActivity(activityId) {
  const userConfirmed = window.confirm('Excluir esta atividade? Essa ação não pode ser desfeita.');
  if (!userConfirmed) return;

  deleteImprovementActivity(activityId);
  renderImprovementActivitiesSection();
}


/* ============================================================
   VIEW: ANALYTICS
   ============================================================
   DATE FILTER: uses DataAbertura (start of development)
   or DataFechamento (end of validation) as a fallback.
   Many activities have no date filled in — the interface shows how many were excluded.
   ============================================================ */
/*
 * buildAna() — Analytics tab.
 *
 * Reads:  App.P.ana
 * Writes: #ana-content
 * Called by: generate() and renderAll()
 *
 * ATTENTION — low date coverage:
 *   Many activities have no date filled in on the spreadsheet.
 *   With an active filter, only activities WITH a date are included.
 *   The interface shows how many were excluded, for transparency.
 *
 * Produces:
 *  - KPIs: total, completed, in progress, not started
 *  - Status donut, bars by priority, area and owner
 *  - Priority × area heatmap (via buildHeatmap(), called directly here)
 */
function buildAna(){
  const {kept:A, noDate} = applyDate(App.P.ana);
  document.getElementById('ana-empty').style.display  = App.P.ana.length ? 'none' : 'block';
  document.getElementById('ana-content').style.display = App.P.ana.length ? 'block' : 'none';
  if(!App.P.ana.length) return;
  const sc   = statusCounts(A);
  const done = sc.done;
  const doing = sc.doing;
  const todo  = sc.todo;
  const comData = A.filter(a => a.dtFim).length;

  // Informational note: how many activities have a date vs. how many don't
  let dateNote = '';
  if(App.dateRange.mode !== 'all'){
    dateNote = `<div class="note" style="background:var(--neu-bg);color:var(--ink3)"><i class="ti ti-calendar-stats"></i><div>
      Período aplicado: <b>${A.length} atividades</b> no recorte.` +
      (noDate>0 ? ` ${noDate} sem data não entram no filtro.` : '') +
      `<br><span style="font-size:10px;opacity:.6;font-style:italic">Referência de data: data de abertura da atividade (ou fechamento como fallback)</span>
      </div></div>`;
  } else if(comData < A.length){
    // no active filter: warns how many have a date (relevant to the evolution chart)
    dateNote = `<div class="note"><i class="ti ti-info-circle"></i><div>${comData} de ${A.length} atividades têm data registrada. As ${A.length-comData} restantes não têm data preenchida na base, então não entram nos cálculos por período.</div></div>`;
  }

  // only priorities 1 to 5 (values outside that range are dropped from the chart)
  const prioCount = count(A.filter(a => a.prio && a.prio>=1 && a.prio<=5), a => 'Prioridade '+a.prio);
  let html = dateNote + `<div class="sh">Analytics</div>
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
      ${hbars(sortedCountEntries(A.filter(a=>a.frente), a=>a.frente),{max:8,lw:60,tot:A.length})}</div>
  </div>`;
  html += `<div class="two">
    <div class="card"><div class="card-title"><i class="ti ti-user"></i> Por responsável</div>
      ${hbars(sortedCountEntries(A.filter(a=>a.resp), a=>a.resp),{max:8,lw:140})}</div>
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
   VIEW: RPA TICKETS (5 sub-tabs)
   ============================================================
   DATE FILTER: uses 'criado' (ticket opening date).
   Every ticket has this date filled in (a required field in Pipefy).
   Sub-tabs: Overview, Top bots, Problem types, Resolution time, Tickets.
   ============================================================ */
/*
 * buildRPATickets() — RPA & Bots tab (ticket sub-tabs).
 *
 * Reads:  App.R (tickets), App.B (inventory, via areaPorProc)
 * Writes: #rpa-empty / #rpa-content  (visibility)
 *          #rpage-visao   → structure + calls renderRPAStatus()
 *          #rpage-bots    → top bots by maintenance volume
 *          #rpage-prob    → problem types × phase (clusteredBars)
 *          #rpage-tempo   → average time per bot
 *          #rpage-lista   → paginated table with search
 * Called by: generate() and renderAll()
 *
 * FUNCTION STRUCTURE:
 *   1. Validation and date-filter note
 *   2. Overview sub-tab  → htmlVisao + renderRPAStatus()
 *   3. Top Bots sub-tab     → htmlTopBots
 *   4. Problem Types sub-tab → htmlProblemas
 *   5. Time sub-tab        → htmlTempo
 *   6. List sub-tab        → htmlLista + renderRPAList()
 */
function buildRPATickets(){
  const {kept: chamados, noDate} = applyDate(App.R);
  const emptyEl = document.getElementById('rpa-empty');
  emptyEl.style.display  = App.R.length ? 'none' : 'block';
  document.getElementById('rpa-content').style.display = App.R.length ? 'block' : 'none';
  // if there was a wrong-file warning, shows a specific message instead of the default text
  if(!App.R.length){
    emptyEl.innerHTML = App.rpaWarn
      ? `<i class="ti ti-alert-triangle" style="color:var(--warn)"></i>${App.rpaWarn}`
      : `<i class="ti ti-robot"></i>Carregue o relatório de Chamados RPA`;
    return;
  }

  const total      = chamados.length;
  const venc       = chamados.filter(r => r.vencido).length;
  const concl      = chamados.filter(r => r.fase.toLowerCase().includes('conclu')).length;
  const abertos    = total - concl;
  const reexec     = chamados.filter(r => r.problema.toLowerCase().includes('reexecu')).length;
  const procUnicos = new Set(chamados.map(r=>r.processo).filter(p=>p&&p!=='(sem processo)')).size;

  let dateNote = '';
  if(App.dateRange.mode !== 'all'){
    dateNote = `<div class="note" style="background:var(--neu-bg);color:var(--ink3)"><i class="ti ti-calendar-stats"></i><div>
      Período aplicado: <b>${total} chamados</b> abertos no recorte.` +
      (noDate>0 ? ` ${noDate} sem data de criação não entram no filtro.` : '') +
      `<br><span style="font-size:10px;opacity:.6;font-style:italic">Referência de data: data de abertura do chamado</span>
      </div></div>`;
  }

  // Local status (phase) filter — options derived from the phases present in the data
  const fasesDisp = [...new Set(chamados.map(r=>r.fase).filter(Boolean))].sort();
  const filtroStatus = `<div class="filters" style="margin-bottom:14px">
    <label>Status do chamado</label>
    <select id="rpa-fs" onchange="renderRPAStatus()"><option value="">Todos</option>
      ${fasesDisp.map(f=>`<option>${f}</option>`).join('')}</select>
    <span style="font-size:11px;color:var(--ink4);margin-left:auto" id="rpa-fs-count"></span>
  </div>`;

  let htmlVisao = dateNote + aiBar('rpa') + filtroStatus + `<div id="rpa-visao-kpis"></div>`;
  document.getElementById('rpage-visao').innerHTML = htmlVisao;
  // the KPIs and charts are rendered by renderRPAStatus (it respects the status filter)
  renderRPAStatus();

  const labelComArea = rpaLabelWithArea(chamados);
  buildRPATabTopBots(chamados, labelComArea);
  buildRPATabProblems(chamados);
  buildRPATabTime(chamados, labelComArea);
  buildRPATabList(chamados, total, venc);
}

// Returns a function that formats "Nome do bot  ·  ÁREA" for chart labels.
function rpaLabelWithArea(chamados) {
  const areaPorProc = {};
  chamados.forEach(r => { if(r.processo && !areaPorProc[r.processo]) areaPorProc[r.processo] = r.area; });
  return proc => {
    const a = areaPorProc[proc];
    return a && a !== '(não mapeada)' ? `${proc}  ·  ${a}` : proc;
  };
}

function buildRPATabTopBots(chamados, labelComArea) {
  const procList = sortedCountEntries(chamados, r => r.processo)
    .filter(([proc]) => proc !== '(sem processo)')
    .map(([proc, n]) => [labelComArea(proc), n]);
  document.getElementById('rpage-bots').innerHTML =
    `<div class="card"><div class="card-title"><i class="ti ti-trophy"></i> Top bots por nº de manutenções<span class="rt">${procList.length} processos</span></div>
      ${hbars(procList,{max:15,lw:300,color:'var(--err)',fixedLabel:true})}</div>`;
  flushCharts();
}

function buildRPATabProblems(chamados) {
  const porProb   = count(chamados, r => r.problema);
  const porReexec = count(chamados.filter(r=>r.reexec), r => r.reexec);
  const porIntext = count(chamados.filter(r=>r.intext), r => r.intext);

  const fasesDef = [
    {key:'Backlog',                    label:'Backlog',         color:'#9CA3AF'},
    {key:'Identificação do problema',  label:'Identificação',   color:'#E66407'},
    {key:'Desenvolvimento da solução', label:'Desenvolvimento', color:'#0195D6'},
    {key:'Reexecução',                 label:'Reexecução',      color:'#4DB1B3'},
    {key:'Concluído',                  label:'Concluído',       color:'#0F5299'}
  ];
  const areasDef = [
    {key:'P2P',           label:'P2P',         color:'#0195D6'},
    {key:'TAX',           label:'TAX',         color:'#E66407'},
    {key:'H2R',           label:'H2R',         color:'#4DB1B3'},
    {key:'O2C',           label:'O2C',         color:'#8B6FD4'},
    {key:'R2R',           label:'R2R',         color:'#C5284C'},
    {key:'(não mapeada)', label:'Não mapeada', color:'#9CA3AF'}
  ];
  const paletaProb = ['#0195D6','#E66407','#4DB1B3','#C5284C','#E83430','#0F5299','#8B6FD4'];
  const probsOrd   = Object.entries(porProb).sort((a,b)=>b[1]-a[1]).map(e=>e[0]);
  const serieProb  = probsOrd.map((pr,i) => ({key:pr, label:pr, color:paletaProb[i%paletaProb.length]}));

  const gruposProb = fasesDef.map(f => {
    const sub = chamados.filter(r => r.fase===f.key);
    const valores = {};
    probsOrd.forEach(pr => { valores[pr] = sub.filter(r=>r.problema===pr).length; });
    return {label:f.label, color:f.color, valores};
  });
  const gruposArea = areasDef
    .map(a => {
      const sub = chamados.filter(r => r.area === a.key);
      const valores = {};
      probsOrd.forEach(pr => { valores[pr] = sub.filter(r=>r.problema===pr).length; });
      return {label:a.label, color:a.color, valores};
    })
    .filter(g => probsOrd.some(pr => g.valores[pr] > 0));

  const reexecDonut = donut(Object.entries(porReexec).map(([k,vv],i)=>({label:k,value:vv,color:i===0?'var(--ok)':'var(--warn)'})));
  const intextEntries = Object.entries(porIntext);
  const intextDonut = intextEntries.length
    ? donut(intextEntries.map(([k,vv])=>({label:k,value:vv,color:k.toLowerCase().includes('intern')?'var(--info)':'var(--warn)'})))
    : `<div style="font-size:12px;color:var(--ink4);font-style:italic">Campo "Interno ou externo?" ainda não disponível nos dados.<br>Adicione esse campo ao formulário RPA no Pipefy para habilitar esta análise.</div>`;

  document.getElementById('rpage-prob').innerHTML =
    `<div class="card"><div class="card-title"><i class="ti ti-alert-circle"></i> Tipos de problema <span class="rt">por fase do chamado</span></div>
      ${clusteredBars(gruposProb, serieProb)}</div>
    <div class="card"><div class="card-title"><i class="ti ti-building"></i> Tipos de problema <span class="rt">por área</span></div>
      ${clusteredBars(gruposArea, serieProb)}</div>
    <div class="two">
      <div class="card"><div class="card-title"><i class="ti ti-refresh"></i> Admite reexecução?</div>
        ${reexecDonut}
        <div class="note" style="margin-top:14px;margin-bottom:0;background:var(--neu-bg);color:var(--ink3)"><i class="ti ti-info-circle"></i><div>
          <b>O que é reexecução?</b> Indica se o bot pode ser rodado novamente após uma falha sem risco de duplicar transações.
          <b>Admite:</b> basta re-executar — o resultado é o mesmo.
          <b>Não admite:</b> é preciso investigar até onde processou antes de qualquer ação (ex: evitar pagamento duplo ou lançamento duplicado no SAP).
        </div></div></div>
      <div class="card"><div class="card-title"><i class="ti ti-arrow-fork"></i> Causa interna ou externa?</div>
        ${intextDonut}</div>
    </div>`;
  flushCharts();
}

function buildRPATabTime(chamados, labelComArea) {
  const tempoPorProcesso = {};
  chamados.forEach(r => {
    const diasAtivos = (r.tIdent || 0) + (r.tDesenv || 0);
    if (diasAtivos > 0) {
      if (!tempoPorProcesso[r.processo]) tempoPorProcesso[r.processo] = { soma: 0, contagem: 0 };
      tempoPorProcesso[r.processo].soma     += diasAtivos;
      tempoPorProcesso[r.processo].contagem += 1;
    }
  });
  const procAvg = Object.entries(tempoPorProcesso)
    .filter(([proc, d]) => proc !== '(sem processo)' && d.contagem >= 3)
    .map(([proc, d]) => [labelComArea(proc), +(d.soma / d.contagem).toFixed(1)])
    .sort((a, b) => b[1] - a[1]);
  const procUm = Object.entries(tempoPorProcesso)
    .filter(([proc, d]) => proc !== '(sem processo)' && d.contagem === 1)
    .map(([proc, d]) => [labelComArea(proc), +d.soma.toFixed(1)])
    .sort((a, b) => b[1] - a[1]);

  const notaTempoMedio = `<div class="note" style="margin-top:14px;margin-bottom:0;background:var(--neu-bg);color:var(--ink3)"><i class="ti ti-info-circle"></i><div>Soma dos dias em <b>Identificação</b> + <b>Desenvolvimento</b> dividida pelo nº de chamados do bot. Só bots com <b>3+ chamados</b> entram (evita distorção de amostra única).</div></div>`;
  const cardTempoMedio = `<div class="card"><div class="card-title"><i class="ti ti-clock"></i> Tempo médio por bot<span class="rt">dias · 3+ chamados</span></div>
    ${hbars(procAvg,{max:12,lw:200,color:'var(--warn)'})}${notaTempoMedio}</div>`;

  let html = `<div class="krow">
    <div class="kpi">${kpiIcon('clock')}<div class="knum sm">${avgField(chamados,'tIdent')}</div><div class="klbl">Média dias · Identificação</div></div>
    <div class="kpi">${kpiIcon('clock')}<div class="knum sm">${avgField(chamados,'tDesenv')}</div><div class="klbl">Média dias · Desenvolvimento</div></div>
    <div class="kpi">${kpiIcon('clock')}<div class="knum sm">${avgField(chamados,'tReexec')}</div><div class="klbl">Média dias · Reexecução</div></div>
    <div class="kpi">${kpiIcon('chartbar')}<div class="knum sm">${chamados.filter(r=>r.tIdent!=null||r.tDesenv!=null).length}</div><div class="klbl">Chamados com tempo medido</div></div>
  </div>`;
  if (procUm.length) {
    html += `<div class="two">${cardTempoMedio}<div class="card"><div class="card-title"><i class="ti ti-clock-hour-4"></i> Bots com 1 chamado<span class="rt">dias · ${procUm.length} bots</span></div>
      ${hbars(procUm,{max:20,lw:200,color:'#5aa0a0'})}
      <div class="note" style="margin-top:14px;margin-bottom:0;background:var(--neu-bg);color:var(--ink3)"><i class="ti ti-info-circle"></i><div>Um único chamado — não é média, serve de referência.</div></div></div></div>`;
  } else {
    html += cardTempoMedio;
  }
  document.getElementById('rpage-tempo').innerHTML = html;
  flushCharts();
}

function buildRPATabList(chamados, total, venc) {
  document.getElementById('rpage-lista').innerHTML =
    `<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
      <input type="text" id="rsearch" placeholder="Buscar por código, processo, solicitante..." oninput="renderRPAList()" style="flex:1;max-width:360px">
      <span style="font-size:11px;color:var(--ink4)" id="rlista-count">${total} chamados</span></div>
    <div class="card np"><div style="overflow-x:auto"><table class="tbl" style="margin:0">
    <thead><tr><th style="padding-left:20px">Código</th><th>Processo</th><th>Problema</th><th>Fase</th><th>Mês</th><th style="padding-right:20px">Status</th></tr></thead>
    <tbody id="rlista-body"></tbody></table></div></div>`;
  renderRPAList();
  setBadge('nb-rpa', venc>0 ? venc+' venc' : total, venc>0?'warn':'');
}

/*
 * renderRPAStatus() — renders the KPIs and charts of the RPA Tickets overview,
 * respecting the global date filter AND the local status (phase) filter.
 * Includes: KPIs, monthly volume, opened by weekday (Mon-Fri) and tickets by area.
 */
function renderRPAStatus(){
  const {kept: chamadosFiltrados} = applyDate(App.R);   // já filtrado pelo período global
  const faseSelecionada = document.getElementById('rpa-fs')?.value || '';
  const chamados = faseSelecionada ? chamadosFiltrados.filter(r => r.fase === faseSelecionada) : chamadosFiltrados;

  const total      = chamados.length;
  const venc       = chamados.filter(r => r.vencido).length;
  const concl      = chamados.filter(r => r.fase.toLowerCase().includes('conclu')).length;
  const abertos    = total - concl;
  const reexec     = chamados.filter(r => r.problema.toLowerCase().includes('reexecu')).length;
  const pctVenc    = pct(venc, total);
  const procUnicos = new Set(chamados.map(r => r.processo).filter(p => p && p !== '(sem processo)')).size;

  const cnt = document.getElementById('rpa-fs-count');
  if(cnt) cnt.textContent = faseSelecionada ? `${total} chamados em "${faseSelecionada}"` : `${total} chamados`;

  let htmlKpis = `<div class="krow k5">
    <div class="kpi">${kpiIcon('ticket')}<div class="knum">${total}</div><div class="klbl">Total chamados</div><div class="ksub">${procUnicos} processos distintos</div></div>
    <div class="kpi gl">${kpiIcon('check')}<div class="knum">${concl}</div><div class="klbl">Concluídos</div><div class="ksub">${pct(concl,total)}%</div></div>
    <div class="kpi il">${kpiIcon('clock')}<div class="knum">${abertos}</div><div class="klbl">Abertos</div></div>
    <div class="kpi dl">${kpiIcon('alert')}<div class="knum">${venc}</div><div class="klbl">Vencidos</div><div class="ksub">${pctVenc}% do total</div></div>
    <div class="kpi wl">${kpiIcon('refresh')}<div class="knum">${reexec}</div><div class="klbl">Reexecuções</div></div>
  </div>`;

  // Monthly volume (stacked bars: normal tickets + overdue)
  const porMes={}, porMesV={};
  chamados.forEach(r => {
    if (r.mes) {
      porMes[r.mes]  = (porMes[r.mes]  || 0) + 1;
      if (r.vencido) porMesV[r.mes] = (porMesV[r.mes] || 0) + 1;
    }
  });
  const meses = Object.keys(porMes).sort().slice(-12);
  const vol   = chartVBars(meses, porMes, porMesV);

  // Monthly volume + phase donut side by side (time view + current state)
  htmlKpis += `<div class="two">
    <div class="card"><div class="card-title"><i class="ti ti-chart-bar"></i> Volume mensal</div>${vol}</div>
    <div class="card"><div class="card-title"><i class="ti ti-chart-pie"></i> Status (fase) dos chamados</div>
      ${donut(Object.entries(count(chamados,r=>r.fase)).map(([k,vv],i)=>({label:k,value:vv,color:['var(--ok)','var(--info)','var(--warn)','var(--err)','#7c5cbf','var(--ink4)'][i%6]})))}</div>
  </div>`;

  // Tickets by area (area inherited from the bot inventory via name matching).
  // The main areas stay visible; the rest (PAM, CI, IT, ARG, etc.)
  // are summed into "Outros" to avoid cluttering the chart with tiny slices.
  const porArea = count(chamados, r => r.area || '(não mapeada)');
  let outrosArea = 0;
  const areaEntries = [];
  Object.entries(porArea).forEach(([area, n]) => {
    const up = area.toUpperCase();
    if(MAIN_RPA_AREAS.includes(up) || area === '(não mapeada)'){
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
 * renderRPAList() — renders the paginated ticket list.
 * Applies the global date filter + text search.
 * Shows up to 1000 tickets; warns if there are more.
 */
function renderRPAList(){
  const {kept: chamados} = applyDate(App.R);
  const q = (document.getElementById('rsearch')?.value||'').toLowerCase();
  const vis = q ? chamados.filter(r=>(r.cod+r.processo+r.solicitante+r.problema).toLowerCase().includes(q)) : chamados;
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
   VIEW: BOT INVENTORY
   ============================================================
   DIFFERENT DATE FILTER: uses the YEAR the bot went live (AnoPRD),
   not an action date. Filtering by "2026" shows only bots that
   went live in 2026 (not tickets or improvements from 2026).
   ============================================================ */
/*
 * buildBots() — Bot Inventory tab (inside RPA & Bots).
 *
 * Reads:  App.B (inventory), App.R (for ticket cross-reference, if available)
 * Writes: #bots-empty / #bots-content
 *          #bots-list  → filterable bot list, via renderBotsList()
 * Called by: generate() and renderAll()
 *
 * DIFFERENT DATE FILTER:
 *   Uses AnoPRD (year the bot went live), not action dates.
 *   "Filter by 2026" shows bots that went live in 2026, not tickets from 2026.
 *
 * Produces:
 *  - KPIs: total bots, in PRD, in DEV, backlog
 *  - Bars by area and donut by perimeter (bots in PRD)
 *  - Bars by criticality and frequency
 *  - Inventory × tickets cross-reference table (if App.R is available)
 *  - Filtered list with inline expand (bot details)
 */
function buildBots(){
  // Special AnoPRD filter (extracts just the year from the selected date range)
  const dr = App.dateRange;
  let B = App.B;
  let dateNote = '';
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
    dateNote = `<div class="note" style="background:var(--neu-bg);color:var(--ink3)"><i class="ti ti-calendar-stats"></i><div>
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

  let html = dateNote + `<div class="sh">Inventário de Bots — RPA</div>
  ${aiBar('bots')}
  <div class="krow">
    <div class="kpi">${kpiIcon('robot')}<div class="knum">${B.length}</div><div class="klbl">Total de bots</div></div>
    <div class="kpi gl">${kpiIcon('rocket')}<div class="knum">${prd}</div><div class="klbl">Em produção</div><div class="ksub">${pct(prd,B.length)}% do total</div></div>
    <div class="kpi wl">${kpiIcon('code')}<div class="knum">${dev}</div><div class="klbl">Em desenvolvimento</div></div>
    <div class="kpi">${kpiIcon('stack')}<div class="knum">${backlog}</div><div class="klbl">Backlog</div></div>
  </div>`;

  const prdBots = B.filter(b=>b.status==='PRD');
  // The 5 main business areas stay visible; the rest (MEX, PAM, IT, etc.)
  // are summed into "Outros" so the bars' total matches the total bots in PRD.
  const AREAS_PRINCIPAIS = MAIN_RPA_AREAS;
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
      ${hbars(sortedCountEntries(prdBots.filter(b=>b.freq), b=>b.freq),{max:6,lw:80})}</div>
  </div>`;

  // Inventory × tickets cross-reference (only if the RPA report is loaded)
  if(App.R.length) html += buildBotsCruzamento(B);

  // List filtered by status and area
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
 * buildBotsCruzamento(Bf) — inventory × RPA tickets cross-reference table.
 * Tries to match the bot name (inventory) with the process name (tickets)
 * using an approximate match (one contains the other, after normalization).
 * Shows the 10 bots in PRD with the most maintenance tickets — refactoring candidates.
 *
 * LIMITATION: the name match is heuristic. If the bot's name in the inventory
 * is very different from the process name in Pipefy, the cross-reference can miss it.
 */
function buildBotsCruzamento(Bf){
  const norm = normBotName;
  const {kept:Rf} = applyDate(App.R); // also applies the date filter to the tickets
  const chamPorProc = count(Rf, r => r.processo);
  const rows = Bf.filter(b => b.status === 'PRD').map(b => {
    const botNameNorm = norm(b.nome);
    let totalChamados = 0;
    Object.entries(chamPorProc).forEach(([proc, qtd]) => {
      const procNameNorm = norm(proc);
      if (procNameNorm && botNameNorm && (botNameNorm.includes(procNameNorm) || procNameNorm.includes(botNameNorm))) {
        totalChamados += qtd;
      }
    });
    return { nome: b.nome, area: b.area, crit: b.criticidade, ch: totalChamados };
  }).filter(r => r.ch > 0).sort((a, b) => b.ch - a.ch).slice(0, 10);
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
 * renderBotsList() — filtered bot list with local filters (status, area).
 * Applies the AnoPRD date filter before the local filters.
 * Shows up to 200 bots; warns if there are more.
 */
function renderBotsList(){
  const filterStatus = document.getElementById('bot-fs')?.value||'';
  const filterArea   = document.getElementById('bot-fa')?.value||'';
  const dr = App.dateRange;
  let source = App.B;
  // special date filter: by AnoPRD (not by action date)
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
  let B = source.filter(b => (!filterStatus||b.status===filterStatus) && (!filterArea||b.area===filterArea));
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
   GLOBAL DATE FILTER — HEADER CONTROLS
   ============================================================ */

/*
 * applyDateFilter() — called when the user changes either date field in the header.
 * Reads both inputs (from/to), updates App.dateRange, and calls renderAll() to
 * redraw every tab with the new range.
 *
 * If both fields are empty → goes back to 'all' mode (no filter).
 * The time is fixed: 'from' starts at 00:00:00 and 'to' ends at 23:59:59
 * to include the full day on both ends.
 */
/*
 * setQuickRange(mode) — applies a period shortcut (current month/quarter/year).
 * Calculates the start and end dates based on today's date, fills in the
 * date fields, then triggers the filter. Visually marks the active chip.
 */
function setQuickRange(mode){
  // If the clicked chip is already active, clears the filter (toggle)
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
    to   = new Date(y, m+1, 0); // last day of the current month
  } else if(mode==='quarter'){
    const q = Math.floor(m/3);  // 0,1,2,3
    from = new Date(y, q*3, 1);
    to   = new Date(y, q*3+3, 0); // last day of the quarter
  } else if(mode==='year'){
    from = new Date(y, 0, 1);
    to   = new Date(y, 11, 31);
  }
  const iso = toIsoDate;
  document.getElementById('df-from').value = iso(from);
  document.getElementById('df-to').value   = iso(to);
  // marks the active chip
  ['month','quarter','year'].forEach(k=>{
    const c = document.getElementById('dfc-'+k);
    if(c) c.classList.toggle('active', k===mode);
  });
  applyDateFilter(true); // true = don't clear the chips (already marked above)
}

/*
 * applyDateFilter(fromChip) — called when the user changes the date fields
 * or clicks a shortcut. Updates App.dateRange and redraws everything.
 * fromChip: if false (manual change), unmarks the shortcut chips.
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
  // a manual change in the fields unmarks the quick shortcuts
  if(fromChip!==true){
    ['month','quarter','year'].forEach(k=>{
      const c=document.getElementById('dfc-'+k); if(c) c.classList.remove('active');
    });
  }
  const wrap = document.getElementById('date-filter');
  if(wrap) wrap.classList.toggle('active', dr.mode!=='all');
  renderAll();
}

// Clears both date fields, unmarks shortcuts, and returns to 'all' mode
function clearDateFilter(){
  document.getElementById('df-from').value = '';
  document.getElementById('df-to').value   = '';
  ['month','quarter','year'].forEach(k=>{
    const c=document.getElementById('dfc-'+k); if(c) c.classList.remove('active');
  });
  applyDateFilter();
}

/*
 * renderAll() — redraws every tab with the current state (filters included).
 * Called whenever the date filter changes.
 * Each build*() function applies the date filter internally before calculating.
 */
function renderAll(){
  buildGovernance();
  if(App.P.proj.length) buildProjects();
  if(App.P.improvements.length) buildImprovements();
  if(App.P.ana.length) buildAna();
  if(App.R.length) buildRPATickets();
  if(App.B.length) buildBots();
  updateDateBadge();
}

/*
 * updateDateBadge() — updates the status text in the header (topbar).
 * When a filter is active, appends "· período: DD/MM/AAAA → DD/MM/AAAA".
 * Uses dataset.base to store the original text (update time + sources)
 * and avoid overwriting it when the period updates.
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
   AUTOMATIC ANALYSIS ("AI" of computed insights)
   ============================================================
   Generates analytical readings from the data, 100% in the browser —
   nothing is sent to any server. This is not a language model: these
   are programmed analyses (concentration, trend, bottlenecks, outliers)
   that produce dynamic sentences, always recalculated according to the
   spreadsheet and the active period filter.

   Each tab has an analyze<Tab>() function that returns a list of
   insights in the format { type, text }, where type ∈ {pos, neg, warn, neu}
   controls the color/icon. generateAnalysis() builds the panel and aiBar() the button.
   ============================================================ */

// Icon (inline SVG) for the "spark/analysis" button — doesn't depend on an external font
const AI_SPARK = '<svg class="ai-spark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2z"/></svg>';

/*
 * aiBar(tab) — generates the HTML for a tab's "Gerar análise" button.
 * The panel container's id is ai-panel-<tab>, filled in by generateAnalysis().
 */
function aiBar(tab){
  return `<div class="ai-bar">
    <button class="ai-btn" id="ai-btn-${tab}" onclick="generateAnalysis('${tab}')">${AI_SPARK} Gerar análise</button>
    <span class="ai-hint">leitura automática dos números deste recorte · 100% local</span>
  </div><div id="ai-panel-${tab}"></div>`;
}

/*
 * generateAnalysis(tab) — computes the tab's insights and renders the panel.
 * Shows a brief "analyzing" state (purely visual) and then the result.
 * Clicking again collapses the panel (toggle).
 */
function generateAnalysis(tab){
  const panel = document.getElementById('ai-panel-'+tab);
  const btn = document.getElementById('ai-btn-'+tab);
  if(!panel) return;
  // toggle: if already open, collapse it
  if(panel.dataset.open === '1'){
    panel.innerHTML = ''; panel.dataset.open = '0';
    return;
  }
  if(btn) btn.classList.add('loading');
  // small delay just to give a sense of processing (doesn't block anything)
  setTimeout(() => {
    const fn = {
      gov: analyzeGovernance, proj: analyzeProjects, mel: analyzeImprovements,
      ana: analyzeAnalytics, rpa: analyzeRPA, bots: analyzeBots
    }[tab];
    const insights = (fn ? fn() : []).filter(Boolean);
    const corpo = insights.length
      ? insights.map(i => `<div class="ai-item ${i.type}"><div class="ai-ico">${i.ico||'•'}</div><div>${i.text}</div></div>`).join('')
      : `<div class="ai-item neu"><div class="ai-ico">•</div><div>Não há dados suficientes neste recorte para gerar uma análise. Tente limpar o filtro de período.</div></div>`;
    panel.innerHTML = `<div class="ai-panel">
      <div class="ai-panel-head">${AI_SPARK}<span class="ai-panel-title">Análise automática</span>
        <span class="ai-panel-sub">${insights.length} ${insights.length===1?'observação':'observações'} · recalculado dos dados atuais</span></div>
      ${corpo}</div>`;
    panel.dataset.open = '1';
    if(btn) btn.classList.remove('loading');
  }, 280);
}

// helper: largest {key,value} entry of a count object
function topEntry(obj, exclude=[]){
  const e = Object.entries(obj).filter(([k]) => !exclude.includes(k)).sort((a,b)=>b[1]-a[1]);
  return e[0] || null;
}

/* --- Analysis: GOVERNANCE --- */
function analyzeGovernance(){
  const {kept:A} = allActionsFiltered();
  const tot = A.length;
  if(!tot) return [];
  const ins = [];
  const sc      = statusCounts(A);
  const done    = sc.done;
  const doing   = sc.doing + sc.closing;
  const backlog = sc.todo;
  const rate = pct(done,tot);

  // 1. General completion reading
  ins.push({type: rate>=60?'pos':(rate>=35?'neu':'warn'), ico:'%',
    text:`<b>${rate}% das ${tot} ações estão concluídas</b> (${done}). Em andamento: ${doing}. Backlog/não iniciadas: ${backlog} (${pct(backlog,tot)}%).`});

  // 2. Which source concentrates the most open backlog
  const sources = ['Projetos','Pipefy','Analytics','Chamados RPA'];
  const backlogBySource = {};
  sources.forEach(f => { backlogBySource[f] = A.filter(a=>a.source===f && (a.sc==='todo'||a.sc==='doing'||a.sc==='closing')).length; });
  const topBacklog = topEntry(backlogBySource);
  if(topBacklog && topBacklog[1]>0){
    ins.push({type:'neu', ico:'≡',
      text:`A fonte com mais ações em aberto é <b>${topBacklog[0]}</b>, com ${topBacklog[1]} ${topBacklog[1]===1?'ação':'ações'} (em andamento ou backlog).`});
  }

  // 3. Concentration of open actions by owner (CoE team only, same as the chart)
  const openByOwner = {};
  A.filter(a=>a.resp && a.sc!=='done' && a.sc!=='cancel').forEach(a=>{
    const nome = getStandardCoeName(a.resp);
    if(nome) openByOwner[nome] = (openByOwner[nome]||0)+1;
  });
  const totalOpen = Object.values(openByOwner).reduce((s,v)=>s+v,0);
  const topOwner = topEntry(openByOwner);
  if(topOwner && totalOpen>0){
    // 30% threshold: one person carrying >30% of open actions is a possible bottleneck.
    // Below that it's just "highest individual load" — informative, not a problem.
    ins.push({type: topOwner[1]/totalOpen>0.3?'warn':'neu', ico:'@',
      text:`Na equipe CoE, <b>${topOwner[0]}</b> concentra ${topOwner[1]} ações abertas (${pct(topOwner[1],totalOpen)}% do total da equipe) — ${topOwner[1]/totalOpen>0.3?'possível gargalo de capacidade':'maior carga individual'}.`});
  }

  // 4. Cancelled (flagged if relevant)
  // 5% threshold: below that is normal planning noise; above it deserves a process review.
  const cancel = A.filter(a=>a.sc==='cancel').length;
  if(cancel>0 && pct(cancel,tot)>=5){
    ins.push({type:'warn', ico:'×',
      text:`<b>${cancel} ações canceladas</b> (${pct(cancel,tot)}% do total) — vale revisar o motivo para reduzir retrabalho de planejamento.`});
  }
  return ins;
}

/* --- Analysis: PROJECTS --- */
function analyzeProjects(){
  const {kept:P} = applyDate(App.P.proj);
  const tot = P.length;
  if(!tot) return [];
  const ins = [];
  const exec = P.filter(p=>p.sc==='doing').length;
  const fin = P.filter(p=>p.sc==='closing'||p.sc==='monitor').length;
  const overdue = P.filter(isProjectOverdue);

  // 1. General status
  ins.push({type:'neu', ico:'≡',
    text:`<b>${tot} projetos</b> no recorte: ${exec} em execução, ${fin} em fase final (encerramento/monitoramento).`});

  // 2. Overdue — a NAMED list of which ones (sorted by days overdue)
  if(overdue.length>0){
    const withDays = overdue.map(p => ({
      titulo: p.titulo,
      dias: daysBetween(HOJE, p.dtFim),
      fase: getProjectPhase(p.statusRaw), statusRaw: p.statusRaw
    })).sort((a,b)=>b.dias-a.dias);
    const list = withDays.map(p => `<b>${p.titulo}</b> (${p.dias}d, ${p.statusRaw})`).join('; ');
    ins.push({type:'neg', ico:'!',
      text:`<b>${overdue.length} ${overdue.length===1?'projeto atrasado':'projetos atrasados'}</b>: ${list}.`});
  } else {
    ins.push({type:'pos', ico:'✓', text:`Nenhum projeto com prazo vencido neste recorte.`});
  }

  // 3. Most critical project by the automatic risk score
  const withRisk = P.map(p => ({p, r:getProjectRisk(p)})).filter(x=>x.r.score>0).sort((a,b)=>b.r.score-a.r.score);
  if(withRisk.length){
    const top = withRisk[0];
    const levelPt = {high:'alto', medium:'médio', low:'baixo'}[top.r.level];
    ins.push({type: top.r.level==='high'?'neg':'warn', ico:'▲',
      text:`Projeto mais crítico: <b>${top.p.titulo}</b> (risco ${levelPt}, score ${top.r.score}) — ${top.r.reasons.join(', ')}.`});
    const highRiskCount = withRisk.filter(x=>x.r.level==='high').length;
    if(highRiskCount>1){
      ins.push({type:'warn', ico:'▲',
        text:`<b>${highRiskCount} projetos</b> estão em risco alto e merecem atenção prioritária.`});
    }
  }

  // 4. Area with the most projects
  const byArea = count(P.filter(p=>p.frente), p=>p.frente);
  const topArea = topEntry(byArea);
  if(topArea){
    ins.push({type:'neu', ico:'#',
      text:`A frente com mais projetos é <b>${topArea[0]}</b> (${topArea[1]}).`});
  }

  // 5. Not-started projects
  // 30% threshold: if more than 30% of the portfolio hasn't started, the pipeline is backed up.
  const notStarted = P.filter(p=>p.sc==='todo').length;
  if(notStarted>0){
    ins.push({type: pct(notStarted,tot)>30?'warn':'neu', ico:'○',
      text:`<b>${notStarted} ${notStarted===1?'projeto não iniciado':'projetos não iniciados'}</b> (${pct(notStarted,tot)}% da carteira) aguardando início.`});
  }
  return ins;
}

/* --- Analysis: PIPEFY IMPROVEMENTS --- */
function analyzeImprovements(){
  const {kept: melhorias} = applyDate(App.P.improvements);
  const tot = melhorias.length;
  if(!tot) return [];
  const ins = [];
  const sc      = statusCounts(melhorias);
  const done    = sc.done;
  const backlog = sc.todo;
  const blocked = sc.blocked;

  ins.push({type: pct(done,tot)>=60?'pos':'neu', ico:'%',
    text:`<b>${pct(done,tot)}% das ${tot} melhorias concluídas</b> (${done}). Backlog: ${backlog}.`});

  // dominant complexity
  const byComplexity = count(melhorias.filter(m=>m.complex), m=>m.complex);
  const topComplexity = topEntry(byComplexity);
  if(topComplexity){
    ins.push({type:'neu', ico:'≡',
      text:`Complexidade predominante: <b>${topComplexity[0]}</b> (${topComplexity[1]} melhorias, ${pct(topComplexity[1],tot)}%).`});
  }

  // area with the most improvements
  const byArea = count(melhorias.filter(m=>m.frente), m=>m.frente);
  const topArea = topEntry(byArea);
  if(topArea){
    ins.push({type:'neu', ico:'#',
      text:`A frente que mais demanda melhorias é <b>${topArea[0]}</b> (${topArea[1]}).`});
  }

  if(blocked>0){
    ins.push({type:'warn', ico:'!',
      text:`<b>${blocked} ${blocked===1?'melhoria bloqueada':'melhorias bloqueadas'}</b> — vale destravar para liberar o fluxo.`});
  }
  return ins;
}

/* --- Analysis: ANALYTICS --- */
function analyzeAnalytics(){
  const {kept:A} = applyDate(App.P.ana);
  const tot = A.length;
  if(!tot) return [];
  const ins = [];
  const done = A.filter(a=>a.sc==='done').length;

  ins.push({type: pct(done,tot)>=50?'pos':'neu', ico:'%',
    text:`<b>${pct(done,tot)}% das ${tot} atividades concluídas</b> (${done}).`});

  // priority 1 still open — alert
  const openP1 = A.filter(a=>a.prio===1 && a.sc!=='done' && a.sc!=='cancel').length;
  if(openP1>0){
    ins.push({type:'neg', ico:'!',
      text:`<b>${openP1} ${openP1===1?'atividade de Prioridade 1 em aberto':'atividades de Prioridade 1 em aberto'}</b> — foco máximo de atenção.`});
  }

  // most in-demand area
  const byArea = count(A.filter(a=>a.frente), a=>a.frente);
  const topArea = topEntry(byArea);
  if(topArea){
    ins.push({type:'neu', ico:'#',
      text:`A frente com mais atividades de Analytics é <b>${topArea[0]}</b> (${topArea[1]}).`});
  }

  // without a date (transparency)
  const withoutDate = A.filter(a=>!a.dtFim && !a.dtInicio).length;
  if(withoutDate>0){
    ins.push({type:'neu', ico:'○',
      text:`${withoutDate} de ${tot} atividades não têm data registrada, então não entram nos cálculos por período.`});
  }
  return ins;
}

/* --- Analysis: RPA TICKETS --- */
function analyzeRPA(){
  const {kept: chamados} = applyDate(App.R);
  const tot = chamados.length;
  if(!tot) return [];
  const ins = [];
  const overdue = chamados.filter(r=>r.vencido).length;
  const done = chamados.filter(r=>r.fase.toLowerCase().includes('conclu')).length;

  // 1. Concentration in the top bots
  // 40% threshold: if 3 processes (out of dozens) concentrate >40% of tickets,
  // stabilizing them has a disproportionate impact on the total support volume.
  const byProcess = count(chamados.filter(r=>r.processo!=='(sem processo)'), r=>r.processo);
  const sorted = Object.entries(byProcess).sort((a,b)=>b[1]-a[1]);
  const totalProcess = sorted.reduce((s,e)=>s+e[1],0);
  if(sorted.length>=3){
    const top3 = sorted.slice(0,3);
    const top3Sum = top3.reduce((s,e)=>s+e[1],0);
    ins.push({type: top3Sum/totalProcess>0.4?'warn':'neu', ico:'≡',
      text:`Os 3 processos com mais manutenções (<b>${top3.map(e=>e[0]).join(', ')}</b>) concentram <b>${pct(top3Sum,totalProcess)}%</b> dos chamados. Estabilizá-los reduz bastante o volume de suporte.`});
  }

  // 2. SLA overdue rate
  // Threshold: >25% = critical (red), >0% = attention (orange), 0% = good (green).
  ins.push({type: pct(overdue,tot)>25?'neg':(pct(overdue,tot)>0?'warn':'pos'), ico: pct(overdue,tot)>25?'!':'%',
    text:`<b>${pct(overdue,tot)}% dos ${tot} chamados venceram o prazo</b> (${overdue}). Concluídos: ${pct(done,tot)}%.`});

  // 3. Most common problem
  const byProblem = count(chamados, r=>r.problema);
  const topProblem = topEntry(byProblem, ['']);
  if(topProblem && topProblem[0]){
    ins.push({type:'neu', ico:'?',
      text:`Problema mais frequente: <b>"${topProblem[0]}"</b> (${topProblem[1]} chamados, ${pct(topProblem[1],tot)}%).`});
  }

  // 4. Month-over-month trend: compares the average of the 1st half of the period with the 2nd half.
  // 15% threshold: variations below that are normal fluctuation; above it is a real trend.
  // Splitting into two halves works with any number of available months.
  const byMonth = {};
  chamados.forEach(r=>{ if(r.mes) byMonth[r.mes]=(byMonth[r.mes]||0)+1; });
  const months = Object.keys(byMonth).sort();
  if(months.length>=4){
    const half = Math.floor(months.length/2);
    const recent = months.slice(-half).reduce((s,m)=>s+byMonth[m],0)/half; // 2nd-half average
    const older  = months.slice(0,half).reduce((s,m)=>s+byMonth[m],0)/half; // 1st-half average
    const change = older>0 ? Math.round((recent-older)/older*100) : 0; // % change
    if(Math.abs(change)>=15){
      ins.push({type: change>0?'warn':'pos', ico: change>0?'↑':'↓',
        text:`O volume de chamados está <b>${change>0?'subindo':'caindo'}</b>: média recente ${recent.toFixed(0)}/mês vs ${older.toFixed(0)}/mês no início do período (${change>0?'+':''}${change}%).`});
    }
  }

  // 5. Area that opens the most tickets (if mapped)
  const byArea = count(chamados.filter(r=>r.area && r.area!=='(não mapeada)'), r=>r.area);
  const topArea = topEntry(byArea);
  if(topArea){
    ins.push({type:'neu', ico:'#',
      text:`A área que mais abre chamados é <b>${topArea[0]}</b> (${topArea[1]}).`});
  }
  return ins;
}

/* --- Analysis: BOT INVENTORY --- */
function analyzeBots(){
  // bots use the AnoPRD filter; here we analyze the full loaded set
  const bots = App.B;
  if(!bots.length) return [];
  const ins = [];
  const prd     = bots.filter(b=>b.status==='PRD').length;
  const dev     = bots.filter(b=>b.status==='DEV').length;
  const backlog = bots.filter(b=>b.status==='BACKLOG').length;

  ins.push({type:'neu', ico:'≡',
    text:`<b>${bots.length} bots no inventário</b>: ${prd} em produção (${pct(prd,bots.length)}%), ${dev} em desenvolvimento, ${backlog} em backlog.`});

  // coverage by area (among the main business areas)
  const prdBots = bots.filter(b=>b.status==='PRD');
  const byArea = count(prdBots, b=>b.area);
  const topArea = topEntry(byArea);
  if(topArea){
    ins.push({type:'neu', ico:'#',
      text:`A área com mais automações em produção é <b>${topArea[0]}</b> (${topArea[1]} bots, ${pct(topArea[1],prd)}%).`});
  }

  // critical bots
  const critical = prdBots.filter(b=>b.criticidade && b.criticidade<=2).length;
  if(critical>0){
    ins.push({type:'warn', ico:'!',
      text:`<b>${critical} bots em produção são de criticidade alta</b> (nível 1-2) — priorize monitoramento e plano de contingência.`});
  }

  // cross-reference with tickets, if available
  if(App.R.length){
    const ticketsByProcess = count(App.R, r=>r.processo);
    let maxTickets = 0, botWithMostTickets = '';
    prdBots.forEach(b => {
      const botNameNorm = normBotName(b.nome);
      let totalTickets = 0;
      Object.entries(ticketsByProcess).forEach(([proc, qtd]) => {
        const procNameNorm = normBotName(proc);
        if (procNameNorm && botNameNorm && (botNameNorm.includes(procNameNorm) || procNameNorm.includes(botNameNorm))) {
          totalTickets += qtd;
        }
      });
      if (totalTickets > maxTickets) { maxTickets = totalTickets; botWithMostTickets = b.nome; }
    });
    if(maxTickets>0){
      ins.push({type:'warn', ico:'⚙',
        text:`O bot em produção com mais manutenções é <b>${botWithMostTickets}</b> (${maxTickets} chamados) — forte candidato a refatoração.`});
    }
  }
  return ins;
}


/* ============================================================
   GENERATE — MAIN ENTRY POINT
   ============================================================
   Called when the user clicks "Gerar dashboard".
   Orchestrates: parsers → finds the date range → builds every view → navigates.
   ============================================================ */
function generate(){
  // Destroys previous Chart.js instances and resets the id counter
  // to avoid the "Canvas already in use" error on every dashboard regeneration
  Object.values(_chartInstances).forEach(ch => { try { ch.destroy(); } catch(_){} });
  Object.keys(_chartInstances).forEach(k => delete _chartInstances[k]);
  _chartSeq = 0;

  // 1. Parses each source (converts raw Excel into normalized objects)
  if(App.gov) parseGov();   // governance base: Pipefy, Projetos, Analytics
  if(App.gov) parseInv();   // bot inventory (separate tab within the governance base)
  if(App.rpa) parseRPA();   // RPA maintenance ticket report
  enrichRPAWithArea();      // assigns bot area to tickets (via name matching)

  // 2. Finds the global date range (min and max across all sources)
  //    This sets the min/max limits of the header's date inputs,
  //    preventing the user from selecting dates outside the data's range.
  const all = [...App.P.improvements, ...App.P.proj, ...App.P.ana, ...App.R];
  const dates = all.map(refDate).filter(Boolean).map(d => d.getTime());
  if(dates.length){
    const min = new Date(Math.min(...dates));
    const max = new Date(Math.max(...dates));
    const iso = toIsoDate;
    ['df-from','df-to'].forEach(id => {
      const el = document.getElementById(id);
      if(el){ el.min=iso(min); el.max=iso(max); }
    });
  }

  // 3. Builds every view (try/catch per tab: an error in one doesn't block the others or the redirect)
  function buildTab(builder) {
    try { builder(); } catch(error) { console.error('[SYNAPSE] erro ao construir aba:', error); }
  }
  buildTab(() => buildGovernance());
  buildTab(() => { if(App.P.proj.length) buildProjects(); });
  buildTab(() => { if(App.P.improvements.length) buildImprovements(); });
  buildTab(() => { if(App.P.ana.length) buildAna(); });
  buildTab(() => { if(App.R.length) buildRPATickets(); });
  buildTab(() => { if(App.B.length) buildBots(); });

  // 4. Updates navigation badges and status text
  if(App.P.improvements.length) setBadge('nb-mel', App.P.improvements.length, '');
  const now = new Date();
  const ts  = `Atualizado ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  const src = [App.loaded.gov?'Base Governança':'', App.loaded.rpa?'Chamados RPA':''].filter(Boolean).join(' · ');
  const lbl = document.getElementById('sync-lbl');
  lbl.textContent = `${ts} · ${src}`;
  lbl.dataset.base = `${ts} · ${src}`; // stored so updateDateBadge doesn't overwrite it

  // 5. Reveals the date filter and the export button (hidden until the first generate)
  const df = document.getElementById('date-filter');
  if(df) df.style.display = 'flex';
  const bp = document.getElementById('btn-print');
  if(bp) bp.style.display = 'flex';

  // 6. Navigates to the Governance tab (executive view)
  setNav('gov');
}

// Initializes on the Upload screen when the page loads
setNav('upload');

// "Back to top" button: appears after 300px of scroll, hides at the top
window.addEventListener('scroll', () => {
  const btn = document.getElementById('btn-top');
  if (btn) btn.classList.toggle('visible', window.scrollY > 300);
});