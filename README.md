# SYNAPSE · Governança GBS

Dashboard de governança do CoE de Projetos e Automações do GBS (Global Business Services).
Consolida projetos, melhorias Pipefy, chamados de manutenção RPA e Analytics em uma única interface, a partir das planilhas que a equipe já usa.

> **Acesso:** https://synapse-gbs-governanca.vercel.app
> **Dados:** 100% locais — nenhuma informação sai do navegador do usuário.

---

## Como funciona

O site roda **100% no navegador** — sem servidor, sem banco de dados, sem instalação.
O usuário carrega as planilhas Excel na tela de Upload; a aplicação lê, processa e gera o dashboard na hora.

```
Planilhas Excel → FileReader API → SheetJS → Parsers → Arrays normalizados → KPIs + Gráficos
```

---

## Como usar

1. Abra o site (ou o `index.html` localmente no Chrome/Edge).
2. Na tela **Upload**, carregue as duas bases:

| Arquivo | Abas lidas |
|---|---|
| `Base_Governanca_GBS.xlsx` | Pipefy_Melhorias · Projetos · Analytics · Inventario_RPA |
| `relatório_completo.xlsx` | A aba com mais colunas de chamado (detectada automaticamente) |

3. Clique em **Gerar dashboard**.
4. Use o filtro de período no topo para recortar os dados de todas as abas ao mesmo tempo.
5. Use **Exportar PDF** para gerar um PDF da aba atual (impressão nativa do navegador).

---

## Abas do dashboard

| Aba | Conteúdo |
|---|---|
| **Painel de Controle** | Visão executiva: KPIs consolidados de todas as 4 fontes, ações abertas por responsável CoE, evolução de % concluído |
| **Projetos** | Portfólio — status, fase, prazo, score de risco automático, filtros e painel de detalhes por projeto |
| **Pipefy Melhorias** | Melhorias e ajustes — status, complexidade, frente, responsável, gráfico evolutivo, overview por categoria |
| **RPA & Bots** | Chamados de manutenção (volume, tipos de problema, tempo de resolução, lista) + Inventário de bots |
| **Analytics** | Atividades de Analytics — status, prioridade, frente, responsável |

---

## Filtro de período

O filtro global (**Este mês / Trimestre / Este ano** ou intervalo manual) recorta todas as abas simultaneamente.
Cada fonte usa a data que faz mais sentido para ela:

| Fonte | Data usada |
|---|---|
| Pipefy Melhorias | Intervalo DataInicio → DataConclusaoReal (inclui itens ativos no período) |
| Projetos | PrazoConclusão |
| Analytics | DataAbertura ou DataFechamento |
| Chamados RPA | Criado em (data de abertura) |
| Inventário de Bots | AnoPRD (ano de entrada em produção) — filtro por ano, não por data completa |

Itens sem data ficam **fora** do recorte quando o filtro está ativo — comportamento intencional, sempre sinalizado na interface com a contagem de itens excluídos.

---

## Comparativos mês a mês (↑↓)

Dois KPIs mostram a variação em relação ao mês anterior:

### Pipefy Melhorias — Concluídas
- **Base:** `DataConclusaoRealDesenvolvimento` (campo `dtFim` no parser)
- **Regra:** só entram itens com `sc === 'done'` **e** `dtFim` preenchida
- **Erro sinalizado:** itens marcados como concluídos sem data de conclusão são um erro de preenchimento na planilha — a interface exibe um aviso com a contagem exata
- **Itens não-concluídos sem data:** correto — ainda estão em andamento/backlog

### Chamados RPA — Volume e Vencidos
- **Base:** campo `Criado em` (data de abertura do chamado)
- **Cobertura:** 100% dos chamados têm essa data — comparativo sem ressalvas
- **Lógica de cor:** menos chamados = verde (melhora), mais chamados = vermelho (piora)
- **Independente do filtro:** o comparativo usa sempre a base completa (`App.chamadosRPA`), não o subconjunto filtrado por fase ou por data

---

## Score de risco de projetos

Calculado automaticamente por `projRisco(p)` sem campo manual na planilha:

| Fator | Pontuação |
|---|---|
| Atraso (dias corridos) | `min(70, 15 + dias × 1,2)` |
| Prazo em ≤ 15 dias | +18 |
| Prazo em ≤ 30 dias | +10 |
| Sem prazo definido | +14 |
| Bloqueado | +30 |
| Fase inicial (Diagnóstico) | +18 |
| Fase Planejamento | +14 |
| Fase Execução | +9 |
| Fase Encerramento | +4 |

**Níveis:** score ≥ 55 = alto · ≥ 30 = médio · < 30 = baixo.
Projetos em monitoramento, concluídos ou cancelados têm score 0 automaticamente.

---

## Análise automática (painel ↯)

Cada aba tem um botão "Gerar análise" que calcula insights programáticos a partir dos dados:
- Detecta concentrações, tendências, gargalos e outliers
- Gera frases dinâmicas em português
- **Não é IA nem modelo de linguagem** — são regras determinísticas rodando 100% no navegador
- Limiares utilizados: >30% de carga em um responsável = gargalo · >40% dos chamados em 3 bots = concentração · variação ≥15% no volume = tendência

---

## Estrutura de arquivos

```
SYNAPSE - GBS GOVERNANCA/
│
├── index.html              # Estrutura HTML + fundo interativo de partículas
├── app.js                  # Artefato de build (gerado pelo Vercel, não versionado — ver Nota abaixo)
│
├── styles/
│   └── main.css            # Estilos (identidade Saint-Gobain/GBS + @media print)
│
├── src/                    # Código-fonte real do site — toda alteração é feita aqui
│   ├── main.js             # Entry point — orquestra parsers, views e navegação
│   ├── state.js            # Estado global compartilhado (App.dadosGovernanca, App.chamadosRPA, App.bots…)
│   ├── constants.js        # Equipe CoE, status, paleta de cores, HOJE
│   ├── charts.js           # Componentes SVG: graficoRosca, barrasHorizontais, graficoLinha, mapaCalor
│   ├── analysis.js         # Análise automática por aba (insights programáticos)
│   ├── nav.js              # Navegação entre abas
│   ├── upload.js           # Upload de arquivos (drag-and-drop + input file)
│   ├── filters.js          # Filtro global de período
│   ├── parsers/
│   │   ├── gov.js          # Parser da Base Governança (Melhorias, Projetos, Analytics, Inventário)
│   │   └── rpa.js          # Parser dos Chamados RPA + enriquecimento de área
│   ├── views/
│   │   ├── gov.js          # Painel de Controle (visão executiva)
│   │   ├── proj.js         # Projetos (lista filtrável + score de risco)
│   │   ├── mel.js          # Pipefy Melhorias
│   │   ├── ana.js          # Analytics
│   │   ├── rpa.js          # RPA & Bots — chamados
│   │   └── bots.js         # Inventário de Bots
│   └── utils/
│       ├── date.js         # Conversão, formatação e filtro de datas
│       ├── classify.js     # Normalização de status + score de risco
│       └── helpers.js      # findSheet, get, count, pct
│
├── saint-gobain-logo.png
├── logo_gbs.png
├── synapse_logo3.png
├── package.json            # Script "build": esbuild empacota src/main.js → app.js
├── vercel.json             # Roda o build (npm install + esbuild) a cada deploy
└── README.md               # Este arquivo
```

> **Nota:** o código-fonte é `src/`. O `app.js` é gerado automaticamente pelo Vercel a cada deploy (ver seção 1.1 da documentação técnica) e não deve ser editado à mão nem versionado — não há Node.js nesta máquina para gerá-lo localmente, então validações de mudanças passam por preview do Vercel (push em branch / Pull Request).

---

## Dependências externas (CDN — sem instalação)

| Biblioteca | Versão | Uso |
|---|---|---|
| [SheetJS (xlsx)](https://sheetjs.com/) | 0.18.5 | Leitura de arquivos Excel no navegador |
| [Chart.js](https://www.chartjs.org/) | 4.4.0 | Gráficos de linhas e donut interativos |
| [Tabler Icons](https://tabler.io/icons) | 3.19.0 | Ícones da interface |
| [Inter + Syne](https://fonts.google.com/) | — | Tipografia |

---

## Identidade visual

| Variável CSS | Cor | Uso |
|---|---|---|
| `--brand` | `#0F5299` | Topbar, cor principal de marca |
| `--accent` | `#0195D6` | Destaques interativos, botões |
| `--teal` | `#4DB1B3` | Acento secundário |
| `--err` | `#C5284C` | Alertas críticos |
| `--warn` | `#9A3412` | Avisos, prazos em risco |

Todas as variáveis estão em `styles/main.css` e podem ser ajustadas em um único lugar.

---

## Funcionalidades de experiência

- **Fundo interativo:** campo de partículas conectadas que reagem ao cursor do mouse (canvas fixo, `z-index: -1`)
- **Animação de KPIs:** números contam de 0 ao valor ao carregar cada aba (cubic ease-out, 850ms)
- **Exportar PDF:** botão na topbar (visível após gerar o dashboard) — abre diálogo de impressão do navegador com layout limpo (só a aba ativa, sem botões ou filtros)

---

## Responsável técnico

CoE Projetos e Automações — GBS Saint-Gobain Brasil
