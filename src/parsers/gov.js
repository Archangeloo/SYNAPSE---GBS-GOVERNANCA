import { App } from '../state.js';
import { findSheet, get } from '../utils/helpers.js';
import { toDate } from '../utils/date.js';
import { statusClass } from '../utils/classify.js';

// ─── MÓDULO: parsers/gov.js ──────────────────────────────────────────────────
// Parser da Base Governança (arquivo Excel principal do CoE).
// Lê 3 abas e normaliza os dados para os arrays de estado global.
//
// Exporta:
//   parseGov() — processa Pipefy_Melhorias → App.P.mel
//                         Projetos          → App.P.proj
//                         Analytics         → App.P.ana
//
// TOLERÂNCIAS IMPLEMENTADAS:
//   - Nomes de aba: busca por fragmento, insensível a maiúsculas/underlines
//   - Nomes de coluna: cada campo aceita múltiplos nomes alternativos
//   - Layout de Projetos: detecta automaticamente se o cabeçalho está correto
//     ou embaralhado (versão antiga), e lê por posição como fallback
//
// Para mapear uma nova coluna da planilha: adicione o nome no array do get()
// e inclua o campo no objeto retornado pelo .map().
// ─────────────────────────────────────────────────────────────────────────────

// ─── parseGov ─────────────────────────────────────────────────────────────────
// Processa as 3 abas da Base Governança: Pipefy_Melhorias, Projetos e Analytics.
// Chamado por generate() após o usuário clicar em "Gerar dashboard".
export function parseGov() {
  const wb = App.gov;

  /* ── Pipefy_Melhorias ─────────────────────────────────────────────────── */
  const sMel = findSheet(wb, 'pipefymelhorias') || findSheet(wb, 'melhorias');
  App.P.mel = sMel
    ? XLSX.utils.sheet_to_json(wb.Sheets[sMel], { defval: '' }).map(r => ({
        num:       get(r, ['Numero']),
        frente:    String(get(r, ['Gerencia'])).trim(),
        fluxo:     get(r, ['NomeFluxo']),
        atividade: get(r, ['Atividade']),
        statusRaw: String(get(r, ['Status'])).trim(),
        sc:        statusClass(get(r, ['Status'])),
        resp:      String(get(r, ['Responsavel'])).trim().replace(/​/g, ''),
        champion:  String(get(r, ['Champion'])).trim(),
        complex:   String(get(r, ['Complexidade'])).trim(),
        tipo:      String(get(r, ['TipoMelhoriaAjuste'])).trim(),
        // dtInicio e dtFim são usados para verificar se a melhoria estava ATIVA
        // num período (ver applyDate em utils/date.js)
        dtInicio:  toDate(get(r, ['DataInicioDesenvolvimento'])),
        dtFim:     toDate(get(r, ['DataConclusaoRealDesenvolvimento'])),
        horas:     get(r, ['QtdHorasEstimadas'])
      })).filter(r => r.num !== '' || r.atividade)
    : [];

  /* ── Projetos ────────────────────────────────────────────────────────── */
  const sProj = findSheet(wb, 'projetos');
  App.P.proj = [];
  if (sProj) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sProj], { defval: '' });

    // DETECÇÃO DE VERSÃO: testa se o header reconhece status esperados.
    // Se não reconhece nenhum, a planilha está no layout antigo (colunas embaralhadas).
    const sample = rows.slice(0, 5);
    const headerLooksRight = sample.some(r => statusClass(get(r, ['Status'])) !== 'other');

    if (headerLooksRight) {
      App.P.proj = rows.map(r => ({
        num:         get(r, ['Numero']),
        titulo:      String(get(r, ['Titulo'])).trim(),
        resp:        String(get(r, ['Responsavel'])).trim(),
        // AreaCliente = nome novo do campo; 'Frente' = fallback para base antiga
        frente:      String(get(r, ['AreaCliente', 'Frente'])).trim(),
        focal:       String(get(r, ['PontoFocal'])).trim(),
        statusRaw:   String(get(r, ['Status'])).trim(),
        sc:          statusClass(get(r, ['Status'])),
        dtFim:       toDate(get(r, ['PrazoConclusão', 'PrazoConclusao', 'DataFechamento'])),
        proximos:    String(get(r, ['ProximosPassos'])).trim(),
        equipes:     String(get(r, ['EquipesEnvolvidas'])).trim(),
        descricao:   String(get(r, ['DescricaoProjeto'])).trim(),
        atvConcl:    String(get(r, ['AtividadesConcluidas'])).trim(),
        atvAndam:    String(get(r, ['AtividadesAndamento'])).trim(),
        comentarios: String(get(r, ['Comentarios'])).trim(),
        prog: (() => {
          const v = get(r, ['ProgressoPct', 'Progresso']);
          return typeof v === 'number' ? v : (parseFloat(v) || null);
        })()
      })).filter(p => p.titulo);
    } else {
      // LAYOUT ANTIGO EMBARALHADO: lemos por posição (índice da coluna).
      // Mapeamento: col0=Numero, col1=Titulo, col2=Responsavel, col3=Frente,
      //             col4=PontoFocal, col5=Status, col6=DataFechamento, col7=ProximosPassos
      const raw = XLSX.utils.sheet_to_json(wb.Sheets[sProj], { defval: '', header: 1 });
      for (let i = 1; i < raw.length; i++) {
        const c = raw[i];
        if (c[0] === '' && c[1] === '') continue;
        if (!String(c[1] || '').trim()) continue;
        App.P.proj.push({
          num: c[0], titulo: String(c[1]).trim(), resp: String(c[2] || '').trim(),
          frente: String(c[3] || '').trim(), focal: String(c[4] || '').trim(),
          statusRaw: String(c[5] || '').trim(), sc: statusClass(c[5]),
          dtFim: toDate(c[6]), proximos: String(c[7] || '').trim(),
          equipes: '', descricao: '', atvConcl: '', atvAndam: '', comentarios: '',
          prog: typeof c[8] === 'number' ? c[8] : (parseFloat(c[8]) || null)
        });
      }
    }
  }

  /* ── Analytics ──────────────────────────────────────────────────────── */
  const sAna = findSheet(wb, 'analytics');
  App.P.ana = sAna
    ? XLSX.utils.sheet_to_json(wb.Sheets[sAna], { defval: '' }).map(r => ({
        num:       get(r, ['Numero']),
        titulo:    String(get(r, ['Titulo'])).trim(),
        statusRaw: String(get(r, ['Status'])).trim(),
        sc:        statusClass(get(r, ['Status'])),
        prioRaw:   String(get(r, ['Prioridade'])).trim(),
        prio:      (() => { const m = String(get(r, ['Prioridade'])).match(/\d+/); return m ? +m[0] : null; })(),
        frente:    String(get(r, ['Frente'])).trim(),
        resp:      String(get(r, ['Responsavel'])).trim(),
        // Muitas atividades não têm DataAbertura — o fallback para DataFechamento amplia a cobertura
        dtAbre:    toDate(get(r, ['DataAbertura'])),
        dtFim:     toDate(get(r, ['DataFechamento']))
      })).filter(r => r.titulo)
    : [];
}
