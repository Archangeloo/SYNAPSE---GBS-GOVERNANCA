# TODO — pontos levantados durante a refatoração

## Dependência circular (src/ → será recriada no app.js modularizado)

Ao mapear `src/` (Etapa 0), foi identificado um ciclo de import:

- `src/views/gov.js` importa `aiBar` de `src/analysis.js`
- `src/analysis.js` importa `allActionsFiltered` de `src/views/gov.js`

Isso não quebra nada hoje porque `src/` não é a versão que roda no navegador
(ver README: apenas `app.js` é carregado pelo `index.html`). Mas a mesma relação
existe implicitamente dentro do `app.js` monolítico (a seção de Governança usa
`aiBar()`, e a seção de Análise usa `allActionsFiltered()`), então o mesmo ciclo
vai reaparecer se a Etapa 3 recriar módulos com essa mesma divisão.

**Decisão do usuário:** não corrigir agora — só documentar aqui.

**Quando chegar na Etapa 3 (quebra em módulos):** ao decidir os limites dos
módulos, considerar extrair `allActionsFiltered()` (e `allActions()`) para um
módulo de dados compartilhado (ex: `data/actions.js`) que tanto o módulo de
Governança quanto o de Análise possam importar, em vez de um depender do outro.
