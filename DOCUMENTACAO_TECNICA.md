# SYNAPSE — Documentação Técnica

## Painel de Governança do CoE de Projetos e Automações — GBS Saint-Gobain Brasil

Este documento descreve o funcionamento interno do SYNAPSE: a estrutura de dados, o comportamento de cada tela e as regras usadas para ler e transformar as planilhas carregadas pelo usuário. O objetivo é permitir que qualquer pessoa da equipe entenda o sistema sem precisar ler o código-fonte diretamente.

---

## Sumário

1. Arquitetura geral
2. Estado global (`App`)
3. Tela de upload
4. Geração do dashboard
5. Leitura e transformação das planilhas
6. Normalização de status
7. Filtro global de período
8. Barra superior
9. Navegação entre abas
10. Aba Painel de Controle
11. Aba Projetos
12. Aba Pipefy Melhorias
13. Registro manual de atividades
14. Aba Analytics
15. Aba RPA e Bots
16. Análise automática
17. Gráficos
18. Exportação para PDF
19. Fundo animado
20. Privacidade e segurança
21. Glossário de renomeações

---

## 1 Arquitetura geral

O SYNAPSE roda inteiramente no navegador do usuário. Não há servidor, banco de dados ou API própria associada à aplicação — o processamento das planilhas, os cálculos e a montagem dos gráficos acontecem no cliente.

O fluxo de uso segue esta sequência: o usuário carrega duas planilhas Excel; o `FileReader`, API nativa do navegador, lê cada arquivo como `ArrayBuffer`; a biblioteca SheetJS converte o binário em um objeto de planilha (*workbook*); os parsers percorrem as abas relevantes e produzem arrays de objetos normalizados, armazenados em `App.P.*`, `App.R` e `App.B`; cada função de construção de aba lê esses arrays, aplica o filtro de período ativo e monta o HTML correspondente; por fim, o Chart.js desenha os gráficos dentro dos elementos `<canvas>` inseridos na página.

Não há envio de dados para fora do navegador em nenhuma etapa desse fluxo — o código não contém chamadas de `fetch`, `XMLHttpRequest` ou `WebSocket` para nenhum servidor próprio. As únicas conexões de rede da página servem para carregar bibliotecas, ícones e fontes hospedados em CDN, que não recebem o conteúdo das planilhas.

Quadro 1 — Bibliotecas externas utilizadas

| Biblioteca | Finalidade |
|---|---|
| SheetJS (`xlsx.full.min.js`) | Leitura de arquivos `.xlsx`/`.xls` no navegador |
| Chart.js | Renderização dos gráficos de linha, barra e donut |
| Tabler Icons (webfont) | Ícones da interface |
| Google Fonts (Inter, Syne) | Tipografia |

### 1.1 Relação entre `src/` e `app.js`

`src/` é a única fonte da verdade do código. É lá que toda alteração de lógica deve ser feita — os cerca de vinte módulos menores, cada um com suas próprias declarações `import`/`export`, documentados ao longo deste texto.

`app.js` é o artefato de build: o arquivo único, gerado a partir de `src/main.js` e seus imports, que o `index.html` efetivamente carrega (`<script src="app.js">`). Ele nunca é editado à mão e não é versionado no git (está listado em `.gitignore`) — existe apenas como saída de um comando de build.

A geração acontece no deploy, não nesta máquina. O `vercel.json` define `buildCommand: "npm install && npm run build && rm -rf node_modules"`: a cada push para o repositório, o Vercel instala o `esbuild` (dependência de desenvolvimento listada em `package.json`), executa `esbuild src/main.js --bundle --format=iife --outfile=app.js`, e remove o `node_modules` antes de publicar o resultado. O Vercel tem Node.js disponível no seu próprio ambiente de build — o que resolve a restrição desta máquina corporativa, onde Node.js não está instalado e não pode ser instalado.

Isso elimina o risco de duplicação: antes, `app.js` e `src/` eram mantidos manualmente em paralelo e podiam divergir; agora só existe uma versão do código (`src/`), e `app.js` é sempre reflexo exato dela após o próximo deploy.

Consequência prática para desenvolvimento local: como não há Node.js nesta máquina, não é possível regerar `app.js` localmente após editar `src/`. Um `app.js` de build anterior permanece no disco (fora do git) só para permitir abrir o `index.html` diretamente por conveniência, mas ele fica desatualizado assim que `src/` muda. Para validar uma alteração antes de ir para produção, o caminho é abrir um Pull Request ou enviar a mudança para uma branch — o Vercel gera automaticamente uma URL de preview já buildada a partir do `src/` atualizado.

---

## 2 Estado global (`App`)

Um único objeto, `App`, concentra todo o estado da aplicação e é compartilhado por todas as funções:

```js
App = {
  gov: null,           // workbook da Base Governança, após o upload
  rpa: null,            // workbook do relatório de Chamados RPA

  P: {
    improvements: [],  // Pipefy_Melhorias normalizado
    proj: [],          // Projetos normalizado
    ana: []            // Analytics normalizado
  },
  R: [],               // Chamados RPA normalizados
  B: [],               // Inventário de Bots normalizado

  loaded: { gov:false, rpa:false },
  dateRange: { mode:'all', from:null, to:null },

  projOpen: new Set(),
  projChips: { atraso:false, risco:false },
  govFrente: '',

  botsOpen: new Set(),
  rpaWarn: ''
}
```

Nada nesse objeto é persistido entre sessões. Ao recarregar a página, todo o estado volta ao valor inicial e é necessário carregar as planilhas novamente. A única exceção é o registro de atividades da aba Pipefy Melhorias, gravado em `localStorage` e descrito na seção 13.

---

## 3 Tela de upload

A tela inicial apresenta dois cartões de upload lado a lado — Base Governança e Chamados RPA. Cada cartão funciona como uma área de arraste e soltura (*dropzone*).

Quadro 2 — Interações da área de upload

| Ação do usuário | Função acionada |
|---|---|
| Clique na área tracejada | Aciona o `<input type="file">` oculto, abrindo o seletor de arquivos do sistema |
| Arrastar um arquivo sobre a área | `handleDropzoneDragOver` — destaca a área com a classe `.over` |
| Arrastar para fora da área | `handleDropzoneDragLeave` — remove o destaque |
| Soltar o arquivo | `handleDropzoneDrop` — lê o arquivo solto e chama `readFile` |
| Selecionar o arquivo pelo seletor do sistema | `handleFileInputChange` — chama `readFile` sobre o arquivo escolhido |

A função `readFile` cria um `FileReader` e lê o conteúdo como `ArrayBuffer`. Ao concluir a leitura, `XLSX.read()` converte os bytes em um workbook, com a opção `cellDates:true`, que faz o SheetJS retornar objetos `Date` nativos em vez do número serial usado internamente pelo Excel. O workbook resultante é armazenado em `App.gov` ou `App.rpa`, conforme o tipo de upload, e as funções `showOk` e `updateBar` atualizam a interface.

A função `showOk` confirma visualmente o upload e, no caso da Base Governança, verifica quais das quatro abas esperadas (`Pipefy_Melhorias`, `Projetos`, `Analytics`, `Inventario_RPA`) foram encontradas no arquivo, com comparação tolerante a maiúsculas, espaços e underscores. Um diagnóstico adicional varre as colunas da aba `Pipefy_Melhorias` em busca de termos como "data", "criado", "início" ou "conclusão", útil para identificar rapidamente se o nome de uma coluna de data foi alterado na planilha de origem.

A função `updateBar` conta quantos dos dois arquivos já foram carregados e habilita o botão "Gerar dashboard" assim que pelo menos um deles estiver presente — não é necessário carregar as duas bases simultaneamente. As abas que dependem da fonte ausente exibem apenas uma mensagem informando que não há dados carregados.

---

## 4 Geração do dashboard

A função `generate` orquestra a construção do dashboard a partir das planilhas carregadas, executando as seguintes etapas em sequência:

Primeiro, todas as instâncias ativas do Chart.js são destruídas e o contador de identificadores é zerado, evitando o erro de canvas duplicado ao gerar o dashboard mais de uma vez na mesma sessão. Em seguida, os parsers correspondentes às fontes carregadas são executados — `parseGov` e `parseInv` para a Base Governança, `parseRPA` para o relatório de chamados — seguidos por `enrichRPAWithArea`, que roda mesmo quando uma das fontes está ausente.

A partir dos dados normalizados, o sistema calcula o intervalo de datas coberto pela planilha e define esse intervalo como limite dos campos de data do filtro de período, impedindo a seleção de datas fora do que a base realmente contém. Cada aba é então construída dentro de um bloco `try/catch` independente, de modo que uma falha de renderização em uma aba não interrompa as demais — o erro, quando ocorre, é registrado apenas no console do navegador.

Por fim, o texto de sincronização no topo da página é atualizado com o horário da geração e as fontes carregadas, a barra de filtro de período e o botão de exportação em PDF são exibidos, e a navegação é direcionada automaticamente para a aba Painel de Controle.

---

## 5 Leitura e transformação das planilhas

### 5.1 Detecção de abas

O sistema não exige nomes exatos de aba. A comparação ignora maiúsculas, minúsculas, espaços e underscores, de modo que `Pipefy_Melhorias`, `pipefymelhorias` e `PIPEFY MELHORIAS` são reconhecidos como a mesma aba.

Para o relatório de Chamados RPA, cujo nome de aba varia entre exportações do Pipefy, o sistema testa todas as abas do arquivo e atribui uma pontuação a cada uma, de acordo com a presença de colunas características de um relatório de chamados: `Código`, `Fase atual`, `Processo`, uma coluna relacionada a "qual é o problema" e `Criado em`. A aba com maior pontuação é selecionada. Quando nenhuma aba atinge ao menos duas dessas colunas, o sistema não tenta adivinhar: deixa `App.R` vazio e exibe um aviso informando que o arquivo carregado não corresponde a um relatório de chamados válido.

### 5.2 Pipefy_Melhorias → `App.P.improvements`

Quadro 3 — Campos normalizados de Pipefy_Melhorias

| Campo interno | Coluna de origem | Observação |
|---|---|---|
| `num` | Numero | |
| `frente` | Gerencia | área de negócio (P2P, O2C etc.) |
| `fluxo` | NomeFluxo | nome do fluxo de processo |
| `atividade` | Atividade | descrição da melhoria |
| `statusRaw` | Status | texto original da planilha |
| `sc` | Status, via `classeStatusMelhoria` | ver seção 6; "Planejamento" conta como `doing` |
| `resp` | Responsavel | remove um caractere de espaço de largura zero comum em colagens do Excel |
| `champion` | Champion | |
| `complex` | Complexidade | |
| `tipo` | TipoMelhoriaAjuste | |
| `dtInicio` | DataInicioDesenvolvimento | sem coluna alternativa |
| `dtFim` | DataRealEstimadaConclusaoValidacaoChampion | apenas quando `sc==='done'` — ver observação abaixo |
| `horas` | QtdHorasEstimadas | |

Linhas sem `num` e sem `atividade` são descartadas. Melhorias de backlog sem `dtInicio` nem `dtFim` são sempre incluídas quando o filtro de período está ativo, por representarem trabalho pendente e não histórico.

A coluna `DataRealEstimadaConclusaoValidacaoChampion` guarda uma data estimada enquanto a melhoria ainda está em desenvolvimento e só passa a representar a data real depois que o champion valida a conclusão. Por isso o parser só preenche `dtFim` quando o item já está com status concluído (`sc==='done')`; para os demais status, `dtFim` fica `null`, evitando que uma estimativa ainda não confirmada seja tratada como data de conclusão real pelo filtro de período (ver seção 7).

### 5.3 Projetos → `App.P.proj`

O parser reconhece automaticamente duas versões de layout da planilha. No layout atual, a coluna Status contém valores reconhecíveis pela função de classificação, e os campos são lidos pelo nome da coluna (`Numero`, `Titulo`, `Responsavel`, `AreaCliente` ou `Frente`, `PontoFocal`, `Status`, `PrazoConclusão`, entre outros). Quando nenhum valor de Status é reconhecido, o sistema assume uma versão anterior da planilha, na qual os cabeçalhos estão deslocados uma coluna em relação ao conteúdo, e passa a ler por posição: coluna 0 corresponde ao número, 1 ao título, 2 ao responsável, e assim por diante. Em ambos os casos, linhas sem título são descartadas.

### 5.4 Analytics → `App.P.ana`

Quadro 4 — Campos normalizados de Analytics

| Campo | Coluna de origem | Observação |
|---|---|---|
| `num` | Numero | |
| `titulo` | Titulo | linhas sem título são descartadas |
| `statusRaw` / `sc` | Status | classificação padrão, sem a regra especial do Pipefy |
| `prio` | Prioridade | extrai apenas o número do texto |
| `frente` | Frente | |
| `resp` | Responsavel | |
| `dtInicio` | DataAbertura | |
| `dtFim` | DataFechamento | |

### 5.5 Inventario_RPA → `App.B`

Quadro 5 — Campos normalizados do inventário de bots

| Campo | Coluna de origem | Observação |
|---|---|---|
| `nome` | NomeRPA | linhas sem nome são descartadas |
| `perimetro` | Perimetro | Brasil, MEX, ARG etc. |
| `area` | Area | P2P, TAX, H2R etc. |
| `status` | Status | convertido para maiúsculas: PRD, DEV, BACKLOG, CANCELADO, DESATIVADO |
| `anoPrd` | AnoPRD | ano de entrada em produção, usado no filtro de período específico desta aba |
| `criticidade` | Criticidade | 1 (crítica) a 4 (baixa) |
| `fte` | FTE | FTEs economizados |
| `vol` | VolumetriaMensal | transações por mês |

### 5.6 Relatório de Chamados RPA → `App.R`

Quadro 6 — Campos normalizados dos chamados RPA

| Campo | Coluna de origem | Observação |
|---|---|---|
| `cod` | Código | linhas sem código são descartadas |
| `fase` | Fase atual | fase corrente no fluxo do Pipefy |
| `processo` | Processo | nome do bot; vazio vira `(sem processo)` |
| `solicitante` | Nome do solicitante | quem abriu o chamado |
| `responsaveis` | Responsáveis | quem atende o chamado, armazenado como lista |
| `criado` | Criado em | data de abertura |
| `dtFim` | Finalizado em | data de conclusão |
| `mes` | derivado de `criado` | chave no formato AAAA-MM |
| `vencido` | Vencido | aceita booleano ou texto "true"/"sim" |

### 5.7 Identificação da área de cada chamado

Os chamados RPA não têm coluna de área na planilha de origem. A função `enrichRPAWithArea` resolve essa informação em duas etapas: primeiro tenta um cruzamento com o inventário de bots, comparando os nomes normalizados (sem prefixos entre colchetes, sem acentuação, sem espaços) e verificando se um nome contém o outro; quando esse cruzamento falha, aplica um conjunto de regras por palavra-chave — processos com termos como "bank statement" ou "payment run" são atribuídos a P2P, termos relacionados a impostos a TAX, e assim por diante. Chamados que não se encaixam em nenhuma das duas regras recebem a marcação `(não mapeada)`.

---

## 6 Normalização de status

Internamente, o sistema nunca compara o texto bruto de status vindo da planilha — trabalha com um código normalizado (`sc`), já que o texto de origem varia em grafia e acentuação. A função `classeStatus` faz essa conversão.

Quadro 7 — Mapeamento de status

| Texto na planilha | Código interno |
|---|---|
| Concluído, Finalizado(s) | `done` |
| Suporte Pipefy, Encaminhado ao fornecedor | `vendor` |
| Em andamento, Em execução, Desenvolvimento, Em validação | `doing` |
| Encerramento | `closing` |
| Monitoramento | `monitor` |
| Planejamento, Diagnóstico, Não iniciado, Backlog | `todo` |
| Bloqueado, Pausado | `blocked` |
| Cancelado | `cancel` |
| qualquer outro valor | `other` |

Um prefixo numérico de ordenação, quando presente, é ignorado antes da comparação — "3 - Planejamento" e "Planejamento" resultam no mesmo código.

Existe uma exceção para as Melhorias Pipefy, aplicada pela função `classeStatusMelhoria`: nessa fonte, o status "Planejamento" é tratado como `doing`, e não como `todo`, por já representar trabalho retirado do backlog. Essa distinção é o que permite à coluna "Dev + Planej." do Overview somar os dois estados corretamente — a correção desse comportamento foi a motivação original deste projeto, já que a versão anterior do painel tratava "Backlog" e "Planejamento" como equivalentes. Em Projetos e Analytics essa exceção não se aplica: ali, "Planejamento" é a segunda fase do fluxo (Diagnóstico → Planejamento → Execução) e permanece classificada como `todo`.

---

## 7 Filtro global de período

O filtro de período no topo da página afeta todas as abas simultaneamente. Ele pode ser acionado de três formas: pelos atalhos "Este mês", "Trimestre" e "Este ano" (função `setQuickRange`, que calcula o intervalo a partir da data atual e marca o atalho como ativo); pela edição manual dos dois campos de data (função `applyDateFilter`, que monta o intervalo no modo personalizado, cobrindo o dia inteiro em ambas as pontas); ou pelo botão de limpar (função `clearDateFilter`, que retorna ao modo sem filtro). Clicar em um atalho já ativo funciona como alternância e remove o filtro. Qualquer uma dessas ações aciona `renderAll`, que reconstrói todas as abas com dado carregado.

O período não é interpretado da mesma forma em todas as fontes — cada uma usa a data que faz sentido para o seu contexto de negócio.

Quadro 8 — Referência de data por fonte

| Fonte | Campo de referência |
|---|---|
| Pipefy Melhorias | intervalo `dtInicio` a `dtFim` (só enquanto em andamento; concluídas usam `dtFim` como data única — ver abaixo) |
| Projetos | `dtFim` (prazo de conclusão) |
| Analytics | intervalo `dtInicio` a `dtFim` (mesma regra de itens concluídos que Melhorias) |
| Chamados RPA | `criado` (data de abertura) |
| Inventário de Bots | `anoPrd`, filtrado por ano — ver seção 15 |

A lógica central está em três funções do módulo de datas. `dataNoIntervalo` avalia itens com uma única data de referência: sem filtro ativo, tudo passa; com filtro ativo, um item sem data nunca passa. `ativoNoIntervalo` avalia itens com um intervalo próprio, como as Melhorias — um item com apenas a data de início é considerado ativo até a data atual; um item sem nenhuma das duas datas é classificado como "sem data" e contado à parte. `filtrarPorPeriodo` decide qual das duas regras aplicar a cada item de um array: itens ainda em andamento usam o intervalo completo (`ativoNoIntervalo`), porque faz sentido considerá-los "ativos" durante todo o desenvolvimento; itens já concluídos (`sc==='done'`) usam apenas `dtFim` como data única, via `dataNoIntervalo`, porque uma vez concluído o item tem uma data de conclusão real e fixa, e o que importa é se essa conclusão caiu dentro do período — não se o desenvolvimento, em algum momento, tocou o período. Essa distinção evita que um item concluído bem depois do período apareça como "concluído no período" só porque estava em desenvolvimento durante ele.

`filtrarPorPeriodo` retorna dois valores: os itens que passaram no filtro e a quantidade dos que ficaram de fora por ausência de data — essa contagem é sempre exibida na interface, nunca ocultada. Em nenhuma circunstância um item sem data recebe uma data aproximada ou padrão: ele simplesmente fica fora do recorte enquanto o filtro estiver ativo.

---

## 8 Barra superior

Quadro 9 — Elementos da barra superior

| Elemento | Comportamento |
|---|---|
| Logos Saint-Gobain e GBS | decorativos |
| Texto de sincronização | exibe a hora da última geração, as fontes carregadas e o período ativo |
| Atalhos de período | ver seção 7 |
| Botão "Exportar PDF" | visível somente após a primeira geração; aciona `window.print()` |
| Botão "Atualizar bases" | retorna à tela de upload sem descartar os dados já carregados |

---

## 9 Navegação entre abas

A função `setNav` alterna a classe ativa entre o item de menu selecionado e a seção de página correspondente, ocultando as demais. Ao entrar em uma aba, os números dos indicadores visíveis são reanimados do zero até o valor final — efeito puramente visual, sem novo cálculo.

A aba RPA e Bots possui uma navegação secundária entre seis subabas, controlada pela função `rpaPage`, restrita ao conteúdo dessa aba. Os contadores exibidos ao lado de cada item do menu principal são atualizados pela função `setBadge` conforme cada aba é construída.

---

## 10 Aba Painel de Controle

Esta aba apresenta uma visão executiva que combina as quatro fontes de dados — Projetos, Melhorias, Analytics e Chamados RPA — em uma lista unificada de ações, produzida pela função `todasAcoes`. Cada ação carrega a fonte de origem, o status normalizado, a frente de negócio, o responsável, as datas relevantes e, no caso de chamados RPA, o indicador de vencimento. Chamados RPA só recebem uma frente quando a área do bot corresponde a uma das cinco áreas de negócio principais; áreas secundárias do inventário não entram nos gráficos "por frente" desta aba. A função `todasAcoesFiltradas` aplica o filtro global de período sobre essa lista combinada.

Quando há mais de uma frente presente nos dados, chips de filtro permitem restringir a visão a uma área específica; essa seleção é guardada em `App.govFrente`. O filtro de área afeta os indicadores, o donut de status e o gráfico "Por responsável", mas não o gráfico "Por frente", que sempre mostra o panorama completo como referência de comparação.

A aba exibe cinco indicadores — total de ações, percentual concluído, em andamento, em backlog e "outros" — seguidos de um donut de status que agrupa Encerramento e Monitoramento em uma única fatia e reúne bloqueados, cancelados e itens em suporte externo sob "Impedimentos". O gráfico "Por responsável" soma apenas os membros fixos da equipe CoE, definidos na constante `COE_TEAM`; pessoas fora dessa lista não aparecem, ainda que constem como responsáveis na planilha. Um rodapé de diagnóstico mostra a contagem bruta de cada fonte, sem filtro de data, para auditoria rápida.

---

## 11 Aba Projetos

A aba apresenta indicadores de total, execução, fase final, atrasos e risco alto, seguidos de um donut de status e barras por frente ou área cliente.

O score de risco de cada projeto, calculado pela função `riscoProjeto`, combina três fatores sem exigir nenhum campo manual na planilha. O atraso é o fator de maior peso: quando o prazo já passou, a pontuação soma até 70 pontos, crescendo com o número de dias de atraso — cerca de 40 dias de atraso já é suficiente para classificar o projeto como risco alto isoladamente. Quando o prazo ainda não venceu, a proximidade da data soma pontos adicionais, e a ausência de qualquer prazo definido também é penalizada, por representar falta de controle. A fase do projeto contribui com um peso decrescente conforme o projeto avança no fluxo — Diagnóstico e Planejamento pesam mais que Execução e Encerramento — e um projeto bloqueado recebe um acréscimo fixo. O resultado final é classificado como risco alto a partir de 55 pontos, médio a partir de 30, e baixo abaixo disso; projetos concluídos, cancelados ou em monitoramento sempre recebem risco zero. Cada cálculo mantém também uma lista de motivos legíveis, exibida como texto auxiliar no indicador de risco.

A lista de projetos aceita busca por texto, filtros combináveis de atraso e risco alto, e seletores de responsável, status e frente. A ordenação padrão é por score de risco, com progresso como critério de desempate. Clicar em um projeto expande um painel com os campos preenchidos na planilha — campos vazios simplesmente não aparecem. O estado de expansão de cada projeto é mantido em `App.projOpen` enquanto a página não é recarregada.

---

## 12 Aba Pipefy Melhorias

Os indicadores desta aba mostram o total de melhorias sem filtro, seguido de conclusão percentual, backlog, bloqueadas e fluxos distintos. Quando existem melhorias marcadas como concluídas sem data de conclusão preenchida, um aviso identifica essa situação como erro de preenchimento da planilha, não como falha do sistema.

O gráfico "Melhorias Concluídas × Backlog" aparece somente quando há ao menos três melhorias concluídas com data e dois meses históricos distintos. Ele traz três séries: concluídas por mês, que é uma contagem histórica real; backlog reconstruído, calculado como o backlog atual somado às melhorias concluídas após cada mês do histórico — uma aproximação que assume que nenhum item novo entrou no backlog depois daquele ponto; e uma projeção linear para os meses futuros, calculada como o backlog atual dividido pelo número de meses futuros exibidos. Uma linha vertical tracejada marca o mês corrente, separando histórico de projeção.

A tabela "Overview por categoria" cruza frentes de negócio com as colunas Melhorias, Backlog, Dev + Planejamento, Validação, Pipefy, Bloqueado, Concluídos e Cancelados. As colunas Dev + Planejamento e Validação representam a mesma classificação interna (`doing`), diferenciadas pelo texto original do status: registros cujo status contém "validação" ou "aguardando" vão para Validação; os demais, para Dev + Planejamento.

---

## 13 Registro manual de atividades

No final da aba Pipefy Melhorias há um card de Atividades, a única parte do sistema cujos dados não vêm de planilha alguma. Ele reproduz uma tabela de acompanhamento manual — tema, atividade, observação e responsável — usada pela equipe em apresentações internas, cujos temas não correspondem diretamente a linhas da planilha Pipefy_Melhorias.

Os registros são gravados em `localStorage`, sob a chave `synapse.melhorias.atividades`, como um array de objetos com os campos `id`, `tema`, `atividade`, `observacao` e `responsavel`. Essa gravação sobrevive a recarregamentos de página e a novas gerações do dashboard com planilhas diferentes, mas fica restrita ao navegador e computador em que foi criada — não é sincronizada entre dispositivos e é removida se o usuário limpar os dados de navegação.

O botão de adicionar abre o modal em branco; o ícone de lápis em uma linha o abre preenchido para edição. O envio do formulário decide entre criar ou atualizar com base no identificador oculto do registro. A exclusão pede confirmação nativa do navegador antes de remover o item, de forma definitiva. O texto digitado nos campos passa por um escape de HTML antes de ser inserido na tabela, prevenindo que marcações digitadas pelo usuário sejam interpretadas como código.

---

## 14 Aba Analytics

Além dos indicadores de total, conclusão, andamento e não iniciadas, a aba apresenta um donut de status e barras por prioridade, frente e responsável. Quando não há filtro de período ativo, mas parte das atividades carece de data registrada, um aviso informa a proporção afetada.

O heatmap de prioridade por frente, produzido pela função `buildHeatmap` — fisicamente definida no módulo da Governança, mas usada apenas aqui —, cruza as prioridades de 1 a 4 com as frentes presentes em Analytics ou em Projetos, contando apenas atividades ainda em aberto. A intensidade da cor é proporcional ao valor máximo da matriz.

---

## 15 Aba RPA e Bots

O filtro de período desta seção usa a data de abertura do chamado, campo obrigatório no Pipefy e por isso presente em todos os registros.

A subaba Visão geral acrescenta um filtro local por fase do chamado, que atualiza apenas seus próprios indicadores e gráficos através da função `renderRPAStatus`. Ela reúne cinco indicadores, um gráfico de volume mensal em barras empilhadas, um donut de status por fase e uma distribuição de chamados por área, na qual áreas secundárias do inventário são agregadas sob "Outros".

A subaba Top bots lista, em barras horizontais, a contagem de chamados por processo. A subaba Tipos de problema cruza tipo de problema com fase e com área, usando o componente `clusteredBars`, e apresenta dois donuts adicionais sobre reexecução e causa interna ou externa. A subaba Tempo de resolução calcula a média de dias por fase e o tempo médio por bot, considerando apenas bots com três ou mais chamados para evitar distorção estatística por amostra pequena. A subaba Chamados oferece busca textual sobre a lista completa, limitada a mil linhas exibidas por vez.

A subaba Inventário de bots reinterpreta o filtro de período: em vez de filtrar por data de ação, filtra por ano de entrada em produção (`AnoPRD`). Ela apresenta indicadores de composição do inventário, distribuição por área e perímetro, classificação por criticidade e frequência de execução, e uma tabela de cruzamento que aponta os dez bots em produção com mais chamados de manutenção associados — candidatos naturais a refatoração.

---

## 16 Análise automática

O botão "Gerar análise", presente em todas as abas, não envolve inteligência artificial ou modelo de linguagem: aciona um conjunto de regras determinísticas, escritas manualmente, que transformam os números do recorte atual em frases descritivas. Cada observação recebe uma classificação — positiva, negativa, alerta ou neutra — que define a cor e o ícone exibidos.

Quadro 10 — Critérios de análise por aba

| Aba | Critérios avaliados |
|---|---|
| Governança | taxa geral de conclusão; fonte com mais backlog aberto; concentração de carga por responsável da equipe CoE; percentual de ações canceladas |
| Projetos | contagem geral; lista nominal de atrasados por dias de atraso; projeto mais crítico por score de risco; frente com mais projetos; percentual não iniciado |
| Pipefy Melhorias | taxa de conclusão; complexidade predominante; frente com mais demanda; contagem de bloqueadas |
| Analytics | taxa de conclusão; atividades de prioridade 1 em aberto; frente com mais demanda; atividades sem data |
| RPA | concentração nos três processos com mais manutenções; taxa de chamados vencidos; problema mais frequente; tendência de volume mês a mês; área com mais chamados |
| Inventário de Bots | composição geral; área com mais bots em produção; bots críticos em produção; bot com mais chamados associados |

Os limiares numéricos usados nessas regras — por exemplo, 30% de concentração de carga ou 15% de variação mensal — foram definidos pela equipe para separar ruído estatístico normal de sinais que merecem atenção; não resultam de cálculo estatístico automático.

---

## 17 Gráficos

Os gráficos de linha, donut e barras empilhadas são produzidos pelo Chart.js. Cada função de gráfico devolve um trecho de HTML contendo um elemento `<canvas>` com identificador único e registra a configuração correspondente em uma fila interna, já que o elemento ainda não existe no DOM no momento da chamada. Após a inserção do HTML na página, a função `flushCharts` percorre essa fila e instancia cada gráfico. Instâncias anteriores com o mesmo identificador são destruídas antes da recriação, evitando o erro de canvas já em uso quando uma aba é reconstruída — por exemplo, ao alterar o filtro de período. No início de cada geração de dashboard, todas as instâncias ativas são destruídas de uma só vez.

Dois componentes visuais não usam Chart.js: as barras agrupadas da subaba Tipos de problema e o heatmap da aba Analytics são montados diretamente em HTML e CSS, para permitir controle total do layout.

---

## 18 Exportação para PDF

O botão "Exportar PDF" aciona `window.print()`, abrindo o diálogo de impressão nativo do navegador — não há geração de PDF customizada nem envio de dados a um servidor. Uma seção de impressão na folha de estilos oculta a navegação, os botões de ação, o filtro de período e o fundo animado, mostrando apenas o conteúdo da aba ativa no momento. Para exportar outra aba, é necessário navegar até ela antes de acionar a exportação.

---

## 19 Fundo animado

O fundo de partículas atrás do conteúdo é puramente decorativo. Um elemento `<canvas>` fixo desenha cerca de noventa e cinco pontos em movimento lento, conectados por linhas quando próximos o suficiente, com leve repulsão em relação ao cursor do mouse. A animação é recalculada a cada quadro via `requestAnimationFrame` e se ajusta automaticamente ao redimensionamento da janela.

---

## 20 Privacidade e segurança

Nenhum dado das planilhas carregadas sai do navegador do usuário: não há backend, API própria ou envio de arquivos a qualquer servidor, e todo o processamento ocorre localmente, em JavaScript. As conexões de rede feitas pela página servem exclusivamente para carregar bibliotecas de terceiros, ícones e fontes tipográficas — nenhuma delas recebe o conteúdo das planilhas.

A única informação que persiste entre sessões é o registro de atividades descrito na seção 13, mantido exclusivamente em `localStorage` local. Recarregar a página descarta o restante do estado — workbooks, dados normalizados e filtros —, exigindo novo carregamento das planilhas.

---

## 21 Glossário de renomeações

Durante uma revisão de nomenclatura, funções identificadas por siglas ou abreviações pouco claras foram renomeadas para identificadores completos e autoexplicativos, tanto no `app.js` quanto em `src/` e `index.html`. Nenhum comportamento do sistema foi alterado nessa revisão.

Quadro 11 — Funções renomeadas

| Nome anterior | Nome atual | Função |
|---|---|---|
| `hf` | `handleFileInputChange` | trata a seleção de arquivo pelo input de upload |
| `dzO` | `handleDropzoneDragOver` | trata o arraste de um arquivo sobre a área de upload |
| `dzL` | `handleDropzoneDragLeave` | trata a saída do arraste da área de upload |
| `dzD` | `handleDropzoneDrop` | trata a soltura do arquivo na área de upload |
| `_cid` | `_generateChartId` | gera um identificador único de canvas para cada gráfico |
| `_animateNum` | `_animateNumber` | anima a contagem visual dos indicadores numéricos |
| `ym` | `toYearMonthKey` | converte uma data em chave de agrupamento mensal |
| `ymLabel` | `toYearMonthLabel` | converte a chave mensal em rótulo legível |
| `get` | `getColumnValue` | lê o valor de uma coluna da planilha, com nomes alternativos |
| `pct` | `calculatePercentage` | calcula uma porcentagem arredondada |
| `hbars` | `horizontalBars` | monta um gráfico de barras horizontais |
| `chartVBars` | `verticalBarsChart` | monta o gráfico de barras verticais empilhadas |
| `buildAna` | `buildAnalytics` | constrói a aba Analytics |
| `avgField` | `averageField` | calcula a média de um campo numérico |
| `normBotName` | `normalizeBotName` | normaliza o nome de um bot para comparação aproximada |

Além dessa revisão de siglas, uma segunda etapa traduziu para português os identificadores e comentários originalmente escritos em inglês, mantida a convenção de preservar em inglês apenas os códigos internos de status (`done`, `doing`, `todo`, `blocked`, `cancel`, `closing`, `monitor`, `vendor`, `other`), por funcionarem como um conjunto fechado de constantes internas, sem relação direta com texto exibido ao usuário.

Quadro 12 — Principais funções traduzidas

| Nome em inglês | Nome em português |
|---|---|
| `statusClass` | `classeStatus` |
| `improvementStatusClass` | `classeStatusMelhoria` |
| `getStandardCoeName` | `nomePadraoCoe` |
| `getProjectPhase` | `faseProjeto` |
| `isProjectOverdue` | `projetoAtrasado` |
| `getProjectRisk` | `riscoProjeto` |
| `allActions` | `todasAcoes` |
| `allActionsFiltered` | `todasAcoesFiltradas` |
| `buildGovernance` | `construirGovernanca` |
| `buildHeatmap` (nome mantido) | `construirMapaCalor` |
| `buildImprovements` | `construirMelhorias` |
| `applyDate` | `filtrarPorPeriodo` |
| `inDateRange` | `dataNoIntervalo` |
| `activeInRange` | `ativoNoIntervalo` |
| `analyzeGovernance`, `analyzeProjects` etc. | `analisarGovernanca`, `analisarProjetos` etc. |

Esta segunda etapa, no momento da última atualização deste documento, cobre o núcleo de dados (Seção 1), a aba Governança, a aba Melhorias com o registro de atividades, e o módulo de análise automática. As funções relacionadas a upload, navegação, filtros, parsers e às abas Projetos, Analytics, RPA e Bots ainda mantêm identificadores em inglês e serão atualizadas em uma etapa posterior.
