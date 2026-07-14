// ─── MODULE: views/mel-activities.js ───────────────────────────────────────
// MELHORIAS — REGISTRO MANUAL DE ATIVIDADES
// Card "Atividades" no final da aba Pipefy Melhorias.
//
// Diferente do resto da aba (que vem inteiramente da planilha), esses
// registros são criados e mantidos manualmente pela equipe dentro do
// próprio site. Eles existem porque o acompanhamento apresentado para
// a gestão é organizado por tema/iniciativa (ex: "Anticipos v1",
// "Miscelaneas v1"), e esses temas não têm correspondência 1:1 com
// linhas da planilha Pipefy_Melhorias — então essa tabela não pode ser
// calculada a partir de App.P.improvements como o resto da aba.
//
// PERSISTÊNCIA:
// Os registros são salvos no localStorage do navegador (chave
// CHAVE_ARMAZENAMENTO_ATIVIDADES_MELHORIAS), não em nenhuma planilha e
// nem em servidor — consistente com a arquitetura 100% local do SYNAPSE
// (ver README). Isso significa que:
//   - Sobrevivem a recarregar a página e regerar o dashboard com uma
//     planilha diferente (não dependem do Excel carregado).
//   - Ficam restritos a este navegador/computador — não aparecem para
//     quem abre o site em outra máquina.
//   - São apagados se o usuário limpar os dados de navegação do site.
//
// Exportações (indiretamente, via window — ver main.js):
//   renderizarSecaoAtividadesMelhorias() — chamada por construirMelhorias()
//   abrirFormularioAtividade(idAtividade?)
//   fecharFormularioAtividade()
//   fecharFormularioAtividadeAoClicarFora(event)
//   salvarFormularioAtividade(event)
//   confirmarExclusaoAtividade(idAtividade)
// ─────────────────────────────────────────────────────────────────────────────

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
export function renderizarSecaoAtividadesMelhorias() {
  const container = document.getElementById('mel-atividades');
  if (container) container.innerHTML = construirSecaoAtividadesMelhorias();
}

/*
 * abrirFormularioAtividade(idAtividade)
 * Sem argumento, abre o modal em branco (modo criação). Com o id de
 * um registro existente, abre o modal preenchido com os valores atuais
 * (modo edição).
 */
export function abrirFormularioAtividade(idAtividade) {
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
export function fecharFormularioAtividade() {
  document.getElementById('fundo-formulario-atividade').classList.add('oculto');
}

/*
 * fecharFormularioAtividadeAoClicarFora(event)
 * O modal cobre a tela inteira com um fundo escurecido
 * (#fundo-formulario-atividade) atrás da caixa branca. Clicar nesse
 * fundo fecha o modal; clicar dentro da caixa (ou nos campos) não deve
 * fechar — daí a checagem do alvo do clique.
 */
export function fecharFormularioAtividadeAoClicarFora(event) {
  if (event.target.id === 'fundo-formulario-atividade') fecharFormularioAtividade();
}

/*
 * salvarFormularioAtividade(event)
 * Handler de submit do formulário do modal. Decide entre criar ou
 * atualizar com base no campo oculto "campo-atividade-id": vazio
 * significa um registro novo; preenchido significa editar um existente.
 */
export function salvarFormularioAtividade(event) {
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
export function confirmarExclusaoAtividade(idAtividade) {
  const usuarioConfirmou = window.confirm('Excluir esta atividade? Essa ação não pode ser desfeita.');
  if (!usuarioConfirmou) return;

  excluirAtividadeMelhoria(idAtividade);
  renderizarSecaoAtividadesMelhorias();
}
