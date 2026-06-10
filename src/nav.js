// ─── Navegação principal ──────────────────────────────────────────────────────

// Alterna entre as abas principais do dashboard.
export function setNav(id) {
  ['upload', 'gov', 'proj', 'mel', 'rpa', 'ana'].forEach(n => {
    const ni = document.getElementById('nav-' + n);
    const pg = document.getElementById('page-' + n);
    if (ni) ni.classList.toggle('active', n === id);
    if (pg) pg.classList.toggle('active', n === id);
  });
}

// Alterna entre as sub-abas da aba RPA & Bots.
export function rpaPage(id) {
  document.querySelectorAll('#page-rpa .pip-sub-page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('#page-rpa .pip-nav-item').forEach(n => n.classList.remove('active'));
  const pg = document.getElementById('rpage-' + id);
  const nv = document.getElementById('rnav-' + id);
  if (pg) pg.classList.add('active');
  if (nv) nv.classList.add('active');
}

// Atualiza o badge numérico de uma aba no menu de navegação.
export function setBadge(id, txt, cls) {
  const e = document.getElementById(id);
  if (e) { e.textContent = txt; e.className = 'nb' + (cls ? ' ' + cls : ''); }
}
