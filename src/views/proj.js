import { App } from '../state.js';
import { applyDate } from '../utils/date.js';
import { projAtrasado, projRisco, projFase } from '../utils/classify.js';
import { STATUS_BADGE } from '../constants.js';
import { count, pct } from '../utils/helpers.js';
import { donut, hbars } from '../charts.js';
import { aiBar } from '../analysis.js';
import { setBadge } from '../nav.js';

// ─── MÓDULO: views/proj.js ───────────────────────────────────────────────────
// Aba Projetos: KPIs de portfólio, gráficos de status/frente e lista filtrável.
//
// Exporta:
//   buildProj()            — renderiza aba completa (KPIs + filtros + lista)
//   renderProjList()       — re-renderiza apenas a lista com filtros atuais
//   toggleProjChip(qual)   — ativa/desativa filtro rápido ('atraso' | 'risco')
//   toggleProj(key)        — expande ou recolhe o painel de detalhes de um projeto
//
// Funções internas (privadas):
//   projDetails(p)         — HTML do painel expandido com campos ricos da planilha
// ─────────────────────────────────────────────────────────────────────────────

// ─── buildProj ────────────────────────────────────────────────────────────────
// Monta a aba Projetos com KPIs, donut de status, barras por frente e lista filtrada.
export function buildProj() {
  const { kept: P, noDate } = applyDate(App.P.proj);

  // Mostra a aba se houver projetos filtrados OU projetos sem data (são exibidos sem filtro)
  document.getElementById('proj-empty').style.display  = (P.length || noDate) ? 'none' : 'block';
  document.getElementById('proj-content').style.display = (P.length || noDate) ? 'block' : 'none';
  if (!P.length && !noDate) return;

  const done       = P.filter(p => p.sc === 'done').length;
  const doing      = P.filter(p => p.sc === 'doing').length;
  const finalizando = P.filter(p => p.sc === 'closing' || p.sc === 'monitor').length;
  const atrasados  = P.filter(projAtrasado);
  const criticos   = P.filter(p => projRisco(p).nivel === 'alto').length;

  let h = `<div class="sh">Projetos</div>
  ${aiBar('proj')}
  <div class="krow k5">
    <div class="kpi"><div class="knum">${P.length}</div><div class="klbl">Total</div></div>
    <div class="kpi il"><div class="knum">${doing}</div><div class="klbl">Em execução</div></div>
    <div class="kpi gl"><div class="knum">${finalizando}</div><div class="klbl">Em fase final</div>
      <div class="ksub">encerramento / monit.</div></div>
    <div class="kpi dl"><div class="knum">${atrasados.length}</div><div class="klbl">Atrasados</div>
      <div class="ksub">prazo vencido</div></div>
    <div class="kpi wl"><div class="knum">${criticos}</div><div class="klbl">Risco alto</div>
      <div class="ksub">score de risco</div></div>
  </div>`;

  // Conta projetos por frente/área para o gráfico de barras
  const frCount = count(P.filter(p => p.frente), p => p.frente);

  const donutProj = [
    { label: 'Concluído',       value: P.filter(p => p.sc === 'done').length,                          color: '#2f7d4f' },
    { label: 'Em andamento',    value: P.filter(p => p.sc === 'doing').length,                         color: '#3b82c4' },
    { label: 'Em encerramento', value: P.filter(p => p.sc === 'closing' || p.sc === 'monitor').length, color: '#5bbd7a' },
    { label: 'Não iniciado',    value: P.filter(p => p.sc === 'todo').length,                          color: '#b8bcc2' },
    { label: 'Bloqueado',       value: P.filter(p => p.sc === 'blocked').length,                       color: '#d89b3c' },
    { label: 'Cancelado',       value: P.filter(p => p.sc === 'cancel').length,                        color: '#c75d5d' }
  ].filter(d => d.value); // omite status sem projetos

  h += `<div class="two">
    <div class="card"><div class="card-title"><i class="ti ti-chart-pie"></i> Por status</div>
      ${donut(donutProj)}</div>
    <div class="card"><div class="card-title"><i class="ti ti-building"></i> Por frente / área cliente</div>
      ${Object.keys(frCount).length ? hbars(Object.entries(frCount).sort((a, b) => b[1] - a[1]), { max: 8, lw: 80, tot: P.length }) : '<div style="font-size:12px;color:var(--ink4)">Sem dados de área</div>'}</div>
  </div>`;

  // Filtros de texto, chips e selects acima da lista
  const pessoas = [...new Set(P.map(p => p.resp).filter(Boolean))].sort();
  h += `<div class="filters" style="margin-top:4px">
    <input type="text" id="proj-q" placeholder="Buscar projeto, responsável, frente..." oninput="renderProjList()" style="flex:1;max-width:280px">
    <button class="df-chip" id="proj-chip-atraso" onclick="toggleProjChip('atraso')">⚠ Só atrasados</button>
    <button class="df-chip" id="proj-chip-risco" onclick="toggleProjChip('risco')">Risco alto</button>
    <label>Responsável</label>
    <select id="proj-fp" onchange="renderProjList()"><option value="">Todos</option>
      ${pessoas.map(p => `<option>${p}</option>`).join('')}</select>
    <label>Status</label>
    <select id="proj-fs" onchange="renderProjList()"><option value="">Todos</option>
      ${[...new Set(P.map(p => p.statusRaw).filter(Boolean))].sort().map(s => `<option>${s}</option>`).join('')}</select>
    <label>Frente</label>
    <select id="proj-ff" onchange="renderProjList()"><option value="">Todas</option>
      ${[...new Set(P.map(p => p.frente).filter(Boolean))].sort().map(f => `<option>${f}</option>`).join('')}</select>
    <span style="font-size:11px;color:var(--ink4);margin-left:auto" id="proj-count"></span>
  </div>`;
  h += `<div class="card np"><div class="ilist" id="proj-list" style="border:none;border-radius:0"></div></div>`;

  document.getElementById('proj-content').innerHTML = h;
  renderProjList();
  setBadge('nb-proj', P.length + ' proj', '');
}

// ─── renderProjList ───────────────────────────────────────────────────────────
// Re-renderiza a lista filtrada de projetos quando qualquer filtro muda.
//
// ORDENAÇÃO:
//   Os projetos são exibidos do mais crítico para o menos crítico.
//   Critério primário: score de risco (maior score = aparece primeiro).
//   Critério secundário (empate): % de progresso (mais adiantado primeiro).
//   Isso coloca projetos atrasados e bloqueados no topo automaticamente.
export function renderProjList() {
  const { kept: P } = applyDate(App.P.proj);

  // Lê os valores atuais de todos os filtros (podem ser null se o DOM ainda não existir)
  const q  = (document.getElementById('proj-q')?.value || '').toLowerCase();
  const fp = document.getElementById('proj-fp')?.value || '';   // filtro de responsável
  const fs = document.getElementById('proj-fs')?.value || '';   // filtro de status
  const ff = document.getElementById('proj-ff')?.value || '';   // filtro de frente
  const chips = App.projChips || { atraso: false, risco: false };

  // Aplica todos os filtros simultaneamente
  let vis = P.filter(p =>
    // busca textual: procura em título, responsável, frente, descrição e próximos passos
    (!q || (p.titulo + ' ' + p.resp + ' ' + p.frente + ' ' + (p.descricao || '') + ' ' + (p.proximos || '')).toLowerCase().includes(q)) &&
    (!fp || p.resp === fp) &&
    (!fs || p.statusRaw === fs) &&
    (!ff || p.frente === ff) &&
    (!chips.atraso || projAtrasado(p)) &&  // chip "só atrasados": ignora se desativado
    (!chips.risco  || projRisco(p).nivel === 'alto') // chip "risco alto": ignora se desativado
  );

  // Ordena: mais crítico primeiro (score maior), desempata pelo progresso (mais adiantado)
  vis.sort((a, b) => {
    const ra = projRisco(a).score, rb = projRisco(b).score;
    if (rb !== ra) return rb - ra;             // score diferente: mais crítico primeiro
    return (b.prog || 0) - (a.prog || 0);      // empate: mais adiantado primeiro
  });

  const cnt = document.getElementById('proj-count');
  if (cnt) cnt.textContent = `${vis.length} de ${P.length}`;

  if (!App.projOpen) App.projOpen = new Set();

  // Cor do ponto colorido que indica o status (visualmente intuitivo)
  const dotColor = {
    done: '#3fa46a', doing: '#4a90d9', closing: '#d49a4a', monitor: '#6fa0e0',
    todo: '#9a9a92', blocked: '#d4a93c', cancel: '#d46a6a', vendor: '#8f6fd0', other: '#9a9a92'
  };

  let h = vis.map(p => {
    const bd      = STATUS_BADGE[p.sc];
    const lateTag = projAtrasado(p);
    const risco   = projRisco(p);
    const key     = String(p.num || p.titulo); // chave única para controlar expansão
    const open    = App.projOpen.has(key);     // está expandido?
    const dc      = dotColor[p.sc] || dotColor.other;

    // Badge de risco: só aparece se for médio ou alto
    const riscoBadge = risco.nivel === 'alto'
      ? `<span class="badge red" title="${risco.motivos.join(' · ')}">risco alto</span>`
      : (risco.nivel === 'medio' ? `<span class="badge warn" title="${risco.motivos.join(' · ')}">risco médio</span>` : '');

    return `<div class="proj-row ${open ? 'open' : ''}" data-k="${key.replace(/"/g, '')}">
      <div class="icard" onclick="toggleProj('${key.replace(/'/g, "\\'").replace(/"/g, '&quot;')}')" style="cursor:pointer">
        <div class="iico" style="background:var(--neu-bg)">
          <span style="width:11px;height:11px;border-radius:50%;background:${dc};display:block"></span>
        </div>
        <div class="imain"><div class="ititle">${p.titulo}</div>
          <div class="isub">
            ${p.frente ? `<span class="apill">${p.frente}</span>` : ''}
            ${p.resp   ? `<span>${p.resp}</span>` : ''}
            ${p.dtFim  ? `<span style="color:${lateTag ? 'var(--err)' : 'var(--ink4)'}">· ${p.dtFim.toLocaleDateString('pt-BR')}${lateTag ? ` ⚠ atrasado em ${p.statusRaw}` : ''}</span>` : ''}
          </div>
          ${p.prog != null
            ? `<div class="stk" style="max-width:280px"><div style="width:${Math.round(p.prog * 100)}%;background:var(--info)"></div></div>`
            : ''}
        </div>
        <div class="iright">
          ${riscoBadge}
          ${p.prog != null ? `<span style="font-size:11px;color:var(--ink3);font-weight:600">${Math.round(p.prog * 100)}%</span>` : ''}
          <span class="badge ${bd}">${p.statusRaw}</span>
          <!-- seta rotacionada quando expandido -->
          <span style="color:var(--ink4);font-size:11px;margin-left:6px;display:inline-block;transition:transform .15s;transform:rotate(${open ? '90deg' : '0deg'})">▶</span>
        </div>
      </div>
      ${open ? projDetails(p) : ''} <!-- painel de detalhes: só renderiza quando aberto -->
    </div>`;
  }).join('');

  const el = document.getElementById('proj-list');
  if (el) el.innerHTML = h || '<div class="empty" style="padding:24px">Nenhum projeto neste filtro</div>';
}

// ─── toggleProjChip ────────────────────────────────────────────────────────────
// Inverte o estado de um chip de filtro rápido e re-renderiza a lista.
export function toggleProjChip(qual) {
  if (!App.projChips) App.projChips = { atraso: false, risco: false };
  App.projChips[qual] = !App.projChips[qual]; // inverte: ativo → inativo, inativo → ativo

  const map = { atraso: 'proj-chip-atraso', risco: 'proj-chip-risco' };
  const btn = document.getElementById(map[qual]);
  if (btn) btn.classList.toggle('active', App.projChips[qual]); // destaca o botão quando ativo

  renderProjList();
}

// ─── toggleProj ────────────────────────────────────────────────────────────────
// Expande ou recolhe o painel de detalhes de um projeto ao clicar na linha.
// O estado de quais projetos estão abertos é guardado em App.projOpen (Set).
export function toggleProj(key) {
  if (!App.projOpen) App.projOpen = new Set();
  if (App.projOpen.has(key)) App.projOpen.delete(key); // estava aberto → fecha
  else App.projOpen.add(key);                          // estava fechado → abre
  renderProjList(); // re-renderiza para aplicar a mudança de estado
}

// ─── projDetails [PRIVADO] ───────────────────────────────────────────────────
// Gera o HTML do painel expandido de um projeto.
// Só renderiza campos que estão preenchidos na planilha — campos vazios não aparecem.
// Isso evita seções em branco quando a planilha tem campos opcionais não preenchidos.
function projDetails(p) {
  const fmt = txt => String(txt || '').trim().replace(/\n/g, '<br>'); // preserva quebras de linha

  const blocks = [];
  if (p.descricao)   blocks.push({ lbl: 'Descrição',               val: fmt(p.descricao) });
  if (p.equipes)     blocks.push({ lbl: 'Equipes envolvidas',      val: fmt(p.equipes) });
  if (p.focal)       blocks.push({ lbl: 'Ponto focal',             val: p.focal });
  if (p.atvConcl)    blocks.push({ lbl: 'Atividades concluídas',   val: fmt(p.atvConcl) });
  if (p.atvAndam)    blocks.push({ lbl: 'Atividades em andamento', val: fmt(p.atvAndam) });
  if (p.proximos)    blocks.push({ lbl: 'Próximos passos',         val: fmt(p.proximos) });
  if (p.comentarios) blocks.push({ lbl: 'Comentários',             val: fmt(p.comentarios) });

  if (!blocks.length) {
    return `<div class="proj-detail"><div style="font-size:12px;color:var(--ink4);font-style:italic">Sem detalhes preenchidos na planilha.</div></div>`;
  }

  return `<div class="proj-detail">` + blocks.map(b =>
    `<div class="pd-block"><div class="pd-lbl">${b.lbl}</div><div class="pd-val">${b.val}</div></div>`
  ).join('') + `</div>`;
}
