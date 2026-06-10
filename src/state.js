// Estado global mutável da aplicação.
// Todos os módulos importam este objeto e o modificam diretamente — isso é
// intencional: o estado é único e compartilhado, assim como era quando o código
// era um único arquivo. Para evitar acoplamento implícito, todos os acessos
// devem vir de `import { App } from '../state.js'`.

export const App = {
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
  B: [],       // Inventário de Bots — catálogo de automações

  // Controle de quais arquivos já foram carregados
  loaded: { gov: false, rpa: false },

  // Filtros legados (mantidos por compatibilidade com código existente)
  filt: { rpaFrente: '', rpaProb: '', rpaFase: '' },

  // Filtro global de período: mode='all' (sem filtro) | 'custom' (range manual)
  dateRange: { mode: 'all', from: null, to: null },

  // Set de projetos expandidos na lista (chave = num ou titulo)
  projOpen: new Set(),

  // Filtros rápidos da aba Projetos
  projChips: { atraso: false, risco: false },

  // Mensagem de aviso quando o arquivo RPA não parece ser o relatório correto
  rpaWarn: ''
};
