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
function dataReferencia(item){
  return item.dtFim || item.criado || null;
}

/*
 * Verifica se uma data passa no filtro global de período.
 * Retorna true se: modo=all, ou data dentro do range.
 * Retorna false se: modo=custom e sem data (item não entra no filtro).
 */
function dataNoIntervalo(date){
  const dr = App.dateRange;
  if(dr.mode === 'all') return true;        // sem filtro: passa tudo
  if(!date) return false;                    // sem data: não entra em período específico
  if(dr.from && date < dr.from) return false;  // antes do início: fora
  if(dr.to && date > dr.to) return false;      // depois do fim: fora
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
 *   - só tem fim → cai no comportamento de data única (dataNoIntervalo no fim)
 *   - sem nenhuma data → fora (contabilizado como "sem data")
 * Retorna 'in' | 'out' | 'nodate'.
 */
function ativoNoIntervalo(ini, fim){
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
 * Para itens que têm dtInicio (ex: Pipefy, Analytics), usa a lógica de "ativo no
 * período" (intervalo início→fim) — MAS só enquanto o item ainda está em
 * andamento. Um item já concluído (sc==='done') tem uma data de conclusão real
 * e fixa (dtFim); nesse caso o filtro passa a checar só se ESSA data cai no
 * período, com dataNoIntervalo. Se usássemos o intervalo inteiro também para
 * concluídos, um item que só passou pelo período em desenvolvimento e fechou
 * bem depois apareceria como "concluído no período" de forma enganosa — foi
 * exatamente essa distorção que causava o KPI "Concluídas" mostrar um número
 * maior que o gráfico de evolução (que sempre agrupa pelo mês real de dtFim).
 * Para os demais itens (sem dtInicio), usa a data única de dataReferencia.
 * Os itens sem data não são perdidos — ficam fora do recorte e o número é
 * exibido na nota de transparência da interface.
 */
function filtrarPorPeriodo(arr){
  if(App.dateRange.mode === 'all') return { kept: arr, noDate: 0 };
  const kept = [], noDate = [];
  arr.forEach(x => {
    if(x.dtInicio !== undefined && x.sc !== 'done'){
      // ainda em andamento: usa o intervalo início→fim (ativoNoIntervalo)
      const rangeStatus = ativoNoIntervalo(x.dtInicio, x.dtFim);
      if(rangeStatus === 'nodate') noDate.push(x);
      else if(rangeStatus === 'in') kept.push(x);
    } else {
      // já concluído (ou sem conceito de intervalo): data única de referência
      const date = dataReferencia(x);
      if(!date) noDate.push(x);
      else if(dataNoIntervalo(date)) kept.push(x);
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
function iconeKpi(nome){
  const path = _SVG[nome] || '';
  if(!path) return '';
  return `<svg class="kico" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
}
const HOJE  = new Date(); // data atual no momento do carregamento da página

/*
 * Converte o texto bruto de status (vindo da planilha) num código interno.
 * Isso normaliza variações de grafia ("Concluido" vs "Concluído"), sinônimos
 * e status específicos do GBS (Encerramento, Monitoramento).
 *
 * Fluxo de Projeto GBS:
 *   Diagnóstico → Planejamento → Execução → Encerramento → Monitoramento
 *   (nenhuma dessas fases é "done" — "done" só aparece quando o projeto
 *   realmente encerra)
 *
 * Mapeamento para o código interno:
 *   done    = realmente concluído (ainda não existe para projetos)
 *   doing   = em andamento / em desenvolvimento
 *   closing = em processo de encerramento (pode estar atrasado se o prazo passou)
 *   monitor = entregue, em monitoramento pós-implantação (não conta como atrasado)
 *   todo    = não iniciado / backlog / planejamento
 *   blocked = bloqueado / pausado
 *   cancel  = cancelado
 *   vendor  = encaminhado ao suporte do Pipefy (fornecedor externo)
 *   other   = qualquer valor não reconhecido
 */
function classeStatus(statusBruto){
  // Remove o prefixo numérico de ordenação, se houver.
  // Ex: "6. Encerramento" → "encerramento", "3 - Planejamento" → "planejamento"
  const normalizado = (statusBruto || '').toString().trim().toLowerCase().replace(/^\s*\d+\s*[.\-)]\s*/, '');

  if (['suporte pipefy', 'encaminhado ao fornecedor', 'pipefy'].includes(normalizado))
    return 'vendor';

  if (['concluído', 'concluido', 'finalizados', 'finalizado', 'tema concluído.', 'tema concluído'].includes(normalizado))
    return 'done';

  if (['em andamento', 'em execução', 'execução', 'execucao', 'desenvolvimento',
       'em validação', 'em validacao', 'aguardando validação', 'aguardando validacao'].includes(normalizado))
    return 'doing';

  if (['encerramento'].includes(normalizado))  return 'closing';
  if (['monitoramento'].includes(normalizado)) return 'monitor';

  if (['planejamento', 'diagnóstico', 'diagnostico', 'não iniciado', 'nao iniciado', 'backlog'].includes(normalizado))
    return 'todo';

  if (['bloqueado', 'pausado'].includes(normalizado))  return 'blocked';
  if (['cancelado'].includes(normalizado))             return 'cancel';

  return 'other';
}

/*
 * classeStatus específica para Melhorias (Pipefy_Melhorias).
 * Ali, "Planejamento" já é um item retirado do backlog (trabalho ativo),
 * então é contado junto com "doing" — é isso que alimenta a coluna
 * "Dev + Planej." do Overview e o KPI "Backlog" da aba Melhorias.
 * Não usar para Projetos/Analytics: lá "Planejamento" é a fase 2 do fluxo
 * (Diagnóstico→Planejamento→Execução...) e precisa continuar como 'todo'.
 */
function classeStatusMelhoria(statusBruto){
  const normalizado = (statusBruto || '').toString().trim().toLowerCase().replace(/^\s*\d+\s*[.\-)]\s*/, '');
  if (normalizado === 'planejamento') return 'doing';
  return classeStatus(statusBruto);
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

// Classe CSS do selo (badge) de cada status (ver CSS: .badge.ok, .badge.info, etc.)
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

// Cor sólida para os gráficos — paleta Saint-Gobain
const STATUS_COLOR = {
  done:    '#4DB1B3',  // verde-água    — concluído
  doing:   '#0195D6',  // azul claro    — em andamento
  closing: '#E66407',  // laranja       — encerramento
  monitor: '#0F5299',  // azul da marca — monitoramento
  todo:    '#9CA3AF',  // cinza         — não iniciado
  blocked: '#E83430',  // vermelho      — bloqueado
  cancel:  '#C5284C',  // rosa-vermelho — cancelado
  vendor:  '#8B6FD4',  // roxo          — suporte Pipefy
  other:   '#9CA3AF'   // cinza
};

/*
 * COE_TEAM — membros da equipe CoE, organizados pela área em que atuam.
 * Usado SÓ na aba Governança para filtrar "Ações abertas por responsável"
 * (mostra só a equipe interna; pessoas fora do CoE não aparecem nesse gráfico).
 *
 * Cada entrada tem uma lista 'match' de termos distintivos pra reconhecer
 * a pessoa nos dados, tolerando variações de grafia. Usamos deliberadamente
 * sobrenomes/termos únicos pra EVITAR confundir homônimos de primeiro nome
 * (ex: "Gustavo" também bateria com "Matheus Gustavo Germano", que não é do
 * CoE; por isso usamos "archangelo"). 'name' é o rótulo mostrado no gráfico.
 */
const COE_TEAM = [
  // --- Projetos ---
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
 * nomePadraoCoe(resp) — pega o nome do responsável como ele aparece nos
 * dados e, se for membro da equipe CoE, retorna o nome padronizado (rótulo).
 * Caso contrário retorna null.
 * Usa os termos 'match' de cada membro (sem diferenciar maiúsculas/minúsculas
 * nem acentos).
 */
function nomePadraoCoe(resp){
  if(!resp) return null;
  const normalizado = resp.toString().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,''); // remove acentos pra comparação
  for(const membro of COE_TEAM){
    for(const termo of membro.match){
      const termoNorm = termo.normalize('NFD').replace(/[\u0300-\u036f]/g,'');
      if(normalizado.includes(termoNorm)) return membro.name;
    }
  }
  return null;
}

/*
 * Número da fase no ciclo de vida de um Projeto GBS.
 * Quanto maior o número, mais perto da conclusão.
 * Fluxo: Diagnóstico(1) → Planejamento(2) → Execução(3) → Encerramento(4) → Monitoramento(5)
 * Retorna null para status fora do fluxo (cancelado, bloqueado).
 */
function faseProjeto(statusBruto){
  const normalizado = (statusBruto||'').toString().trim().toLowerCase();
  if(normalizado.includes('diagn')) return 1;
  if(normalizado.includes('planej')) return 2;
  if(normalizado.includes('execu')) return 3;
  if(normalizado.includes('encerr')) return 4;
  if(normalizado.includes('monitor')) return 5;
  if(normalizado.includes('conclu')) return 5;
  return null;
}

/*
 * projetoAtrasado(p) — true se o projeto tem prazo vencido e ainda não foi
 * entregue/cancelado. Considerados "não elegíveis a atraso": projetos
 * concluídos, em monitoramento (pós-implantação) ou cancelados.
 */
function projetoAtrasado(projeto){
  return !!(projeto.dtFim && projeto.dtFim < HOJE && projeto.sc!=='done' && projeto.sc!=='cancel' && projeto.sc!=='monitor');
}

/*
 * riscoProjeto(p) — score de risco automático (0 a 100) de um projeto.
 * Combina três fatores objetivos, sem precisar de campo manual na planilha:
 *   1) ATRASO (peso mais forte): dias após o prazo. Quanto mais atrasado, maior.
 *   2) FASE: projetos em fases iniciais (Diagnóstico/Planejamento) com prazo
 *      apertado são mais arriscados que os que já estão em Encerramento.
 *   3) PROXIMIDADE DO PRAZO: um prazo se aproximando (mesmo sem atraso) eleva o risco.
 * Projetos concluídos/cancelados/em monitoramento têm risco 0 (não estão mais "em jogo").
 * Retorna { score, level, reasons[] } — level ∈ {high, medium, low}.
 */
function riscoProjeto(projeto){
  if(projeto.sc==='done' || projeto.sc==='cancel' || projeto.sc==='monitor'){
    return { score:0, level:'low', reasons:[] };
  }
  let score = 0;
  const reasons = [];
  const fase = faseProjeto(projeto.statusRaw) || 2;

  // 1) Atraso — o fator mais forte. Um atraso significativo sozinho já empurra pro risco alto.
  if(projeto.dtFim){
    const dias = daysBetween(HOJE, projeto.dtFim);
    if(dias > 0){
      // 15 pontos base + ~1/dia, com teto em 70; ~40 dias já cruza o limiar de "alto"
      score += Math.min(70, 15 + dias*1.2);
      reasons.push(`${dias} ${dias===1?'dia':'dias'} de atraso`);
    } else {
      // 2) Proximidade do prazo (ainda não atrasado)
      const diasRestantes = -dias;
      if(diasRestantes <= 15){ score += 18; reasons.push(`prazo em ${diasRestantes} ${diasRestantes===1?'dia':'dias'}`); }
      else if(diasRestantes <= 30){ score += 10; reasons.push('prazo próximo'); }
    }
  } else {
    // sem prazo definido num projeto ativo = risco de falta de controle
    score += 14; reasons.push('sem prazo definido');
  }

  // 3) Fase — peso por estágio (fases mais iniciais = mais caminho pela frente = mais risco)
  if(projeto.sc==='blocked'){ score += 30; reasons.push('bloqueado'); }
  const pesoFase = {1:18, 2:14, 3:9, 4:4, 5:0}[fase] || 9;
  score += pesoFase;
  if(fase<=2 && projeto.sc!=='blocked') reasons.push(`fase inicial (${projeto.statusRaw})`);

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
    _animateNumber(el);
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
function handleDropzoneDragOver(event,id){ event.preventDefault(); document.getElementById(id).classList.add('over'); }
function handleDropzoneDragLeave(id){ document.getElementById(id).classList.remove('over'); }
function handleDropzoneDrop(event,type){
  event.preventDefault();
  document.getElementById('dz-'+type).classList.remove('over');
  const file = event.dataTransfer.files[0];
  if(file) readFile(file, type);
}

// File input handler (click on the file selection button)
function handleFileInputChange(input,type){ if(input.files[0]) readFile(input.files[0], type); }

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
 *
 * NORMALIZAÇÃO DE FUSO: tanto o SheetJS (com cellDates:true) quanto o parser de
 * string "AAAA-MM-DD" do JavaScript constroem a data como meia-noite em UTC.
 * Num fuso com offset negativo (Brasil, UTC-3), ler ano/mês/dia dessa data com
 * os métodos locais (getFullYear/getMonth/getDate) desloca o dia pra trás — o
 * dia 1º de um mês "vira" 21h do último dia do mês anterior, e todo agrupamento
 * por mês (evolução de melhorias, volume mensal de chamados RPA) fica errado
 * bem no primeiro dia de cada mês. Por isso, sempre que a data resultante cai
 * exatamente à meia-noite UTC (sinal de que é uma data pura, sem hora real),
 * reconstruímos como uma data LOCAL com os mesmos componentes de ano/mês/dia,
 * eliminando esse deslocamento em qualquer lugar do site que leia essa data.
 */
function toDate(rawValue){
  if(!rawValue) return null;
  let date;
  if(rawValue instanceof Date){
    date = isNaN(rawValue) ? null : rawValue;
  } else if(typeof rawValue === 'number'){
    date = new Date(Math.round((rawValue - EXCEL_EPOCH_OFFSET) * 864e5));
    if(isNaN(date)) date = null;
  } else if(typeof rawValue === 'string' && rawValue.length > 4){
    date = new Date(rawValue);
    if(isNaN(date)) date = null;
  } else {
    date = null;
  }
  if(!date) return null;
  // A hora nunca importa pra essas datas (são datas de negócio, não timestamps) —
  // por isso ignoramos qualquer componente de hora e reconstruímos direto a
  // partir do ano/mês/dia em UTC. Fazer essa normalização sempre, em vez de só
  // quando a hora bate exatamente meia-noite, evita escapar de casos em que o
  // serial do Excel chega com uma pequena imprecisão de ponto flutuante (ex:
  // 46579,999999998 em vez de 46580) e a hora não fica exatamente zerada.
  return new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

// Formats a Date as a "YYYY-MM" string (used as the monthly grouping key)
function toYearMonthKey(date){ return date ? `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}` : ''; }

// Converts "YYYY-MM" into a readable "Mmm/AA" label (ex: "2026-04" → "Abr/26")
function toYearMonthLabel(monthKey){
  if(!monthKey) return '';
  const partes = monthKey.split('-');
  return `${MESES[+partes[1]-1]}/${partes[0].slice(2)}`;
}

/*
 * Looks up a column's value in a SheetJS row, accepting multiple
 * possible names (since the column name can vary between spreadsheet versions).
 * The comparison is case-insensitive and ignores extra spaces.
 * Returns '' if none of the keys are found.
 */
function getColumnValue(row, keys){
  const rowKeys = Object.keys(row);
  for(const key of keys){
    for(const columnName of rowKeys){
      if(columnName.trim().toLowerCase() === key.toLowerCase()){
        const value = row[columnName];
        return value == null ? '' : value;
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
function calculatePercentage(value, total){ return total ? Math.round(value/total*100) : 0; }

// Converts a Date to a "YYYY-MM-DD" string (ISO format, used in date inputs).
// Defined here to avoid the duplicated `iso = d => ...` lambda in setQuickRange and generate().
function toIsoDate(date){ return date.toISOString().slice(0, 10); }

// Calculates the average of a numeric field across an array, ignoring nulls.
// Returns the value as a string with 1 decimal, or '—' if there's no data.
// Extracted from buildRPATickets() for reuse in other analysis modules.
function averageField(arr, campo){
  const valores = arr.filter(r => r[campo] != null).map(r => r[campo]);
  return valores.length ? (valores.reduce((soma, v) => soma + v, 0) / valores.length).toFixed(1) : '—';
}

// Normalizes a bot or process name for approximate (fuzzy) comparison.
// Strips bracketed prefixes (ex: "[P2P]"), lowercases, and
// removes anything that isn't a letter or digit.
// Used in enrichRPAWithArea(), buildBotsCruzamento() and analisarBots().
function normalizeBotName(name){ return name.toLowerCase().replace(/^\[.*?\]/, '').replace(/[^a-z0-9]/g, ''); }

// Main GBS business areas — used to filter RPA and bot charts.
// Secondary inventory areas (PAM, CI, IT, ARG, MEX etc.) are grouped into "Outros"
// to avoid cluttering the charts with low-volume slices.
const MAIN_RPA_AREAS = ['P2P', 'TAX', 'H2R', 'O2C', 'R2R'];

// Team responsible for developing Pipefy improvements (excludes requesters/champions).
// Used in construirMelhorias() to filter the "Por responsável" chart.
const PIPEFY_TEAM = ['willian', 'vinícius', 'vinicius', 'felipe', 'gustavo', 'caio'];
function isPipefyTeamMember(nome){ return PIPEFY_TEAM.some(p => nome.toLowerCase().includes(p)); }

// Calculates the number of days between two dates.
// Positive = date1 is more recent than date2 (ex: today - deadline = days overdue).
const MS_PER_DAY = 86_400_000;
const EXCEL_EPOCH_OFFSET = 25569; // days between 1900-01-01 (Excel epoch) and 1970-01-01 (Unix epoch)
function daysBetween(date1, date2){ return Math.round((date1 - date2) / MS_PER_DAY); }

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
 *   - Column names: each field tries multiple alternative names (see getColumnValue())
 *   - Projects layout: automatically detects whether the header is correct
 *     or shuffled (old layout), and reads by position as a fallback
 *
 * To add a new field: add the column name to the array in getColumnValue()
 * and map it to the normalized field in the object returned by .map().
 */
function parseGov(){
  const wb = App.gov;

  /* --- Pipefy_Melhorias --- */
  // Looks up the tab by name (flexible: accepts "pipefymelhorias" or "melhorias")
  const sMel = findSheet(wb,'pipefymelhorias') || findSheet(wb,'melhorias');
  App.P.improvements = sMel ? XLSX.utils.sheet_to_json(wb.Sheets[sMel], {defval:''}).map(r => {
    const sc = classeStatusMelhoria(getColumnValue(r, ['Status']));
    return {
      num:      getColumnValue(r, ['Numero']),
      frente:   String(getColumnValue(r, ['Gerencia'])).trim(),      // business area (P2P, O2C, etc.)
      fluxo:    getColumnValue(r, ['NomeFluxo']),                    // process flow name
      atividade:getColumnValue(r, ['Atividade']),                    // improvement description
      statusRaw:String(getColumnValue(r, ['Status'])).trim(),        // original status (spreadsheet text)
      sc,                                                            // normalized status ("Planejamento" counts as 'doing' here)
      resp:     String(getColumnValue(r, ['Responsavel'])).trim().replace(/​/g,''), // owner's name
      champion: String(getColumnValue(r, ['Champion'])).trim(),
      complex:  String(getColumnValue(r, ['Complexidade'])).trim(),
      tipo:     String(getColumnValue(r, ['TipoMelhoriaAjuste'])).trim(),
      // PERIOD FILTER — one column per field, no fallback:
      //   dtInicio → DataInicioDesenvolvimento
      //   dtFim    → DataRealEstimadaConclusaoValidacaoChampion, mas só para concluídas.
      //     Essa coluna guarda a data ESTIMADA enquanto a melhoria ainda não fechou e
      //     só passa a valer como data REAL depois que o champion valida a conclusão —
      //     por isso só é confiável como "data de conclusão" quando sc==='done'.
      //     Para as demais, ficaria fora do prazo real de forma enganosa, então fica null.
      // Neither one filled in = not-started backlog → always included (see construirMelhorias).
      dtInicio: toDate(getColumnValue(r, ['DataInicioDesenvolvimento'])),
      dtFim:    sc === 'done' ? toDate(getColumnValue(r, ['DataRealEstimadaConclusaoValidacaoChampion'])) : null,
      horas:    getColumnValue(r, ['QtdHorasEstimadas'])
    };
  }).filter(r => r.num !== '' || r.atividade) : []; // discards fully empty rows

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
    const criado = toDate(getColumnValue(r, ['Criado em']));
    const vencRaw = getColumnValue(r, ['Vencido']);
    const venc = vencRaw===true || String(vencRaw).toLowerCase()==='true' || String(vencRaw).toLowerCase()==='sim';
    return {
      cod:        String(getColumnValue(r, ['Código','Codigo'])).trim(),
      titulo:     String(getColumnValue(r, ['Título','Titulo'])).trim(),
      fase:       String(getColumnValue(r, ['Fase atual'])).trim(),
      processo:   String(getColumnValue(r, ['Processo'])).trim() || '(sem processo)',
      problema:   String(getColumnValue(r, ['Qual é o problema?'])).trim(),
      reexec:     String(getColumnValue(r, ['Este robô admite reexecução?'])).trim(),
      intext:     String(getColumnValue(r, ['O problema é interno ou externo?', 'Interno ou externo?', 'Causa interna ou externa?', 'Causa interna/externa'])).trim(),
      solicitante:String(getColumnValue(r, ['Nome do solicitante'])).trim(),
      // "Responsáveis" = who works the ticket (RPA CoE team), not who opened it.
      // Can have several names separated by commas; we store it as a list so we
      // can count each owner individually.
      responsaveis: String(getColumnValue(r, ['Responsáveis','Responsável']))
        .split(',').map(s=>s.trim()).filter(Boolean),
      criado,
      dtInicio: criado,                            // Criado em → start of the interval
      dtFim:    toDate(getColumnValue(r, ['Finalizado em'])), // Finalizado em → end of the interval
      mes: toYearMonthKey(criado),
      finalizado: toDate(getColumnValue(r, ['Finalizado em'])), // alias for display
      vencido:    venc,
      tIdent:  parseFloat(getColumnValue(r, ['Tempo total na fase Identificação do problema (dias)']))||null,
      tDesenv: parseFloat(getColumnValue(r, ['Tempo total na fase Desenvolvimento da solução (dias)']))||null,
      tReexec: parseFloat(getColumnValue(r, ['Tempo total na fase Reexecução (dias)']))||null
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
  const botAreas = App.B.filter(b=>b.nome && b.area).map(b => ({nomeNorm: normalizeBotName(b.nome), area:b.area}));
  App.R.forEach(r => {
    const procNorm = normalizeBotName(r.processo);
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
function _generateChartId(prefix) { return `ch-${prefix}-${++_chartSeq}`; }

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
    _animateNumber(el);
  });
}

/*
 * _animateNumber(el) — counts the number from 0 up to the displayed value over ~850ms.
 * Extracts the number from the text (int or float), animates with a cubic
 * ease-out, and restores the exact original text at the end.
 * Values smaller than 2 are skipped (0 and 1 don't need animating).
 */
function _animateNumber(el) {
  const raw   = el.textContent.trim();
  const match = raw.match(/^(\d+\.?\d*)(.*)/);
  if (!match) return;
  const target  = parseFloat(match[1]);
  const suffix  = match[2];
  const isFloat = match[1].includes('.');
  if (!target || target < 2) return;

  const duration = 850;
  const start    = performance.now();

  (function frame(now) {
    const progress = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3); // cubic ease-out: starts fast, decelerates
    el.textContent = (isFloat ? (target * eased).toFixed(1) : Math.round(target * eased)) + suffix;
    if (progress < 1) requestAnimationFrame(frame);
    else el.textContent = raw; // restores the exact text (avoids residual rounding)
  })(start);
}

// Global Chart.js defaults
Chart.defaults.font.family = "'Inter', system-ui, sans-serif";
Chart.defaults.font.size   = 11;
Chart.defaults.color       = '#6B7280';


// Saint-Gobain palette in hex (CSS vars don't work inside Chart.js)
const CHART_COLORS = {
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
function resolveColor(color) {
  const map = {
    'var(--brand)':  CHART_COLORS.brand,
    'var(--accent)': CHART_COLORS.accent,
    'var(--ok)':     CHART_COLORS.ok,
    'var(--warn)':   CHART_COLORS.warn,
    'var(--err)':    CHART_COLORS.err,
    'var(--info)':   CHART_COLORS.brand,
    'var(--neu)':    '#9CA3AF',
    'var(--ink)':    CHART_COLORS.ink,
    'var(--ink2)':   CHART_COLORS.ink2,
    'var(--ink3)':   CHART_COLORS.ink3,
    'var(--ink4)':   CHART_COLORS.ink4,
  };
  return map[color] || color;
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

  const id = _generateChartId('donut');

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
              label: ctx => ` ${ctx.label}: ${ctx.parsed}  (${calculatePercentage(ctx.parsed, total)}%)`
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
      <span class="dpct">${calculatePercentage(d.value, total)}%</span>
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
 * horizontalBars(entries, opts) — horizontal bars via Chart.js
 * entries: array of [label, value]
 * opts: { max, tot, color, showTotal, totLabel, lw }
 * lw: minimum Y-axis width (calculated automatically; opts.lw is used as an extra minimum).
 */
function horizontalBars(entries, opts = {}) {
  const items = entries.slice(0, opts.max || 10);
  if (!items.length) return '<div style="font-size:12px;color:var(--ink4)">Sem dados</div>';

  const id  = _generateChartId('hbar');
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
            grid:   { color: CHART_COLORS.rule },
            border: { display: false },
            ticks:  { display: false }
          },
          y: {
            grid:   { display: false },
            border: { display: false },
            ticks:  { color: CHART_COLORS.ink2, font: { size: 11 } },
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
          ctx.fillStyle    = CHART_COLORS.ink2;
          ctx.font         = `500 11px 'Inter', system-ui, sans-serif`;
          ctx.textAlign    = 'left';
          ctx.textBaseline = 'middle';
          // All labels stay aligned in the same X column (right after the longest bar)
          // avoids labels of short bars ending up in the middle of the chart
          const xBase = chartArea.right + 6;
          data.datasets[0].data.forEach((value, i) => {
            const bar   = meta.data[i];
            const label = tot
              ? `${value}  (${calculatePercentage(value, tot)}%)`
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
      const value = g.valores[s.key]||0;
      if(!value) return ''; // omits zeroed-out series within the group
      const widthPct = Math.round(value/maxVal*100);
      return `<div class="clu-bar-row">
        <span class="clu-bar-lbl" title="${String(s.label).replace(/"/g,'')}">${s.label}</span>
        <div class="clu-bar-track"><div class="clu-bar-fill" style="width:${widthPct}%;background:${s.color}"></div></div>
        <span class="clu-bar-val">${value}</span>
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

  const id = _generateChartId('line');

  _pendingCharts.push({
    id,
    config: {
      type: 'line',
      data: {
        labels: points.map(p => p.label),
        datasets: [{
          data:                 points.map(p => p.value),
          borderColor:          CHART_COLORS.brand,
          backgroundColor:      'rgba(15,82,153,0.07)',
          borderWidth:          2,
          pointRadius:          3,
          pointBackgroundColor: '#fff',
          pointBorderColor:     CHART_COLORS.brand,
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
            ticks:  { color: CHART_COLORS.ink4, font: { size: 9 }, maxTicksLimit: 8 }
          },
          y: {
            min:    opts.min ?? 0,
            max:    opts.max,
            grid:   { color: CHART_COLORS.rule },
            border: { display: false },
            ticks: {
              color:    CHART_COLORS.ink4,
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
 * verticalBarsChart(meses, porMes, porMesV) — stacked vertical bars of monthly volume.
 * Two datasets: normal tickets (brand blue) and overdue (red), stacked.
 * meses: array of ordered "YYYY-MM" keys
 * porMes / porMesV: objects { "YYYY-MM": count }
 */
function verticalBarsChart(meses, porMes, porMesV) {
  const id      = _generateChartId('vbar');
  const labels  = meses.map(m => toYearMonthLabel(m));
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
              color: CHART_COLORS.ink4, padding: 14,
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
            ticks:   { color: CHART_COLORS.ink4, font: { size: 9 } }
          },
          y: {
            stacked: true,
            grid:    { color: CHART_COLORS.rule },
            border:  { display: false },
            ticks:   { color: CHART_COLORS.ink4 }
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
   ABA: GOVERNANÇA (executiva)
   ============================================================
   A aba Governança é a visão unificada de todas as fontes.
   Combina Projetos + Melhorias Pipefy + Analytics + Chamados RPA
   num único conjunto de KPIs e gráficos.
   ============================================================ */

/*
 * todasAcoes() — junta as 4 fontes num único array de "ações".
 * Cada ação tem: source, sc (status normalizado), frente, owner,
 * dtFim (data de referência para filtros e gráficos) e campos específicos da fonte.
 *
 * Para Chamados RPA:
 *   - sc é derivado da fase atual (contém "conclu" → done, senão → doing)
 *   - dtFim = data de conclusão do chamado
 *   - criado = data de abertura (usada como fallback de dataReferencia)
 *   - vencido = flag booleana vinda do Pipefy
 */
function todasAcoes(){
  const saida = [];
  App.P.proj.forEach(p => saida.push({source:'Projetos', sc:p.sc, frente:p.frente, resp:p.resp, dtFim:p.dtFim, prog:p.prog, prio:null}));
  App.P.improvements.forEach(m => saida.push({source:'Pipefy', sc:m.sc, frente:m.frente, resp:m.resp, dtInicio:m.dtInicio, dtFim:m.dtFim, prog:null, prio:null}));
  App.P.ana.forEach(a => saida.push({source:'Analytics', sc:a.sc, frente:a.frente, resp:a.resp, dtInicio:a.dtInicio, dtFim:a.dtFim, prog:null, prio:a.prio}));
  App.R.forEach(r => saida.push({
    source:'Chamados RPA',
    sc: r.fase.toLowerCase().includes('conclu') ? 'done' : 'doing',
    // frente = área de negócio principal do bot (P2P, O2C, R2R, TAX, H2R), resolvida por enriquecerRPAComArea()
    // Áreas secundárias do inventário (Arg, CI, IT, PAM…) não são áreas de negócio → null
    frente: ['P2P','O2C','R2R','TAX','H2R'].includes(r.area) ? r.area : null,
    resp:r.solicitante,
    dtInicio:r.criado, dtFim:r.dtFim, criado:r.criado,
    prog:null, prio:null, vencido:r.vencido
  }));
  return saida;
}

// Versão filtrada: aplica o filtro global de data antes de retornar
function todasAcoesFiltradas(){
  return filtrarPorPeriodo(todasAcoes());
}

/*
 * construirGovernanca() — Painel de Controle (visão executiva).
 *
 * Lê:      App.P.improvements, App.P.proj, App.P.ana, App.R (todas as fontes)
 * Escreve: #gov-content
 * Chama:   todasAcoesFiltradas(), construirMapaCalor(), flushCharts()
 * Chamada por: generate() e renderAll() (quando o filtro de data muda)
 *
 * Produz:
 *  - KPIs de composição: Concluídas / Em andamento / Backlog / Outros
 *  - Donut de status unificado com um segmento "Impedimentos"
 *  - Barras por responsável (equipe CoE) e por área
 *  - Heatmap prioridade × área (Analytics)
 *  - Gráfico de linha da % concluída ao longo do tempo
 */
function construirGovernanca(){
  const qualquer = App.loaded.gov || App.loaded.rpa;
  document.getElementById('gov-empty').style.display = qualquer ? 'none' : 'block';
  document.getElementById('gov-content').style.display = qualquer ? 'block' : 'none';
  if(!qualquer) return;

  const {kept:acoes, noDate} = todasAcoesFiltradas();

  // Áreas disponíveis (só itens com uma área definida — chamados RPA não têm área)
  const todasFrentes = [...new Set(acoes.filter(a => a.frente).map(a => a.frente))].sort();
  // Valida: se a área guardada não existe mais nos dados atuais, reseta
  const frenteAtiva  = App.govFrente && todasFrentes.includes(App.govFrente) ? App.govFrente : '';
  if (!frenteAtiva) App.govFrente = '';
  const acoesFiltradas = frenteAtiva ? acoes.filter(a => a.frente === frenteAtiva) : acoes;

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
  // monta a descrição do que entra em "Outros" (só categorias com contagem > 0)
  const outrosDesc = [
    nCancel?`${nCancel} cancel.`:'',
    nBlocked?`${nBlocked} bloq.`:'',
    nMonitor?`${nMonitor} monit.`:'',
    nVendor?`${nVendor} suporte`:''
  ].filter(Boolean).join(' · ');

  // Aviso de filtro ativo — mostra o período, o total de ações no recorte e quantas ficaram de fora
  let notaData = '';
  if(App.dateRange.mode !== 'all'){
    const fmt = d => d ? d.toLocaleDateString('pt-BR') : '∞';
    notaData = `<div class="note" style="background:var(--neu-bg);color:var(--ink3)"><i class="ti ti-calendar-stats"></i><div>
      Período <b>${fmt(App.dateRange.from)} → ${fmt(App.dateRange.to)}</b>: <b>${total} ações</b> no recorte.`+
      (noDate>0 ? ` (${noDate} ações sem data não entram no filtro.)` : '')+
      ` Para ver tudo, limpe os campos de data no topo.
      <br><span style="font-size:10px;opacity:.6;font-style:italic">Referência por fonte: prazo de conclusão (Projetos) · início/conclusão do desenvolvimento (Pipefy) · data de abertura ou fechamento (Analytics) · data de abertura (RPA)</span>
      </div></div>`;
  }

  const fontes = ['Projetos','Pipefy','Analytics','Chamados RPA'];
  const porFonte = fontes.map(fonte => {
    const subAcoes = acoesFiltradas.filter(a => a.source === fonte);
    const subConcluidas = subAcoes.filter(a => a.sc === 'done').length;
    return {f: fonte, total: subAcoes.length, done: subConcluidas};
  }).filter(x => x.total > 0);

  // Chips de filtro por área — sem onclick inline, listeners adicionados depois do innerHTML
  const frenteChips = todasFrentes.length > 1
    ? `<div class="filters" id="gov-frente-chips" style="margin-bottom:16px">
        <span style="font-size:11px;color:var(--ink4);text-transform:uppercase;letter-spacing:.04em">Frente</span>
        <button class="chip${!frenteAtiva ? ' active' : ''}" data-gf="">Todas</button>
        ${todasFrentes.map(f =>
          `<button class="chip${frenteAtiva === f ? ' active' : ''}" data-gf="${f.replace(/"/g,'&quot;')}">${f}</button>`
        ).join('')}
      </div>` : '';


  // KPIs de composição
  let html = `<div class="sh">Painel de Controle — visão executiva</div>
  ${frenteChips}${notaData}
  ${barraAnalise('gov')}
  <div class="krow k5">
    <div class="kpi il">${iconeKpi('list')}<div class="knum">${total}</div><div class="klbl">Total de ações CoE</div>
      <div class="ksub">${fontes.filter(f=>acoes.some(a=>a.source===f)).length} fontes integradas</div></div>
    <div class="kpi gl">${iconeKpi('check')}<div class="knum">${calculatePercentage(done,total)}%</div><div class="klbl">Concluídas</div>
      <div class="ksub">${done} de ${total}</div></div>
    <div class="kpi">${iconeKpi('clock')}<div class="knum">${calculatePercentage(doing,total)}%</div><div class="klbl">Em andamento</div>
      <div class="ksub">${doing} de ${total}</div></div>
    <div class="kpi">${iconeKpi('stack')}<div class="knum">${calculatePercentage(backlog,total)}%</div><div class="klbl">Backlog / não iniciadas</div>
      <div class="ksub">${backlog} de ${total}</div></div>
    <div class="kpi">${iconeKpi('dots')}<div class="knum">${calculatePercentage(outros,total)}%</div><div class="klbl">Outros</div>
      <div class="ksub">${outrosDesc||'—'}</div></div>
  </div>`;


  // Donut de status — junta Encerramento + Monitoramento numa única fatia
  // ("Em encerramento" = fase final / entregue) e usa uma paleta deliberada:
  //   verde escuro = concluído · verde claro = encerramento (fase final) ·
  //   azul = em andamento · cinza = não iniciado · âmbar = bloqueado ·
  //   vermelho = cancelado · roxo = suporte fornecedor.
  // Ordenado do mais avançado/positivo pro menos. O total mostrado bate com
  // "Total de ações CoE" porque todo status está incluído.
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

  // Detalha o que compõe "Impedimentos" (só mostra categorias com valor > 0)
  const impedimentosDesc = [
    scAll.blocked ? `${scAll.blocked} bloqueado${scAll.blocked > 1 ? 's' : ''}` : '',
    scAll.cancel  ? `${scAll.cancel} cancelado${scAll.cancel  > 1 ? 's' : ''}` : '',
    scAll.vendor  ? `${scAll.vendor} suporte/fornec.`                           : '',
    scAll.other   ? `${scAll.other} outro${scAll.other > 1 ? 's' : ''}`         : '',
  ].filter(Boolean).join(' · ');

  // Total de ações por responsável da equipe CoE (TODAS — abertas, concluídas, canceladas).
  // Mostra SÓ a equipe CoE (ver COE_TEAM), somada pelo nome padronizado.
  // IMPORTANTE: cada fonte tem seu próprio campo de responsável:
  //   - Projetos/Pipefy/Analytics: campo 'resp' (1 responsável por item)
  //   - Chamados RPA: campo 'responsaveis' (lista — quem atende o chamado, não
  //     quem solicitou; um chamado pode ter vários responsáveis, cada um conta).
  // Respeita o filtro de período de cada fonte (filtrarPorPeriodo).
  const respCoE = {};
  const addResp = nomeBruto => {
    const nome = nomePadraoCoe(nomeBruto);
    if(nome) respCoE[nome] = (respCoE[nome]||0) + 1;
  };
  // Quando um filtro de área está ativo: filtra cada fonte por área; RPA não tem área → excluído
  filtrarPorPeriodo(App.P.proj).kept.filter(p => !frenteAtiva || p.frente === frenteAtiva).forEach(p => addResp(p.resp));
  filtrarPorPeriodo(App.P.improvements).kept.filter(m => !frenteAtiva || m.frente === frenteAtiva).forEach(m => addResp(m.resp));
  filtrarPorPeriodo(App.P.ana).kept.filter(a => !frenteAtiva || a.frente === frenteAtiva).forEach(a => addResp(a.resp));
  // RPA: sempre incluído (sem filtro), ou quando a área do bot bate com a área ativa
  filtrarPorPeriodo(App.R).kept.filter(r => !frenteAtiva || r.area === frenteAtiva).forEach(r => (r.responsaveis||[]).forEach(addResp));
  const respTop = Object.entries(respCoE).sort((a,b) => b[1]-a[1]);
  const totalRespCoE = respTop.reduce((s,e)=>s+e[1],0); // base pra porcentagem

  // "Por área" sempre mostra o panorama completo (acoes, não acoesFiltradas) pra comparação
  const frCount = count(acoes.filter(a => a.frente), a => a.frente);
  const fonteInfo = porFonte.map(x =>
    `<span><b style="color:var(--ink2)">${x.f}</b> ${x.total} <span style="color:var(--ink4)">(${calculatePercentage(x.done,x.total)}% concl.)</span></span>`
  ).join(' &thinsp;·&thinsp; ');
  html += `<div class="g3">
    <div class="card"><div class="card-title"><i class="ti ti-chart-pie"></i> Status das ações</div>
      ${donut(donutData)}
      ${impedimentosDesc ? `<div style="margin-top:10px;padding:7px 10px;background:rgba(197,40,76,0.07);border-radius:var(--r);font-size:11px;color:var(--err)">
        <b>Impedimentos:</b> ${impedimentosDesc}
      </div>` : ''}
      <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--rule);font-size:11px;color:var(--ink3);line-height:2">${fonteInfo}</div></div>
    <div class="card"><div class="card-title"><i class="ti ti-user-bolt"></i> Por responsável <span class="rt">equipe CoE</span></div>
      ${respTop.length ? horizontalBars(respTop, {max:12, lw:130, tot:totalRespCoE}) : '<div style="font-size:12px;color:var(--ink4)">Sem dados da equipe CoE.</div>'}</div>
    <div class="card"><div class="card-title"><i class="ti ti-building"></i> Por frente</div>
      ${horizontalBars(Object.entries(frCount).sort((a,b)=>b[1]-a[1]), {max:8, lw:60, tot:Object.values(frCount).reduce((s,v)=>s+v,0)})}</div>
  </div>`;

  // Rodapé de diagnóstico — mostra de onde vem cada número (trilha de auditoria).
  // Ajuda a identificar rapidamente se alguma fonte tem uma contagem inesperada.
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

  // Listeners dos chips de área — sem onclick inline, risco zero de escaping
  document.querySelectorAll('[data-gf]').forEach(btn => {
    btn.addEventListener('click', () => { App.govFrente = btn.dataset.gf; construirGovernanca(); });
  });

  flushCharts();
}


/*
 * construirMapaCalor() — heatmap das ações Analytics em aberto por prioridade × área.
 * Linhas = prioridades 1 a 4. Colunas = áreas.
 * Células com mais ações em aberto ficam mais vermelhas.
 * Só aparece se houver dados de Analytics com prioridade preenchida.
 */
function construirMapaCalor(){
  const {kept:anaF} = filtrarPorPeriodo(App.P.ana);
  const {kept:projF} = filtrarPorPeriodo(App.P.proj);
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
  const {kept:P, noDate} = filtrarPorPeriodo(App.P.proj);
  document.getElementById('proj-empty').style.display = (P.length||noDate) ? 'none' : 'block';
  document.getElementById('proj-content').style.display = (P.length||noDate) ? 'block' : 'none';
  if(!P.length && !noDate) return;

  // Contagens por código de status — respeitam o fluxo real do GBS
  const done    = P.filter(p => p.sc==='done').length;     // concluído (ainda não existe na base)
  const doing   = P.filter(p => p.sc==='doing').length;    // em execução
  // Encerramento + Monitoramento agrupados (ambos = projeto entregue / em fase final)
  const finalizando = P.filter(p => p.sc==='closing' || p.sc==='monitor').length;
  const atrasados = P.filter(projetoAtrasado);                // prazo vencido e não entregue
  const criticos = P.filter(p => riscoProjeto(p).level==='high').length; // risco alto

  const dnProj = App.dateRange.mode !== 'all'
    ? `<div class="note" style="background:var(--neu-bg);color:var(--ink3)"><i class="ti ti-calendar-stats"></i><div>
        Período aplicado: <b>${P.length} projetos</b> no recorte.${noDate > 0 ? ` ${noDate} sem prazo definido não entram no filtro.` : ''}
        <br><span style="font-size:10px;opacity:.6;font-style:italic">Referência de data: prazo de conclusão do projeto</span>
        </div></div>` : '';

  let html = `<div class="sh">Projetos</div>
  ${dnProj}
  ${barraAnalise('proj')}
  <div class="krow k5">
    <div class="kpi">${iconeKpi('folders')}<div class="knum">${P.length}</div><div class="klbl">Total</div></div>
    <div class="kpi il">${iconeKpi('play')}<div class="knum">${doing}</div><div class="klbl">Em execução</div></div>
    <div class="kpi gl">${iconeKpi('flag')}<div class="knum">${finalizando}</div><div class="klbl">Em fase final</div>
      <div class="ksub">encerramento / monit.</div></div>
    <div class="kpi dl">${iconeKpi('clock')}<div class="knum">${atrasados.length}</div><div class="klbl">Atrasados</div>
      <div class="ksub">prazo vencido</div></div>
    <div class="kpi wl">${iconeKpi('flame')}<div class="knum">${criticos}</div><div class="klbl">Risco alto</div>
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
      ${Object.keys(frCount).length ? horizontalBars(Object.entries(frCount).sort((a,b)=>b[1]-a[1]),{max:8,lw:80,tot:P.length}) : '<div style="font-size:12px;color:var(--ink4)">Sem dados de área</div>'}</div>
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
  const {kept: projetos} = filtrarPorPeriodo(App.P.proj);
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
    (!chips.atraso || projetoAtrasado(p)) &&
    (!chips.risco  || riscoProjeto(p).level==='high')
  );
  // ordena por score de risco (mais crítico primeiro); empate vai pelo mais avançado
  vis.sort((a,b) => {
    const scoreA = riscoProjeto(a).score, scoreB = riscoProjeto(b).score;
    if(scoreB !== scoreA) return scoreB - scoreA;
    return (b.prog||0) - (a.prog||0);
  });
  const cnt = document.getElementById('proj-count');
  if(cnt) cnt.textContent = `${vis.length} de ${projetos.length}`;
  if(!App.projOpen) App.projOpen = new Set();
  let itensProjeto = vis.map(p => {
    const badgeClass  = STATUS_BADGE[p.sc];
    const estaAtrasado = projetoAtrasado(p);
    const risco        = riscoProjeto(p); // { score, level, reasons }
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
 * projectDetails(project) — generates the HTML for a project's expanded details panel.
 * Only renders the field blocks that are filled in on the spreadsheet.
 * Empty fields don't show up (not even as an empty placeholder).
 * The layout is a 2-column grid (or 1 column on mobile).
 */
function projectDetails(project){
  const fmt = txt => String(txt||'').trim().replace(/\n/g,'<br>');
  const blocks = [];
  if(project.resp)        blocks.push({lbl:'Responsável',             val:project.resp});
  if(project.dtFim)       blocks.push({lbl:'Prazo de conclusão',      val:`${project.dtFim.toLocaleDateString('pt-BR')}${projetoAtrasado(project)?' &nbsp;<span style="color:var(--err)">⚠ prazo vencido</span>':''}`});
  if(project.descricao)   blocks.push({lbl:'Descrição',              val:fmt(project.descricao)});
  if(project.equipes)     blocks.push({lbl:'Equipes envolvidas',     val:fmt(project.equipes)});
  if(project.focal)       blocks.push({lbl:'Ponto focal',            val:project.focal});
  if(project.atvConcl)    blocks.push({lbl:'Atividades concluídas',  val:fmt(project.atvConcl)});
  if(project.atvAndam)    blocks.push({lbl:'Atividades em andamento',val:fmt(project.atvAndam)});
  if(project.proximos)    blocks.push({lbl:'Próximos passos',        val:fmt(project.proximos)});
  if(project.comentarios) blocks.push({lbl:'Comentários',           val:fmt(project.comentarios)});
  if(!blocks.length) return `<div class="proj-detail"><div style="font-size:12px;color:var(--ink4);font-style:italic">Sem detalhes preenchidos na planilha.</div></div>`;
  return `<div class="proj-detail">` + blocks.map(b =>
    `<div class="pd-block"><div class="pd-lbl">${b.lbl}</div><div class="pd-val">${b.val}</div></div>`
  ).join('') + `</div>`;
}


/*
 * construirGraficoEvolucaoMelhorias(M) — gráfico de linha: Concluídas × Backlog × Previsão.
 *
 * Linha 1 — Concluídas/mês: itens com sc='done' agrupados por dtFim
 * Linha 2 — Backlog/mês: reconstruído historicamente como
 *           itens_backlog_hoje + itens_concluidos_depois_daquele_mes
 * Linha 3 — Previsão (futuro): média dos últimos 3 meses projetada adiante
 *
 * Linha vertical tracejada vermelha marca o mês atual (divisor passado/futuro).
 * Retorna '' se não houver dados suficientes (< 3 meses com conclusões).
 */
// Calcula os dados das três séries do gráfico de evolução de melhorias.
// Retorna null se não houver dados suficientes (< 3 concluídas ou < 2 meses históricos).
function calcularDadosEvolucaoMelhorias(melhorias) {
  const concluidas = melhorias.filter(m => m.sc === 'done' && m.dtFim);
  if (concluidas.length < 3) return null;

  const porMes        = {};
  concluidas.forEach(m => { const chaveMes = toYearMonthKey(m.dtFim); porMes[chaveMes] = (porMes[chaveMes] || 0) + 1; });
  const mesAtual    = toYearMonthKey(HOJE);
  const mesesHistoricos = Object.keys(porMes).sort().filter(k => k <= mesAtual);
  if (mesesHistoricos.length < 2) return null;

  const avancarMes = chaveMes => {
    const [ano, mes] = chaveMes.split('-').map(Number);
    return mes === 12 ? `${ano + 1}-01` : `${ano}-${String(mes + 1).padStart(2, '0')}`;
  };

  // Prazo final = outubro do ano corrente (ou o seguinte, se outubro já passou)
  const [anoAtual, mesNum] = mesAtual.split('-').map(Number);
  const PRAZO_OUTUBRO = `${mesNum <= 10 ? anoAtual : anoAtual + 1}-10`;

  let fimIntervalo = mesAtual;
  for (let i = 0; i < 6; i++) fimIntervalo = avancarMes(fimIntervalo);
  if (fimIntervalo > PRAZO_OUTUBRO) fimIntervalo = PRAZO_OUTUBRO;

  const todosMeses = [];
  let atual = mesesHistoricos[0];
  while (atual <= fimIntervalo) { todosMeses.push(atual); atual = avancarMes(atual); }

  const itensBacklogAtual = melhorias.filter(m => m.sc === 'todo').length;
  const mesesFuturos      = todosMeses.filter(m => m >= mesAtual);
  const previsaoPorMes    = mesesFuturos.length > 0 ? Math.max(1, Math.round(itensBacklogAtual / mesesFuturos.length)) : 1;

  return {
    labels:         todosMeses.map(m => toYearMonthLabel(m)),
    currentIndex:   todosMeses.indexOf(mesAtual),
    currentTodoItems: itensBacklogAtual,
    futureMonths:     mesesFuturos,
    forecastPerMonth: previsaoPorMes,
    completedData: todosMeses.map(m => m <= mesAtual ? (porMes[m] || 0) : null),
    backlogData:   todosMeses.map(m => {
      if (m > mesAtual) return null;
      return itensBacklogAtual + concluidas.filter(c => toYearMonthKey(c.dtFim) > m).length;
    }),
    forecastData:  todosMeses.map(m => m >= mesAtual ? previsaoPorMes : null),
  };
}

// Plugins do Chart.js para o gráfico de evolução: rótulos dos pontos e a linha do mês atual.
function pluginsEvolucaoMelhorias(currentIndex) {
  const dataLabels = {
    id: 'dataLabels',
    afterDatasetsDraw(chart) {
      const { ctx, data } = chart;
      data.datasets.forEach((dataset, i) => {
        const meta = chart.getDatasetMeta(i);
        if (meta.hidden) return;
        const acima = i !== 2; // Previsão (i===2) fica embaixo pra evitar sobreposição
        meta.data.forEach((el, j) => {
          const value = dataset.data[j];
          if (value == null) return;
          ctx.save();
          ctx.fillStyle    = dataset.borderColor;
          ctx.font         = `bold 10px Inter, system-ui, sans-serif`;
          ctx.textAlign    = 'center';
          ctx.textBaseline = acima ? 'bottom' : 'top';
          ctx.fillText(value, el.x, el.y + (acima ? -5 : 5));
          ctx.restore();
        });
      });
    }
  };
  const linhaHoje = {
    id: 'todayLine',
    afterDraw(chart) {
      if (currentIndex < 0) return;
      const { ctx, chartArea, scales } = chart;
      const xPixel = scales.x.getPixelForValue(chart.data.labels[currentIndex]);
      ctx.save();
      ctx.beginPath();
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = CHART_COLORS.err;
      ctx.lineWidth   = 1.5;
      ctx.moveTo(xPixel, chartArea.top);
      ctx.lineTo(xPixel, chartArea.bottom);
      ctx.stroke();
      ctx.restore();
    }
  };
  return [dataLabels, linhaHoje];
}

function construirGraficoEvolucaoMelhorias(melhorias) {
  const evolucao = calcularDadosEvolucaoMelhorias(melhorias);
  if (!evolucao) return '';

  const { labels, currentIndex, currentTodoItems, futureMonths, forecastPerMonth,
          completedData, backlogData, forecastData } = evolucao;
  const id = _generateChartId('mel-evol');

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
            borderColor:         CHART_COLORS.ink,
            backgroundColor:     'transparent',
            borderWidth:         2,
            pointRadius:         4,
            pointBackgroundColor: CHART_COLORS.ink,
            tension:             0.1,
            spanGaps:            false,
          },
          {
            label:               'Backlog',
            data:                backlogData,
            borderColor:         CHART_COLORS.ink,
            backgroundColor:     'transparent',
            borderWidth:         2,
            borderDash:          [6, 4],
            pointRadius:         3,
            pointBackgroundColor: CHART_COLORS.ink,
            tension:             0.1,
            spanGaps:            false,
          },
          {
            label:               'Previsão',
            data:                forecastData,
            borderColor:         CHART_COLORS.err,
            backgroundColor:     'transparent',
            borderWidth:         1.5,
            pointRadius:         3,
            pointBackgroundColor: CHART_COLORS.err,
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
            labels: { color: CHART_COLORS.ink3, boxWidth: 20, boxHeight: 2, padding: 20, font: { size: 11 } }
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
            ticks:  { color: CHART_COLORS.ink4, font: { size: 10 }, maxTicksLimit: 14 }
          },
          y: {
            grid:   { color: CHART_COLORS.rule },
            border: { display: false },
            ticks:  { color: CHART_COLORS.ink4, font: { size: 10 } }
          }
        }
      },
      plugins: pluginsEvolucaoMelhorias(currentIndex)
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
 * visaoGeralPorArea(M) — tabela "Overview por categoria" da aba Pipefy Melhorias.
 *
 * Linhas  = áreas de negócio (P2P, O2C, TAX…), na ordem padrão + extras no final.
 * Colunas = Melhorias (total) + detalhamento por status.
 *
 * "Dev + Planej." e "Validação" são as duas fatias de sc='doing', diferenciadas pelo statusRaw:
 *   Validação    → statusRaw contém "validação" ou "aguardando"
 *   Dev + Planej → sc='doing' e não é validação
 */
function visaoGeralPorArea(melhorias) {
  const ehValidacao = melhoria => {
    const textoStatus = (melhoria.statusRaw || '').toLowerCase();
    return textoStatus.includes('validação') || textoStatus.includes('validacao') || textoStatus.includes('aguardando');
  };

  const COLUNAS = [
    { label: 'Melhorias',     fn: null,                                      cls: '' },
    { label: 'Backlog',       fn: m => m.sc === 'todo',                      cls: '' },
    { label: 'Dev + Planej.', fn: m => m.sc === 'doing' && !ehValidacao(m),  cls: '' },
    { label: 'Validação',     fn: m => ehValidacao(m),                      cls: '' },
    { label: 'Pipefy',        fn: m => m.sc === 'vendor',                    cls: '' },
    { label: 'Bloqueado',     fn: m => m.sc === 'blocked',                   cls: '' },
    { label: 'Concluídos',    fn: m => m.sc === 'done',                      cls: 'ov-done' },
    { label: 'Cancelados',    fn: m => m.sc === 'cancel',                    cls: 'ov-cancel' },
  ];

  const ORDEM  = ['COE','P2P','O2C','R2R','TAX','H2R'];
  const CORES = { COE:'#0195D6', P2P:'#E83430', O2C:'#4DB1B3', R2R:'#E66407', TAX:'#0F5299', H2R:'#8B6FD4' };

  const todasFrentes = [...new Set(melhorias.map(m => m.frente).filter(Boolean))];
  const frentes = [
    ...ORDEM.filter(f => todasFrentes.includes(f)),
    ...todasFrentes.filter(f => !ORDEM.includes(f)).sort(),
  ];
  if (!frentes.length) return '';

  const celula = value => value
    ? `<td>${value}</td>`
    : `<td class="ov-zero">—</td>`;

  const linhas = frentes.map(frente => {
    const itens = melhorias.filter(m => m.frente === frente);
    const cor   = CORES[frente] || 'var(--ink3)';
    const cols  = COLUNAS.map((c, i) => celula(i === 0 ? itens.length : itens.filter(c.fn).length)).join('');
    return `<tr>
      <td><span class="ov-badge" style="background:${cor}">${frente}</span></td>
      ${cols}
    </tr>`;
  }).join('');

  const totais = COLUNAS.map((c, i) =>
    `<td>${i === 0 ? melhorias.length : melhorias.filter(c.fn).length}</td>`
  ).join('');

  const cabecalhos = COLUNAS.map(c =>
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
        <thead><tr><th></th>${cabecalhos}</tr></thead>
        <tbody>${linhas}</tbody>
        <tfoot><tr>
          <td style="text-align:left">Total</td>
          ${totais}
        </tr></tfoot>
      </table>
    </div>
  </div>`;
}


/* ============================================================
   ABA: MELHORIAS PIPEFY
   ============================================================
   FILTRO DE DATA: usa DataConclusaoRealDesenvolvimento.
   A maioria das melhorias em backlog/planejamento NÃO tem essa data.
   Ao filtrar por período, elas ficam de fora — comportamento correto e documentado.
   Pra ver todas as melhorias, use o filtro de Status dentro da aba.
   ============================================================ */
/*
 * construirMelhorias() — aba Pipefy Melhorias.
 *
 * Lê:      App.P.improvements
 * Escreve: #mel-content
 * Chamada por: generate() e renderAll()
 *
 * ATENÇÃO — lógica especial de filtro de data:
 *   Usa dtInicio + dtFim (intervalo de desenvolvimento), não uma data única.
 *   Melhorias de backlog sem data são SEMPRE incluídas, mesmo com um
 *   filtro ativo (representam trabalho pendente, não histórico).
 *
 * Produz:
 *  - KPIs: total, concluídas, backlog, bloqueadas, fluxos distintos
 *  - Donut de status, barras por área, complexidade e responsável
 */
function construirMelhorias(){
  const {kept: melhoriasFiltradas} = filtrarPorPeriodo(App.P.improvements);
  // Backlog sem data = trabalho pendente, não histórico. Sempre incluído.
  const backlogSemData = App.dateRange.mode !== 'all'
    ? App.P.improvements.filter(m => !m.dtInicio && !m.dtFim && m.sc === 'todo')
    : [];
  const melhorias = [...melhoriasFiltradas, ...backlogSemData];
  document.getElementById('mel-empty').style.display  = App.P.improvements.length ? 'none' : 'block';
  document.getElementById('mel-content').style.display = App.P.improvements.length ? 'block' : 'none';
  if(!App.P.improvements.length) return;
  const sc      = statusCounts(melhorias);
  const done    = sc.done;
  const backlog = sc.todo;
  const blocked = sc.blocked;

  let notaData = '';
  if(App.dateRange.mode !== 'all'){
    notaData = `<div class="note" style="background:var(--neu-bg);color:var(--ink3)"><i class="ti ti-calendar-stats"></i><div>
      Período aplicado: <b>${melhorias.length} melhorias</b> no recorte${backlogSemData.length > 0 ? ` (inclui <b>${backlogSemData.length} backlog</b> sem data)` : ''}.
      <br><span style="font-size:10px;opacity:.6;font-style:italic">Referência de data: início e conclusão do desenvolvimento — inclui melhorias ativas no período, mesmo que iniciadas antes dele</span>
      </div></div>`;
  }

  // "Fluxos (processos)" = número de NomeFluxo distintos no recorte atual
  const fluxosUnicos = new Set(App.P.improvements.map(m => m.fluxo).filter(Boolean)).size;

  // Qualidade de dados: concluída sem dtFim = erro de preenchimento na planilha.
  // Itens não concluídos sem dtFim estão corretos (ainda em andamento/backlog).
  const concluidasSemData = App.P.improvements.filter(m => m.sc==='done' && !m.dtFim).length;

  let html = notaData + `<div class="sh">Pipefy — Melhorias & Ajustes</div>
  ${barraAnalise('mel')}
  <div class="krow k5">
    <div class="kpi">${iconeKpi('message')}<div class="knum">${App.P.improvements.length}</div><div class="klbl">Total melhorias</div>${App.dateRange.mode !== 'all' ? `<div class="ksub">${melhorias.length} no recorte</div>` : ''}</div>
    <div class="kpi gl">${iconeKpi('check')}<div class="knum">${done}</div><div class="klbl">Concluídas</div><div class="ksub">${calculatePercentage(done,App.P.improvements.length)}% do total</div></div>
    <div class="kpi">${iconeKpi('stack')}<div class="knum">${backlog}</div><div class="klbl">Backlog</div></div>
    <div class="kpi wl">${iconeKpi('lock')}<div class="knum">${blocked}</div><div class="klbl">Bloqueadas</div></div>
    <div class="kpi il">${iconeKpi('branch')}<div class="knum">${fluxosUnicos}</div><div class="klbl">Fluxos (processos)</div><div class="ksub">distintos no recorte</div></div>
  </div>
  ${concluidasSemData > 0 ? `<div class="note" style="background:var(--neu-bg);color:var(--ink3)"><i class="ti ti-alert-triangle" style="color:var(--warn)"></i><div>
    <b>${concluidasSemData} melhorias marcadas como concluídas não têm data de conclusão preenchida.</b>
    Isso é um erro de preenchimento na planilha — preencher o campo <i>DataConclusaoRealDesenvolvimento</i> permite análise temporal correta dessas entregas.
  </div></div>` : ''}`;

  html += `<div class="two">
    <div class="card"><div class="card-title"><i class="ti ti-chart-pie"></i> Status</div>
      ${donut(['done','doing','todo','vendor','blocked','cancel'].map(k=>({label:STATUS_PT[k],value:melhorias.filter(m=>m.sc===k).length,color:STATUS_COLOR[k]})).filter(d=>d.value), {total:App.P.improvements.length})}</div>
    <div class="card"><div class="card-title"><i class="ti ti-building"></i> Por frente</div>
      ${horizontalBars(sortedCountEntries(melhorias, m=>m.frente),{max:8,lw:60,tot:melhorias.length})}</div>
  </div>`;
  html += `<div class="two">
    <div class="card"><div class="card-title"><i class="ti ti-stack-2"></i> Por complexidade</div>
      ${horizontalBars(sortedCountEntries(melhorias.filter(m=>m.complex), m=>m.complex),{max:6,lw:90})}</div>
    <div class="card"><div class="card-title"><i class="ti ti-user-code"></i> Por responsável</div>
      ${(() => {
        const dados = sortedCountEntries(melhorias.filter(m=>m.resp && isPipefyTeamMember(m.resp)), m=>m.resp);
        return horizontalBars(dados,{max:8,lw:130});
      })()}</div>
  </div>`;
  html += construirGraficoEvolucaoMelhorias(melhorias);
  html += visaoGeralPorArea(melhorias);
  html += '<div id="mel-atividades"></div>';
  document.getElementById('mel-content').innerHTML = html;
  flushCharts();
  setBadge('nb-mel', melhorias.length, '');
  renderizarSecaoAtividadesMelhorias();
}


/* ============================================================
   MELHORIAS — REGISTRO MANUAL DE ATIVIDADES
   ============================================================
   Card "Atividades" no final da aba Pipefy Melhorias.

   Diferente do resto da aba (que vem inteiramente da planilha), esses
   registros são criados e mantidos manualmente pela equipe dentro do
   próprio site. Eles existem porque o acompanhamento apresentado para
   a gestão é organizado por tema/iniciativa (ex: "Anticipos v1",
   "Miscelaneas v1"), e esses temas não têm correspondência 1:1 com
   linhas da planilha Pipefy_Melhorias — então essa tabela não pode ser
   calculada a partir de App.P.improvements como o resto da aba.

   PERSISTÊNCIA:
   Records are saved to the browser's localStorage (key
   CHAVE_ARMAZENAMENTO_ATIVIDADES_MELHORIAS), not to any spreadsheet and not
   to a server — consistent with SYNAPSE's 100% local architecture (see
   README). Isso significa que:
     - Sobrevivem a recarregar a página e regerar o dashboard com uma
       planilha diferente (não dependem do Excel carregado).
     - Ficam restritos a este navegador/computador — não aparecem para
       quem abre o site em outra máquina.
     - São apagados se o usuário limpar os dados de navegação do site.

   Exportações (indiretamente, via window — ver o final do arquivo):
     renderizarSecaoAtividadesMelhorias() — chamada por construirMelhorias()
     abrirFormularioAtividade(activityId?)
     fecharFormularioAtividade()
     fecharFormularioAtividadeAoClicarFora(event)
     salvarFormularioAtividade(event)
     confirmarExclusaoAtividade(activityId)
   ============================================================ */

const CHAVE_ARMAZENAMENTO_ATIVIDADES_MELHORIAS = 'synapse.melhorias.atividades';

/*
 * Um registro na tabela "Atividades" da aba Pipefy Melhorias.
 *
 * @typedef {Object} ActivityRecord
 * @property {string} id            identificador único do registro
 * @property {string} tema          nome do tema/iniciativa (ex: "Anticipos v1")
 * @property {string} atividade     etapa atual (ex: "Em desenvolvimento")
 * @property {string} observacao    anotações livres sobre o andamento
 * @property {string} responsavel   pessoa ou equipe responsável
 */

/*
 * carregarAtividadesMelhorias()
 * Lê a lista de registros salvos do localStorage. Retorna um array
 * vazio tanto quando nunca foi salvo nada quanto quando o conteúdo
 * salvo está corrompido — nesse segundo caso o erro só é logado no
 * console, sem interromper o carregamento do dashboard.
 */
function carregarAtividadesMelhorias() {
  const conteudoSalvo = localStorage.getItem(CHAVE_ARMAZENAMENTO_ATIVIDADES_MELHORIAS);
  if (!conteudoSalvo) return [];

  try {
    const registrosSalvos = JSON.parse(conteudoSalvo);
    return Array.isArray(registrosSalvos) ? registrosSalvos : [];
  } catch (erroLeitura) {
    console.warn('Não foi possível ler as atividades salvas de Melhorias:', erroLeitura);
    return [];
  }
}

/*
 * salvarAtividadesMelhorias(registrosAtividades)
 * Escreve a lista completa de registros no localStorage. Não há
 * atualização parcial: toda operação de criar/editar/excluir relê a
 * lista inteira, muda o que precisa e escreve tudo de volta.
 */
function salvarAtividadesMelhorias(registrosAtividades) {
  localStorage.setItem(
    CHAVE_ARMAZENAMENTO_ATIVIDADES_MELHORIAS,
    JSON.stringify(registrosAtividades)
  );
}

/*
 * gerarIdAtividade()
 * Usa crypto.randomUUID() quando disponível. Como alternativa (navegadores
 * muito antigos ou contexto sem HTTPS), gera um id a partir do timestamp
 * atual + um número aleatório — suficiente aqui porque esses registros
 * nunca saem do navegador do próprio usuário.
 */
function gerarIdAtividade() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `atividade-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

/*
 * escaparTextoHtml(texto)
 * Os campos dessa tabela são texto livre digitado pelo usuário (especialmente
 * "Observação"). Sem escapar, caracteres como < e > quebrariam o HTML da
 * tabela ao renderizar. Passar por um elemento temporário é a forma padrão
 * do navegador fazer esse escape corretamente.
 */
function escaparTextoHtml(texto) {
  const elementoTemp = document.createElement('div');
  elementoTemp.textContent = texto || '';
  return elementoTemp.innerHTML;
}

/*
 * adicionarAtividadeMelhoria(dadosFormulario)
 * Cria um registro novo a partir dos dados do formulário e adiciona
 * à lista persistida.
 */
function adicionarAtividadeMelhoria(dadosFormulario) {
  const registros = carregarAtividadesMelhorias();
  registros.push({ id: gerarIdAtividade(), ...dadosFormulario });
  salvarAtividadesMelhorias(registros);
}

/*
 * atualizarAtividadeMelhoria(idAtividade, dadosFormulario)
 * Substitui os campos de um registro existente pelos novos valores do
 * formulário. Não faz nada se o id não for encontrado (o registro pode
 * ter sido excluído em outra aba do navegador, por exemplo).
 */
function atualizarAtividadeMelhoria(idAtividade, dadosFormulario) {
  const registros = carregarAtividadesMelhorias();
  const indiceRegistro = registros.findIndex(registro => registro.id === idAtividade);
  if (indiceRegistro === -1) return;

  registros[indiceRegistro] = { ...registros[indiceRegistro], ...dadosFormulario };
  salvarAtividadesMelhorias(registros);
}

/*
 * excluirAtividadeMelhoria(idAtividade)
 * Remove permanentemente um registro da lista persistida.
 */
function excluirAtividadeMelhoria(idAtividade) {
  const registrosRestantes = carregarAtividadesMelhorias()
    .filter(registro => registro.id !== idAtividade);
  salvarAtividadesMelhorias(registrosRestantes);
}

/*
 * construirLinhaTabelaAtividade(registro)
 * Gera uma linha <tr> para a tabela de atividades, com os botões de
 * editar e excluir na última coluna.
 */
function construirLinhaTabelaAtividade(registro) {
  return `<tr>
    <td>${escaparTextoHtml(registro.tema)}</td>
    <td>${escaparTextoHtml(registro.atividade)}</td>
    <td style="white-space:pre-wrap">${escaparTextoHtml(registro.observacao)}</td>
    <td>${escaparTextoHtml(registro.responsavel)}</td>
    <td style="text-align:right;white-space:nowrap">
      <button type="button" class="icon-button" title="Editar atividade" onclick="abrirFormularioAtividade('${registro.id}')"><i class="ti ti-pencil"></i></button>
      <button type="button" class="icon-button icon-button-perigo" title="Excluir atividade" onclick="confirmarExclusaoAtividade('${registro.id}')"><i class="ti ti-trash"></i></button>
    </td>
  </tr>`;
}

/*
 * construirFormularioAtividade()
 * Monta o modal (escondido por padrão) usado tanto pra criar quanto pra
 * editar um registro. O mesmo formulário serve os dois casos: o campo
 * oculto "campo-atividade-id" fica vazio ao criar e preenchido ao
 * editar — esse valor é o que salvarFormularioAtividade() usa pra decidir
 * entre adicionar ou atualizar.
 */
function construirFormularioAtividade() {
  return `<div class="modal-fundo oculto" id="fundo-formulario-atividade" onclick="fecharFormularioAtividadeAoClicarFora(event)">
    <div class="modal-caixa">
      <div class="modal-cabecalho">
        <span class="modal-titulo" id="titulo-formulario-atividade">Adicionar atividade</span>
        <button type="button" class="modal-botao-fechar" onclick="fecharFormularioAtividade()" aria-label="Fechar">×</button>
      </div>
      <form id="formulario-atividade" onsubmit="salvarFormularioAtividade(event)">
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
          <button type="button" class="btn" onclick="fecharFormularioAtividade()">Cancelar</button>
          <button type="submit" class="btn primary">Salvar</button>
        </div>
      </form>
    </div>
  </div>`;
}

/*
 * construirSecaoAtividadesMelhorias()
 * Monta o card "Atividades" inteiro: título, botão de adicionar, tabela
 * (ou mensagem de lista vazia) e o modal de criar/editar.
 */
function construirSecaoAtividadesMelhorias() {
  const registros = carregarAtividadesMelhorias();

  const corpoTabela = registros.length
    ? `<table class="tbl"><thead><tr>
         <th>Tema</th><th>Atividade</th><th>Observação</th><th>Responsável</th><th></th>
       </tr></thead>
       <tbody>${registros.map(construirLinhaTabelaAtividade).join('')}</tbody></table>`
    : `<div class="empty" style="padding:32px 20px"><i class="ti ti-clipboard-list"></i>Nenhuma atividade registrada ainda.</div>`;

  return `<div class="card">
    <div class="card-title">
      <i class="ti ti-clipboard-list"></i> Atividades
      <span class="rt">registro manual, salvo neste navegador</span>
    </div>
    <div style="margin-bottom:14px">
      <button type="button" class="btn primary" onclick="abrirFormularioAtividade()"><i class="ti ti-plus"></i> Adicionar atividade</button>
    </div>
    ${corpoTabela}
  </div>
  ${construirFormularioAtividade()}`;
}

/*
 * renderizarSecaoAtividadesMelhorias()
 * Recria só o conteúdo do container #mel-atividades. Chamada por
 * construirMelhorias() ao montar a aba, e de novo depois de qualquer
 * adição/edição/exclusão — sem precisar recalcular o resto dos KPIs
 * e gráficos da aba Melhorias.
 */
function renderizarSecaoAtividadesMelhorias() {
  const container = document.getElementById('mel-atividades');
  if (container) container.innerHTML = construirSecaoAtividadesMelhorias();
}

/*
 * abrirFormularioAtividade(idAtividade)
 * Sem argumento, abre o modal em branco (modo criação). Com o id de
 * um registro existente, abre o modal preenchido com os valores atuais
 * (modo edição).
 */
function abrirFormularioAtividade(idAtividade) {
  const registroExistente = idAtividade
    ? carregarAtividadesMelhorias().find(registro => registro.id === idAtividade)
    : null;

  document.getElementById('titulo-formulario-atividade').textContent =
    registroExistente ? 'Editar atividade' : 'Adicionar atividade';
  document.getElementById('campo-atividade-id').value         = registroExistente ? registroExistente.id : '';
  document.getElementById('campo-atividade-tema').value        = registroExistente ? registroExistente.tema : '';
  document.getElementById('campo-atividade-etapa').value       = registroExistente ? registroExistente.atividade : '';
  document.getElementById('campo-atividade-observacao').value  = registroExistente ? registroExistente.observacao : '';
  document.getElementById('campo-atividade-responsavel').value = registroExistente ? registroExistente.responsavel : '';

  document.getElementById('fundo-formulario-atividade').classList.remove('oculto');
}

/*
 * fecharFormularioAtividade()
 * Só esconde o modal — qualquer dado digitado é descartado, já que nada
 * é salvo antes do formulário ser enviado.
 */
function fecharFormularioAtividade() {
  document.getElementById('fundo-formulario-atividade').classList.add('oculto');
}

/*
 * fecharFormularioAtividadeAoClicarFora(event)
 * O modal cobre a tela inteira com um fundo escurecido
 * (#fundo-formulario-atividade) atrás da caixa branca. Clicar nesse
 * fundo fecha o modal; clicar dentro da caixa (ou nos campos) não deve
 * fechar — daí a checagem do alvo do clique.
 */
function fecharFormularioAtividadeAoClicarFora(event) {
  if (event.target.id === 'fundo-formulario-atividade') fecharFormularioAtividade();
}

/*
 * salvarFormularioAtividade(event)
 * Handler de submit do formulário do modal. Decide entre criar ou
 * atualizar com base no campo oculto "campo-atividade-id": vazio
 * significa um registro novo; preenchido significa editar um existente.
 */
function salvarFormularioAtividade(event) {
  event.preventDefault();

  const idAtividade = document.getElementById('campo-atividade-id').value;
  const dadosFormulario = {
    tema:        document.getElementById('campo-atividade-tema').value.trim(),
    atividade:   document.getElementById('campo-atividade-etapa').value.trim(),
    observacao:  document.getElementById('campo-atividade-observacao').value.trim(),
    responsavel: document.getElementById('campo-atividade-responsavel').value.trim()
  };

  if (idAtividade) atualizarAtividadeMelhoria(idAtividade, dadosFormulario);
  else adicionarAtividadeMelhoria(dadosFormulario);

  fecharFormularioAtividade();
  renderizarSecaoAtividadesMelhorias();
}

/*
 * confirmarExclusaoAtividade(idAtividade)
 * Pede confirmação nativa do navegador antes de excluir. Não há lixeira
 * nem "desfazer" pra esses registros — daí a confirmação explícita.
 */
function confirmarExclusaoAtividade(idAtividade) {
  const usuarioConfirmou = window.confirm('Excluir esta atividade? Essa ação não pode ser desfeita.');
  if (!usuarioConfirmou) return;

  excluirAtividadeMelhoria(idAtividade);
  renderizarSecaoAtividadesMelhorias();
}


/* ============================================================
   VIEW: ANALYTICS
   ============================================================
   DATE FILTER: uses DataAbertura (start of development)
   or DataFechamento (end of validation) as a fallback.
   Many activities have no date filled in — the interface shows how many were excluded.
   ============================================================ */
/*
 * buildAnalytics() — Analytics tab.
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
 *  - Priority × area heatmap (via construirMapaCalor(), called directly here)
 */
function buildAnalytics(){
  const {kept:A, noDate} = filtrarPorPeriodo(App.P.ana);
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
  ${barraAnalise('ana')}
  <div class="krow">
    <div class="kpi">${iconeKpi('chartbar')}<div class="knum">${A.length}</div><div class="klbl">Total</div></div>
    <div class="kpi gl">${iconeKpi('check')}<div class="knum">${done}</div><div class="klbl">Concluídas</div><div class="ksub">${calculatePercentage(done,A.length)}%</div></div>
    <div class="kpi il">${iconeKpi('clock')}<div class="knum">${doing}</div><div class="klbl">Em andamento</div></div>
    <div class="kpi">${iconeKpi('minus')}<div class="knum">${todo}</div><div class="klbl">Não iniciadas</div></div>
  </div>`;
  html += `<div class="g3">
    <div class="card"><div class="card-title"><i class="ti ti-chart-pie"></i> Status</div>
      ${donut(['done','doing','todo','blocked','cancel'].map(k=>({label:STATUS_PT[k],value:A.filter(a=>a.sc===k).length,color:STATUS_COLOR[k]})).filter(d=>d.value))}</div>
    <div class="card"><div class="card-title"><i class="ti ti-flag"></i> Por prioridade</div>
      ${horizontalBars(Object.entries(prioCount).sort((a,b)=>{const na=+a[0].match(/\d+/),nb=+b[0].match(/\d+/);return na-nb;}),{max:10,lw:90})}</div>
    <div class="card"><div class="card-title"><i class="ti ti-building"></i> Por frente</div>
      ${horizontalBars(sortedCountEntries(A.filter(a=>a.frente), a=>a.frente),{max:8,lw:60,tot:A.length})}</div>
  </div>`;
  html += `<div class="two">
    <div class="card"><div class="card-title"><i class="ti ti-user"></i> Por responsável</div>
      ${horizontalBars(sortedCountEntries(A.filter(a=>a.resp), a=>a.resp),{max:8,lw:140})}</div>
    ${construirMapaCalor()}
  </div>`;
  document.getElementById('ana-content').innerHTML = html;
  flushCharts();
  setBadge('nb-ana', A.length, '');
}

// Helper: atualiza o badge numérico de uma aba no menu de navegação
function setBadge(id, txt, cls){
  const element = document.getElementById(id);
  if(element){ element.textContent=txt; element.className='nb'+(cls?' '+cls:''); }
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
  const {kept: chamados, noDate} = filtrarPorPeriodo(App.R);
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

  let htmlVisao = dateNote + barraAnalise('rpa') + filtroStatus + `<div id="rpa-visao-kpis"></div>`;
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
    const area = areaPorProc[proc];
    return area && area !== '(não mapeada)' ? `${proc}  ·  ${area}` : proc;
  };
}

function buildRPATabTopBots(chamados, labelComArea) {
  const procList = sortedCountEntries(chamados, r => r.processo)
    .filter(([proc]) => proc !== '(sem processo)')
    .map(([proc, n]) => [labelComArea(proc), n]);
  document.getElementById('rpage-bots').innerHTML =
    `<div class="card"><div class="card-title"><i class="ti ti-trophy"></i> Top bots por nº de manutenções<span class="rt">${procList.length} processos</span></div>
      ${horizontalBars(procList,{max:15,lw:300,color:'var(--err)',fixedLabel:true})}</div>`;
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
    ${horizontalBars(procAvg,{max:12,lw:200,color:'var(--warn)'})}${notaTempoMedio}</div>`;

  let html = `<div class="krow">
    <div class="kpi">${iconeKpi('clock')}<div class="knum sm">${averageField(chamados,'tIdent')}</div><div class="klbl">Média dias · Identificação</div></div>
    <div class="kpi">${iconeKpi('clock')}<div class="knum sm">${averageField(chamados,'tDesenv')}</div><div class="klbl">Média dias · Desenvolvimento</div></div>
    <div class="kpi">${iconeKpi('clock')}<div class="knum sm">${averageField(chamados,'tReexec')}</div><div class="klbl">Média dias · Reexecução</div></div>
    <div class="kpi">${iconeKpi('chartbar')}<div class="knum sm">${chamados.filter(r=>r.tIdent!=null||r.tDesenv!=null).length}</div><div class="klbl">Chamados com tempo medido</div></div>
  </div>`;
  if (procUm.length) {
    html += `<div class="two">${cardTempoMedio}<div class="card"><div class="card-title"><i class="ti ti-clock-hour-4"></i> Bots com 1 chamado<span class="rt">dias · ${procUm.length} bots</span></div>
      ${horizontalBars(procUm,{max:20,lw:200,color:'#5aa0a0'})}
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
  const {kept: chamadosFiltrados} = filtrarPorPeriodo(App.R);   // já filtrado pelo período global
  const faseSelecionada = document.getElementById('rpa-fs')?.value || '';
  const chamados = faseSelecionada ? chamadosFiltrados.filter(r => r.fase === faseSelecionada) : chamadosFiltrados;

  const total      = chamados.length;
  const venc       = chamados.filter(r => r.vencido).length;
  const concl      = chamados.filter(r => r.fase.toLowerCase().includes('conclu')).length;
  const abertos    = total - concl;
  const reexec     = chamados.filter(r => r.problema.toLowerCase().includes('reexecu')).length;
  const pctVenc    = calculatePercentage(venc, total);
  const procUnicos = new Set(chamados.map(r => r.processo).filter(p => p && p !== '(sem processo)')).size;

  const cnt = document.getElementById('rpa-fs-count');
  if(cnt) cnt.textContent = faseSelecionada ? `${total} chamados em "${faseSelecionada}"` : `${total} chamados`;

  let htmlKpis = `<div class="krow k5">
    <div class="kpi">${iconeKpi('ticket')}<div class="knum">${total}</div><div class="klbl">Total chamados</div><div class="ksub">${procUnicos} processos distintos</div></div>
    <div class="kpi gl">${iconeKpi('check')}<div class="knum">${concl}</div><div class="klbl">Concluídos</div><div class="ksub">${calculatePercentage(concl,total)}%</div></div>
    <div class="kpi il">${iconeKpi('clock')}<div class="knum">${abertos}</div><div class="klbl">Abertos</div></div>
    <div class="kpi dl">${iconeKpi('alert')}<div class="knum">${venc}</div><div class="klbl">Vencidos</div><div class="ksub">${pctVenc}% do total</div></div>
    <div class="kpi wl">${iconeKpi('refresh')}<div class="knum">${reexec}</div><div class="klbl">Reexecuções</div></div>
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
  const vol   = verticalBarsChart(meses, porMes, porMesV);

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
    ${horizontalBars(areaEntries,{max:12,lw:120,tot:total,fixedLabel:true})}</div>`;

  document.getElementById('rpa-visao-kpis').innerHTML = htmlKpis;
  flushCharts();
}

/*
 * renderRPAList() — renders the paginated ticket list.
 * Applies the global date filter + text search.
 * Shows up to 1000 tickets; warns if there are more.
 */
function renderRPAList(){
  const {kept: chamados} = filtrarPorPeriodo(App.R);
  const query = (document.getElementById('rsearch')?.value||'').toLowerCase();
  const vis = query ? chamados.filter(r=>(r.cod+r.processo+r.solicitante+r.problema).toLowerCase().includes(query)) : chamados;
  const cnt = document.getElementById('rlista-count');
  if(cnt) cnt.textContent = vis.length+' chamados';
  let linhasChamados = vis.slice(0,1000).map(r => {
    const concl = r.fase.toLowerCase().includes('conclu');
    return `<tr>
      <td style="padding-left:20px;font-family:monospace;font-size:11px;color:var(--ink3)">${r.cod}</td>
      <td style="font-size:11px">${r.processo}</td>
      <td style="font-size:11px;color:var(--ink3)">${r.problema}</td>
      <td><span class="badge ${concl?'ok':'info'}" style="font-size:9px">${r.fase}</span></td>
      <td style="font-size:11px;color:var(--ink4)">${toYearMonthLabel(r.mes)}</td>
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
  let bots = App.B;
  let dateNote = '';
  if(dr.mode !== 'all'){
    const yFrom = dr.from ? dr.from.getFullYear() : null;
    const yTo   = dr.to   ? dr.to.getFullYear()   : null;
    bots = App.B.filter(b => {
      const prdYear = parseInt(b.anoPrd);
      if(isNaN(prdYear)) return false;            // sem AnoPRD: fica fora do filtro
      if(yFrom!=null && prdYear<yFrom) return false;
      if(yTo!=null   && prdYear>yTo)   return false;
      return true;
    });
    const semAno = App.B.filter(b => isNaN(parseInt(b.anoPrd))).length;
    dateNote = `<div class="note" style="background:var(--neu-bg);color:var(--ink3)"><i class="ti ti-calendar-stats"></i><div>
      Período aplicado: <b>${bots.length} bots</b> que entraram em produção entre ${yFrom||'∞'} e ${yTo||'∞'}.` +
      (semAno>0 ? ` ${semAno} bots sem ano de PRD não entram no filtro.` : '') +
      `<br><span style="font-size:10px;opacity:.6;font-style:italic">Referência de data: ano de entrada em produção (AnoPRD) — filtra por ano, não por data exata</span>
      </div></div>`;
  }
  document.getElementById('bots-empty').style.display  = App.B.length ? 'none' : 'block';
  document.getElementById('bots-content').style.display = App.B.length ? 'block' : 'none';
  if(!App.B.length) return;

  const prd       = bots.filter(b=>b.status==='PRD').length;
  const dev       = bots.filter(b=>b.status==='DEV').length;
  const backlog   = bots.filter(b=>b.status==='BACKLOG').length;
  const cancel    = bots.filter(b=>b.status==='CANCELADO'||b.status==='DESATIVADO').length;

  let html = dateNote + `<div class="sh">Inventário de Bots — RPA</div>
  ${barraAnalise('bots')}
  <div class="krow">
    <div class="kpi">${iconeKpi('robot')}<div class="knum">${bots.length}</div><div class="klbl">Total de bots</div></div>
    <div class="kpi gl">${iconeKpi('rocket')}<div class="knum">${prd}</div><div class="klbl">Em produção</div><div class="ksub">${calculatePercentage(prd,bots.length)}% do total</div></div>
    <div class="kpi wl">${iconeKpi('code')}<div class="knum">${dev}</div><div class="klbl">Em desenvolvimento</div></div>
    <div class="kpi">${iconeKpi('stack')}<div class="knum">${backlog}</div><div class="klbl">Backlog</div></div>
  </div>`;

  const prdBots = bots.filter(b=>b.status==='PRD');
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
      ${horizontalBars(areaBots,{max:6,lw:60,tot:prd})}</div>
    <div class="card"><div class="card-title"><i class="ti ti-world"></i> Por perímetro</div>
      ${donut(Object.entries(count(prdBots,b=>b.perimetro)).map(([k,v],i)=>({label:k,value:v,color:['var(--info)','var(--ok)','var(--warn)','var(--err)'][i%4]})))}</div>
  </div>`;
  html += `<div class="two">
    <div class="card"><div class="card-title"><i class="ti ti-alert-octagon"></i> Por criticidade</div>
      ${horizontalBars([1,2,3,4].map(c=>['Criticidade '+c,prdBots.filter(b=>b.criticidade===c).length]).filter(e=>e[1]),{max:4,lw:100})}
      <div class="note" style="margin-top:14px;margin-bottom:0;background:var(--neu-bg);color:var(--ink3)"><i class="ti ti-info-circle"></i><div>
        <b>Critérios de criticidade:</b><br>
        <b>1 — Crítica:</b> processo essencial; falha gera impacto financeiro/fiscal imediato ou para a operação.<br>
        <b>2 — Alta:</b> processo importante com prazo sensível; falha causa atraso relevante.<br>
        <b>3 — Média:</b> processo recorrente; falha tem impacto moderado e contornável.<br>
        <b>4 — Baixa:</b> processo de apoio; falha tem baixo impacto e pode esperar.</div></div></div>
    <div class="card"><div class="card-title"><i class="ti ti-repeat"></i> Por frequência</div>
      ${horizontalBars(sortedCountEntries(prdBots.filter(b=>b.freq), b=>b.freq),{max:6,lw:80})}</div>
  </div>`;

  // Inventory × tickets cross-reference (only if the RPA report is loaded)
  if(App.R.length) html += buildBotsCruzamento(bots);

  // List filtered by status and area
  html += `<div class="filters" style="margin-top:8px">
    <label>Status</label><select id="bot-fs" onchange="renderBotsList()"><option value="">Todos</option>
      <option>PRD</option><option>DEV</option><option>BACKLOG</option><option>CANCELADO</option><option>DESATIVADO</option></select>
    <label>Área</label><select id="bot-fa" onchange="renderBotsList()"><option value="">Todas</option>
      ${[...new Set(bots.map(b=>b.area))].filter(Boolean).sort().map(a=>`<option>${a}</option>`).join('')}</select></div>
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
  const norm = normalizeBotName;
  const {kept:Rf} = filtrarPorPeriodo(App.R); // also applies the date filter to the tickets
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
      const prdYear = parseInt(b.anoPrd);
      if(isNaN(prdYear)) return false;
      if(yFrom!=null && prdYear<yFrom) return false;
      if(yTo!=null   && prdYear>yTo)   return false;
      return true;
    });
  }
  if(!App.botsOpen) App.botsOpen = new Set();
  let bots = source.filter(b => (!filterStatus||b.status===filterStatus) && (!filterArea||b.area===filterArea));
  const sb = {PRD:'ok', DEV:'info', BACKLOG:'neu', CANCELADO:'red', DESATIVADO:'red'};
  const botDot = {PRD:'#4DB1B3', DEV:'#0195D6', BACKLOG:'#9CA3AF', CANCELADO:'#C5284C', DESATIVADO:'#E83430'};
  const critLabel = {1:'Crítica',2:'Alta',3:'Média',4:'Baixa'};
  const critBadge = {1:'err',2:'warn',3:'neu',4:'neu'};
  let itensBots = bots.slice(0,200).map(b => {
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
  if(bots.length>200) itensBots += `<div class="icard" style="justify-content:center;color:var(--ink4);font-size:12px">Exibindo 200 de ${bots.length}</div>`;
  const listaBots = document.getElementById('bots-list');
  if(listaBots) listaBots.innerHTML = itensBots || '<div class="empty" style="padding:24px">Nenhum bot neste filtro</div>';
}


function toggleBot(key){
  if(!App.botsOpen) App.botsOpen = new Set();
  if(App.botsOpen.has(key)) App.botsOpen.delete(key);
  else App.botsOpen.add(key);
  renderBotsList();
}

function botDetails(bot){
  const row = (lbl, val) => val ? `<div class="pd-block"><div class="pd-lbl">${lbl}</div><div class="pd-val">${val}</div></div>` : '';
  const critDesc = {1:'Falha gera impacto financeiro/fiscal imediato ou para a operação.',2:'Processo com prazo sensível — falha causa atraso relevante.',3:'Falha tem impacto moderado e contornável.',4:'Processo de apoio — falha tem baixo impacto.'};
  const critTxt = bot.criticidade ? `${bot.criticidade} — ${['Crítica','Alta','Média','Baixa'][bot.criticidade-1]||''}: ${critDesc[bot.criticidade]||''}` : '';
  return `<div class="proj-detail">
    ${row('Desenvolvedor', bot.dev)}
    ${row('Suporte / Sustentação', bot.suporte)}
    ${row('Descrição', bot.desc)}
    ${row('Área cliente', bot.areaCliente)}
    ${row('Sistema SAP', bot.sap)}
    ${row('Criticidade', critTxt)}
    ${row('FTEs economizados', bot.fte ? bot.fte+' FTE' : '')}
    ${row('Volumetria mensal', bot.vol ? bot.vol.toLocaleString('pt-BR')+' transações/mês' : '')}
    ${row('Nº de robôs', bot.nBots ? String(bot.nBots) : '')}
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

  const year = HOJE.getFullYear();
  const month = HOJE.getMonth();
  let from, to;
  if(mode==='month'){
    from = new Date(year, month, 1);
    to   = new Date(year, month+1, 0); // last day of the current month
  } else if(mode==='quarter'){
    const quarter = Math.floor(month/3);  // 0,1,2,3
    from = new Date(year, quarter*3, 1);
    to   = new Date(year, quarter*3+3, 0); // last day of the quarter
  } else if(mode==='year'){
    from = new Date(year, 0, 1);
    to   = new Date(year, 11, 31);
  }
  const iso = toIsoDate;
  document.getElementById('df-from').value = iso(from);
  document.getElementById('df-to').value   = iso(to);
  // marks the active chip
  ['month','quarter','year'].forEach(k=>{
    const chip = document.getElementById('dfc-'+k);
    if(chip) chip.classList.toggle('active', k===mode);
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
      const chip=document.getElementById('dfc-'+k); if(chip) chip.classList.remove('active');
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
    const chip=document.getElementById('dfc-'+k); if(chip) chip.classList.remove('active');
  });
  applyDateFilter();
}

/*
 * renderAll() — redraws every tab with the current state (filters included).
 * Called whenever the date filter changes.
 * Each build*() function applies the date filter internally before calculating.
 */
function renderAll(){
  construirGovernanca();
  if(App.P.proj.length) buildProjects();
  if(App.P.improvements.length) construirMelhorias();
  if(App.P.ana.length) buildAnalytics();
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
   ANÁLISE AUTOMÁTICA ("IA" de insights calculados)
   ============================================================
   Gera leituras analíticas a partir dos dados, 100% no navegador —
   nada é enviado a nenhum servidor. Isso não é um modelo de linguagem:
   são análises programadas (concentração, tendência, gargalos, outliers)
   que produzem frases dinâmicas, sempre recalculadas de acordo com a
   planilha e o filtro de período ativo.

   Cada aba tem uma função analisar<Aba>() que retorna uma lista de
   observações no formato { type, text }, onde type ∈ {pos, neg, warn, neu}
   controla a cor/ícone. gerarAnalise() monta o painel e barraAnalise() o botão.
   ============================================================ */

// Ícone (SVG inline) do botão "faísca/análise" — não depende de fonte externa
const FAISCA_IA = '<svg class="ai-spark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2z"/></svg>';

/*
 * barraAnalise(aba) — gera o HTML do botão "Gerar análise" de uma aba.
 * O id do container do painel é ai-panel-<aba>, preenchido por gerarAnalise().
 */
function barraAnalise(aba){
  return `<div class="ai-bar">
    <button class="ai-btn" id="ai-btn-${aba}" onclick="gerarAnalise('${aba}')">${FAISCA_IA} Gerar análise</button>
    <span class="ai-hint">leitura automática dos números deste recorte · 100% local</span>
  </div><div id="ai-panel-${aba}"></div>`;
}

/*
 * gerarAnalise(aba) — calcula as observações da aba e renderiza o painel.
 * Mostra um estado breve de "analisando" (puramente visual) e depois o resultado.
 * Clicar de novo recolhe o painel (toggle).
 */
function gerarAnalise(aba){
  const painel = document.getElementById('ai-panel-'+aba);
  const botao = document.getElementById('ai-btn-'+aba);
  if(!painel) return;
  // toggle: se já está aberto, recolhe
  if(painel.dataset.open === '1'){
    painel.innerHTML = ''; painel.dataset.open = '0';
    return;
  }
  if(botao) botao.classList.add('loading');
  // pequeno atraso só pra dar uma sensação de processamento (não bloqueia nada)
  setTimeout(() => {
    const funcao = {
      gov: analisarGovernanca, proj: analisarProjetos, mel: analisarMelhorias,
      ana: analisarAnalytics, rpa: analisarRPA, bots: analisarBots
    }[aba];
    const observacoes = (funcao ? funcao() : []).filter(Boolean);
    const corpo = observacoes.length
      ? observacoes.map(i => `<div class="ai-item ${i.type}"><div class="ai-ico">${i.ico||'•'}</div><div>${i.text}</div></div>`).join('')
      : `<div class="ai-item neu"><div class="ai-ico">•</div><div>Não há dados suficientes neste recorte para gerar uma análise. Tente limpar o filtro de período.</div></div>`;
    painel.innerHTML = `<div class="ai-panel">
      <div class="ai-panel-head">${FAISCA_IA}<span class="ai-panel-title">Análise automática</span>
        <span class="ai-panel-sub">${observacoes.length} ${observacoes.length===1?'observação':'observações'} · recalculado dos dados atuais</span></div>
      ${corpo}</div>`;
    painel.dataset.open = '1';
    if(botao) botao.classList.remove('loading');
  }, 280);
}

// helper: maior entrada {chave,valor} de um objeto de contagem
function maiorEntrada(objeto, excluidos=[]){
  const entradas = Object.entries(objeto).filter(([k]) => !excluidos.includes(k)).sort((a,b)=>b[1]-a[1]);
  return entradas[0] || null;
}

/* --- Análise: GOVERNANÇA --- */
function analisarGovernanca(){
  const {kept:acoes} = todasAcoesFiltradas();
  const total = acoes.length;
  if(!total) return [];
  const observacoes = [];
  const sc      = statusCounts(acoes);
  const done    = sc.done;
  const doing   = sc.doing + sc.closing;
  const backlog = sc.todo;
  const taxa = calculatePercentage(done,total);

  // 1. Leitura geral de conclusão
  observacoes.push({type: taxa>=60?'pos':(taxa>=35?'neu':'warn'), ico:'%',
    text:`<b>${taxa}% das ${total} ações estão concluídas</b> (${done}). Em andamento: ${doing}. Backlog/não iniciadas: ${backlog} (${calculatePercentage(backlog,total)}%).`});

  // 2. Qual fonte concentra mais backlog em aberto
  const fontes = ['Projetos','Pipefy','Analytics','Chamados RPA'];
  const backlogPorFonte = {};
  fontes.forEach(f => { backlogPorFonte[f] = acoes.filter(a=>a.source===f && (a.sc==='todo'||a.sc==='doing'||a.sc==='closing')).length; });
  const maiorBacklog = maiorEntrada(backlogPorFonte);
  if(maiorBacklog && maiorBacklog[1]>0){
    observacoes.push({type:'neu', ico:'≡',
      text:`A fonte com mais ações em aberto é <b>${maiorBacklog[0]}</b>, com ${maiorBacklog[1]} ${maiorBacklog[1]===1?'ação':'ações'} (em andamento ou backlog).`});
  }

  // 3. Concentração de ações abertas por responsável (só equipe CoE, igual ao gráfico)
  const abertasPorResponsavel = {};
  acoes.filter(a=>a.resp && a.sc!=='done' && a.sc!=='cancel').forEach(a=>{
    const nome = nomePadraoCoe(a.resp);
    if(nome) abertasPorResponsavel[nome] = (abertasPorResponsavel[nome]||0)+1;
  });
  const totalAberto = Object.values(abertasPorResponsavel).reduce((s,v)=>s+v,0);
  const maiorResponsavel = maiorEntrada(abertasPorResponsavel);
  if(maiorResponsavel && totalAberto>0){
    // limiar de 30%: uma pessoa carregando >30% das ações abertas é um possível gargalo.
    // Abaixo disso é só "maior carga individual" — informativo, não um problema.
    observacoes.push({type: maiorResponsavel[1]/totalAberto>0.3?'warn':'neu', ico:'@',
      text:`Na equipe CoE, <b>${maiorResponsavel[0]}</b> concentra ${maiorResponsavel[1]} ações abertas (${calculatePercentage(maiorResponsavel[1],totalAberto)}% do total da equipe) — ${maiorResponsavel[1]/totalAberto>0.3?'possível gargalo de capacidade':'maior carga individual'}.`});
  }

  // 4. Canceladas (sinalizado se relevante)
  // limiar de 5%: abaixo disso é ruído normal de planejamento; acima merece revisão de processo.
  const cancelados = acoes.filter(a=>a.sc==='cancel').length;
  if(cancelados>0 && calculatePercentage(cancelados,total)>=5){
    observacoes.push({type:'warn', ico:'×',
      text:`<b>${cancelados} ações canceladas</b> (${calculatePercentage(cancelados,total)}% do total) — vale revisar o motivo para reduzir retrabalho de planejamento.`});
  }
  return observacoes;
}

/* --- Análise: PROJETOS --- */
function analisarProjetos(){
  const {kept:projetos} = filtrarPorPeriodo(App.P.proj);
  const total = projetos.length;
  if(!total) return [];
  const observacoes = [];
  const emExecucao = projetos.filter(p=>p.sc==='doing').length;
  const emFaseFinal = projetos.filter(p=>p.sc==='closing'||p.sc==='monitor').length;
  const atrasados = projetos.filter(projetoAtrasado);

  // 1. Status geral
  observacoes.push({type:'neu', ico:'≡',
    text:`<b>${total} projetos</b> no recorte: ${emExecucao} em execução, ${emFaseFinal} em fase final (encerramento/monitoramento).`});

  // 2. Atrasados — uma lista NOMEADA de quais são (ordenados por dias de atraso)
  if(atrasados.length>0){
    const comDias = atrasados.map(p => ({
      titulo: p.titulo,
      dias: daysBetween(HOJE, p.dtFim),
      fase: faseProjeto(p.statusRaw), statusRaw: p.statusRaw
    })).sort((a,b)=>b.dias-a.dias);
    const lista = comDias.map(p => `<b>${p.titulo}</b> (${p.dias}d, ${p.statusRaw})`).join('; ');
    observacoes.push({type:'neg', ico:'!',
      text:`<b>${atrasados.length} ${atrasados.length===1?'projeto atrasado':'projetos atrasados'}</b>: ${lista}.`});
  } else {
    observacoes.push({type:'pos', ico:'✓', text:`Nenhum projeto com prazo vencido neste recorte.`});
  }

  // 3. Projeto mais crítico pelo score de risco automático
  const comRisco = projetos.map(p => ({project: p, risk: riscoProjeto(p)})).filter(x=>x.risk.score>0).sort((a,b)=>b.risk.score-a.risk.score);
  if(comRisco.length){
    const maisCritico = comRisco[0];
    const nivelPt = {high:'alto', medium:'médio', low:'baixo'}[maisCritico.risk.level];
    observacoes.push({type: maisCritico.risk.level==='high'?'neg':'warn', ico:'▲',
      text:`Projeto mais crítico: <b>${maisCritico.project.titulo}</b> (risco ${nivelPt}, score ${maisCritico.risk.score}) — ${maisCritico.risk.reasons.join(', ')}.`});
    const contagemRiscoAlto = comRisco.filter(x=>x.risk.level==='high').length;
    if(contagemRiscoAlto>1){
      observacoes.push({type:'warn', ico:'▲',
        text:`<b>${contagemRiscoAlto} projetos</b> estão em risco alto e merecem atenção prioritária.`});
    }
  }

  // 4. Frente com mais projetos
  const porArea = count(projetos.filter(p=>p.frente), p=>p.frente);
  const maiorArea = maiorEntrada(porArea);
  if(maiorArea){
    observacoes.push({type:'neu', ico:'#',
      text:`A frente com mais projetos é <b>${maiorArea[0]}</b> (${maiorArea[1]}).`});
  }

  // 5. Projetos não iniciados
  // limiar de 30%: se mais de 30% da carteira não começou, o pipeline está represado.
  const naoIniciados = projetos.filter(p=>p.sc==='todo').length;
  if(naoIniciados>0){
    observacoes.push({type: calculatePercentage(naoIniciados,total)>30?'warn':'neu', ico:'○',
      text:`<b>${naoIniciados} ${naoIniciados===1?'projeto não iniciado':'projetos não iniciados'}</b> (${calculatePercentage(naoIniciados,total)}% da carteira) aguardando início.`});
  }
  return observacoes;
}

/* --- Análise: MELHORIAS PIPEFY --- */
function analisarMelhorias(){
  const {kept: melhorias} = filtrarPorPeriodo(App.P.improvements);
  const total = melhorias.length;
  if(!total) return [];
  const observacoes = [];
  const sc      = statusCounts(melhorias);
  const done    = sc.done;
  const backlog = sc.todo;
  const blocked = sc.blocked;

  observacoes.push({type: calculatePercentage(done,total)>=60?'pos':'neu', ico:'%',
    text:`<b>${calculatePercentage(done,total)}% das ${total} melhorias concluídas</b> (${done}). Backlog: ${backlog}.`});

  // complexidade predominante
  const porComplexidade = count(melhorias.filter(m=>m.complex), m=>m.complex);
  const maiorComplexidade = maiorEntrada(porComplexidade);
  if(maiorComplexidade){
    observacoes.push({type:'neu', ico:'≡',
      text:`Complexidade predominante: <b>${maiorComplexidade[0]}</b> (${maiorComplexidade[1]} melhorias, ${calculatePercentage(maiorComplexidade[1],total)}%).`});
  }

  // área que mais demanda melhorias
  const porArea = count(melhorias.filter(m=>m.frente), m=>m.frente);
  const maiorArea = maiorEntrada(porArea);
  if(maiorArea){
    observacoes.push({type:'neu', ico:'#',
      text:`A frente que mais demanda melhorias é <b>${maiorArea[0]}</b> (${maiorArea[1]}).`});
  }

  if(blocked>0){
    observacoes.push({type:'warn', ico:'!',
      text:`<b>${blocked} ${blocked===1?'melhoria bloqueada':'melhorias bloqueadas'}</b> — vale destravar para liberar o fluxo.`});
  }
  return observacoes;
}

/* --- Análise: ANALYTICS --- */
function analisarAnalytics(){
  const {kept:atividades} = filtrarPorPeriodo(App.P.ana);
  const total = atividades.length;
  if(!total) return [];
  const observacoes = [];
  const done = atividades.filter(a=>a.sc==='done').length;

  observacoes.push({type: calculatePercentage(done,total)>=50?'pos':'neu', ico:'%',
    text:`<b>${calculatePercentage(done,total)}% das ${total} atividades concluídas</b> (${done}).`});

  // prioridade 1 ainda aberta — alerta
  const p1Abertas = atividades.filter(a=>a.prio===1 && a.sc!=='done' && a.sc!=='cancel').length;
  if(p1Abertas>0){
    observacoes.push({type:'neg', ico:'!',
      text:`<b>${p1Abertas} ${p1Abertas===1?'atividade de Prioridade 1 em aberto':'atividades de Prioridade 1 em aberto'}</b> — foco máximo de atenção.`});
  }

  // área com mais demanda
  const porArea = count(atividades.filter(a=>a.frente), a=>a.frente);
  const maiorArea = maiorEntrada(porArea);
  if(maiorArea){
    observacoes.push({type:'neu', ico:'#',
      text:`A frente com mais atividades de Analytics é <b>${maiorArea[0]}</b> (${maiorArea[1]}).`});
  }

  // sem data (transparência)
  const semData = atividades.filter(a=>!a.dtFim && !a.dtInicio).length;
  if(semData>0){
    observacoes.push({type:'neu', ico:'○',
      text:`${semData} de ${total} atividades não têm data registrada, então não entram nos cálculos por período.`});
  }
  return observacoes;
}

/* --- Análise: CHAMADOS RPA --- */
function analisarRPA(){
  const {kept: chamados} = filtrarPorPeriodo(App.R);
  const total = chamados.length;
  if(!total) return [];
  const observacoes = [];
  const vencidos = chamados.filter(r=>r.vencido).length;
  const concluidos = chamados.filter(r=>r.fase.toLowerCase().includes('conclu')).length;

  // 1. Concentração nos top bots
  // limiar de 40%: se 3 processos (de dezenas) concentram >40% dos chamados,
  // estabilizá-los tem um impacto desproporcional no volume total de suporte.
  const porProcesso = count(chamados.filter(r=>r.processo!=='(sem processo)'), r=>r.processo);
  const ordenados = Object.entries(porProcesso).sort((a,b)=>b[1]-a[1]);
  const totalProcesso = ordenados.reduce((s,e)=>s+e[1],0);
  if(ordenados.length>=3){
    const top3 = ordenados.slice(0,3);
    const somaTop3 = top3.reduce((s,e)=>s+e[1],0);
    observacoes.push({type: somaTop3/totalProcesso>0.4?'warn':'neu', ico:'≡',
      text:`Os 3 processos com mais manutenções (<b>${top3.map(e=>e[0]).join(', ')}</b>) concentram <b>${calculatePercentage(somaTop3,totalProcesso)}%</b> dos chamados. Estabilizá-los reduz bastante o volume de suporte.`});
  }

  // 2. Taxa de chamados vencidos (SLA)
  // Limiar: >25% = crítico (vermelho), >0% = atenção (laranja), 0% = bom (verde).
  observacoes.push({type: calculatePercentage(vencidos,total)>25?'neg':(calculatePercentage(vencidos,total)>0?'warn':'pos'), ico: calculatePercentage(vencidos,total)>25?'!':'%',
    text:`<b>${calculatePercentage(vencidos,total)}% dos ${total} chamados venceram o prazo</b> (${vencidos}). Concluídos: ${calculatePercentage(concluidos,total)}%.`});

  // 3. Problema mais comum
  const porProblema = count(chamados, r=>r.problema);
  const maiorProblema = maiorEntrada(porProblema, ['']);
  if(maiorProblema && maiorProblema[0]){
    observacoes.push({type:'neu', ico:'?',
      text:`Problema mais frequente: <b>"${maiorProblema[0]}"</b> (${maiorProblema[1]} chamados, ${calculatePercentage(maiorProblema[1],total)}%).`});
  }

  // 4. Tendência mês a mês: compara a média da 1ª metade do período com a 2ª metade.
  // limiar de 15%: variações abaixo disso são flutuação normal; acima é uma tendência real.
  // Dividir em duas metades funciona com qualquer número de meses disponíveis.
  const porMes = {};
  chamados.forEach(r=>{ if(r.mes) porMes[r.mes]=(porMes[r.mes]||0)+1; });
  const meses = Object.keys(porMes).sort();
  if(meses.length>=4){
    const metade = Math.floor(meses.length/2);
    const recente = meses.slice(-metade).reduce((s,m)=>s+porMes[m],0)/metade; // média da 2ª metade
    const anterior  = meses.slice(0,metade).reduce((s,m)=>s+porMes[m],0)/metade; // média da 1ª metade
    const variacao = anterior>0 ? Math.round((recente-anterior)/anterior*100) : 0; // variação %
    if(Math.abs(variacao)>=15){
      observacoes.push({type: variacao>0?'warn':'pos', ico: variacao>0?'↑':'↓',
        text:`O volume de chamados está <b>${variacao>0?'subindo':'caindo'}</b>: média recente ${recente.toFixed(0)}/mês vs ${anterior.toFixed(0)}/mês no início do período (${variacao>0?'+':''}${variacao}%).`});
    }
  }

  // 5. Área que mais abre chamados (se mapeada)
  const porArea = count(chamados.filter(r=>r.area && r.area!=='(não mapeada)'), r=>r.area);
  const maiorArea = maiorEntrada(porArea);
  if(maiorArea){
    observacoes.push({type:'neu', ico:'#',
      text:`A área que mais abre chamados é <b>${maiorArea[0]}</b> (${maiorArea[1]}).`});
  }
  return observacoes;
}

/* --- Análise: INVENTÁRIO DE BOTS --- */
function analisarBots(){
  // bots usam o filtro de AnoPRD; aqui analisamos o conjunto completo carregado
  const bots = App.B;
  if(!bots.length) return [];
  const observacoes = [];
  const prd     = bots.filter(b=>b.status==='PRD').length;
  const dev     = bots.filter(b=>b.status==='DEV').length;
  const backlog = bots.filter(b=>b.status==='BACKLOG').length;

  observacoes.push({type:'neu', ico:'≡',
    text:`<b>${bots.length} bots no inventário</b>: ${prd} em produção (${calculatePercentage(prd,bots.length)}%), ${dev} em desenvolvimento, ${backlog} em backlog.`});

  // cobertura por área (entre as áreas de negócio principais)
  const botsPrd = bots.filter(b=>b.status==='PRD');
  const porArea = count(botsPrd, b=>b.area);
  const maiorArea = maiorEntrada(porArea);
  if(maiorArea){
    observacoes.push({type:'neu', ico:'#',
      text:`A área com mais automações em produção é <b>${maiorArea[0]}</b> (${maiorArea[1]} bots, ${calculatePercentage(maiorArea[1],prd)}%).`});
  }

  // bots críticos
  const criticos = botsPrd.filter(b=>b.criticidade && b.criticidade<=2).length;
  if(criticos>0){
    observacoes.push({type:'warn', ico:'!',
      text:`<b>${criticos} bots em produção são de criticidade alta</b> (nível 1-2) — priorize monitoramento e plano de contingência.`});
  }

  // cruzamento com chamados, se disponível
  if(App.R.length){
    const chamadosPorProcesso = count(App.R, r=>r.processo);
    let maxChamados = 0, botComMaisChamados = '';
    botsPrd.forEach(b => {
      const nomeBotNorm = normalizeBotName(b.nome);
      let totalChamados = 0;
      Object.entries(chamadosPorProcesso).forEach(([proc, qtd]) => {
        const nomeProcNorm = normalizeBotName(proc);
        if (nomeProcNorm && nomeBotNorm && (nomeBotNorm.includes(nomeProcNorm) || nomeProcNorm.includes(nomeBotNorm))) {
          totalChamados += qtd;
        }
      });
      if (totalChamados > maxChamados) { maxChamados = totalChamados; botComMaisChamados = b.nome; }
    });
    if(maxChamados>0){
      observacoes.push({type:'warn', ico:'⚙',
        text:`O bot em produção com mais manutenções é <b>${botComMaisChamados}</b> (${maxChamados} chamados) — forte candidato a refatoração.`});
    }
  }
  return observacoes;
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
  const dates = all.map(dataReferencia).filter(Boolean).map(d => d.getTime());
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
  buildTab(() => construirGovernanca());
  buildTab(() => { if(App.P.proj.length) buildProjects(); });
  buildTab(() => { if(App.P.improvements.length) construirMelhorias(); });
  buildTab(() => { if(App.P.ana.length) buildAnalytics(); });
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