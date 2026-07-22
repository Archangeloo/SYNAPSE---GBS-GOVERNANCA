// constants.js — tabelas fixas e valores compartilhados pelo app. Nenhuma lógica aqui
// além de derivações simples (HOJE) — o resto é dado puro.

export const MESES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

export const HOJE = new Date(); // data atual no momento em que a página carrega

/* Paths de SVG inline — não dependem de fonte carregada, funcionam em HTML dinâmico */
export const _SVG = {
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

// Rótulos em português pra exibir na interface
export const STATUS_PT = {
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

// Classe CSS de badge pra cada status (ver CSS: .badge.ok, .badge.info, etc.)
export const STATUS_BADGE = {
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

// Cor sólida pros gráficos — paleta Saint-Gobain
export const STATUS_COLOR = {
  done:    '#4DB1B3',  // teal        — concluído
  doing:   '#0195D6',  // azul claro  — em andamento
  closing: '#E66407',  // laranja     — em encerramento
  monitor: '#0F5299',  // azul marca  — monitoramento
  todo:    '#9CA3AF',  // cinza       — não iniciado
  blocked: '#E83430',  // vermelho    — bloqueado
  cancel:  '#C5284C',  // vermelho-rosa — cancelado
  vendor:  '#8B6FD4',  // roxo        — suporte Pipefy
  other:   '#9CA3AF'   // cinza
};

/*
 * COE_TEAM — integrantes do time CoE, organizados pela área em que atuam.
 * Usado APENAS na aba Governança pra filtrar "Ações abertas por responsável"
 * (mostra só o time interno; pessoas fora do CoE não aparecem nesse gráfico).
 *
 * Cada entrada tem uma lista 'match' de termos distintivos pra reconhecer a
 * pessoa nos dados, tolerando variações de grafia. Usamos deliberadamente
 * sobrenomes/termos únicos pra EVITAR confundir homônimos de primeiro nome
 * (ex: "Gustavo" também bateria com "Matheus Gustavo Germano", que não é do
 * CoE — por isso usamos "archangelo"). 'name' é o rótulo mostrado no gráfico.
 */
export const COE_TEAM = [
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

// Principais áreas de negócio do GBS — usadas pra filtrar os gráficos de RPA e bots.
// Áreas secundárias do inventário (PAM, CI, IT, ARG, MEX etc.) são agrupadas em "Outros"
// pra não poluir os gráficos com fatias de baixo volume.
export const MAIN_RPA_AREAS = ['P2P', 'TAX', 'H2R', 'O2C', 'R2R'];

// Time responsável por desenvolver as melhorias Pipefy (exclui solicitantes/champions).
// Usado em construirMelhorias() pra filtrar o gráfico "Por responsável".
export const PIPEFY_TEAM = ['willian', 'vinícius', 'vinicius', 'felipe', 'gustavo', 'caio'];

// Constantes usadas no cálculo de dias entre datas e na conversão de serial do Excel.
export const MS_PER_DAY = 86_400_000;
export const EXCEL_EPOCH_OFFSET = 25569; // dias entre 1900-01-01 (época do Excel) e 1970-01-01 (época Unix)
