/* ============================================================
   GBS Governança — motor de dados + dashboard
   Calibrado para as duas bases reais:
   - Base_Governanca_GBS (abas Pipefy_Melhorias, Projetos, Analytics)
   - relatório_completo (aba Report = chamados de manutenção RPA)
   ============================================================ */

const App = {
  gov: null, rpa: null,          // workbooks brutos
  P: { mel: [], proj: [], ana: [] }, // dados normalizados governança (FONTE)
  R: [],                          // chamados RPA normalizados (FONTE)
  B: [],                          // inventário de bots (não tem data de ação; não filtra)
  loaded: { gov: false, rpa: false },
  filt: { rpaFrente: '', rpaProb: '', rpaFase: '' },
  dateRange: { mode: 'all', from: null, to: null } // filtro global de data
};

// retorna a data de referência de um item normalizado (cada fonte tem a sua)
function refDate(item){ return item.dtFim || item.criado || null; }

// item passa no filtro de data global? (null = sem data, tratado à parte)
function inDateRange(d){
  const dr=App.dateRange;
  if(dr.mode==='all') return true;
  if(!d) return false; // sem data não entra em período específico
  if(dr.from && d < dr.from) return false;
  if(dr.to && d > dr.to) return false;
  return true;
}

// aplica filtro de data a um array, separando com/sem data
function applyDate(arr){
  if(App.dateRange.mode==='all') return { kept: arr, noDate: 0 };
  const kept=[], noDate=[];
  arr.forEach(x=>{
    const d=refDate(x);
    if(!d) noDate.push(x);
    else if(inDateRange(d)) kept.push(x);
  });
  return { kept, noDate: noDate.length };
}

const MESES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
const DOW = ['Seg','Ter','Qua','Qui','Sex','Sáb','Dom'];
const HOJE = new Date();

/* ---- Normalização de status (do dicionário de dados) ---- */
function statusClass(s){
  const t = (s||'').toString().trim().toLowerCase();
  if(['suporte pipefy','encaminhado ao fornecedor','pipefy'].includes(t)) return 'vendor';
  if(['concluído','concluido','finalizados','finalizado','encerramento','tema concluído.','tema concluído'].includes(t)) return 'done';
  if(['em andamento','em execução','execução','execucao','desenvolvimento','em validação','em validacao','aguardando validação','aguardando validacao'].includes(t)) return 'doing';
  if(['planejamento','diagnóstico','diagnostico','não iniciado','nao iniciado','backlog'].includes(t)) return 'todo';
  if(['bloqueado','pausado'].includes(t)) return 'blocked';
  if(['cancelado'].includes(t)) return 'cancel';
  return 'other';
}
const STATUS_PT = { done:'Concluído', doing:'Em andamento', todo:'Não iniciado', blocked:'Bloqueado', cancel:'Cancelado', vendor:'Suporte Pipefy', other:'Outro' };
const STATUS_BADGE = { done:'ok', doing:'info', todo:'neu', blocked:'warn', cancel:'red', vendor:'blue', other:'neu' };
const STATUS_COLOR = { done:'var(--ok)', doing:'var(--info)', todo:'var(--neu)', blocked:'var(--warn)', cancel:'var(--err)', vendor:'#7c5cbf', other:'var(--ink4)' };

/* ---- Navegação ---- */
function setNav(id){
  ['upload','gov','proj','mel','rpa','bots','ana'].forEach(n=>{
    const ni=document.getElementById('nav-'+n), pg=document.getElementById('page-'+n);
    if(ni) ni.classList.toggle('active', n===id);
    if(pg) pg.classList.toggle('active', n===id);
  });
}
function rpaPage(id){
  document.querySelectorAll('#page-rpa .pip-sub-page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('#page-rpa .pip-nav-item').forEach(n=>n.classList.remove('active'));
  const pg=document.getElementById('rpage-'+id), nv=document.getElementById('rnav-'+id);
  if(pg) pg.classList.add('active'); if(nv) nv.classList.add('active');
}

/* ---- Drag & drop / upload ---- */
function dzO(e,id){e.preventDefault();document.getElementById(id).classList.add('over');}
function dzL(id){document.getElementById(id).classList.remove('over');}
function dzD(e,t){e.preventDefault();document.getElementById('dz-'+t).classList.remove('over');const f=e.dataTransfer.files[0];if(f)readFile(f,t);}
function hf(i,t){if(i.files[0])readFile(i.files[0],t);}

function readFile(file,type){
  const rd=new FileReader();
  rd.onload=e=>{
    const wb=XLSX.read(new Uint8Array(e.target.result),{type:'array',cellDates:true});
    if(type==='gov') App.gov=wb; else App.rpa=wb;
    App.loaded[type]=true;
    showOk(type,file.name,wb);
    updateBar();
  };
  rd.readAsArrayBuffer(file);
}

function showOk(type,name,wb){
  document.getElementById('ok-'+type).classList.add('show');
  document.getElementById('uc-'+type).classList.add('loaded');
  document.getElementById('fn-'+type).textContent=name;
  const tg=document.getElementById('tg-'+type); tg.classList.add('show');
  if(type==='gov'){
    const found=wb.SheetNames;
    const want=['Pipefy_Melhorias','Projetos','Analytics','Inventario_RPA'];
    tg.innerHTML='<b>Abas lidas:</b> '+want.map(w=>{
      const ok=found.some(f=>f.toLowerCase().replace(/[_ ]/g,'').includes(w.toLowerCase().replace(/[_ ]/g,'')));
      return `<span class="badge ${ok?'ok':'warn'}" style="margin:2px">${w}${ok?'':' (?)'}</span>`;
    }).join('');
  } else {
    const ws=wb.Sheets[wb.SheetNames[0]];
    const n=XLSX.utils.sheet_to_json(ws,{defval:''}).length;
    tg.innerHTML=`<b>Aba lida:</b> <span class="badge ok" style="margin:2px">${wb.SheetNames[0]} · ${n} chamados</span>`;
  }
}

function updateBar(){
  const n=Object.values(App.loaded).filter(Boolean).length;
  document.getElementById('abar-status').innerHTML=`<strong style="color:var(--ink)">${n} de 2</strong> bases carregadas`;
  document.getElementById('btn-gen').disabled=n===0;
}

/* ---- Helpers ---- */
function findSheet(wb,frag){
  const f=frag.toLowerCase().replace(/[_ ]/g,'');
  return wb.SheetNames.find(s=>s.toLowerCase().replace(/[_ ]/g,'').includes(f));
}
function toDate(v){
  if(!v) return null;
  if(v instanceof Date) return isNaN(v)?null:v;
  if(typeof v==='number'){const d=new Date(Math.round((v-25569)*864e5));return isNaN(d)?null:d;}
  if(typeof v==='string'&&v.length>4){const d=new Date(v);return isNaN(d)?null:d;}
  return null;
}
function ym(d){return d?`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`:'';}
function ymLabel(m){if(!m)return'';const p=m.split('-');return `${MESES[+p[1]-1]}/${p[0].slice(2)}`;}
function get(row,keys){
  const rk=Object.keys(row);
  for(const k of keys){
    for(const r of rk){
      if(r.trim().toLowerCase()===k.toLowerCase()){const v=row[r];return v==null?'':v;}
    }
  }
  return '';
}
function count(arr,fn){const m={};arr.forEach(x=>{const k=fn(x)||'—';m[k]=(m[k]||0)+1;});return m;}
function pct(a,b){return b?Math.round(a/b*100):0;}

/* ---- Parsing: Base Governança ---- */
function parseGov(){
  const wb=App.gov;
  // Pipefy_Melhorias
  const sMel=findSheet(wb,'pipefymelhorias')||findSheet(wb,'melhorias');
  App.P.mel = sMel ? XLSX.utils.sheet_to_json(wb.Sheets[sMel],{defval:''}).map(r=>({
    num:get(r,['Numero']), frente:String(get(r,['Gerencia'])).trim(),
    fluxo:get(r,['NomeFluxo']), atividade:get(r,['Atividade']),
    statusRaw:String(get(r,['Status'])).trim(), sc:statusClass(get(r,['Status'])),
    resp:String(get(r,['Responsavel'])).trim().replace(/​/g,''),
    champion:String(get(r,['Champion'])).trim(),
    complex:String(get(r,['Complexidade'])).trim(),
    tipo:String(get(r,['TipoMelhoriaAjuste'])).trim(),
    dtFim:toDate(get(r,['DataConclusaoRealDesenvolvimento'])),
    horas:get(r,['QtdHorasEstimadas'])
  })).filter(r=>r.num!=='' || r.atividade) : [];

  // Projetos — detecta automaticamente se base está CORRIGIDA (header limpo) ou ANTIGA (embaralhada)
  const sProj=findSheet(wb,'projetos');
  App.P.proj=[];
  if(sProj){
    const rows=XLSX.utils.sheet_to_json(wb.Sheets[sProj],{defval:''});
    // testa se está corrigida: Status contém valores de status, não nomes de pessoa
    const sample=rows.slice(0,5);
    const statusLooksRight=sample.some(r=>statusClass(get(r,['Status']))!=='other');
    if(statusLooksRight){
      // BASE CORRIGIDA
      App.P.proj=rows.map(r=>({
        num:get(r,['Numero']), titulo:String(get(r,['Titulo'])).trim(),
        resp:String(get(r,['Responsavel'])).trim(),
        frente:String(get(r,['Frente'])).trim(),
        focal:String(get(r,['PontoFocal'])).trim(),
        statusRaw:String(get(r,['Status'])).trim(), sc:statusClass(get(r,['Status'])),
        dtFim:toDate(get(r,['DataFechamento'])),
        proximos:String(get(r,['ProximosPassos'])).trim(),
        prog:(()=>{const v=get(r,['ProgressoPct','Progresso']);return typeof v==='number'?v:(parseFloat(v)||null);})()
      })).filter(p=>p.titulo);
    } else {
      // BASE ANTIGA EMBARALHADA — remapeia por posição
      const raw=XLSX.utils.sheet_to_json(wb.Sheets[sProj],{defval:'',header:1});
      for(let i=1;i<raw.length;i++){
        const c=raw[i]; if(c[0]===''&&c[1]==='')continue;
        if(!String(c[1]||'').trim())continue;
        App.P.proj.push({
          num:c[0],titulo:String(c[1]).trim(),resp:String(c[2]||'').trim(),
          frente:String(c[3]||'').trim(),focal:String(c[4]||'').trim(),
          statusRaw:String(c[5]||'').trim(),sc:statusClass(c[5]),
          dtFim:toDate(c[6]),proximos:String(c[7]||'').trim(),
          prog:typeof c[8]==='number'?c[8]:(parseFloat(c[8])||null)
        });
      }
    }
  }

  // Analytics
  const sAna=findSheet(wb,'analytics');
  App.P.ana = sAna ? XLSX.utils.sheet_to_json(wb.Sheets[sAna],{defval:''}).map(r=>({
    num:get(r,['Numero']), titulo:String(get(r,['Titulo'])).trim(),
    statusRaw:String(get(r,['Status'])).trim(), sc:statusClass(get(r,['Status'])),
    prioRaw:String(get(r,['Prioridade'])).trim(),
    prio:(()=>{const m=String(get(r,['Prioridade'])).match(/\d+/);return m?+m[0]:null;})(),
    frente:String(get(r,['Frente'])).trim(),
    resp:String(get(r,['Responsavel'])).trim(),
    dtAbre:toDate(get(r,['DataAbertura'])), dtFim:toDate(get(r,['DataFechamento']))
  })).filter(r=>r.titulo) : [];
}

/* ---- Parsing: Chamados RPA (aba Report) ---- */
function parseRPA(){
  const wb=App.rpa;
  const sn=wb.SheetNames[0];
  const rows=XLSX.utils.sheet_to_json(wb.Sheets[sn],{defval:''});
  App.R = rows.map(r=>{
    const criado=toDate(get(r,['Criado em']));
    const vencRaw=get(r,['Vencido']);
    const venc = vencRaw===true || String(vencRaw).toLowerCase()==='true' || String(vencRaw).toLowerCase()==='sim';
    return {
      cod:String(get(r,['Código','Codigo'])).trim(),
      titulo:String(get(r,['Título','Titulo'])).trim(),
      fase:String(get(r,['Fase atual'])).trim(),
      processo:String(get(r,['Processo'])).trim()||'(sem processo)',
      problema:String(get(r,['Qual é o problema?'])).trim(),
      reexec:String(get(r,['Este robô admite reexecução?'])).trim(),
      solicitante:String(get(r,['Nome do solicitante'])).trim(),
      criado, mes:ym(criado),
      dow: criado ? (criado.getDay()+6)%7 : -1,
      finalizado:toDate(get(r,['Finalizado em'])),
      vencido:venc,
      tIdent:parseFloat(get(r,['Tempo total na fase Identificação do problema (dias)']))||null,
      tDesenv:parseFloat(get(r,['Tempo total na fase Desenvolvimento da solução (dias)']))||null,
      tReexec:parseFloat(get(r,['Tempo total na fase Reexecução (dias)']))||null
    };
  }).filter(r=>r.cod || r.titulo || r.processo!=='(sem processo)' || r.solicitante);
}

/* ============================================================
   COMPONENTES DE GRÁFICO (SVG puro, sem libs)
   ============================================================ */

function donut(data, opts={}){
  // data: [{label, value, color}]
  const total=data.reduce((s,d)=>s+d.value,0);
  if(!total) return '<div style="font-size:12px;color:var(--ink4)">Sem dados</div>';
  const R=54, C=2*Math.PI*R, sw=22;
  let off=0;
  const segs=data.filter(d=>d.value>0).map(d=>{
    const frac=d.value/total, len=frac*C;
    const s=`<circle r="${R}" cx="64" cy="64" fill="none" stroke="${d.color}" stroke-width="${sw}"
      stroke-dasharray="${len} ${C-len}" stroke-dashoffset="${-off}" transform="rotate(-90 64 64)"/>`;
    off+=len; return s;
  }).join('');
  const legend=data.filter(d=>d.value>0).map(d=>
    `<div class="dleg"><span class="dleg-dot" style="background:${d.color}"></span>${d.label}
     <b>${d.value}</b><span class="dpct">${pct(d.value,total)}%</span></div>`).join('');
  return `<div class="donut-wrap">
    <svg width="128" height="128" viewBox="0 0 128 128" style="flex-shrink:0">${segs}
      <text x="64" y="60" text-anchor="middle" font-family="Syne" font-size="26" font-weight="600" fill="var(--ink)">${total}</text>
      <text x="64" y="78" text-anchor="middle" font-size="9" fill="var(--ink4)" letter-spacing="1">TOTAL</text>
    </svg>
    <div class="donut-legend">${legend}</div></div>`;
}

function hbars(entries, opts={}){
  // entries: [[label,value],...]
  const items=entries.slice(0,opts.max||10);
  const mx=items.length?Math.max(...items.map(e=>e[1])):1;
  const lw=opts.lw||90;
  const h=items.map(([l,v])=>{
    const w=Math.round(v/mx*100);
    const p=opts.tot?`<span class="hbar-pct">${pct(v,opts.tot)}%</span>`:'';
    const col=opts.color||'var(--ink)';
    return `<div class="hbar-row"><span class="hbar-lbl" style="min-width:${lw}px">${l}</span>
      <div class="hbar-track"><div class="hbar-fill" style="width:${w}%;background:${col}"></div></div>
      <span class="hbar-val">${v}</span>${p}</div>`;
  }).join('');
  return h||'<div style="font-size:12px;color:var(--ink4)">Sem dados</div>';
}

function lineChart(points, opts={}){
  // points: [{label, value}] ; value 0-100 (percent) ou bruto
  if(points.length<2) return '<div style="font-size:12px;color:var(--ink4)">Dados insuficientes para tendência</div>';
  const W=opts.w||560, H=opts.h||140, pad={l:32,r:12,t:12,b:24};
  const iw=W-pad.l-pad.r, ih=H-pad.t-pad.b;
  const max=opts.max!=null?opts.max:Math.max(...points.map(p=>p.value),1);
  const min=opts.min!=null?opts.min:0;
  const x=i=>pad.l+(i/(points.length-1))*iw;
  const y=v=>pad.t+ih-((v-min)/(max-min||1))*ih;
  const path=points.map((p,i)=>`${i?'L':'M'}${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(' ');
  const area=`${path} L${x(points.length-1)} ${pad.t+ih} L${pad.l} ${pad.t+ih} Z`;
  const dots=points.map((p,i)=>{
    const step=Math.ceil(points.length/7);
    const showVal=points.length<=7 || i%step===0 || i===points.length-1;
    return `<circle cx="${x(i)}" cy="${y(p.value)}" r="3" fill="var(--surface)" stroke="var(--info)" stroke-width="2"/>
    ${showVal?`<text x="${x(i)}" y="${y(p.value)-9}" text-anchor="middle" font-size="9" font-weight="600" fill="var(--ink2)">${opts.fmt?opts.fmt(p.value):p.value}</text>`:''}`;
  }).join('');
  const xl=points.map((p,i)=>{
    const step=Math.ceil(points.length/7);
    const isShown = points.length<=7 || i%step===0;
    const isLast = i===points.length-1;
    // mostra o último só se não colar no penúltimo desenhado
    const lastShownByStep = Math.floor((points.length-1)/step)*step;
    const lastTooClose = isLast && (points.length-1 - lastShownByStep) < step*0.6;
    if(!isShown && !(isLast && !lastTooClose)) return '';
    if(isLast && lastTooClose) return '';
    return `<text x="${x(i)}" y="${H-6}" text-anchor="middle" font-size="9" fill="var(--ink4)">${p.label}</text>`;
  }).join('');
  const grid=[0,.25,.5,.75,1].map(f=>{const yy=pad.t+ih-f*ih;const val=Math.round(min+f*(max-min));
    return `<line x1="${pad.l}" y1="${yy}" x2="${W-pad.r}" y2="${yy}" stroke="var(--rule)" stroke-width="1"/>
      <text x="${pad.l-6}" y="${yy+3}" text-anchor="end" font-size="8" fill="var(--ink4)">${opts.pctAxis?val+'%':val}</text>`;}).join('');
  return `<svg width="100%" viewBox="0 0 ${W} ${H}" style="overflow:visible">
    ${grid}<path d="${area}" fill="var(--info)" opacity="0.08"/>
    <path d="${path}" fill="none" stroke="var(--info)" stroke-width="2" stroke-linejoin="round"/>${dots}${xl}</svg>`;
}

function heatmap(matrix, rowLabels, colLabels, opts={}){
  // matrix[r][c] = valor
  const flat=matrix.flat().filter(v=>v>0);
  const mx=flat.length?Math.max(...flat):1;
  const color=v=>{
    if(!v) return 'var(--neu-bg)';
    const t=v/mx;
    // escala de calor: claro -> err
    const op=0.12+t*0.85;
    return `color-mix(in srgb, var(--err) ${Math.round(op*100)}%, var(--surface))`;
  };
  let html='<table class="hm"><thead><tr><th class="rh"></th>'+colLabels.map(c=>`<th>${c}</th>`).join('')+'</tr></thead><tbody>';
  matrix.forEach((row,r)=>{
    html+=`<tr><td class="rl">${rowLabels[r]}</td>`+row.map(v=>
      `<td><div class="cell" style="background:${color(v)};color:${v/mx>0.5?'#fff':'var(--ink2)'}">${v||''}</div></td>`).join('')+'</tr>';
  });
  html+='</tbody></table>';
  return html;
}

/* ============================================================
   VIEW: GOVERNANÇA (executiva)
   ============================================================ */
function allActions(){
  // unifica todas as fontes num formato comum p/ KPIs cruzados
  const out=[];
  App.P.proj.forEach(p=>out.push({fonte:'Projetos',sc:p.sc,frente:p.frente,resp:p.resp,
    dtFim:p.dtFim,prog:p.prog,prio:null}));
  App.P.mel.forEach(m=>out.push({fonte:'Pipefy',sc:m.sc,frente:m.frente,resp:m.resp,
    dtFim:m.dtFim,prog:null,prio:null}));
  App.P.ana.forEach(a=>out.push({fonte:'Analytics',sc:a.sc,frente:a.frente,resp:a.resp,
    dtFim:a.dtFim,prog:null,prio:a.prio}));
  App.R.forEach(r=>out.push({fonte:'Chamados RPA',sc:r.fase.toLowerCase().includes('conclu')?'done':'doing',
    frente:null,resp:r.solicitante,dtFim:r.finalizado,criado:r.criado,prog:null,prio:null,vencido:r.vencido}));
  return out;
}

// versão filtrada por data (para KPIs/gráficos da aba Governança)
function allActionsFiltered(){
  return applyDate(allActions());
}

// atraso só onde há prazo real: Projetos (dtFim<hoje e não concluído) e Chamados RPA (vencido)
function isLate(a){
  if(a.fonte==='Chamados RPA') return a.vencido && a.sc!=='done';
  if(a.fonte==='Projetos' && a.dtFim) return a.dtFim<HOJE && a.sc!=='done' && a.sc!=='cancel';
  return null; // sem base p/ calcular
}

function buildGov(){
  const any=App.loaded.gov||App.loaded.rpa;
  document.getElementById('gov-empty').style.display=any?'none':'block';
  document.getElementById('gov-content').style.display=any?'block':'none';
  if(!any) return;

  const {kept:A, noDate}=allActionsFiltered();
  const total=A.length;
  const done=A.filter(a=>a.sc==='done').length;
  const lateArr=A.map(isLate);
  const lateBase=lateArr.filter(v=>v!==null).length;
  const late=lateArr.filter(v=>v===true).length;
  const blocked=A.filter(a=>a.sc==='blocked').length;
  // ações críticas abertas = bloqueadas + atrasadas + chamados RPA vencidos abertos
  const critical=A.filter(a=>a.sc==='blocked'||isLate(a)===true).length;

  // aviso de filtro de data ativo
  let dateNote='';
  if(App.dateRange.mode!=='all'){
    const fmt=d=>d?d.toLocaleDateString('pt-BR'):'∞';
    dateNote=`<div class="note" style="background:var(--neu-bg);color:var(--ink3)"><i class="ti ti-calendar-stats"></i><div>
      Período <b>${fmt(App.dateRange.from)} → ${fmt(App.dateRange.to)}</b>: <b>${total} ações</b> no recorte.`+
      (noDate>0?` (${noDate} ações sem data não entram no filtro.)`:'')+
      ` Para ver tudo, limpe os campos de data no topo.</div></div>`;
  }

  // KPIs por fonte
  const fontes=['Projetos','Pipefy','Analytics','Chamados RPA'];
  const porFonte=fontes.map(f=>{
    const sub=A.filter(a=>a.fonte===f);
    const sd=sub.filter(a=>a.sc==='done').length;
    const sl=sub.map(isLate).filter(v=>v===true).length;
    const slBase=sub.map(isLate).filter(v=>v!==null).length;
    return {f,total:sub.length,done:sd,late:sl,lateBase:slBase};
  }).filter(x=>x.total>0);

  let h=`<div class="sh">Visão executiva — todas as frentes</div>
  ${dateNote}
  <div class="krow">
    <div class="kpi il"><div class="knum">${total}</div><div class="klbl">Total de ações</div>
      <div class="ksub">${fontes.filter(f=>A.some(a=>a.fonte===f)).length} fontes integradas</div></div>
    <div class="kpi gl"><div class="knum">${pct(done,total)}%</div><div class="klbl">Concluídas</div>
      <div class="ksub">${done} de ${total} ações</div></div>
    <div class="kpi dl"><div class="knum">${lateBase?pct(late,lateBase)+'%':'—'}</div><div class="klbl">Atrasadas</div>
      <div class="ksub${lateBase?'':' na'}">${lateBase?`${late} de ${lateBase} com prazo`:'sem prazo nas bases'}</div></div>
    <div class="kpi wl"><div class="knum">${critical}</div><div class="klbl">Ações críticas abertas</div>
      <div class="ksub">${blocked} bloqueadas · ${late} atrasadas</div></div>
  </div>`;

  // Nota de transparência sobre atraso — DINÂMICA: descobre quais fontes têm prazo
  const fontesComPrazo=[], fontesSemPrazo=[];
  fontes.forEach(f=>{
    const sub=A.filter(a=>a.fonte===f);
    if(!sub.length) return;
    const temBase=sub.some(a=>isLate(a)!==null);
    (temBase?fontesComPrazo:fontesSemPrazo).push(f);
  });
  let notaAtraso;
  if(fontesSemPrazo.length===0){
    notaAtraso=`<b>Atrasadas:</b> calculado sobre todas as fontes (${late} de ${lateBase} ações com prazo). Uma ação é atrasada quando o prazo já passou e ela não está concluída.`;
  } else if(fontesComPrazo.length===0){
    notaAtraso=`<b>Atrasadas:</b> nenhuma fonte tem prazo preenchido nas bases atuais, então o percentual não pode ser calculado de forma confiável.`;
  } else {
    notaAtraso=`<b>Atrasadas:</b> calculável onde há prazo real — ${fontesComPrazo.join(' e ')}. `+
      `${fontesSemPrazo.join(' e ')} ${fontesSemPrazo.length>1?'não têm':'não tem'} prazo preenchido, então ${fontesSemPrazo.length>1?'não entram':'não entra'} no percentual (em vez de contar como zero, o que falsearia o número).`;
  }
  h+=`<div class="note"><i class="ti ti-info-circle"></i><div>${notaAtraso}</div></div>`;

  // KPI por fonte
  h+=`<div class="sh mt">Por fonte</div><div class="krow k5" style="grid-template-columns:repeat(${porFonte.length},1fr)">`;
  porFonte.forEach(x=>{
    h+=`<div class="kpi"><div class="knum sm">${x.total}</div><div class="klbl">${x.f}</div>
      <div class="ksub">${pct(x.done,x.total)}% concl.${x.lateBase?` · ${pct(x.late,x.lateBase)}% atras.`:''}</div></div>`;
  });
  h+=`</div>`;

  // Gráficos: pizza status + barra por responsável
  const scAll=count(A,a=>a.sc);
  const donutData=['done','doing','todo','vendor','blocked','cancel','other'].map(k=>(
    {label:STATUS_PT[k],value:scAll[k]||0,color:STATUS_COLOR[k]})).filter(d=>d.value>0);
  const respCount=count(A.filter(a=>a.resp&&a.sc!=='done'&&a.sc!=='cancel'),a=>a.resp);
  const respTop=Object.entries(respCount).sort((a,b)=>b[1]-a[1]);

  h+=`<div class="two">
    <div class="card"><div class="card-title"><i class="ti ti-chart-pie"></i> Status das ações</div>${donut(donutData)}</div>
    <div class="card"><div class="card-title"><i class="ti ti-user-bolt"></i> Ações abertas por responsável<span class="rt">para cobrança</span></div>
      ${hbars(respTop,{max:8,lw:130})}</div>
  </div>`;

  // Heatmap atrasos por prioridade (Analytics tem prio; Projetos não tem prio -> usamos por frente como 2ª dim)
  h+=buildHeatmap();

  // Linha: evolução do % concluído por mês (usa dtFim como proxy de conclusão)
  h+=buildEvolucao(A);

  // Ações por frente
  const frCount=count(A.filter(a=>a.frente),a=>a.frente);
  h+=`<div class="two">
    <div class="card"><div class="card-title"><i class="ti ti-building"></i> Ações por frente</div>
      ${hbars(Object.entries(frCount).sort((a,b)=>b[1]-a[1]),{max:8,lw:60,tot:Object.values(frCount).reduce((s,v)=>s+v,0)})}</div>
    <div class="card"><div class="card-title"><i class="ti ti-source-code"></i> Ações por fonte</div>
      ${hbars(fontes.map(f=>[f,A.filter(a=>a.fonte===f).length]).filter(e=>e[1]),{max:6,lw:100,tot:total})}</div>
  </div>`;

  document.getElementById('gov-content').innerHTML=h;
}

function buildHeatmap(){
  // Atrasos por prioridade (linhas) x frente (colunas) — usa Analytics (tem prioridade) + Projetos
  // Como atraso é escasso, mostramos VOLUME DE AÇÕES ABERTAS por prioridade x frente (foco executivo)
  const {kept:anaF}=applyDate(App.P.ana);
  const {kept:projF}=applyDate(App.P.proj);
  const frentes=[...new Set([...anaF,...projF].map(x=>x.frente).filter(Boolean))].sort();
  if(!anaF.length || !frentes.length){
    return '';
  }
  const prios=[1,2,3,4];
  const labelP=p=>`Prioridade ${p}`;
  const matrix=prios.map(p=>frentes.map(f=>
    anaF.filter(a=>a.prio===p && a.frente===f && a.sc!=='done').length
  ));
  // só mostra se houver algum valor
  if(!matrix.flat().some(v=>v>0)) return '';
  return `<div class="card"><div class="card-title"><i class="ti ti-grid-dots"></i> Ações Analytics abertas — prioridade × frente
    <span class="rt">foco executivo</span></div>
    <div style="overflow-x:auto">${heatmap(matrix,prios.map(labelP),frentes)}</div></div>`;
}

function buildEvolucao(A){
  // % concluído acumulado por mês — robusto: só meses ATÉ o mês atual (não projeta futuro)
  const comData=A.filter(a=>a.dtFim);
  if(comData.length<3) return '';
  const mesAtual=ym(HOJE);
  // universo: ações que JÁ deveriam ter acontecido (data <= mês atual)
  const passadas=comData.filter(a=>ym(a.dtFim)<=mesAtual);
  if(passadas.length<3) return '';
  const meses=[...new Set(passadas.map(a=>ym(a.dtFim)))].sort().filter(m=>m<=mesAtual);
  if(meses.length<2) return '';
  const denom=passadas.length;
  let acum=0;
  const pts=meses.map(m=>{
    acum+=passadas.filter(a=>a.sc==='done'&&ym(a.dtFim)===m).length;
    return {label:ymLabel(m),value:pct(acum,denom)};
  });
  const ultimoPct=pts[pts.length-1].value;
  return `<div class="card"><div class="card-title"><i class="ti ti-trending-up"></i> Evolução do % concluído
    <span class="rt">para comitê</span></div>
    ${lineChart(pts,{pctAxis:true,max:100,fmt:v=>v+'%'})}
    <div style="font-size:10px;color:var(--ink4);margin-top:8px">Conclusões acumuladas sobre ${denom} ações com data de conclusão registrada, de ${pts[0].label} a ${pts[pts.length-1].label}. Atinge ${ultimoPct}% no período medido.</div></div>`;
}

/* ---- Parsing: Inventário de Bots (aba Inventario_RPA da base gov) ---- */
function parseInv(){
  const wb=App.gov;
  if(!wb) { App.B=[]; return; }
  const sn=findSheet(wb,'inventariorpa')||findSheet(wb,'inventario');
  if(!sn) { App.B=[]; return; }
  const rows=XLSX.utils.sheet_to_json(wb.Sheets[sn],{defval:''});
  App.B=rows.map(r=>({
    nome:String(get(r,['NomeRPA','NOME DO RPA','Nome do RPA'])).trim(),
    perimetro:String(get(r,['Perimetro','PERIMETRO','Perímetro'])).trim(),
    area:String(get(r,['Area','AREA','Área'])).trim(),
    status:String(get(r,['Status','STATUS'])).trim().toUpperCase(),
    anoPrd:get(r,['AnoPRD','ANO PRD']),
    desc:String(get(r,['Descricao','DESCRIÇÃO'])).trim(),
    dev:String(get(r,['Desenvolvedor','DESENVOLVEDOR'])).trim(),
    suporte:String(get(r,['Suporte','SUPORTE / SUSTENTAÇÃO'])).trim(),
    criticidade:(()=>{const v=get(r,['Criticidade','CRITICIDADE']);const n=parseInt(v);return isNaN(n)?null:n;})(),
    freq:String(get(r,['Frequencia','FREQUENCIA','Frequência'])).trim().toLowerCase(),
    fte:parseFloat(get(r,['FTE']))||0,
    vol:parseFloat(get(r,['VolumetriaMensal','VOLUMETRIA MENSAL']))||0,
    nBots:parseFloat(get(r,['NumeroBots','NUMERO DE BOTS']))||0,
    areaCliente:String(get(r,['AreaCliente','AREA CLIENTE'])).trim(),
    sap:String(get(r,['SAP'])).trim()
  })).filter(b=>b.nome);
}

/* ============================================================
   VIEW: PROJETOS
   ============================================================ */
function buildProj(){
  const {kept:P, noDate}=applyDate(App.P.proj);
  document.getElementById('proj-empty').style.display=(P.length||noDate)?'none':'block';
  document.getElementById('proj-content').style.display=(P.length||noDate)?'block':'none';
  if(!P.length && !noDate) return;
  const done=P.filter(p=>p.sc==='done').length;
  const doing=P.filter(p=>p.sc==='doing').length;
  const todo=P.filter(p=>p.sc==='todo').length;
  const late=P.filter(p=>p.dtFim&&p.dtFim<HOJE&&p.sc!=='done'&&p.sc!=='cancel').length;
  const avgProg=Math.round(P.filter(p=>p.prog!=null).reduce((s,p)=>s+p.prog,0)/Math.max(1,P.filter(p=>p.prog!=null).length)*100);

  let h=`<div class="sh">Projetos</div>
  <div class="krow">
    <div class="kpi"><div class="knum">${P.length}</div><div class="klbl">Total</div></div>
    <div class="kpi gl"><div class="knum">${done}</div><div class="klbl">Concluídos</div></div>
    <div class="kpi il"><div class="knum">${doing}</div><div class="klbl">Em execução</div></div>
    <div class="kpi dl"><div class="knum">${late}</div><div class="klbl">Atrasados</div>
      <div class="ksub">prazo vencido + não concl.</div></div>
  </div>`;

  const frCount=count(P,p=>p.frente);
  h+=`<div class="two">
    <div class="card"><div class="card-title"><i class="ti ti-chart-pie"></i> Por status</div>
      ${donut(['done','doing','todo','vendor','blocked','cancel'].map(k=>({label:STATUS_PT[k],value:P.filter(p=>p.sc===k).length,color:STATUS_COLOR[k]})).filter(d=>d.value))}</div>
    <div class="card"><div class="card-title"><i class="ti ti-building"></i> Por frente</div>
      ${hbars(Object.entries(frCount).sort((a,b)=>b[1]-a[1]),{max:8,lw:60,tot:P.length})}</div>
  </div>`;

  // filtros: pessoa (responsável), status, busca
  const pessoas=[...new Set(P.map(p=>p.resp).filter(Boolean))].sort();
  h+=`<div class="filters" style="margin-top:4px">
    <input type="text" id="proj-q" placeholder="Buscar projeto, responsável, frente..." oninput="renderProjList()" style="flex:1;max-width:300px">
    <label>Responsável</label>
    <select id="proj-fp" onchange="renderProjList()"><option value="">Todos</option>
      ${pessoas.map(p=>`<option>${p}</option>`).join('')}</select>
    <label>Status</label>
    <select id="proj-fs" onchange="renderProjList()"><option value="">Todos</option>
      ${[...new Set(P.map(p=>p.statusRaw).filter(Boolean))].sort().map(s=>`<option>${s}</option>`).join('')}</select>
    <label>Frente</label>
    <select id="proj-ff" onchange="renderProjList()"><option value="">Todas</option>
      ${[...new Set(P.map(p=>p.frente).filter(Boolean))].sort().map(f=>`<option>${f}</option>`).join('')}</select>
    <span style="font-size:11px;color:var(--ink4);margin-left:auto" id="proj-count"></span>
  </div>`;
  h+=`<div class="card np"><div class="ilist" id="proj-list" style="border:none;border-radius:0"></div></div>`;
  document.getElementById('proj-content').innerHTML=h;
  renderProjList();
  setBadge('nb-proj',P.length+' proj','');
}

function renderProjList(){
  const {kept:P}=applyDate(App.P.proj);
  const q=(document.getElementById('proj-q')?.value||'').toLowerCase();
  const fp=document.getElementById('proj-fp')?.value||'';
  const fs=document.getElementById('proj-fs')?.value||'';
  const ff=document.getElementById('proj-ff')?.value||'';
  const vis=P.filter(p=>
    (!q||(p.titulo+' '+p.resp+' '+p.frente+' '+(p.proximos||'')).toLowerCase().includes(q)) &&
    (!fp||p.resp===fp) && (!fs||p.statusRaw===fs) && (!ff||p.frente===ff)
  ).sort((a,b)=>(b.prog||0)-(a.prog||0));
  const cnt=document.getElementById('proj-count'); if(cnt) cnt.textContent=`${vis.length} de ${P.length}`;
  let h=vis.map(p=>{
    const bd=STATUS_BADGE[p.sc];
    const lateTag=p.dtFim&&p.dtFim<HOJE&&p.sc!=='done'&&p.sc!=='cancel';
    return `<div class="icard">
      <div class="iico" style="background:var(--neu-bg)"><i class="ti ti-folder" style="color:var(--ink3);font-size:14px"></i></div>
      <div class="imain"><div class="ititle">${p.titulo}</div>
        <div class="isub">${p.frente?`<span class="apill">${p.frente}</span>`:''}
          ${p.resp?`<span>${p.resp}</span>`:''}
          ${p.dtFim?`<span style="color:${lateTag?'var(--err)':'var(--ink4)'}">· ${p.dtFim.toLocaleDateString('pt-BR')}${lateTag?' ⚠':''}</span>`:''}</div>
        ${p.prog!=null?`<div class="stk" style="max-width:280px"><div style="width:${Math.round(p.prog*100)}%;background:var(--info)"></div></div>`:''}
      </div>
      <div class="iright">${p.prog!=null?`<span style="font-size:11px;color:var(--ink3);font-weight:600">${Math.round(p.prog*100)}%</span>`:''}
        <span class="badge ${bd}">${p.statusRaw}</span></div>
    </div>`;
  }).join('');
  const el=document.getElementById('proj-list');
  if(el) el.innerHTML=h||'<div class="empty" style="padding:24px">Nenhum projeto neste filtro</div>';
}

/* ============================================================
   VIEW: PIPEFY MELHORIAS
   ============================================================ */
function buildMel(){
  const {kept:M, noDate}=applyDate(App.P.mel);
  document.getElementById('mel-empty').style.display=App.P.mel.length?'none':'block';
  document.getElementById('mel-content').style.display=App.P.mel.length?'block':'none';
  if(!App.P.mel.length) return;
  const done=M.filter(m=>m.sc==='done').length;
  const backlog=M.filter(m=>m.sc==='todo').length;
  const blocked=M.filter(m=>m.sc==='blocked').length;

  let dn='';
  if(App.dateRange.mode!=='all'){
    dn=`<div class="note" style="background:var(--neu-bg);color:var(--ink3)"><i class="ti ti-calendar-stats"></i><div>
      Período aplicado: <b>${M.length} melhorias</b> com conclusão no recorte.`+
      (noDate>0?` ${noDate} sem data de conclusão não entram no filtro.`:'')+`</div></div>`;
  }

  let h=dn+`<div class="sh">Pipefy — Melhorias & Ajustes</div>
  <div class="krow">
    <div class="kpi"><div class="knum">${M.length}</div><div class="klbl">Total</div></div>
    <div class="kpi gl"><div class="knum">${done}</div><div class="klbl">Concluídas</div><div class="ksub">${pct(done,M.length)}% do total</div></div>
    <div class="kpi"><div class="knum">${backlog}</div><div class="klbl">Backlog</div></div>
    <div class="kpi wl"><div class="knum">${blocked}</div><div class="klbl">Bloqueadas</div></div>
  </div>`;

  h+=`<div class="two">
    <div class="card"><div class="card-title"><i class="ti ti-chart-pie"></i> Status</div>
      ${donut(['done','doing','todo','vendor','blocked','cancel'].map(k=>({label:STATUS_PT[k],value:M.filter(m=>m.sc===k).length,color:STATUS_COLOR[k]})).filter(d=>d.value))}</div>
    <div class="card"><div class="card-title"><i class="ti ti-building"></i> Por frente</div>
      ${hbars(Object.entries(count(M,m=>m.frente)).sort((a,b)=>b[1]-a[1]),{max:8,lw:60,tot:M.length})}</div>
  </div>`;
  h+=`<div class="two">
    <div class="card"><div class="card-title"><i class="ti ti-stack-2"></i> Por complexidade</div>
      ${hbars(Object.entries(count(M.filter(m=>m.complex),m=>m.complex)).sort((a,b)=>b[1]-a[1]),{max:6,lw:90})}</div>
    <div class="card"><div class="card-title"><i class="ti ti-user-code"></i> Por responsável</div>
      ${hbars(Object.entries(count(M.filter(m=>m.resp),m=>m.resp)).sort((a,b)=>b[1]-a[1]),{max:8,lw:130})}</div>
  </div>`;
  document.getElementById('mel-content').innerHTML=h;
  setBadge('nb-mel',M.length,'');
}

/* ============================================================
   VIEW: ANALYTICS
   ============================================================ */
function buildAna(){
  const {kept:A, noDate}=applyDate(App.P.ana);
  document.getElementById('ana-empty').style.display=App.P.ana.length?'none':'block';
  document.getElementById('ana-content').style.display=App.P.ana.length?'block':'none';
  if(!App.P.ana.length) return;
  const done=A.filter(a=>a.sc==='done').length;
  const doing=A.filter(a=>a.sc==='doing').length;
  const todo=A.filter(a=>a.sc==='todo').length;
  const comData=A.filter(a=>a.dtFim).length;

  let dn='';
  if(App.dateRange.mode!=='all'){
    dn=`<div class="note" style="background:var(--neu-bg);color:var(--ink3)"><i class="ti ti-calendar-stats"></i><div>
      Período aplicado: <b>${A.length} atividades</b> no recorte.`+
      (noDate>0?` ${noDate} sem data não entram no filtro.`:'')+`</div></div>`;
  }

  let h=dn+`<div class="sh">Analytics</div>
  <div class="krow">
    <div class="kpi"><div class="knum">${A.length}</div><div class="klbl">Total</div></div>
    <div class="kpi gl"><div class="knum">${done}</div><div class="klbl">Concluídas</div><div class="ksub">${pct(done,A.length)}%</div></div>
    <div class="kpi il"><div class="knum">${doing}</div><div class="klbl">Em andamento</div></div>
    <div class="kpi"><div class="knum">${todo}</div><div class="klbl">Não iniciadas</div></div>
  </div>`;
  if(comData<A.length){
    h+=`<div class="note"><i class="ti ti-info-circle"></i><div>${comData} de ${A.length} atividades têm data registrada. As ${A.length-comData} restantes não têm data preenchida na base, então não entram nos cálculos por período.</div></div>`;
  }

  const prioCount=count(A.filter(a=>a.prio),a=>'Prioridade '+a.prio);
  h+=`<div class="two">
    <div class="card"><div class="card-title"><i class="ti ti-chart-pie"></i> Status</div>
      ${donut(['done','doing','todo','vendor','blocked','cancel'].map(k=>({label:STATUS_PT[k],value:A.filter(a=>a.sc===k).length,color:STATUS_COLOR[k]})).filter(d=>d.value))}</div>
    <div class="card"><div class="card-title"><i class="ti ti-flag"></i> Por prioridade</div>
      ${hbars(Object.entries(prioCount).sort((a,b)=>{const na=+a[0].match(/\d+/),nb=+b[0].match(/\d+/);return na-nb;}),{max:10,lw:90})}</div>
  </div>`;
  h+=`<div class="two">
    <div class="card"><div class="card-title"><i class="ti ti-building"></i> Por frente</div>
      ${hbars(Object.entries(count(A.filter(a=>a.frente),a=>a.frente)).sort((a,b)=>b[1]-a[1]),{max:8,lw:60,tot:A.length})}</div>
    <div class="card"><div class="card-title"><i class="ti ti-user"></i> Por responsável</div>
      ${hbars(Object.entries(count(A.filter(a=>a.resp),a=>a.resp)).sort((a,b)=>b[1]-a[1]),{max:8,lw:140})}</div>
  </div>`;
  document.getElementById('ana-content').innerHTML=h;
  setBadge('nb-ana',A.length,'');
}

function setBadge(id,txt,cls){const e=document.getElementById(id);if(e){e.textContent=txt;e.className='nb'+(cls?' '+cls:'');}}

/* ============================================================
   VIEW: CHAMADOS RPA (5 sub-abas)
   ============================================================ */
function buildRPAChamados(){
  const {kept:R, noDate}=applyDate(App.R);
  document.getElementById('rpa-empty').style.display=App.R.length?'none':'block';
  document.getElementById('rpa-content').style.display=App.R.length?'block':'none';
  if(!App.R.length) return;

  const total=R.length;
  const venc=R.filter(r=>r.vencido).length;
  const concl=R.filter(r=>r.fase.toLowerCase().includes('conclu')).length;
  const abertos=total-concl;
  const reexec=R.filter(r=>r.problema.toLowerCase().includes('reexecu')).length;

  // VISÃO GERAL
  let dn='';
  if(App.dateRange.mode!=='all'){
    dn=`<div class="note" style="background:var(--neu-bg);color:var(--ink3)"><i class="ti ti-calendar-stats"></i><div>
      Período aplicado: <b>${total} chamados</b> abertos no recorte.`+
      (noDate>0?` ${noDate} sem data de criação não entram no filtro.`:'')+`</div></div>`;
  }
  let v=dn+`<div class="krow k5">
    <div class="kpi"><div class="knum">${total}</div><div class="klbl">Total chamados</div></div>
    <div class="kpi gl"><div class="knum">${concl}</div><div class="klbl">Concluídos</div><div class="ksub">${pct(concl,total)}%</div></div>
    <div class="kpi il"><div class="knum">${abertos}</div><div class="klbl">Abertos</div></div>
    <div class="kpi dl"><div class="knum">${venc}</div><div class="klbl">Vencidos</div><div class="ksub">${pct(venc,total)}% do total</div></div>
    <div class="kpi wl"><div class="knum">${reexec}</div><div class="klbl">Reexecuções</div></div>
  </div>`;
  const pctVenc=pct(venc,total);
  // insight dinâmico: deriva o bot mais crítico e o tipo de problema dominante dos dados atuais
  const porProcV=count(R,r=>r.processo);
  const topProc=Object.entries(porProcV).filter(e=>e[0]!=='(sem processo)').sort((a,b)=>b[1]-a[1])[0];
  const porProbV=count(R,r=>r.problema);
  const topProb=Object.entries(porProbV).sort((a,b)=>b[1]-a[1])[0];
  let insV;
  if(pctVenc>25){
    insV=`<b>${pctVenc}% dos ${total} chamados venceram o prazo</b> (${venc} chamados). `+
      (topProc?`O processo com mais manutenções é "${topProc[0]}" (${topProc[1]} chamados). `:'')+
      `Volume indica pressão sobre a sustentação.`;
  } else if(pctVenc>0){
    insV=`${venc} de ${total} chamados (${pctVenc}%) venceram o prazo. `+
      (topProb?`Problema mais frequente: "${topProb[0]}" (${topProb[1]}×).`:'');
  } else {
    insV=`Nenhum dos ${total} chamados está vencido no período.`;
  }
  v+=`<div class="insight${pctVenc>25?'':' ok'}"><i class="ti ti-${pctVenc>25?'alert-triangle':'circle-check'}"></i>
    <div>${insV}</div></div>`;

  // volume mensal
  const porMes={},porMesV={};
  R.forEach(r=>{if(r.mes){porMes[r.mes]=(porMes[r.mes]||0)+1;if(r.vencido)porMesV[r.mes]=(porMesV[r.mes]||0)+1;}});
  const meses=Object.keys(porMes).sort();
  const mx=Math.max(...meses.map(m=>porMes[m]),1);
  let vol='<div class="vchart">';
  meses.slice(-12).forEach(m=>{
    const t=porMes[m]||0,vv=porMesV[m]||0;
    vol+=`<div class="vcol"><div class="vcol-bars"><div class="vbar-total" style="height:${Math.round(t/mx*100)}%"></div>
      <div class="vbar-inc" style="height:${Math.round(vv/mx*100)}%"></div></div><div class="vcol-lbl">${ymLabel(m)}</div></div>`;
  });
  vol+='</div><div class="vlegend"><div class="vleg"><div class="vleg-dot" style="background:var(--ink);opacity:.3"></div>Total</div><div class="vleg"><div class="vleg-dot" style="background:var(--err)"></div>Vencidos</div></div>';
  v+=`<div class="two">
    <div class="card"><div class="card-title"><i class="ti ti-chart-bar"></i> Volume mensal</div>${vol}</div>
    <div class="card"><div class="card-title"><i class="ti ti-calendar"></i> Abertura por dia da semana</div>
      ${hbars(DOW.map((d,i)=>[d,R.filter(r=>r.dow===i).length]),{max:7,lw:40})}</div>
  </div>`;
  document.getElementById('rpage-visao').innerHTML=v;

  // TOP BOTS (manutenções)
  const porProc=count(R,r=>r.processo);
  const procList=Object.entries(porProc).filter(e=>e[0]!=='(sem processo)').sort((a,b)=>b[1]-a[1]);
  const top3=procList.slice(0,3);
  const somaTop3=top3.reduce((s,e)=>s+e[1],0);
  const totalProc=procList.reduce((s,e)=>s+e[1],0);
  let b=`<div class="note"><i class="ti ti-robot"></i><div>`+
    (top3.length?`Os 3 processos com mais manutenções concentram ${pct(somaTop3,totalProc)}% dos chamados (${somaTop3} de ${totalProc}). Priorizar a estabilização deles reduz o volume de suporte.`:`Sem dados de processo suficientes.`)+
    `</div></div>
    <div class="card"><div class="card-title"><i class="ti ti-trophy"></i> Top bots por nº de manutenções<span class="rt">${procList.length} processos</span></div>
    ${hbars(procList,{max:15,lw:220,color:'var(--err)'})}</div>`;
  document.getElementById('rpage-bots').innerHTML=b;

  // TIPOS DE PROBLEMA
  const porProb=count(R,r=>r.problema);
  const porReexec=count(R.filter(r=>r.reexec),r=>r.reexec);
  let p=`<div class="two">
    <div class="card"><div class="card-title"><i class="ti ti-alert-circle"></i> Tipos de problema</div>
      ${hbars(Object.entries(porProb).sort((a,b)=>b[1]-a[1]),{max:8,lw:200,tot:total})}</div>
    <div class="card"><div class="card-title"><i class="ti ti-refresh"></i> Admite reexecução?</div>
      ${donut(Object.entries(porReexec).map(([k,vv],i)=>({label:k,value:vv,color:i===0?'var(--ok)':'var(--warn)'})))}</div>
  </div>`;
  // problema x fase
  const fases=[...new Set(R.map(r=>r.fase))];
  const probs=Object.entries(porProb).sort((a,b)=>b[1]-a[1]).slice(0,5).map(e=>e[0]);
  let tbl='<table class="tbl"><thead><tr><th>Problema</th>'+fases.map(f=>`<th>${f}</th>`).join('')+'<th>Total</th></tr></thead><tbody>';
  probs.forEach(pr=>{
    const sub=R.filter(r=>r.problema===pr);
    tbl+=`<tr><td style="color:var(--ink)">${pr}</td>`+fases.map(f=>`<td>${sub.filter(r=>r.fase===f).length||'—'}</td>`).join('')+`<td style="font-weight:600">${sub.length}</td></tr>`;
  });
  tbl+='</tbody></table>';
  p+=`<div class="card"><div class="card-title"><i class="ti ti-table"></i> Problema × fase atual</div><div style="overflow-x:auto">${tbl}</div></div>`;
  document.getElementById('rpage-prob').innerHTML=p;

  // TEMPO DE RESOLUÇÃO
  const comTempo=R.filter(r=>r.tIdent!=null||r.tDesenv!=null);
  const avg=(arr,k)=>{const v=arr.filter(r=>r[k]!=null).map(r=>r[k]);return v.length?(v.reduce((s,x)=>s+x,0)/v.length).toFixed(1):'—';};
  let t=`<div class="krow">
    <div class="kpi"><div class="knum sm">${avg(R,'tIdent')}</div><div class="klbl">Média dias · Identificação</div></div>
    <div class="kpi"><div class="knum sm">${avg(R,'tDesenv')}</div><div class="klbl">Média dias · Desenvolvimento</div></div>
    <div class="kpi"><div class="knum sm">${avg(R,'tReexec')}</div><div class="klbl">Média dias · Reexecução</div></div>
    <div class="kpi"><div class="knum sm">${comTempo.length}</div><div class="klbl">Chamados com tempo medido</div></div>
  </div>`;
  // tempo médio por processo (top)
  const procTempo={};
  R.forEach(r=>{const tt=(r.tIdent||0)+(r.tDesenv||0);if(tt>0){if(!procTempo[r.processo])procTempo[r.processo]={s:0,n:0};procTempo[r.processo].s+=tt;procTempo[r.processo].n++;}});
  const procAvg=Object.entries(procTempo).filter(e=>e[0]!=='(sem processo)'&&e[1].n>=3).map(([k,v])=>[k,+(v.s/v.n).toFixed(1)]).sort((a,b)=>b[1]-a[1]);
  t+=`<div class="card"><div class="card-title"><i class="ti ti-clock"></i> Tempo médio de resolução por bot (dias, mín. 3 chamados)</div>
    ${hbars(procAvg,{max:12,lw:220,color:'var(--warn)'})}</div>`;
  document.getElementById('rpage-tempo').innerHTML=t;

  // LISTA
  let l=`<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
    <input type="text" id="rsearch" placeholder="Buscar por código, processo, solicitante..." oninput="renderRPALista()" style="flex:1;max-width:360px">
    <span style="font-size:11px;color:var(--ink4)" id="rlista-count">${total} chamados</span></div>
    <div class="card np"><div style="overflow-x:auto"><table class="tbl" style="margin:0">
    <thead><tr><th style="padding-left:20px">Código</th><th>Processo</th><th>Problema</th><th>Fase</th><th>Mês</th><th style="padding-right:20px">Status</th></tr></thead>
    <tbody id="rlista-body"></tbody></table></div></div>`;
  document.getElementById('rpage-lista').innerHTML=l;
  renderRPALista();

  setBadge('nb-rpa',venc>0?venc+' venc':total,venc>0?'warn':'');
}

function renderRPALista(){
  const {kept:R}=applyDate(App.R);
  const q=(document.getElementById('rsearch')?.value||'').toLowerCase();
  const vis=q?R.filter(r=>(r.cod+r.processo+r.solicitante+r.problema).toLowerCase().includes(q)):R;
  const cnt=document.getElementById('rlista-count');if(cnt)cnt.textContent=vis.length+' chamados';
  let h=vis.slice(0,1000).map(r=>{
    const concl=r.fase.toLowerCase().includes('conclu');
    return `<tr><td style="padding-left:20px;font-family:monospace;font-size:11px;color:var(--ink3)">${r.cod}</td>
      <td style="font-size:11px">${r.processo}</td>
      <td style="font-size:11px;color:var(--ink3)">${r.problema}</td>
      <td><span class="badge ${concl?'ok':'info'}" style="font-size:9px">${r.fase}</span></td>
      <td style="font-size:11px;color:var(--ink4)">${ymLabel(r.mes)}</td>
      <td style="padding-right:20px">${r.vencido?'<span class="badge red">Vencido</span>':'<span class="badge neu">No prazo</span>'}</td></tr>`;
  }).join('');
  if(vis.length>1000) h+=`<tr><td colspan="6" style="text-align:center;padding:16px;color:var(--ink4);font-size:12px">Exibindo 1000 de ${vis.length} — use a busca para refinar</td></tr>`;
  const b=document.getElementById('rlista-body');if(b)b.innerHTML=h;
}

/* ============================================================
   VIEW: INVENTÁRIO DE BOTS
   ============================================================ */
function buildBots(){
  // filtro especial: por ano de entrada em PRD
  const dr=App.dateRange;
  let B=App.B;
  let dn='';
  if(dr.mode!=='all'){
    const yFrom = dr.from ? dr.from.getFullYear() : null;
    const yTo   = dr.to   ? dr.to.getFullYear()   : null;
    B=App.B.filter(b=>{
      const y=parseInt(b.anoPrd);
      if(isNaN(y)) return false;
      if(yFrom!=null && y<yFrom) return false;
      if(yTo!=null && y>yTo) return false;
      return true;
    });
    const semAno=App.B.filter(b=>isNaN(parseInt(b.anoPrd))).length;
    dn=`<div class="note" style="background:var(--neu-bg);color:var(--ink3)"><i class="ti ti-calendar-stats"></i><div>
      Período aplicado: <b>${B.length} bots</b> que entraram em produção entre ${yFrom||'∞'} e ${yTo||'∞'}.`+
      (semAno>0?` ${semAno} bots sem ano de PRD não entram no filtro.`:'')+`</div></div>`;
  }
  document.getElementById('bots-empty').style.display=App.B.length?'none':'block';
  document.getElementById('bots-content').style.display=App.B.length?'block':'none';
  if(!App.B.length) return;

  const prd=B.filter(b=>b.status==='PRD').length;
  const dev=B.filter(b=>b.status==='DEV').length;
  const backlog=B.filter(b=>b.status==='BACKLOG').length;
  const fteTotal=B.filter(b=>b.status==='PRD').reduce((s,b)=>s+b.fte,0);
  const volTotal=B.filter(b=>b.status==='PRD').reduce((s,b)=>s+b.vol,0);

  let h=dn+`<div class="sh">Inventário de Bots — RPA</div>
  <div class="krow k5">
    <div class="kpi gl"><div class="knum">${prd}</div><div class="klbl">Em produção</div></div>
    <div class="kpi wl"><div class="knum">${dev}</div><div class="klbl">Em desenvolvimento</div></div>
    <div class="kpi"><div class="knum">${backlog}</div><div class="klbl">Backlog</div></div>
    <div class="kpi il"><div class="knum sm">${fteTotal.toFixed(1)}</div><div class="klbl">FTEs economizados</div><div class="ksub">bots em PRD</div></div>
    <div class="kpi"><div class="knum sm">${volTotal.toLocaleString('pt-BR')}</div><div class="klbl">Transações/mês</div></div>
  </div>`;

  const prdBots=B.filter(b=>b.status==='PRD');
  h+=`<div class="two">
    <div class="card"><div class="card-title"><i class="ti ti-building"></i> Bots em PRD por área</div>
      ${hbars(Object.entries(count(prdBots,b=>b.area)).sort((a,b)=>b[1]-a[1]),{max:10,lw:60,tot:prd})}</div>
    <div class="card"><div class="card-title"><i class="ti ti-world"></i> Por perímetro</div>
      ${donut(Object.entries(count(prdBots,b=>b.perimetro)).map(([k,v],i)=>({label:k,value:v,color:['var(--info)','var(--ok)','var(--warn)','var(--err)'][i%4]})))}</div>
  </div>`;
  h+=`<div class="two">
    <div class="card"><div class="card-title"><i class="ti ti-alert-octagon"></i> Por criticidade</div>
      ${hbars([1,2,3,4].map(c=>['Criticidade '+c,prdBots.filter(b=>b.criticidade===c).length]).filter(e=>e[1]),{max:4,lw:100})}</div>
    <div class="card"><div class="card-title"><i class="ti ti-repeat"></i> Por frequência</div>
      ${hbars(Object.entries(count(prdBots.filter(b=>b.freq),b=>b.freq)).sort((a,b)=>b[1]-a[1]),{max:6,lw:80})}</div>
  </div>`;

  // se houver chamados RPA, cruza top manutenções com inventário
  if(App.R.length){
    h+=buildBotsCruzamento(B);
  }

  // lista de bots
  h+=`<div class="filters" style="margin-top:8px">
    <label>Status</label><select id="bot-fs" onchange="renderBotsList()"><option value="">Todos</option>
      <option>PRD</option><option>DEV</option><option>BACKLOG</option><option>CANCELADO</option><option>DESATIVADO</option></select>
    <label>Área</label><select id="bot-fa" onchange="renderBotsList()"><option value="">Todas</option>
      ${[...new Set(B.map(b=>b.area))].filter(Boolean).sort().map(a=>`<option>${a}</option>`).join('')}</select></div>
    <div class="ilist" id="bots-list"></div>`;
  document.getElementById('bots-content').innerHTML=h;
  renderBotsList();
  setBadge('nb-bots',prd+' PRD','ok');
}

function buildBotsCruzamento(Bf){
  // cruza nome do processo (chamados) com nome do bot (inventário) — match aproximado
  const norm=s=>s.toLowerCase().replace(/^\[.*?\]/,'').replace(/[^a-z0-9]/g,'');
  const {kept:Rf}=applyDate(App.R);
  const chamPorProc=count(Rf,r=>r.processo);
  const rows=Bf.filter(b=>b.status==='PRD').map(b=>{
    const bn=norm(b.nome);
    let ch=0;
    Object.entries(chamPorProc).forEach(([proc,n])=>{
      const pn=norm(proc);
      if(pn&&bn&&(bn.includes(pn)||pn.includes(bn))) ch+=n;
    });
    return {nome:b.nome,area:b.area,crit:b.criticidade,ch};
  }).filter(r=>r.ch>0).sort((a,b)=>b.ch-a.ch).slice(0,10);
  if(!rows.length) return '';
  let tbl='<table class="tbl"><thead><tr><th>Bot</th><th>Área</th><th>Criticidade</th><th>Chamados manut.</th></tr></thead><tbody>';
  rows.forEach(r=>{tbl+=`<tr><td style="color:var(--ink)">${r.nome}</td><td>${r.area}</td>
    <td>${r.crit?'Crit '+r.crit:'—'}</td><td><span class="badge ${r.ch>10?'red':'warn'}">${r.ch}</span></td></tr>`;});
  tbl+='</tbody></table>';
  return `<div class="card"><div class="card-title"><i class="ti ti-link"></i> Bots em produção × chamados de manutenção
    <span class="rt">cruzamento inventário × Pipefy</span></div>
    <div style="font-size:11px;color:var(--ink4);margin-bottom:12px">Bots com mais manutenções são candidatos a refatoração. Match por nome do processo.</div>
    <div style="overflow-x:auto">${tbl}</div></div>`;
}

function renderBotsList(){
  const fs=document.getElementById('bot-fs')?.value||'';
  const fa=document.getElementById('bot-fa')?.value||'';
  // aplica filtro de data por AnoPRD primeiro
  const dr=App.dateRange;
  let source=App.B;
  if(dr.mode!=='all'){
    const yFrom=dr.from?dr.from.getFullYear():null;
    const yTo=dr.to?dr.to.getFullYear():null;
    source=App.B.filter(b=>{
      const y=parseInt(b.anoPrd);
      if(isNaN(y)) return false;
      if(yFrom!=null && y<yFrom) return false;
      if(yTo!=null && y>yTo) return false;
      return true;
    });
  }
  let B=source.filter(b=>(!fs||b.status===fs)&&(!fa||b.area===fa));
  const sb={PRD:'ok',DEV:'info',BACKLOG:'neu',CANCELADO:'red',DESATIVADO:'red'};
  let h=B.slice(0,200).map(b=>`<div class="icard">
    <div class="iico" style="background:var(--neu-bg)"><i class="ti ti-robot" style="color:var(--ink3);font-size:14px"></i></div>
    <div class="imain"><div class="ititle">${b.nome}</div>
      <div class="isub">${b.area?`<span class="apill">${b.area}</span>`:''}${b.perimetro&&b.perimetro!=='Brasil'?`<span class="apill">${b.perimetro}</span>`:''}
        ${b.dev?`<span>${b.dev}</span>`:''}${b.freq?`<span style="color:var(--ink4)">· ${b.freq}</span>`:''}
        ${b.vol?`<span style="color:var(--ink4)">· ${b.vol.toLocaleString('pt-BR')}/mês</span>`:''}</div></div>
    <div class="iright">${b.criticidade?`<span style="font-size:10px;color:var(--ink4)">Crit ${b.criticidade}</span>`:''}
      <span class="badge ${sb[b.status]||'neu'}">${b.status}</span></div></div>`).join('');
  if(B.length>200) h+=`<div class="icard" style="justify-content:center;color:var(--ink4);font-size:12px">Exibindo 200 de ${B.length}</div>`;
  const el=document.getElementById('bots-list');if(el)el.innerHTML=h||'<div class="empty" style="padding:24px">Nenhum bot neste filtro</div>';
}

/* ============================================================
   FILTRO DE DATA GLOBAL
   ============================================================ */
function applyDateFilter(){
  const dr=App.dateRange;
  const ff=document.getElementById('df-from').value;
  const tt=document.getElementById('df-to').value;
  if(!ff && !tt){
    dr.mode='all'; dr.from=null; dr.to=null;
  } else {
    dr.mode='custom';
    dr.from = ff ? new Date(ff+'T00:00:00') : null;
    dr.to   = tt ? new Date(tt+'T23:59:59') : null;
  }
  const wrap=document.getElementById('date-filter');
  if(wrap) wrap.classList.toggle('active', dr.mode!=='all');
  renderAll();
}

function clearDateFilter(){
  document.getElementById('df-from').value='';
  document.getElementById('df-to').value='';
  applyDateFilter();
}

// re-renderiza TODAS as abas respeitando o filtro de data atual
function renderAll(){
  buildGov();
  if(App.P.proj.length) buildProj();
  if(App.P.mel.length) buildMel();
  if(App.P.ana.length) buildAna();
  if(App.R.length) buildRPAChamados();
  if(App.B.length) buildBots();
  updateDateBadge();
}

function updateDateBadge(){
  const dr=App.dateRange;
  const base=document.getElementById('sync-lbl').dataset.base||'';
  let periodo='';
  if(dr.mode!=='all'){
    const fmt=d=>d?d.toLocaleDateString('pt-BR'):'∞';
    periodo=` · período: ${fmt(dr.from)} → ${fmt(dr.to)}`;
  }
  document.getElementById('sync-lbl').textContent=base+periodo;
}


function generate(){
  if(App.gov) parseGov();
  if(App.gov) parseInv();
  if(App.rpa) parseRPA();

  // descobre range global de datas (pra setar min/max nos inputs)
  const all=[...App.P.mel,...App.P.proj,...App.P.ana,...App.R];
  const dates=all.map(refDate).filter(Boolean).map(d=>d.getTime());
  if(dates.length){
    const min=new Date(Math.min(...dates));
    const max=new Date(Math.max(...dates));
    const iso=d=>d.toISOString().slice(0,10);
    ['df-from','df-to'].forEach(id=>{
      const el=document.getElementById(id);
      if(el){ el.min=iso(min); el.max=iso(max); }
    });
  }

  buildGov();
  if(App.P.proj.length) buildProj();
  if(App.P.mel.length) buildMel();
  if(App.P.ana.length) buildAna();
  if(App.R.length) buildRPAChamados();
  if(App.B.length) buildBots();

  if(App.P.mel.length) setBadge('nb-mel',App.P.mel.length,'');
  const now=new Date();
  const ts=`Atualizado ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  const src=[App.loaded.gov?'Governança':'',App.loaded.rpa?'Chamados RPA':''].filter(Boolean).join(' · ');
  const lbl=document.getElementById('sync-lbl');
  lbl.textContent=`${ts} · ${src}`;
  lbl.dataset.base=`${ts} · ${src}`;
  // revela o filtro de data
  const df=document.getElementById('date-filter'); if(df) df.style.display='flex';
  setNav('gov');
}

setNav('upload');