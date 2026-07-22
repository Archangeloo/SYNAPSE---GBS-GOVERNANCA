// state.js — objeto único de estado global da aplicação, compartilhado por todos os módulos.
// Nada aqui é calculado — são só os containers de dados e estado de interface que os
// parsers escrevem e as views leem.

export const App = {
  // Planilhas brutas lidas pelo SheetJS (null até o usuário fazer o upload)
  planilhaGovernanca: null,
  planilhaRPA: null,

  // Dados normalizados após o parse (arrays de objetos simples), vindos da planilha de Governança
  dadosGovernanca: {
    melhorias: [], // Pipefy_Melhorias — melhorias e ajustes do Pipefy
    projetos: [],  // Projetos — carteira de projetos da área
    analytics: []  // Analytics — atividades de Analytics
  },
  chamadosRPA: [], // Chamados RPA — chamados de manutenção dos bots
  bots: [],        // Inventário de Bots — catálogo de automações (sem filtro de data; usa AnoPRD)

  // Controle de quais arquivos já foram carregados
  carregado: { governanca: false, rpa: false },

  // Aviso exibido quando o arquivo de Chamados RPA carregado não parece ser um
  // relatório de chamados válido (preenchido por interpretarRPA(), lido em views/rpa.js)
  avisoRPA: '',

  // Filtro global de período (aplicado em todas as abas ao mesmo tempo)
  // modo: 'all' = sem filtro | 'custom' = intervalo manual de datas
  periodoFiltro: { modo: 'all', de: null, ate: null },

  // Conjunto de projetos expandidos na lista (chave = numero ou titulo)
  projetosAbertos: new Set(),
  // Chips de filtro rápido na aba Projetos: mostrar só atrasados / só risco alto
  chipsProjetos: { atraso: false, risco: false },

  // Conjunto de bots expandidos na lista do Inventário
  botsAbertos: new Set(),

  // Filtro de frente ativo na aba Governança ('' = todas as frentes)
  frenteGovernanca: ''
};
