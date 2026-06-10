# SYNAPSE · Governança GBS

Dashboard de governança do CoE de Projetos e Automações do GBS (Global Business Services).  
Permite acompanhar projetos, melhorias Pipefy, chamados de manutenção de RPA e Analytics em uma única interface, a partir das planilhas que a equipe já usa.

---

## Como funciona

O site roda **100% no navegador** — sem servidor, sem banco de dados, sem instalação.  
O usuário carrega as planilhas Excel diretamente na tela de Upload; a aplicação lê, processa e gera o dashboard na hora.

```
Planilhas → FileReader → SheetJS → Parsers → KPIs + Gráficos → Dashboard
```

---

## Como usar

1. Abra o arquivo `index.html` no navegador (Chrome ou Edge recomendados).
2. Na tela **Upload**, carregue as duas bases de dados:

| Arquivo esperado | Abas lidas |
|---|---|
| `Base_Governanca_GBS.xlsx` | Pipefy_Melhorias · Projetos · Analytics · Inventario_RPA |
| `relatório_completo.xlsx` | Report |

3. Clique em **Gerar dashboard**.
4. Navegue pelas abas — o filtro de período no topo se aplica a todas ao mesmo tempo.

> Nenhum dado é enviado para a internet. Tudo fica no próprio navegador.

---

## Abas do dashboard

| Aba | Conteúdo |
|---|---|
| **Painel de Controle** | Visão executiva: KPIs consolidados de todas as frentes, ações abertas por responsável do CoE |
| **Projetos** | Portfólio de projetos — status, fase, prazo, risco e detalhes por projeto |
| **Pipefy Melhorias** | Melhorias e ajustes do Pipefy — status, complexidade, por frente e por responsável |
| **RPA & Bots** | Chamados de manutenção de RPA (volume, tipos de problema, tempo de resolução) + Inventário de bots |
| **Analytics** | Atividades de Analytics — entregas, status e distribuição por tipo |

---

## Filtro de período

O filtro global (botões **Este mês / Trimestre / Este ano** ou intervalo manual) recorta os dados de todas as abas simultaneamente.

Cada fonte usa a data que faz mais sentido para ela:

- **Pipefy Melhorias** → data de conclusão do desenvolvimento
- **Projetos** → prazo de conclusão
- **Analytics** → data de abertura ou fechamento
- **Chamados RPA** → data de abertura do chamado
- **Inventário de Bots** → ano de entrada em produção (AnoPRD)

Itens sem data ficam fora do recorte quando o filtro está ativo — comportamento intencional, sempre sinalizado na interface.

---

## Estrutura de arquivos

```
SYNAPSE - GBS GOVERNANCA/
│
├── index.html          # Página principal (estrutura HTML)
├── app.js              # JavaScript compilado (bundle — é esse que o navegador carrega)
│
├── styles/
│   └── main.css        # Estilos da interface (identidade visual Saint-Gobain / GBS)
│
├── src/                # Código-fonte modular (usado para gerar o app.js)
│   ├── main.js
│   ├── state.js
│   ├── constants.js
│   ├── charts.js
│   ├── analysis.js
│   ├── nav.js
│   ├── upload.js
│   ├── filters.js
│   ├── parsers/
│   │   ├── gov.js      # Parser da Base Governança
│   │   └── rpa.js      # Parser dos Chamados RPA
│   ├── views/
│   │   ├── gov.js      # View: Painel de Controle
│   │   ├── proj.js     # View: Projetos
│   │   ├── mel.js      # View: Pipefy Melhorias
│   │   ├── ana.js      # View: Analytics
│   │   ├── rpa.js      # View: RPA & Bots
│   │   └── bots.js     # View: Inventário de Bots
│   └── utils/
│       ├── date.js
│       ├── classify.js
│       └── helpers.js
│
├── logo_gbs.png        # Logo GBS (exibido no cabeçalho)
├── package.json        # Configuração de build (esbuild)
└── README.md           # Este arquivo
```

---

## Dependências externas

Todas carregadas via CDN — não é necessário instalar nada para rodar:

| Biblioteca | Uso |
|---|---|
| [SheetJS (xlsx)](https://sheetjs.com/) | Leitura dos arquivos Excel no navegador |
| [Tabler Icons](https://tabler.io/icons) | Ícones da interface |
| [Inter + Syne](https://fonts.google.com/) | Tipografia (Google Fonts) |

---

## Modificar o código-fonte

O arquivo `app.js` é gerado automaticamente a partir dos módulos em `src/`.  
Para modificar a lógica e recompilar, é necessário ter [Node.js](https://nodejs.org) instalado.

```bash
# Instalar dependências de build
npm install

# Compilar uma vez
npm run build

# Compilar e observar alterações automaticamente
npm run dev
```

> Se quiser apenas ajustar estilos ou o HTML, edite `styles/main.css` ou `index.html` diretamente — não é necessário recompilar.

---

## Identidade visual

A interface segue a paleta de cores Saint-Gobain / GBS:

| Variável | Cor | Uso |
|---|---|---|
| `--brand` | `#0F5299` | Cabeçalho, cor principal de marca |
| `--accent` | `#0195D6` | Links ativos, botões, destaques interativos |
| `--teal` | `#4DB1B3` | Acento secundário |
| `--err` | `#C5284C` | Erros e alertas críticos |
| `--warn` | `#9A3412` | Avisos e prazos em risco |

As cores são definidas como variáveis CSS em `styles/main.css` e podem ser ajustadas em um único lugar.

---

## Responsável técnico

CoE Projetos e Automações — GBS Saint-Gobain Brasil
