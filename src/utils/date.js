// utils/date.js — funções de data (parsing/formatação) e o filtro global de período.
//
// FILTRO GLOBAL DE PERÍODO:
//   Cada fonte usa uma data de referência diferente:
//   - Melhorias Pipefy: DataConclusaoRealDesenvolvimento (data de entrega no dev)
//   - Projetos: PrazoConclusão (prazo de entrega do projeto)
//   - Analytics: DataAbertura ou DataFechamento
//   - Chamados RPA: criado (data de abertura do chamado)
//   - Inventário de bots: NÃO filtra por data de ação; usa AnoPRD separadamente
//
//   ATENÇÃO: itens sem data ficam FORA do filtro quando ele está ativo.
//   Isso é intencional e transparente — o app mostra o aviso.
//   Nunca inventamos uma data pra item que não tem.

import { App } from '../state.js';
import { MESES, HOJE, MS_PER_DAY, EXCEL_EPOCH_OFFSET } from '../constants.js';

// Retorna a data de referência de um item normalizado.
// Prioridade: data de conclusão (dataFim) > data de criação (criado).
// Para Chamados RPA, criado é a data de abertura do chamado.
export function dataReferencia(item){
  return item.dataFim || item.criado || null;
}

// Checa se uma data passa no filtro global de período.
// Retorna true se: modo=all, ou a data está dentro do intervalo.
// Retorna false se: modo=custom e não há data (item fica fora do filtro).
export function dataNoIntervalo(date){
  const pf = App.periodoFiltro;
  if(pf.modo === 'all') return true;        // sem filtro: tudo passa
  if(!date) return false;                    // sem data: não entra num período específico
  if(pf.de && date < pf.de) return false;     // antes do início: fora
  if(pf.ate && date > pf.ate) return false;   // depois do fim: fora
  return true;
}

// Checa se um item esteve ATIVO durante o período do filtro, considerando um
// intervalo [início, fim] em vez de uma data única. Usado para Pipefy, onde uma
// melhoria tem início e conclusão de desenvolvimento.
// Regras (modo custom):
//   - tem início e fim → passa se o intervalo do item cruza o intervalo do filtro
//   - só tem início (em andamento) → passa se começou antes do fim do filtro
//     (considerado ativo do início até hoje)
//   - só tem fim → cai no comportamento de data única (dataNoIntervalo no fim)
//   - sem nenhuma data → fora (contado como "sem data")
// Retorna 'in' | 'out' | 'nodate'.
export function ativoNoIntervalo(ini, fim){
  const pf = App.periodoFiltro;
  if(pf.modo === 'all') return 'in';
  if(!ini && !fim) return 'nodate';
  // limites do filtro (qualquer um pode ser null = aberto naquele lado)
  const filtroDe  = pf.de  || new Date(-8640000000000000);
  const filtroAte = pf.ate || new Date( 8640000000000000);
  // limites do item: se falta início, usa o fim; se falta fim, considera "até hoje" (em andamento)
  const itemIni = ini || fim;
  const itemFim = fim || HOJE;
  // sobreposição de intervalos: começa antes do fim do filtro E termina depois do início do filtro
  return (itemIni <= filtroAte && itemFim >= filtroDe) ? 'in' : 'out';
}

/*
 * Aplica o filtro de data a um array inteiro.
 * Retorna: { kept: [...itens que passaram], noDate: N (quantidade sem data) }
 * Para itens que têm dataInicio (ex: Pipefy, Analytics), usa a lógica de "ativo no
 * período" (intervalo início→fim) — MAS só enquanto o item ainda está em
 * andamento. Um item já concluído (codigoStatus==='done') tem uma data de conclusão real
 * e fixa (dataFim); nesse caso o filtro passa a checar só se ESSA data cai no
 * período, com dataNoIntervalo. Se usássemos o intervalo inteiro também para
 * concluídos, um item que só passou pelo período em desenvolvimento e fechou
 * bem depois apareceria como "concluído no período" de forma enganosa.
 * Para os demais itens (sem dataInicio), usa a data única de dataReferencia.
 * Os itens sem data não são perdidos — ficam fora do recorte e o número é
 * exibido na nota de transparência da interface.
 */
export function filtrarPorPeriodo(arr){
  if(App.periodoFiltro.modo === 'all') return { kept: arr, noDate: 0 };
  const kept = [], noDate = [];
  arr.forEach(x => {
    if(x.dataInicio !== undefined && x.codigoStatus !== 'done'){
      // ainda em andamento: usa o intervalo início→fim (ativoNoIntervalo)
      const rangeStatus = ativoNoIntervalo(x.dataInicio, x.dataFim);
      if(rangeStatus === 'nodate') noDate.push(x);
      else if(rangeStatus === 'in') kept.push(x);
    } else {
      // já concluído (ou sem conceito de intervalo): data única de referência
      const date = dataReferencia(x);
      if(!date) noDate.push(x);
      else if(dataNoIntervalo(date)) kept.push(x);
    }
  });
  return { kept, noDate: noDate.length };
}

/*
 * Converte qualquer tipo de valor pra Date (ou null se inválido).
 * Necessário porque o Excel pode guardar datas como:
 *   - um objeto Date (quando cellDates:true e o SheetJS consegue interpretar)
 *   - um serial do Excel (ex: 45678 = dias desde 1900-01-01)
 *   - uma string de data (ex: "2026-04-24")
 *
 * NORMALIZAÇÃO DE FUSO: tanto o SheetJS (com cellDates:true) quanto o parser de
 * string "AAAA-MM-DD" do JavaScript constroem a data como meia-noite em UTC.
 * Num fuso com offset negativo (Brasil, UTC-3), ler ano/mês/dia dessa data com
 * os métodos locais (getFullYear/getMonth/getDate) desloca o dia pra trás — o
 * dia 1º de um mês "vira" 21h do último dia do mês anterior, e todo agrupamento
 * por mês (evolução de melhorias, volume mensal de chamados RPA) fica errado
 * bem no primeiro dia de cada mês. Por isso, sempre que a data resultante cai
 * exatamente à meia-noite UTC (sinal de que é uma data pura, sem hora real),
 * reconstruímos como uma data LOCAL com os mesmos componentes de ano/mês/dia,
 * eliminando esse deslocamento em qualquer lugar do site que leia essa data.
 */
export function paraData(rawValue){
  if(!rawValue) return null;
  let date;
  if(rawValue instanceof Date){
    date = isNaN(rawValue) ? null : rawValue;
  } else if(typeof rawValue === 'number'){
    date = new Date(Math.round((rawValue - EXCEL_EPOCH_OFFSET) * 864e5));
    if(isNaN(date)) date = null;
  } else if(typeof rawValue === 'string' && rawValue.length > 4){
    date = new Date(rawValue);
    if(isNaN(date)) date = null;
  } else {
    date = null;
  }
  if(!date) return null;
  // A hora nunca importa pra essas datas (são datas de negócio, não timestamps) —
  // por isso ignoramos qualquer componente de hora e reconstruímos direto a
  // partir do ano/mês/dia em UTC. Fazer essa normalização sempre, em vez de só
  // quando a hora bate exatamente meia-noite, evita escapar de casos em que o
  // serial do Excel chega com uma pequena imprecisão de ponto flutuante (ex:
  // 46579,999999998 em vez de 46580) e a hora não fica exatamente zerada.
  return new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

// Formata uma Date como string "YYYY-MM" (usado como chave de agrupamento mensal)
export function paraChaveAnoMes(date){ return date ? `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}` : ''; }

// Converte "YYYY-MM" num rótulo legível "Mmm/AA" (ex: "2026-04" → "Abr/26")
export function paraRotuloAnoMes(chaveMes){
  if(!chaveMes) return '';
  const partes = chaveMes.split('-');
  return `${MESES[+partes[1]-1]}/${partes[0].slice(2)}`;
}

// Converte uma Date pra string "YYYY-MM-DD" (formato ISO, usado nos inputs de data).
export function paraDataIso(date){ return date.toISOString().slice(0, 10); }

// Calcula o número de dias entre duas datas.
// Positivo = date1 é mais recente que date2 (ex: hoje - prazo = dias de atraso).
export function diasEntre(date1, date2){ return Math.round((date1 - date2) / MS_PER_DAY); }
