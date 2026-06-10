// Nomes dos meses e dias da semana (índice 0 = Jan / Seg)
export const MESES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
export const DOW   = ['Seg','Ter','Qua','Qui','Sex','Sáb','Dom'];

// Data atual no momento do carregamento — usada como referência em cálculos de atraso/risco
export const HOJE = new Date();

// ─── Equipe CoE ─────────────────────────────────────────────────────────────
// Usado para filtrar "Ações abertas por responsável" na aba Governança.
// Cada membro tem uma lista de termos únicos que identificam seu nome nos dados,
// tolerando variações de escrita. Sobrenomes distintos são preferidos a primeiros
// nomes (ex: "archangelo" em vez de "gustavo") para evitar homônimos.
export const EQUIPE_COE = [
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

// ─── Status ──────────────────────────────────────────────────────────────────
// Rótulos em português exibidos na interface
export const STATUS_PT = {
  done:'Concluído', doing:'Em andamento', closing:'Em encerramento',
  monitor:'Monitoramento', todo:'Não iniciado', blocked:'Bloqueado',
  cancel:'Cancelado', vendor:'Suporte Pipefy', other:'Outro'
};

// Classe CSS do badge de status (ver styles/main.css: .badge.ok, .badge.info, etc.)
export const STATUS_BADGE = {
  done:'ok', doing:'info', closing:'warn', monitor:'info',
  todo:'neu', blocked:'warn', cancel:'red', vendor:'blue', other:'neu'
};

// Cor pura para gráficos SVG (que não usam classes CSS)
export const STATUS_COLOR = {
  done:'var(--ok)', doing:'var(--info)', closing:'#c08438',
  monitor:'#5a8fd9', todo:'var(--neu)', blocked:'var(--warn)',
  cancel:'var(--err)', vendor:'#7c5cbf', other:'var(--ink4)'
};

// SVG inline do ícone "faísca" — não depende de fonte de ícone externa
export const AI_SPARK = '<svg class="ai-spark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2z"/></svg>';
