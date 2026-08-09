
/* ==================================================================
   ANDON · Canaverde & Aguiar Advogados Associados
   Dados reais: MAPA EXECUÇÃO, CONTROLE DE TRATATIVAS,
   RELATÓRIO FATURAMENTO e Financeiro ADVBox — 2026.
   ================================================================== */
const SB = {
  url: 'https://nkodijlsftdlzcmgjahk.supabase.co',
  key: 'sb_publishable_s6EH8fDfeVrBVJVz9i_E9A_QYcgkf88'
};

/* A data é a de hoje, sempre. Já esteve fixa em 31/07/2026, o que fazia o
   painel envelhecer em silêncio: dias parados, takt e ritmo mensal congelavam
   e ninguém percebia porque os números continuavam plausíveis. */
const HOJE = (()=>{ const d=new Date(); d.setHours(12,0,0,0); return d; })();
const ANO  = HOJE.getFullYear();
const MES  = HOJE.getMonth()+1;
const MM   = String(MES).padStart(2,'0');
const ISO_HOJE = `${ANO}-${MM}-${String(HOJE.getDate()).padStart(2,'0')}`;
const MESES_NOME = ['janeiro','fevereiro','março','abril','maio','junho','julho',
                    'agosto','setembro','outubro','novembro','dezembro'];

const brl  = v => (v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL',maximumFractionDigits:0});
const brl2 = v => (v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL',minimumFractionDigits:2});
const kk   = v => v>=1e6 ? (v/1e6).toFixed(2).replace('.',',')+' mi'
                 : v>=1e3 ? Math.round(v/1e3)+' mil' : Math.round(v);
const dtb  = s => s ? s.slice(8,10)+'/'+s.slice(5,7)+'/'+s.slice(0,4) : '—';
const dias = s => s ? Math.round((HOJE - new Date(s+'T12:00:00'))/864e5) : null;
const esc  = s => String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const cap  = s => !s ? '' : s.toLowerCase().replace(/(^|[\s\-'])([a-zà-ú])/g,(m,a,b)=>a+b.toUpperCase());
const pct  = (a,b) => b ? (a/b*100) : 0;
const soma = (l,f) => l.reduce((s,x)=>s+(f(x)||0),0);

/* ---------- estado, preenchido pelo Supabase ---------- */
let EXEC=[], TRAT=[], FAT=[], TRAB=[], ADVBOX={}, ADVMES=[];
/* Views do banco. A regra do projeto é que métrica se calcula uma vez, no
   banco. Onde existe view, a tela lê a view e não refaz a conta. */
let VPAINEL=null, VPREVISAO=[], VCONC=[], VCONCPROC=[], VCONCPAR=[], VRECMES=[];

async function sb(tabela, params){
  const qs = new URLSearchParams({select:'*', ...(params||{})}).toString();
  const r = await fetch(`${SB.url}/rest/v1/${tabela}?${qs}`, {
    headers:{apikey:SB.key, Authorization:'Bearer '+SB.key, Prefer:'count=exact'}
  });
  if(!r.ok) throw new Error(tabela+': '+r.status+' '+(await r.text()).slice(0,120));
  return r.json();
}
async function sbTudo(tabela, ordem){
  // o PostgREST devolve 1000 por vez; pagina até acabar
  const out=[]; let de=0;
  for(;;){
    const qs = new URLSearchParams({select:'*', order:ordem||'id.asc',
      offset:String(de), limit:'1000'}).toString();
    const r = await fetch(`${SB.url}/rest/v1/${tabela}?${qs}`, {
      headers:{apikey:SB.key, Authorization:'Bearer '+SB.key}});
    if(!r.ok) throw new Error(tabela+': '+r.status);
    const l = await r.json(); out.push(...l);
    if(l.length<1000) break; de += 1000;
  }
  return out;
}

async function carrega(){
  const [ex,tr,fa,tb,ar,am,gr,fs,mt,pr,vp,vpr,vc,vcp,vpar,vrm] = await Promise.all([
    sbTudo('execucao'), sbTudo('tratativa'), sbTudo('acordo_faturado'),
    sbTudo('acordo_trabalhista'),
    sb('advbox_resumo',{ano:'eq.'+ANO}), sb('advbox_mes'),
    sb('config_grupo',{order:'ordem.asc'}), sb('config_fase',{order:'ordem.asc'}),
    sb('config_meta'), sb('config_parametro'),
    sb('vw_painel'), sb('vw_previsao'), sb('vw_conciliacao'),
    sb('vw_conciliacao_processo',{order:'diferenca.desc'}), sb('vw_conciliacao_par'),
    sb('vw_receita_mes')
  ]);

  VPAINEL   = vp[0] || null;
  VPREVISAO = vpr;
  VCONC     = vc;
  VCONCPROC = vcp;
  VCONCPAR  = vpar;
  VRECMES   = vrm.map(r=>({origem:r.origem, mes:r.mes, qtd:+r.qtd, valor:+r.valor}));

  EXEC = ex.map(r=>({id:'E'+r.id, ctrl:r.n_controle, prod:r.produto, adv:r.advogado,
    cliente:r.cliente, proc:r.processo, valor:+r.valor, foro:r.foro, vara:r.vara,
    st:r.status, dexp:r.data_expedicao, ult:r.ultimo_andamento,
    dult:r.data_ultimo_andamento, obs:r.observacoes||'', drec:r.data_recebimento}));

  TRAT = tr.map(r=>({id:'T'+r.id, fase:r.fase, uf:r.estado, adv:r.advogado, proc:r.processo,
    autor:r.autor, reu:r.reu, escr:r.escritorio_adverso, canal:r.canal, data:r.data,
    st:r.status, obs:r.observacoes||''}));

  FAT = fa.map(r=>({id:'F'+r.id, orig:r.origem, fase:r.fase, adv:r.advogado, prod:r.produto,
    autor:r.autor, reu:r.reu, proc:r.processo, dmin:r.data_minuta, valor:+r.valor,
    prot:r.protocolado, dprot:r.data_protocolo, uf:r.estado, prev:r.previsao,
    rec:r.recebido, drec:r.data_recebimento, obs:r.observacoes||''}));

  TRAB = tb.map(r=>({id:'B'+r.id, autor:r.autor, reu:r.reu, proc:r.processo, data:r.data,
    valor:+r.valor, prev:r.previsao, rec:r.recebido, drec:r.data_recebimento}));

  ADVBOX = Object.fromEntries(ar.map(r=>[r.categoria, +r.valor]));
  ADVMES = am.map(r=>({cat:r.categoria, mes:r.mes, qtd:r.qtd, valor:+r.valor}));

  // configuração vinda do banco sobrescreve os padrões
  if(gr.length){
    CFG.gruposA = gr.filter(g=>g.esteira==='acordo').map(g=>({id:g.id,nome:g.nome,cor:g.cor,desc:g.descricao}));
    CFG.gruposE = gr.filter(g=>g.esteira==='execucao' && g.id!=='fora')
      .map(g=>({id:g.id,nome:g.nome,cor:g.cor,desc:g.descricao}));
  }
  if(fs.length){
    CFG.fasesA = fs.filter(f=>f.esteira==='acordo')
      .map(f=>({id:f.id,nome:f.nome,grupo:f.grupo_id,cor:f.cor,denom:f.conta_no_denominador}));
    CFG.fasesE = fs.filter(f=>f.esteira==='execucao' && f.id!=='MLE - ACORDO')
      .map(f=>({id:f.id,nome:f.nome,grupo:f.grupo_id,cor:f.cor,desc:f.descricao,
                conf:f.confianca,prazo:f.prazo_dias}));
  }
  mt.forEach(m=>{
    if(m.chave==='caixa_ano') CFG.meta_caixa=+m.valor;
    if(m.chave==='objetivo_ano') CFG.meta_objetivo=+m.valor;
    if(m.chave==='acordos_mes') CFG.meta_acordos_mes=+m.valor;
  });
  pr.forEach(p=>{
    if(p.chave==='alerta_parado') CFG.alerta_parado=+p.valor;
    if(p.chave==='alerta_critico') CFG.alerta_critico=+p.valor;
    if(p.chave==='wip_limite') CFG.wip_limite=+p.valor;
  });
}

/* ==================================================================
   CONFIGURAÇÃO — editável na aba Ajustes
   ================================================================== */
const CFG = {
  meta_caixa: 4000000,
  meta_objetivo: 6500000,
  meta_acordos_mes: 140000,
  wip_limite: 60,
  alerta_parado: 45,
  alerta_critico: 90,

  // Esteira de ACORDOS — status reais da planilha de tratativas
  gruposA: [
    {id:'contato', nome:'Em contato',        cor:'#6366F1', desc:'A bola está com a equipe'},
    {id:'travado', nome:'Travado no processo',cor:'#F59E0B', desc:'Vivo, mas depende de ato de terceiro'},
    {id:'ganho',   nome:'Ganho',              cor:'#A3E635', desc:'Acordo fechado, vai para faturamento'},
    {id:'perdido', nome:'Perdido',            cor:'#FB7185', desc:'Desfecho negativo'}
  ],
  // denom: entra no denominador da taxa de sucesso. Só desfecho entra —
  // um caso aguardando audiência está vivo, contá-lo como perda mente para
  // baixo. Estes valores são o espelho de config_fase no banco, que manda.
  fasesA: [
    {id:'AGUARDANDO RETORNO',  nome:'Aguardando retorno',  grupo:'contato', cor:'#6366F1', denom:false},
    {id:'EM TRATATIVA',        nome:'Em tratativa',        grupo:'contato', cor:'#A855F7', denom:false},
    {id:'AGUARD. CONTESTAÇÃO', nome:'Aguard. contestação', grupo:'travado', cor:'#F59E0B', denom:false},
    {id:'AGUARDANDO RECURSO',  nome:'Aguardando recurso',  grupo:'travado', cor:'#EAB308', denom:false},
    {id:'MLE',                 nome:'MLE',                 grupo:'travado', cor:'#D97706', denom:false},
    {id:'ACORDO FECHADO',      nome:'Acordo fechado',      grupo:'ganho',   cor:'#A3E635', denom:true},
    {id:'RECUSADO',            nome:'Recusado',            grupo:'perdido', cor:'#FB7185', denom:true},
    {id:'SEM RETORNO',         nome:'Sem retorno',         grupo:'perdido', cor:'#F43F5E', denom:true},
    {id:'IMPROCEDENTE',        nome:'Improcedente',        grupo:'perdido', cor:'#BE123C', denom:true}
  ],

  // Esteira de EXECUÇÃO — status reais do mapa
  gruposE: [
    {id:'cumpr', nome:'Em cumprimento', cor:'#6366F1', desc:'Sem depósito ainda'},
    {id:'levan', nome:'Levantamento',   cor:'#06B6D4', desc:'Depositado — corrida até o caixa'},
    {id:'caixa', nome:'Caixa',          cor:'#A3E635', desc:'Recebido em conta'}
  ],
  fasesE: [
    {id:'CS',               nome:'CS',               grupo:'cumpr', cor:'#6366F1', desc:'Cumprimento definitivo'},
    {id:'CS-P',             nome:'CS-P',             grupo:'cumpr', cor:'#A855F7', desc:'Cumprimento provisório'},
    {id:'MLE SEM DESPACHO', nome:'MLE sem despacho', grupo:'levan', cor:'#06B6D4', desc:'Formulário juntado', conf:70, prazo:70},
    {id:'EXPEDIDO',         nome:'Expedido',         grupo:'levan', cor:'#14B8A6', desc:'Juiz deferiu',      conf:85, prazo:38},
    {id:'COM DESPACHO',     nome:'Com despacho',     grupo:'levan', cor:'#22C55E', desc:'Banco autorizado',  conf:95, prazo:11},
    {id:'RECEBIDO',         nome:'Recebido',         grupo:'caixa', cor:'#A3E635', desc:'Valor em conta'}
  ]
};
const fA = id => CFG.fasesA.find(f=>f.id===id) || {nome:cap(id),cor:'#5B6878',grupo:'contato'};
const fE = id => CFG.fasesE.find(f=>f.id===id) || {nome:cap(id),cor:'#5B6878',grupo:'cumpr'};

/* ==================================================================
   MÉTRICAS
   ================================================================== */
const execPorSt = st => EXEC.filter(e=>e.st===st);
const tratPorSt = st => TRAT.filter(t=>t.st===st);

// Recebido de MLE no ano corrente (origem execução, exclui MLE - ACORDO)
const recMLE = () => EXEC.filter(e=>e.st==='RECEBIDO' && e.drec && e.drec.slice(0,4)==String(ANO));
// Acordos recebidos no ano
const recACORDO = () => FAT.filter(f=>f.rec==='SIM' && f.drec && f.drec.slice(0,4)==String(ANO));
const recTRAB = () => TRAB.filter(t=>t.rec==='SIM' && t.drec && t.drec.slice(0,4)==String(ANO));
// Plantado: tudo em execução que ainda não é caixa (exclui MLE - ACORDO, que já faturou em acordos)
const PLANTADO_ST = ['CS','CS-P','MLE SEM DESPACHO','EXPEDIDO','COM DESPACHO'];
const plantados = () => EXEC.filter(e=>PLANTADO_ST.includes(e.st));

/* Receita por origem, no ano corrente, lida de vw_receita_mes. */
function recPorOrigem(o){
  return soma(VRECMES.filter(r=>r.origem===o && r.mes.slice(0,4)===String(ANO)), r=>r.valor);
}

const M = {};
function calcula(){
  // Os fatos vêm do banco. A tela não recalcula receita nem plantado: se
  // divergirem da view, o número da reunião e o do relatório divergem.
  // O fallback em JavaScript só existe para a view não ter respondido.
  const daView = VPAINEL && VRECMES.length;
  M.recMLE   = daView ? recPorOrigem('MLE')         : soma(recMLE(), e=>e.valor);
  M.recACORDO= daView ? recPorOrigem('Acordo')      : soma(recACORDO(), f=>f.valor);
  M.recTRAB  = daView ? recPorOrigem('Trabalhista') : soma(recTRAB(), t=>t.valor);
  M.recebido = M.recMLE + M.recACORDO + M.recTRAB;
  M.plantado = VPAINEL ? +VPAINEL.plantado : soma(plantados(), e=>e.valor);
  M.alcancado= M.recebido + M.plantado;

  // Daqui para baixo depende das metas, que são editáveis em Ajustes —
  // por isso continua na tela: é simulação, não fato.
  M.pctCaixa = pct(M.recebido, CFG.meta_caixa);
  M.pctObj   = pct(M.alcancado, CFG.meta_objetivo);
  M.mesesRest= 12 - MES + 1;
  M.takt     = Math.max(CFG.meta_caixa - M.recebido, 0) / M.mesesRest;
  M.ritmo    = M.recebido / MES;
  M.mleAcordo= soma(execPorSt('MLE - ACORDO'), e=>e.valor);

  // previsão ponderada — vem de vw_previsao, que já aplica a confiança
  M.previsao = VPREVISAO.length
    ? VPREVISAO.map(p=>({id:p.etapa, nome:p.nome, cor:p.cor, conf:p.confianca,
        prazo:p.prazo_dias, qtd:+p.qtd, bruto:+p.bruto, pond:+p.ponderado}))
    : CFG.fasesE.filter(f=>f.conf).map(f=>{
        const l = execPorSt(f.id), bruto = soma(l,e=>e.valor);
        return {...f, qtd:l.length, bruto, pond: bruto*f.conf/100};
      });
  M.previsaoTotal = soma(M.previsao, p=>p.pond);

  // tratativas decididas → taxa de sucesso.
  // Quem decide é config_fase.conta_no_denominador, no banco. Antes a tela
  // cruzava isso com uma lista de grupos escrita aqui: duas regras para a
  // mesma decisão, prontas para divergir na primeira fase nova.
  const DEC = CFG.fasesA.filter(f=>f.denom).map(f=>f.id);
  M.decididos = TRAT.filter(t=>DEC.includes(t.st));
  M.fechados  = tratPorSt('ACORDO FECHADO');
  M.taxa      = pct(M.fechados.length, M.decididos.length);
  M.vivos     = TRAT.filter(t=>!DEC.includes(t.st));
  M.ticket    = FAT.length ? soma(FAT,f=>f.valor)/FAT.length : 0;

  // inércia da execução
  M.parados   = plantados().filter(e=>{const d=dias(e.dult); return d!==null && d>CFG.alerta_parado;});
  M.criticos  = plantados().filter(e=>{const d=dias(e.dult); return d!==null && d>CFG.alerta_critico;});
  M.semAndam  = plantados().filter(e=>!e.dult);

  // acordos fechados sem protocolo / sem recebimento
  M.semProt   = FAT.filter(f=>f.prot!=='SIM');
  M.aReceber  = FAT.filter(f=>f.prot==='SIM' && f.rec!=='SIM');
  M.aReceberV = soma(M.aReceber, f=>f.valor);
  M.atrasados = M.aReceber.filter(f=>f.prev && f.prev < ISO_HOJE);

  // Era `${ANO}-0${MES}`: de outubro em diante virava "2026-010" e o mês
  // aparecia zerado. Não dava para ver com a data fixa em julho.
  M.mesAcordos = FAT.filter(f=>f.dprot && f.dprot.slice(0,7)===`${ANO}-${MM}`);
  M.mesAcordosV= soma(M.mesAcordos, f=>f.valor);

  // Até quando a base foi alimentada. Se o último recebimento é antigo,
  // o painel inteiro está descrevendo um escritório que já mudou.
  const datas = [...EXEC.map(e=>e.drec), ...FAT.map(f=>f.drec)].filter(Boolean).sort();
  M.ultimoDado = datas.length ? datas[datas.length-1] : null;
  M.diasSemDado = M.ultimoDado ? dias(M.ultimoDado) : null;
}
calcula();

/* agrupador genérico para as tabelas de recorte */
function recorte(lista, chave, valor){
  const m = new Map();
  lista.forEach(x=>{
    const k = chave(x) || '—';
    const o = m.get(k) || {k, qtd:0, val:0};
    o.qtd++; o.val += valor(x)||0;
    m.set(k,o);
  });
  return [...m.values()].sort((a,b)=>b.val-a.val);
}
function taxaPor(chave){
  const m = new Map();
  M.decididos.forEach(t=>{
    const k = chave(t) || '—';
    const o = m.get(k) || {k,dec:0,ganhos:0};
    o.dec++; if(t.st==='ACORDO FECHADO') o.ganhos++;
    m.set(k,o);
  });
  return [...m.values()].map(o=>({...o, taxa:pct(o.ganhos,o.dec)}))
    .filter(o=>o.dec>=5).sort((a,b)=>b.taxa-a.taxa);
}

/* ==================================================================
   COMPONENTES
   ================================================================== */
function kpi(rot,val,obs,cor){
  return `<div class="kpi" style="--gl:${cor||'rgba(99,102,241,.24)'}">
    <div class="r">${rot}</div><div class="v">${val}</div>
    ${obs?`<div class="o">${obs}</div>`:''}</div>`;
}

function aro(pcts, tam){
  // pcts: [{v, cor}] empilhados sobre 100%.
  // Cada fatia era limitada a 100% sozinha, mas a soma não: batida a meta,
  // o segundo arco dava a volta e passava por cima do primeiro. O corte
  // agora é no acumulado — o anel enche e para.
  const R=tam/2-11, C=2*Math.PI*R;
  let off=0, acum=0;
  const arcos = pcts.map((p,i)=>{
    const fatia = Math.max(Math.min(p.v, 100-acum), 0);
    acum += fatia;
    const len = fatia/100*C;
    const el = `<circle cx="${tam/2}" cy="${tam/2}" r="${R}" fill="none" stroke="${p.cor}"
      stroke-width="13" stroke-linecap="round" stroke-dasharray="${len} ${C}"
      stroke-dashoffset="${-off}" transform="rotate(-90 ${tam/2} ${tam/2})"
      style="filter:drop-shadow(0 0 8px ${p.cor}aa)"/>`;
    off += len; return el;
  }).join('');
  return `<svg width="${tam}" height="${tam}" viewBox="0 0 ${tam} ${tam}">
    <circle cx="${tam/2}" cy="${tam/2}" r="${R}" fill="none" stroke="rgba(255,255,255,.07)" stroke-width="13"/>
    ${arcos}</svg>`;
}

/* fluxo 3D — o elemento-assinatura */
function fluxo(fases, contar, valorDe, titulo, legenda, filtroAtual, onFiltro){
  const dados = fases.map(f=>{
    const l = contar(f.id);
    return {f, qtd:l.length, val:soma(l,valorDe)};
  });
  const max = Math.max(...dados.map(d=>d.val), 1);
  const total = soma(dados,d=>d.val);
  const slabs = dados.map((d,i)=>{
    const h = 30 + (d.val/max)*118;
    const mudo = filtroAtual && filtroAtual!==d.f.id;
    return `<div class="slab ${mudo?'mudo':''}" data-f="${esc(d.f.id)}" data-onf="${onFiltro}">
      <div class="torre" style="--c:${d.f.cor};height:${h}px">
        ${h>34?`<span class="cifra">${kk(d.val)}</span>`:''}
      </div>
      <div class="base" style="--c:${d.f.cor}"></div>
      <div class="rot"><div class="nm">${esc(d.f.nome)}</div><div class="qt">${d.qtd}</div></div>
      ${i<dados.length-1?'<div class="seta">›</div>':''}
    </div>`;
  }).join('');
  return `<div class="fluxo-cx">
    <div class="fluxo-topo">
      <h3>${titulo}</h3><span class="leg">${legenda}</span>
      <span style="margin-left:auto;font-size:12px;color:var(--txt-3)">
        Total <b class="mono" style="color:var(--txt);font-size:14px">${brl(total)}</b></span>
    </div>
    <div class="palco"><div class="esteira">${slabs}</div></div>
  </div>`;
}

/* ==================================================================
   TELA — PAINEL (visão do gestor)
   ================================================================== */
/* Doze meses do ano corrente para uma origem, lidos de vw_receita_mes. */
function mesesDe(origem){
  const a = new Array(12).fill(0);
  VRECMES.filter(r=>r.origem===origem && r.mes.slice(0,4)===String(ANO))
         .forEach(r=>{ a[+r.mes.slice(5,7)-1] += r.valor; });
  return a;
}

function telaPainel(){
  const cm = {v: mesesDe('MLE')};
  const ca = {v: mesesDe('Acordo')};
  const ct = {v: mesesDe('Trabalhista')};
  const totMes = cm.v.map((x,i)=>x+ca.v[i]+ct.v[i]);
  const metaMes = CFG.meta_caixa/12;
  const maxb = Math.max(...totMes, metaMes)*1.16;
  const MESES=['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];

  const barras = MESES.map((m,i)=>{
    const fut = i>=MES;
    const hm = metaMes/maxb*100;
    const h1 = cm.v[i]/maxb*100, h2 = ca.v[i]/maxb*100, h3 = ct.v[i]/maxb*100;
    return `<div style="flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;gap:6px">
      <div style="height:148px;width:100%;display:flex;align-items:flex-end;justify-content:center;position:relative">
        <div style="position:absolute;bottom:${hm}%;left:0;right:0;border-top:1px dashed rgba(255,255,255,.22)"></div>
        <div style="width:68%;display:flex;flex-direction:column-reverse;${fut?'opacity:.22':''}">
          <div style="height:${h1}px;min-height:${cm.v[i]?2:0}px;background:linear-gradient(180deg,#22D3EE,#0891B2);
            border-radius:0 0 3px 3px;box-shadow:0 0 14px -2px #06B6D4"
            title="MLE ${brl2(cm.v[i])}"></div>
          <div style="height:${h2}px;min-height:${ca.v[i]?2:0}px;background:linear-gradient(180deg,#BEF264,#84CC16);
            box-shadow:0 0 14px -2px #A3E635" title="Acordos ${brl2(ca.v[i])}"></div>
          <div style="height:${h3}px;min-height:${ct.v[i]?2:0}px;background:linear-gradient(180deg,#FCD34D,#F59E0B);
            border-radius:3px 3px 0 0" title="Trabalhista ${brl2(ct.v[i])}"></div>
        </div>
      </div>
      <div style="font-size:10.5px;color:${i===MES-1?'var(--txt)':'var(--txt-3)'};font-weight:${i===MES-1?600:400}">${m}</div>
      <div class="mono" style="font-size:9.5px;color:var(--txt-3)">${totMes[i]?kk(totMes[i]):''}</div>
    </div>`;
  }).join('');

  const luzes = [
    {n:M.criticos.length, t:'Execução parada há mais de '+CFG.alerta_critico+' dias',
     s:brl(soma(M.criticos,e=>e.valor))+' sem movimentação', nivel:M.criticos.length>40?'pr':(M.criticos.length>10?'at':'ok'),
     ir:()=>{filtroE.parado=true; vai('execucao');}},
    {n:M.atrasados.length, t:'Acordo protocolado e não pago no prazo',
     s:brl(soma(M.atrasados,f=>f.valor))+' vencidos', nivel:M.atrasados.length>5?'pr':(M.atrasados.length?'at':'ok'),
     ir:()=>vai('financeiro')},
    {n:M.semAndam.length, t:'Execução sem andamento registrado',
     s:'não dá para medir a inércia', nivel:M.semAndam.length>100?'at':'ok',
     ir:()=>vai('execucao')},
    {n:M.vivos.filter(t=>dias(t.data)>CFG.alerta_parado).length, t:'Tratativa sem contato há mais de '+CFG.alerta_parado+' dias',
     s:'cada dia parado derruba a chance', nivel:'at', ir:()=>vai('acordos')},
    // A corda mais importante do andon: se a base parou de ser alimentada,
    // todo o resto desta tela está descrevendo um escritório que já mudou.
    {n:M.diasSemDado===null?'—':M.diasSemDado, t:'Dias desde o último recebimento registrado',
     s:M.ultimoDado?'base alimentada até '+dtb(M.ultimoDado):'nenhuma data na base',
     nivel:M.diasSemDado===null||M.diasSemDado>45?'pr':(M.diasSemDado>20?'at':'ok'),
     ir:()=>vai('ajustes')}
  ];

  document.getElementById('t-painel').innerHTML = `
    <div class="cab">
      <div class="olho">Gemba · ${dtb(HOJE.toISOString().slice(0,10))}</div>
      <h1>O escritório agora</h1>
      <p>Uma tela só, com o que decide a semana: onde o dinheiro está preso, quanto falta para a meta e o que parou de andar.</p>
    </div>

    <div class="andon">
      ${luzes.map((l,i)=>`<button class="luz ${l.nivel}" data-luz="${i}">
        <span class="bulbo"></span>
        <span class="tx"><b>${l.t}</b><span>${l.s}</span></span>
        <span class="num">${l.n}</span></button>`).join('')}
    </div>

    <div class="grade g2">
      <div class="cx">
        <h3>Objetivo do ano</h3>
        <p class="sub">Recebido em conta mais o que está plantado na execução.</p>
        <div class="medidor">
          <div class="aro">
            ${aro([{v:pct(M.recebido,CFG.meta_objetivo),cor:'#A3E635'},
                   {v:pct(M.plantado,CFG.meta_objetivo),cor:'#06B6D4'}],184)}
            <div class="meio">
              <div class="pc">${M.pctObj.toFixed(0)}%</div>
              <div class="lb">de ${kk(CFG.meta_objetivo)}</div>
            </div>
          </div>
          <div class="legs">
            <div class="leg-l"><span class="pt" style="background:#A3E635;color:#A3E635"></span>
              <span class="tx">Recebido em conta</span><span class="vl">${brl(M.recebido)}</span></div>
            <div class="leg-l"><span class="pt" style="background:#06B6D4;color:#06B6D4"></span>
              <span class="tx">Plantado na execução</span><span class="vl">${brl(M.plantado)}</span></div>
            <div class="leg-l"><span class="pt" style="background:rgba(255,255,255,.14);box-shadow:none"></span>
              <span class="tx">Falta para o objetivo</span><span class="vl">${brl(Math.max(CFG.meta_objetivo-M.alcancado,0))}</span></div>
            <div class="trilho" style="margin-top:4px">
              <i style="width:${Math.min(M.pctObj,100)}%;background:linear-gradient(90deg,#A3E635,#06B6D4)"></i></div>
          </div>
        </div>
      </div>

      <div class="cx">
        <h3>Takt · ritmo necessário</h3>
        <p class="sub">O que falta para os ${kk(CFG.meta_caixa)} de caixa, dividido pelos meses que restam.</p>
        <table class="tb">
          <tr><td>Recebido em ${ANO}<div class="trilho"><i style="width:${Math.min(M.pctCaixa,100)}%;background:#A3E635"></i></div></td>
              <td class="n">${brl(M.recebido)}<div class="p">${M.pctCaixa.toFixed(1)}% da meta</div></td></tr>
          <tr><td>Ritmo atual por mês</td><td class="n">${brl(M.ritmo)}</td></tr>
          <tr><td>Takt necessário por mês</td>
              <td class="n" style="color:${M.takt>M.ritmo?'var(--bad)':'var(--s5)'}">${brl(M.takt)}</td></tr>
          <tr class="tot"><td>${M.mesesRest} meses restantes</td><td class="n">${brl(Math.max(CFG.meta_caixa-M.recebido,0))}</td></tr>
        </table>
        ${M.takt>M.ritmo?`<div class="nota" style="margin:14px 0 0">
          No ritmo de hoje a meta de caixa não fecha. Para chegar lá, a média mensal precisa subir
          <b>${((M.takt/M.ritmo-1)*100).toFixed(0)}%</b> — de ${brl(M.ritmo)} para ${brl(M.takt)}.</div>`
        :`<div class="nota info" style="margin:14px 0 0">Ritmo acima do necessário. Mantendo esta média, a meta fecha antes de dezembro.</div>`}
      </div>
    </div>

    ${descobertas()}

    ${fluxo(CFG.fasesE, execPorSt, e=>e.valor, 'O funil do dinheiro',
      'Cada bloco é uma etapa da execução. A altura é o valor parado ali.', null, 'exec')}

    <div class="grade g4">
      ${kpi('Recebido de MLE', brl(M.recMLE), `${recMLE().length} levantamentos no ano`, 'rgba(6,182,212,.28)')}
      ${kpi('Recebido de acordos', brl(M.recACORDO), `${recACORDO().length} acordos pagos`, 'rgba(163,230,53,.28)')}
      ${kpi('Trabalhista (parceiro)', brl(M.recTRAB), `${recTRAB().length} acordos · só faturamento`, 'rgba(245,158,11,.26)')}
      ${kpi('Previsão ponderada', brl(M.previsaoTotal), 'do que já está em levantamento', 'rgba(20,184,166,.28)')}
    </div>

    <div class="grade g2">
      <div class="cx">
        <h3>Caixa mês a mês</h3>
        <p class="sub">Empilhado por origem. A linha tracejada é ${brl(metaMes)} — a meta de caixa dividida por doze.</p>
        <div style="display:flex;gap:5px;align-items:flex-end">${barras}</div>
        <div style="display:flex;gap:16px;margin-top:14px;font-size:11.5px;color:var(--txt-2);flex-wrap:wrap">
          <span><i style="display:inline-block;width:9px;height:9px;border-radius:2px;background:#06B6D4;margin-right:5px"></i>MLE</span>
          <span><i style="display:inline-block;width:9px;height:9px;border-radius:2px;background:#A3E635;margin-right:5px"></i>Acordos</span>
          <span><i style="display:inline-block;width:9px;height:9px;border-radius:2px;background:#F59E0B;margin-right:5px"></i>Trabalhista</span>
        </div>
      </div>

      <div class="cx">
        <h3>Onde o acordo é fechado</h3>
        <p class="sub">Taxa de sucesso por recorte. Só recortes com 5 ou mais casos decididos.</p>
        <div class="filtros" id="fTaxa">
          ${[['fase','Pré/pós'],['adv','Advogado'],['canal','Canal'],['uf','Estado'],['escr','Escritório adverso'],['reu','Réu']]
            .map(([k,r],i)=>`<button class="chip ${i===0?'on':''}" data-tx="${k}">${r}</button>`).join('')}
        </div>
        <div id="tabTaxa"></div>
      </div>
    </div>`;

  document.querySelectorAll('[data-luz]').forEach(b=>b.onclick=()=>luzes[+b.dataset.luz].ir());
  document.querySelectorAll('#fTaxa .chip').forEach(c=>c.onclick=()=>{
    document.querySelectorAll('#fTaxa .chip').forEach(x=>x.classList.remove('on'));
    c.classList.add('on'); pintaTaxa(c.dataset.tx);
  });
  pintaTaxa('fase');
  ligaFluxo();
}

function descobertas(){
  const canal = taxaPor(t=>t.canal);
  const wa = canal.find(x=>x.k==='WHATSAPP'), em = canal.find(x=>x.k==='E-MAIL');
  const fase = taxaPor(t=>t.fase);
  const pos = fase.find(x=>x.k==='PÓS'), pre = fase.find(x=>x.k==='PRÉ');
  const cards=[];
  if(wa && em && wa.taxa > em.taxa*1.3){
    cards.push({
      t:'WhatsApp fecha '+(wa.taxa/em.taxa).toFixed(1)+'× mais que e-mail',
      n:wa.taxa.toFixed(1)+'%',
      d:`${wa.ganhos} acordos em ${wa.dec} tentativas por WhatsApp, contra ${em.taxa.toFixed(1)}% em ${em.dec} por e-mail. `
        +`Mesmo assim o e-mail é ${(em.dec/wa.dec).toFixed(1)}× mais usado. Se metade do volume de e-mail migrasse para WhatsApp, `
        +`a projeção é de <b>${Math.round(em.dec*0.5*(wa.taxa-em.taxa)/100)} acordos a mais</b> no mesmo esforço.`,
      c:'#22C55E'});
  }
  if(pos && pre && pos.taxa > pre.taxa*1.3){
    cards.push({
      t:'Pós-sentença converte '+(pos.taxa/pre.taxa).toFixed(1)+'× mais que pré',
      n:pos.taxa.toFixed(1)+'%',
      d:`${pos.ganhos} em ${pos.dec} no pós contra ${pre.taxa.toFixed(1)}% em ${pre.dec} no pré. `
        +`O pré responde por ${(pre.dec/(pre.dec+pos.dec)*100).toFixed(0)}% do esforço da equipe e entrega `
        +`${(pre.ganhos/(pre.ganhos+pos.ganhos)*100).toFixed(0)}% dos acordos.`,
      c:'#06B6D4'});
  }
  const topR = taxaPor(t=>t.reu).slice(0,1)[0];
  if(topR && topR.taxa>30){
    cards.push({t:'O réu que mais aceita acordo', n:topR.taxa.toFixed(1)+'%',
      d:`<b>${esc(cap(topR.k))}</b> fechou ${topR.ganhos} de ${topR.dec} tentativas. `
        +`Vale desenhar uma régua específica para esse adverso em vez de tratá-lo como os demais.`,
      c:'#A3E635'});
  }
  if(!cards.length) return '';
  return `<div class="cx" style="margin-bottom:14px">
    <h3>O que os dados dizem</h3>
    <p class="sub">Lido das ${TRAT.length} tratativas da base. Não é opinião — é o que os seus próprios dados mostram.</p>
    <div class="grade g3" style="margin:0">
      ${cards.map(c=>`<div style="border-left:2px solid ${c.c};padding-left:14px">
        <div class="mono" style="font-size:24px;font-weight:700;color:${c.c};letter-spacing:-.04em">${c.n}</div>
        <div style="font-size:13px;font-weight:600;margin:5px 0 6px">${c.t}</div>
        <div style="font-size:12px;color:var(--txt-2);line-height:1.55">${c.d}</div>
      </div>`).join('')}
    </div></div>`;
}

function pintaTaxa(campo){
  const l = taxaPor(t=>t[campo]).slice(0,9);
  const max = Math.max(...l.map(x=>x.taxa),1);
  document.getElementById('tabTaxa').innerHTML = l.length? `<table class="tb">
    <tr><th>Recorte</th><th class="n">Decididos</th><th class="n">Taxa</th></tr>
    ${l.map(x=>`<tr>
      <td>${esc(cap(x.k))}<div class="trilho"><i style="width:${x.taxa/max*100}%;
        background:linear-gradient(90deg,#A3E635,#22C55E)"></i></div></td>
      <td class="n">${x.dec}<div class="p">${x.ganhos} fechados</div></td>
      <td class="n" style="color:${x.taxa>=25?'var(--s6)':(x.taxa>=12?'var(--warn)':'var(--bad)')}">${x.taxa.toFixed(1)}%</td>
    </tr>`).join('')}</table>` : '<p class="sub">Sem recorte com massa suficiente.</p>';
}

/* ==================================================================
   TELA — ACORDOS
   ================================================================== */
let filtroA = {fase:null, adv:null, texto:''};
let limiteA = {};

function fichaTrat(t){
  const d = dias(t.data);
  const alerta = d>CFG.alerta_parado && fA(t.st).grupo==='contato';
  return `<article class="ficha" data-abrir="T" data-id="${t.id}" style="--c:${fA(t.st).cor}">
    <div class="fl1"><span class="proc">${esc(t.proc)}</span>
      ${d!==null?`<span class="tarja ${alerta?'r':(d>20?'a':'v')}">${d}d</span>`:''}</div>
    <div class="partes">${esc(cap(t.autor).split(' ').slice(0,2).join(' '))}<i>×</i>${esc(t.reu)}</div>
    <div class="selos">
      <span class="selo">${esc(t.fase)}</span>
      <span class="selo">${esc(t.uf)}</span>
      <span class="selo">${esc(cap(t.adv))}</span>
      ${t.canal?`<span class="selo">${esc(cap(t.canal))}</span>`:''}
      ${t.escr?`<span class="selo w">${esc(t.escr)}</span>`:''}
    </div>
  </article>`;
}

function telaAcordos(){
  const base = TRAT.filter(t=>(!filtroA.adv||t.adv===filtroA.adv));
  const advs = [...new Set(TRAT.map(t=>t.adv))].filter(Boolean);

  const faixas = CFG.gruposA.map(g=>{
    const fs = CFG.fasesA.filter(f=>f.grupo===g.id);
    const cols = fs.map(f=>{
      const itens = base.filter(t=>t.st===f.id);
      const lim = limiteA[f.id] || 25;
      const most = itens.slice(0,lim);
      const dd = itens.map(t=>dias(t.data)).filter(x=>x!==null);
      const med = dd.length? Math.round(dd.reduce((a,b)=>a+b,0)/dd.length) : null;
      const wip = Math.min(itens.length/CFG.wip_limite*100,100);
      const wipCor = itens.length>CFG.wip_limite ? 'var(--bad)' : (itens.length>CFG.wip_limite*.7?'var(--warn)':f.cor);
      return `<div class="col">
        <div class="col-cab">
          <div class="l1"><span class="pt" style="background:${f.cor};color:${f.cor}"></span>
            <b>${esc(f.nome)}</b><span class="qt">${itens.length}</span></div>
          <div class="vl">${med!==null?med+' d':'—'}</div>
          <div class="sb">${med!==null?'idade média na fase':'sem data'}</div>
          ${g.id==='contato'?`<div class="wip"><i style="width:${wip}%;background:${wipCor}"></i></div>`:''}
        </div>
        <div class="col-lista">
          ${most.length? most.map(fichaTrat).join('') : '<div class="nada">Vazio.</div>'}
          ${itens.length>lim?`<button class="maisbt" data-mais="${esc(f.id)}">
            mostrar mais ${Math.min(25,itens.length-lim)} de ${itens.length-lim}</button>`:''}
        </div>
      </div>`;
    }).join('');
    return `<div class="faixa">
      <div class="dorso" style="background:${g.cor}" title="${esc(g.desc)}"><span>${esc(g.nome)}</span></div>
      <div class="colunas">${cols}</div></div>`;
  }).join('');

  document.getElementById('t-acordos').innerHTML = `
    <div class="cab"><div class="olho">Esteira · ${TRAT.length} tratativas na base</div>
      <h1>Acordos</h1>
      <p>As colunas não arrastam. O card anda quando o fato é registrado. A barra fina embaixo do título é o limite de trabalho em curso: quando estoura, a fila está engasgando.</p></div>

    <div class="grade g4">
      ${kpi('Taxa de sucesso', M.taxa.toFixed(1)+'%', `${M.fechados.length} fechados em ${M.decididos.length} decididos`,'rgba(163,230,53,.26)')}
      ${kpi('Vivos na esteira', M.vivos.length, 'ainda podem virar acordo','rgba(99,102,241,.26)')}
      ${kpi('Ticket médio', brl(M.ticket), 'sobre os acordos faturados','rgba(168,85,247,.26)')}
      ${kpi('Fechado em '+MESES_NOME[MES-1], brl(M.mesAcordosV), `${M.mesAcordos.length} acordos · meta ${brl(CFG.meta_acordos_mes)}`,
        M.mesAcordosV>=CFG.meta_acordos_mes?'rgba(163,230,53,.3)':'rgba(245,158,11,.26)')}
    </div>

    <div class="filtros">
      <button class="chip ${!filtroA.adv?'on':''}" data-adv="">Todos os advogados</button>
      ${advs.map(a=>`<button class="chip ${filtroA.adv===a?'on':''}" data-adv="${esc(a)}">${cap(a)}</button>`).join('')}
    </div>

    ${fluxo(CFG.fasesA, id=>base.filter(t=>t.st===id), ()=>1, 'Onde estão as tratativas',
      'Altura pela quantidade de casos, não por valor: a planilha de tratativas não guarda valor.', null,'trat')}

    <div class="quadro">${faixas}</div>`;

  document.querySelectorAll('[data-adv]').forEach(b=>b.onclick=()=>{
    filtroA.adv = b.dataset.adv || null; limiteA={}; desenha();
  });
  document.querySelectorAll('[data-mais]').forEach(b=>b.onclick=()=>{
    limiteA[b.dataset.mais] = (limiteA[b.dataset.mais]||25)+25; desenha();
  });
  ligaFichas(); ligaFluxo();
}

/* ==================================================================
   TELA — EXECUÇÃO
   ================================================================== */
let filtroE = {fase:null, adv:null, prod:null, parado:false};
let limiteE = {};

function fichaExec(e){
  const d = dias(e.dult);
  const crit = d!==null && d>CFG.alerta_critico;
  const at = d!==null && d>CFG.alerta_parado;
  const rem = /remanescente/i.test(e.obs), inc = /incontroverso/i.test(e.obs);
  return `<article class="ficha" data-abrir="E" data-id="${e.id}" style="--c:${fE(e.st).cor}">
    <div class="fl1"><span class="proc">${esc(e.proc)}</span>
      ${d!==null?`<span class="tarja ${crit?'r':(at?'a':'v')}">${d}d</span>`:''}</div>
    <div class="partes">${esc(cap(e.cliente).split(' ').slice(0,3).join(' '))}</div>
    <div class="cif">${brl2(e.valor)}</div>
    <div class="selos">
      ${e.prod?`<span class="selo">${esc(e.prod)}</span>`:''}
      ${e.adv?`<span class="selo">${esc(cap(e.adv))}</span>`:''}
      ${inc?'<span class="selo g">incontroverso</span>':''}
      ${rem?'<span class="selo w">remanescente</span>':''}
      ${e.ult?`<span class="selo">${esc(cap(e.ult))}</span>`:''}
    </div>
  </article>`;
}

function telaExecucao(){
  let base = EXEC.filter(e=>e.st!=='MLE - ACORDO');
  if(filtroE.adv)  base = base.filter(e=>e.adv===filtroE.adv);
  if(filtroE.prod) base = base.filter(e=>e.prod===filtroE.prod);
  if(filtroE.parado) base = base.filter(e=>{const d=dias(e.dult); return d!==null && d>CFG.alerta_critico;});
  const mleAc = EXEC.filter(e=>e.st==='MLE - ACORDO');

  const advs  = [...new Set(EXEC.map(e=>e.adv))].filter(Boolean);
  const prods = [...new Set(EXEC.map(e=>e.prod))].filter(Boolean);

  const faixas = CFG.gruposE.map(g=>{
    const fs = CFG.fasesE.filter(f=>f.grupo===g.id);
    const cols = fs.map(f=>{
      const itens = base.filter(e=>e.st===f.id).sort((a,b)=>b.valor-a.valor);
      const lim = limiteE[f.id] || 20;
      const val = soma(itens,e=>e.valor);
      const conf = f.conf ? `${f.conf}% · ~${f.prazo} dias até o caixa` : (f.desc||'');
      return `<div class="col">
        <div class="col-cab">
          <div class="l1"><span class="pt" style="background:${f.cor};color:${f.cor}"></span>
            <b>${esc(f.nome)}</b><span class="qt">${itens.length}</span></div>
          <div class="vl">${brl(val)}</div>
          <div class="sb">${esc(conf)}</div>
        </div>
        <div class="col-lista">
          ${itens.length? itens.slice(0,lim).map(fichaExec).join('') : '<div class="nada">Vazio.</div>'}
          ${itens.length>lim?`<button class="maisbt" data-maise="${esc(f.id)}">
            mostrar mais ${Math.min(20,itens.length-lim)} de ${itens.length-lim}</button>`:''}
        </div>
      </div>`;
    }).join('');
    return `<div class="faixa">
      <div class="dorso" style="background:${g.cor}" title="${esc(g.desc)}"><span>${esc(g.nome)}</span></div>
      <div class="colunas">${cols}</div></div>`;
  }).join('');

  document.getElementById('t-execucao').innerHTML = `
    <div class="cab"><div class="olho">Esteira · ${EXEC.length} valores em controle</div>
      <h1>Execução</h1>
      <p>Cada card é um valor, não um processo. O mesmo processo pode ter uma parte já levantada e um remanescente ainda executando — e aparece nas duas colunas, como é na vida real.</p></div>

    <div class="grade g4">
      ${kpi('Plantado', brl(M.plantado), `${plantados().length} valores a levantar`,'rgba(6,182,212,.28)')}
      ${kpi('Recebido em '+ANO, brl(M.recMLE), `${recMLE().length} levantamentos`,'rgba(163,230,53,.28)')}
      ${kpi('Parado há +'+CFG.alerta_critico+' dias', M.criticos.length, brl(soma(M.criticos,e=>e.valor))+' travados',
        M.criticos.length>40?'rgba(251,113,133,.3)':'rgba(245,158,11,.26)')}
      ${kpi('MLE · Acordo', mleAc.length, brl(M.mleAcordo)+' — fora da receita','rgba(168,85,247,.26)')}
    </div>

    <div class="nota info">
      <b>Por que MLE · Acordo fica fora da conta.</b> São ${mleAc.length} levantamentos que nasceram de acordo pago
      por depósito judicial. Eles já entraram na receita quando o acordo foi faturado. Contá-los de novo aqui
      inflaria o caixa em ${brl(M.mleAcordo)}. Ficam separados, visíveis para quem precisa pedir o levantamento.
    </div>

    <div class="filtros">
      <button class="chip ${!filtroE.adv&&!filtroE.prod&&!filtroE.parado?'on':''}" data-lim="tudo">Tudo</button>
      <span style="color:var(--txt-3);font-size:11px">·</span>
      ${advs.map(a=>`<button class="chip ${filtroE.adv===a?'on':''}" data-eadv="${esc(a)}">${cap(a)}</button>`).join('')}
      <span style="color:var(--txt-3);font-size:11px">·</span>
      ${prods.map(p=>`<button class="chip ${filtroE.prod===p?'on':''}" data-eprod="${esc(p)}">${esc(p)}</button>`).join('')}
      <span style="color:var(--txt-3);font-size:11px">·</span>
      <button class="chip ${filtroE.parado?'on':''}" data-eparado="1">Só o que parou</button>
    </div>

    ${fluxo(CFG.fasesE, id=>base.filter(e=>e.st===id), e=>e.valor, 'O funil do dinheiro',
      'Da esquerda para a direita, o valor amadurece até virar caixa.', filtroE.fase,'exec')}

    <div class="quadro">${faixas}</div>`;

  document.querySelectorAll('[data-eadv]').forEach(b=>b.onclick=()=>{
    filtroE.adv = filtroE.adv===b.dataset.eadv?null:b.dataset.eadv; limiteE={}; desenha(); });
  document.querySelectorAll('[data-eprod]').forEach(b=>b.onclick=()=>{
    filtroE.prod = filtroE.prod===b.dataset.eprod?null:b.dataset.eprod; limiteE={}; desenha(); });
  document.querySelectorAll('[data-eparado]').forEach(b=>b.onclick=()=>{
    filtroE.parado=!filtroE.parado; limiteE={}; desenha(); });
  document.querySelectorAll('[data-lim=tudo]').forEach(b=>b.onclick=()=>{
    filtroE={fase:null,adv:null,prod:null,parado:false}; limiteE={}; desenha(); });
  document.querySelectorAll('[data-maise]').forEach(b=>b.onclick=()=>{
    limiteE[b.dataset.maise]=(limiteE[b.dataset.maise]||20)+20; desenha(); });
  ligaFichas(); ligaFluxo();
}

/* ==================================================================
   TELA — FINANCEIRO
   ================================================================== */
function telaFinanceiro(){
  const cats = Object.entries(ADVBOX)
    .filter(([k])=>!['RECEITA BRUTA','0. DEDUÇÕES','RECEITA LIQUIDA'].includes(k))
    .sort((a,b)=>b[1]-a[1]);
  // Sem extrato do ADVBox, cats fica vazio e cats[0][1] derrubava a tela toda.
  const maxCat = cats.length ? cats[0][1] : 0;
  const bruta = ADVBOX['RECEITA BRUTA']||0;
  const ded = ADVBOX['0. DEDUÇÕES']||0;
  const liq = ADVBOX['RECEITA LIQUIDA']||0;

  const prevBloco = M.previsao.map(p=>`<tr>
    <td><span class="pt" style="display:inline-block;width:8px;height:8px;border-radius:50%;
      background:${p.cor};box-shadow:0 0 8px ${p.cor};margin-right:7px"></span>${esc(p.nome)}
      <div class="p">${p.qtd} valores · ${p.conf}% de confiança · ~${p.prazo} dias</div></td>
    <td class="n">${brl(p.pond)}<div class="p">de ${brl(p.bruto)}</div></td></tr>`).join('');

  const aReceber = M.aReceber.sort((a,b)=>(a.prev||'9')<(b.prev||'9')?-1:1);

  document.getElementById('t-financeiro').innerHTML = `
    <div class="cab"><div class="olho">Contas a receber</div><h1>Financeiro</h1>
      <p>Não existe base própria aqui. Tudo vem das esteiras de Acordos e de Execução, mais o que já foi lançado no ADVBox.</p></div>

    <div class="grade g4">
      ${kpi('Receita bruta ADVBox', brl(bruta), 'lançado no sistema em '+ANO,'rgba(163,230,53,.28)')}
      ${kpi('Deduções', brl(ded), pct(ded,bruta).toFixed(1)+'% da bruta','rgba(251,113,133,.26)')}
      ${kpi('Receita líquida', brl(liq), 'o que sobrou de fato','rgba(20,184,166,.28)')}
      ${kpi('A receber de acordos', brl(M.aReceberV), `${M.aReceber.length} protocolados sem pagamento`,'rgba(245,158,11,.26)')}
    </div>

    <div class="grade g2">
      <div class="cx">
        <h3>Composição da receita</h3>
        <p class="sub">Categorias do ADVBox no ano. É a foto do que realmente entrou.</p>
        <table class="tb">
          ${cats.length?'':'<tr><td colspan="2"><span class="p">Nenhum lançamento do ADVBox carregado.</span></td></tr>'}
          ${cats.map(([k,v])=>`<tr><td>${esc(k)}
            <div class="trilho"><i style="width:${pct(v,maxCat)}%;
              background:linear-gradient(90deg,#06B6D4,#A3E635)"></i></div></td>
            <td class="n">${brl(v)}<div class="p">${pct(v,bruta).toFixed(1)}%</div></td></tr>`).join('')}
          <tr class="tot"><td>Receita bruta</td><td class="n">${brl(bruta)}</td></tr>
        </table>
      </div>

      <div class="cx">
        <h3>Previsão ponderada</h3>
        <p class="sub">Cada etapa vale o que ela promete de verdade, não o valor de face.</p>
        <table class="tb">${prevBloco}
          <tr class="tot"><td>Esperado até o caixa</td><td class="n">${brl(M.previsaoTotal)}</td></tr></table>
        <div class="nota" style="margin:14px 0 0">
          Os prazos de 70, 38 e 11 dias são <b>estimativas iniciais</b>, não medições.
          Com a data de expedição e a de recebimento no mesmo lugar, o sistema passa a calcular
          a mediana real e troca sozinho — aí a previsão deixa de ser palpite.
        </div>
      </div>
    </div>

    <div class="cx" style="margin-bottom:14px">
      <h3>Acordos protocolados aguardando pagamento</h3>
      <p class="sub">Ordenado pela previsão. Em vermelho, o que já passou do prazo e precisa voltar para a execução.</p>
      <table class="tb">
        <tr><th>Processo</th><th>Autor</th><th>Réu</th><th>Protocolo</th><th>Previsão</th><th class="n">Valor</th></tr>
        ${aReceber.slice(0,18).map(f=>{
          const venc = f.prev && f.prev < HOJE.toISOString().slice(0,10);
          return `<tr>
            <td class="mono" style="font-size:11px">${esc(f.proc)}</td>
            <td>${esc(cap(f.autor).split(' ').slice(0,2).join(' '))}</td>
            <td>${esc(cap(f.reu))}</td>
            <td class="mono" style="font-size:11px">${dtb(f.dprot)}</td>
            <td class="mono" style="font-size:11px;color:${venc?'var(--bad)':'var(--txt-2)'}">${dtb(f.prev)}${venc?' ⚠':''}</td>
            <td class="n">${brl2(f.valor)}</td></tr>`;
        }).join('')}
        <tr class="tot"><td colspan="5">${M.aReceber.length} acordos aguardando</td><td class="n">${brl(M.aReceberV)}</td></tr>
      </table>
    </div>

    ${conciliacao()}

    <div class="grade g2">
      <div class="cx">
        <h3>Acordos por produto</h3>
        <p class="sub">Sobre os ${FAT.length} acordos faturados no ano.</p>
        <table class="tb">
          ${recorte(FAT, f=>f.prod, f=>f.valor).map(r=>`<tr>
            <td>${esc(r.k)}<div class="p">${r.qtd} acordos · ticket ${brl(r.val/r.qtd)}</div></td>
            <td class="n">${brl(r.val)}</td></tr>`).join('')}
        </table>
      </div>
      <div class="cx">
        <h3>Ativo × passivo</h3>
        <p class="sub">Quanto veio de iniciativa nossa e quanto o adverso trouxe.</p>
        <table class="tb">
          ${recorte(FAT, f=>f.orig, f=>f.valor).map(r=>`<tr>
            <td>${esc(cap(r.k))}
              <div class="trilho"><i style="width:${pct(r.val,soma(FAT,f=>f.valor))}%;
                background:${r.k==='ATIVO'?'#A3E635':'#06B6D4'}"></i></div></td>
            <td class="n">${brl(r.val)}<div class="p">${r.qtd} acordos · ticket ${brl(r.val/r.qtd)}</div></td></tr>`).join('')}
        </table>
        <div class="nota info" style="margin:14px 0 0">
          O ticket médio dos dois lados é a conta que decide onde colocar gente:
          se o passivo paga melhor, prospectar menos e atender mais rápido rende mais.
        </div>
      </div>
    </div>`;

  ligaBusca();
}

/* A conciliação inteira vem de views. A tela só escolhe o que mostrar.
   Antes ela refazia as somas aqui, e refazia errado: comparava o histórico
   inteiro do faturamento contra um único ano do ADVBox. */
function conciliacao(){
  if(!VCONC.length){
    return `<div class="cx" style="margin-bottom:14px"><h3>Conciliação entre as fontes</h3>
      <p class="sub" style="margin:0">Nenhum extrato do ADVBox carregado — não há o que conciliar.</p></div>`;
  }

  const rotulo = {
    'MLE':        {a:'Mapa de execução',        b:'ADVBox · Mle'},
    'Acordos':    {a:'Relatório de faturamento', b:'ADVBox · 4 categorias de acordo'},
    'Trabalhista':{a:'Aba Trabalhista',          b:'ADVBox · Acordo Trabalhista'}
  };
  const linhas = VCONC.map(l=>({o:l.origem, va:+l.controle_equipe, vb:+l.advbox, dif:+l.diferenca}))
                      .sort((x,y)=>Math.abs(y.dif)-Math.abs(x.dif));
  const difTotal = soma(linhas, l=>Math.abs(l.dif));

  /* Decomposição: quanto da diferença já tem explicação conhecida. */
  const trab = linhas.find(l=>l.o==='Trabalhista');
  const semBaseTrab = (trab && !TRAB.length) ? Math.abs(trab.dif) : 0;

  const procMleAcordo = new Set(EXEC.filter(e=>e.st==='MLE - ACORDO').map(e=>e.proc));
  const porMleAcordo = VCONCPROC.filter(c=>c.situacao==='so_advbox' && procMleAcordo.has(c.processo));
  const vMleAcordo = soma(porMleAcordo, c=>+c.diferenca);

  const resto = Math.max(difTotal - semBaseTrab - vMleAcordo, 0);

  const soAdv = VCONCPROC.filter(c=>c.situacao==='so_advbox').length;
  const soCtrl= VCONCPROC.filter(c=>c.situacao==='so_controle').length;

  const explic = [
    semBaseTrab && {v:semBaseTrab, t:'Acordos trabalhistas',
      d:'O ADVBox lança, e o sistema não tem base de trabalhista nenhuma — a tabela está vazia. '
       +'Não é divergência de número: é uma fonte que nunca foi carregada.'},
    vMleAcordo && {v:vMleAcordo, t:`MLE · Acordo — ${porMleAcordo.length} processos`,
      d:'Levantamentos que nasceram de acordo já faturado. A trava anti-duplicidade tira esse valor da '
       +'receita de MLE de propósito; o ADVBox lançou como Mle. Os dois estão certos pela sua própria régua.'},
    resto>0.01 && {v:resto, t:'Ainda sem explicação',
      d:`Sobra depois de descontar o que já se sabe. É aqui que vale procurar: ${soAdv} processos aparecem `
       +`só no ADVBox e ${soCtrl} só no controle da equipe.`}
  ].filter(Boolean);

  const pares = VCONCPAR.map(p=>({...p, valor:+p.valor})).sort((a,b)=>b.valor-a.valor);
  const vPares = soma(pares, p=>p.valor);

  const topo = VCONCPROC.map(c=>({...c, diferenca:+c.diferenca, controle:+c.controle, advbox:+c.advbox}))
    .sort((a,b)=>Math.abs(b.diferenca)-Math.abs(a.diferenca)).slice(0,12);
  const nomeSit = {so_advbox:'Só no ADVBox', so_controle:'Só no controle', valor_diferente:'Valor diferente'};

  return `<div class="cx" style="margin-bottom:14px">
    <h3>Conciliação entre as fontes</h3>
    <p class="sub">A mesma receita, contada por dois caminhos. Os dois lados olham ${ANO} — o ano do extrato do ADVBox.</p>
    <table class="tb">
      <tr><th>Origem</th><th class="n">Controle da equipe</th><th class="n">ADVBox</th><th class="n">Diferença</th></tr>
      ${linhas.map(l=>`<tr>
        <td><b>${esc(l.o)}</b><div class="p">${esc((rotulo[l.o]||{}).a||'')} × ${esc((rotulo[l.o]||{}).b||'')}</div></td>
        <td class="n">${brl2(l.va)}</td>
        <td class="n">${brl2(l.vb)}</td>
        <td class="n" style="color:${Math.abs(l.dif)<1?'var(--s5)':(Math.abs(l.dif)>40000?'var(--bad)':'var(--warn)')}">
          ${l.dif>0?'+':''}${brl2(l.dif)}
          <div class="p" style="font-weight:400">${l.va?pct(Math.abs(l.dif),l.va).toFixed(1)+'%':'—'}</div></td></tr>`).join('')}
      <tr class="tot"><td>Divergência absoluta somada</td><td class="n"></td><td class="n"></td>
        <td class="n" style="color:var(--warn)">${brl2(difTotal)}</td></tr>
    </table>

    <h3 style="margin-top:22px">Do que essa diferença é feita</h3>
    <p class="sub">Divergência sem nome vira discussão. Com nome, vira tarefa.</p>
    <table class="tb">
      ${explic.map(e=>`<tr><td><b>${esc(e.t)}</b>
        <div class="p" style="line-height:1.5;white-space:normal">${e.d}</div></td>
        <td class="n">${brl2(e.v)}<div class="p">${pct(e.v,difTotal).toFixed(0)}%</div></td></tr>`).join('')}
      <tr class="tot"><td>Total</td><td class="n">${brl2(difTotal)}</td></tr>
    </table>
  </div>

  ${pares.length?`<div class="cx" style="margin-bottom:14px">
    <h3>Mesmo dinheiro sob dois números de processo</h3>
    <p class="sub">Valor idêntico, lados opostos. ${pares.length} ocorrências, ${brl(vPares)} de cada lado.
      Não muda o total — os dois se anulam —, mas torna a conciliação por processo impossível
      e é o tipo de coisa que vira pagamento em duplicidade.</p>
    <table class="tb">
      <tr><th>Número no ADVBox</th><th>Número no controle</th><th class="n">Valor</th></tr>
      ${pares.map(p=>`<tr>
        <td class="mono" style="font-size:11px">${esc(p.processo_advbox)}</td>
        <td class="mono" style="font-size:11px">${esc(p.processo_controle)}</td>
        <td class="n">${brl2(p.valor)}</td></tr>`).join('')}
    </table></div>`:''}

  ${topo.length?`<div class="cx" style="margin-bottom:14px">
    <h3>Onde a diferença está, processo a processo</h3>
    <p class="sub">As ${topo.length} maiores de ${VCONCPROC.length}. Clique para abrir o que o sistema conhece do processo.</p>
    <table class="tb">
      <tr><th>Processo</th><th>Situação</th><th class="n">Controle</th><th class="n">ADVBox</th><th class="n">Diferença</th></tr>
      ${topo.map(c=>`<tr>
        <td class="mono" style="font-size:11px"><button class="bt" style="padding:2px 8px;font-size:11px"
          data-busca="${esc(c.processo)}">${esc(c.processo)}</button></td>
        <td><span class="selo ${c.situacao==='so_advbox'?'w':(c.situacao==='so_controle'?'d':'')}">${nomeSit[c.situacao]||c.situacao}</span></td>
        <td class="n">${c.controle?brl2(c.controle):'—'}</td>
        <td class="n">${c.advbox?brl2(c.advbox):'—'}</td>
        <td class="n" style="color:${c.diferenca>0?'var(--warn)':'var(--bad)'}">${c.diferenca>0?'+':''}${brl2(c.diferenca)}</td>
      </tr>`).join('')}
    </table></div>`:''}`;
}

/* ==================================================================
   TELA — BUSCA
   ================================================================== */
function telaBusca(termo){
  const t = (termo||'').toLowerCase().trim();
  const alvo = document.getElementById('t-busca');
  if(t.length<3){
    alvo.innerHTML = `<div class="cab"><div class="olho">Busca</div><h1>Procurar</h1>
      <p>Digite ao menos três letras. Procura em processo, autor, cliente, réu, escritório adverso, advogado e foro — nas três bases ao mesmo tempo.</p></div>`;
    return;
  }
  const m = o => Object.values(o).some(v=>typeof v==='string' && v.toLowerCase().includes(t));
  const e = EXEC.filter(m).slice(0,60), tr = TRAT.filter(m).slice(0,60), f = FAT.filter(m).slice(0,60);
  const procs = [...new Set([...e.map(x=>x.proc),...tr.map(x=>x.proc),...f.map(x=>x.proc)])];

  alvo.innerHTML = `<div class="cab"><div class="olho">Busca</div><h1>“${esc(termo)}”</h1>
    <p>${procs.length} processos · ${e.length} em execução, ${tr.length} em tratativa, ${f.length} faturados.</p></div>
    ${procs.length===0?'<div class="cx"><p class="sub" style="margin:0">Nada encontrado.</p></div>':''}
    ${procs.slice(0,40).map(p=>{
      const le=e.filter(x=>x.proc===p), lt=tr.filter(x=>x.proc===p), lf=f.filter(x=>x.proc===p);
      const ref = le[0]||lt[0]||lf[0];
      const nome = ref.cliente||ref.autor||'';
      return `<div class="resu">
        <div style="display:flex;align-items:baseline;gap:12px;flex-wrap:wrap">
          <span class="mono" style="font-size:12.5px;font-weight:700">${esc(p)}</span>
          <span style="font-size:12.5px">${esc(cap(nome))}</span>
          <span style="margin-left:auto;font-size:11px;color:var(--txt-3)">${esc(cap(ref.adv||''))}</span>
        </div>
        ${le.map(x=>`<div class="lr"><span class="pt" style="width:8px;height:8px;border-radius:50%;
            background:${fE(x.st).cor};box-shadow:0 0 8px ${fE(x.st).cor}"></span>
          <b style="width:78px;font-size:9.5px;letter-spacing:.13em;text-transform:uppercase;color:var(--txt-3);
            font-family:'JetBrains Mono',monospace">Execução</b>
          <span>${esc(fE(x.st).nome)}</span>
          <span class="mono" style="margin-left:auto;font-weight:700">${brl2(x.valor)}</span>
          <button class="bt" data-abrir="E" data-id="${x.id}">Abrir</button></div>`).join('')}
        ${lt.map(x=>`<div class="lr"><span class="pt" style="width:8px;height:8px;border-radius:50%;
            background:${fA(x.st).cor};box-shadow:0 0 8px ${fA(x.st).cor}"></span>
          <b style="width:78px;font-size:9.5px;letter-spacing:.13em;text-transform:uppercase;color:var(--txt-3);
            font-family:'JetBrains Mono',monospace">Tratativa</b>
          <span>${esc(fA(x.st).nome)} · ${esc(x.reu)}</span>
          <span class="mono" style="margin-left:auto;color:var(--txt-3);font-size:11px">${dtb(x.data)}</span>
          <button class="bt" data-abrir="T" data-id="${x.id}">Abrir</button></div>`).join('')}
        ${lf.map(x=>`<div class="lr"><span class="pt" style="width:8px;height:8px;border-radius:50%;
            background:#A3E635;box-shadow:0 0 8px #A3E635"></span>
          <b style="width:78px;font-size:9.5px;letter-spacing:.13em;text-transform:uppercase;color:var(--txt-3);
            font-family:'JetBrains Mono',monospace">Faturado</b>
          <span>${x.rec==='SIM'?'Recebido':'Aguardando pagamento'} · ${esc(x.orig)}</span>
          <span class="mono" style="margin-left:auto;font-weight:700">${brl2(x.valor)}</span>
          <button class="bt" data-abrir="F" data-id="${x.id}">Abrir</button></div>`).join('')}
      </div>`;
    }).join('')}`;
  ligaFichas();
}

/* ==================================================================
   GAVETA
   ================================================================== */
function abre(tipo,id){
  let h='', t='';
  if(tipo==='E'){
    const e = EXEC.find(x=>x.id===id); if(!e) return;
    const f = fE(e.st);
    const etapas = [
      {r:'Expedição do MLE', d:e.dexp, c:'#14B8A6'},
      {r:'Último andamento — '+cap(e.ult||'—'), d:e.dult, c:'#6366F1'},
      {r:'Recebido em conta', d:e.drec, c:'#A3E635'}
    ].filter(x=>x.d);
    t = `<div style="font-size:10px;letter-spacing:.15em;text-transform:uppercase;color:var(--txt-3);
        font-family:'JetBrains Mono',monospace">Execução · controle ${esc(e.ctrl)||'—'}</div>
      <div class="mono" style="font-size:14px;font-weight:700;margin-top:3px">${esc(e.proc)}</div>
      <div style="margin-top:9px"><span style="background:${f.cor};color:#04070C;padding:3px 11px;
        border-radius:99px;font-size:11px;font-weight:700">${esc(f.nome)}</span></div>`;
    h = `<div class="bloco"><h4>Valor</h4>
        <div class="mono" style="font-size:27px;font-weight:700;letter-spacing:-.04em">${brl2(e.valor)}</div>
        ${e.obs?`<div style="font-size:12px;color:var(--txt-2);margin-top:9px">${esc(e.obs)}</div>`:''}</div>
      <div class="bloco"><h4>Processo</h4><div class="par">
        <div class="it"><div class="r">Cliente</div><div class="v">${esc(cap(e.cliente))}</div></div>
        <div class="it"><div class="r">Advogado</div><div class="v">${esc(cap(e.adv))||'—'}</div></div>
        <div class="it"><div class="r">Produto</div><div class="v">${esc(e.prod)||'—'}</div></div>
        <div class="it"><div class="r">Foro</div><div class="v">${esc(e.foro)||'—'}</div></div>
        <div class="it"><div class="r">Vara</div><div class="v">${esc(e.vara)||'—'}</div></div>
        <div class="it"><div class="r">Status</div><div class="v">${esc(e.st)}</div></div>
      </div></div>
      <div class="bloco"><h4>Linha do tempo</h4>
        ${etapas.length?`<div class="rota">${etapas.map(x=>`<div class="et">
          <span class="bola" style="background:${x.c};color:${x.c}"></span>
          <span class="cnt"><b>${esc(x.r)}</b><span>${dtb(x.d)}</span></span></div>`).join('')}</div>`
        :'<p style="margin:0;font-size:12px;color:var(--txt-3)">Sem datas registradas neste valor.</p>'}
        ${e.dult?`<div style="margin-top:12px;font-size:11.5px;color:${dias(e.dult)>CFG.alerta_critico?'var(--bad)':'var(--txt-3)'}">
          Parado há ${dias(e.dult)} dias.</div>`:''}
        ${f.conf&&!e.drec?`<div class="nota info" style="margin:12px 0 0">
          Nesta etapa a expectativa é de cerca de ${f.prazo} dias até o caixa, com ${f.conf}% de confiança.</div>`:''}
      </div>`;
  }
  if(tipo==='T'){
    const x = TRAT.find(y=>y.id===id); if(!x) return;
    const f = fA(x.st);
    const fat = FAT.filter(y=>y.proc===x.proc);
    t = `<div style="font-size:10px;letter-spacing:.15em;text-transform:uppercase;color:var(--txt-3);
        font-family:'JetBrains Mono',monospace">Tratativa · ${esc(x.fase)}-sentença</div>
      <div class="mono" style="font-size:14px;font-weight:700;margin-top:3px">${esc(x.proc)}</div>
      <div style="margin-top:9px"><span style="background:${f.cor};color:#04070C;padding:3px 11px;
        border-radius:99px;font-size:11px;font-weight:700">${esc(f.nome)}</span></div>`;
    h = `<div class="bloco"><h4>Partes</h4>
        <div class="it"><div class="r">Autor · nosso cliente</div><div class="v">${esc(cap(x.autor))}</div></div>
        <div class="it"><div class="r">Réu</div><div class="v">${esc(x.reu)}</div></div>
        <div class="it"><div class="r">Escritório adverso</div><div class="v">${esc(x.escr)||'—'}</div></div>
      </div>
      <div class="bloco"><h4>Tratativa</h4><div class="par">
        <div class="it"><div class="r">Canal</div><div class="v">${esc(cap(x.canal))||'—'}</div></div>
        <div class="it"><div class="r">Advogado</div><div class="v">${esc(cap(x.adv))}</div></div>
        <div class="it"><div class="r">Estado</div><div class="v">${esc(x.uf)}</div></div>
        <div class="it"><div class="r">Data do registro</div><div class="v mono">${dtb(x.data)}</div></div>
      </div>
      ${x.data?`<div style="font-size:11.5px;color:var(--txt-3);margin-top:4px">Há ${dias(x.data)} dias na base.</div>`:''}
      ${x.obs?`<div style="font-size:12px;color:var(--txt-2);margin-top:11px;padding-top:11px;
        border-top:1px solid var(--line)">${esc(x.obs)}</div>`:''}</div>
      ${fat.length?`<div class="bloco"><h4>Faturamento deste processo</h4>
        ${fat.map(y=>`<div class="it"><div class="r">${esc(y.orig)} · ${esc(y.fase)}</div>
          <div class="v mono">${brl2(y.valor)} — ${y.rec==='SIM'?'recebido em '+dtb(y.drec):'aguardando'}</div></div>`).join('')}
      </div>`:''}`;
  }
  if(tipo==='F'){
    const x = FAT.find(y=>y.id===id); if(!x) return;
    t = `<div style="font-size:10px;letter-spacing:.15em;text-transform:uppercase;color:var(--txt-3);
        font-family:'JetBrains Mono',monospace">Acordo faturado · ${esc(x.orig)} · ${esc(x.fase)}</div>
      <div class="mono" style="font-size:14px;font-weight:700;margin-top:3px">${esc(x.proc)}</div>
      <div style="margin-top:9px"><span style="background:${x.rec==='SIM'?'#A3E635':'#F59E0B'};color:#04070C;
        padding:3px 11px;border-radius:99px;font-size:11px;font-weight:700">
        ${x.rec==='SIM'?'Recebido':'Aguardando pagamento'}</span></div>`;
    const rota=[{r:'Minuta assinada',d:x.dmin,c:'#6366F1'},{r:'Protocolado',d:x.dprot,c:'#06B6D4'},
      {r:'Previsão de pagamento',d:x.prev,c:'#F59E0B'},{r:'Recebido',d:x.drec,c:'#A3E635'}].filter(y=>y.d);
    h = `<div class="bloco"><h4>Valor</h4>
        <div class="mono" style="font-size:27px;font-weight:700;letter-spacing:-.04em">${brl2(x.valor)}</div></div>
      <div class="bloco"><h4>Partes</h4>
        <div class="it"><div class="r">Autor</div><div class="v">${esc(cap(x.autor))}</div></div>
        <div class="it"><div class="r">Réu</div><div class="v">${esc(cap(x.reu))}</div></div>
        <div class="par" style="margin-top:10px">
          <div class="it"><div class="r">Advogado</div><div class="v">${esc(cap(x.adv))}</div></div>
          <div class="it"><div class="r">Produto</div><div class="v">${esc(x.prod)||'—'}</div></div>
          <div class="it"><div class="r">Estado</div><div class="v">${esc(x.uf)}</div></div>
          <div class="it"><div class="r">Origem</div><div class="v">${esc(cap(x.orig))}</div></div>
        </div></div>
      <div class="bloco"><h4>Linha do tempo</h4>
        <div class="rota">${rota.map(y=>`<div class="et">
          <span class="bola" style="background:${y.c};color:${y.c}"></span>
          <span class="cnt"><b>${esc(y.r)}</b><span>${dtb(y.d)}</span></span></div>`).join('')}</div>
        ${x.obs?`<div style="font-size:12px;color:var(--txt-2);margin-top:12px">${esc(x.obs)}</div>`:''}</div>`;
  }
  document.getElementById('gavT').innerHTML = t;
  document.getElementById('gavC').innerHTML = h;
  document.getElementById('gav').classList.add('on');
  document.getElementById('veu').classList.add('on');
}
const fecha=()=>{document.getElementById('gav').classList.remove('on');
  document.getElementById('veu').classList.remove('on');};

/* ==================================================================
   TELA — AJUSTES
   ================================================================== */
function telaAjustes(){
  const lf = (f,tipo)=>`<div class="linhaf">
    <input type="color" value="${f.cor}" data-c="cor" data-t="${tipo}" data-id="${esc(f.id)}"
      style="width:32px;height:28px;border:1px solid var(--line);border-radius:7px;padding:0;background:none;cursor:pointer">
    <input class="inp" value="${esc(f.nome)}" data-c="nome" data-t="${tipo}" data-id="${esc(f.id)}" style="flex:1">
    <select class="inp" data-c="grupo" data-t="${tipo}" data-id="${esc(f.id)}" style="width:190px">
      ${(tipo==='a'?CFG.gruposA:CFG.gruposE).map(g=>
        `<option value="${g.id}" ${g.id===f.grupo?'selected':''}>${esc(g.nome)}</option>`).join('')}
    </select>
    <span class="mono" style="width:66px;text-align:right;font-size:11px;color:var(--txt-3)">${
      (tipo==='a'?TRAT.filter(x=>x.st===f.id):EXEC.filter(x=>x.st===f.id)).length}</span>
  </div>`;

  document.getElementById('t-ajustes').innerHTML = `
    <div class="cab"><div class="olho">Configuração</div><h1>Ajustes</h1>
      <p>Renomeie fases, mude cores, mova coluna de grupo, mexa nas metas e nos limites de alerta. Muda na hora nas esteiras.</p></div>

    <div class="nota"><b>As edições desta tela valem só enquanto a aba estiver aberta.</b>
      Escrever no banco exige sessão autenticada, e o login ainda não foi ligado — hoje o ANDON
      é somente leitura. Enquanto isso, use esta tela para simular: mude a meta e veja o painel
      reagir, sem alterar nada para os outros.</div>

    <div class="grade g2">
      <div class="cx"><h3>Fases de acordos</h3>
        <p class="sub">Os nomes vieram da sua planilha de tratativas. O número à direita é quantos casos estão em cada uma.</p>
        ${CFG.fasesA.map(f=>lf(f,'a')).join('')}</div>
      <div class="cx"><h3>Fases de execução</h3>
        <p class="sub">Idem, vindos do mapa de execução. As três de levantamento alimentam a previsão de receita.</p>
        ${CFG.fasesE.map(f=>lf(f,'e')).join('')}</div>
    </div>

    <div class="grade g3">
      <div class="cx"><h3>Metas</h3><p class="sub">Mude e o painel recalcula.</p>
        <div class="it"><div class="r">Caixa no ano</div><input class="inp mono" type="number" id="m1" value="${CFG.meta_caixa}"></div>
        <div class="it"><div class="r">Objetivo total</div><input class="inp mono" type="number" id="m2" value="${CFG.meta_objetivo}"></div>
        <div class="it"><div class="r">Acordos por mês</div><input class="inp mono" type="number" id="m3" value="${CFG.meta_acordos_mes}"></div>
        <button class="bt p" id="salvaM" style="margin-top:10px">Aplicar</button></div>

      <div class="cx"><h3>Sinais do andon</h3><p class="sub">Quando a luz acende.</p>
        <div class="it"><div class="r">Atenção — dias parado</div><input class="inp mono" type="number" id="a1" value="${CFG.alerta_parado}"></div>
        <div class="it"><div class="r">Crítico — dias parado</div><input class="inp mono" type="number" id="a2" value="${CFG.alerta_critico}"></div>
        <div class="it"><div class="r">Limite de casos por coluna (WIP)</div><input class="inp mono" type="number" id="a3" value="${CFG.wip_limite}"></div>
        <button class="bt p" id="salvaA" style="margin-top:10px">Aplicar</button>
        <div class="nota info" style="margin-top:14px">O limite de trabalho em curso é o freio do sistema Toyota:
          quando uma coluna passa do limite, parar de puxar caso novo rende mais do que empurrar mais volume.</div></div>

      <div class="cx"><h3>De onde vêm os dados</h3><p class="sub">Situação atual da carga.</p>
        <table class="tb">
          <tr><td>Mapa de execução</td><td class="n">${EXEC.length}</td></tr>
          <tr><td>Controle de tratativas</td><td class="n">${TRAT.length}</td></tr>
          <tr><td>Faturamento de acordos</td><td class="n">${FAT.length}</td></tr>
          <tr><td>Acordos trabalhistas</td>
              <td class="n" style="color:${TRAB.length?'inherit':'var(--bad)'}">${TRAB.length}</td></tr>
          <tr><td>ADVBox · meses com lançamento</td><td class="n">${new Set(ADVMES.map(a=>a.mes)).size}</td></tr>
          <tr class="tot"><td>Último recebimento na base</td>
              <td class="n">${M.ultimoDado?dtb(M.ultimoDado):'—'}
                <div class="p">${M.diasSemDado!==null?'há '+M.diasSemDado+' dias':'sem data'}</div></td></tr>
        </table>
        ${TRAB.length?'':`<div class="nota" style="margin-top:14px">
          <b>Acordos trabalhistas está zerada.</b> Não existe arquivo alimentando essa tabela em
          <code>dados/</code>, e por isso os ${brl(ADVBOX['Acordo Trabalhista']||0)} que o ADVBox
          registra aparecem inteiros como divergência na conciliação.</div>`}
        <div class="nota info" style="margin-top:14px">Os dados vêm do repositório no GitHub.
          Trocar os arquivos de <code>dados/</code> e dar push atualiza o banco sozinho, em cerca
          de 20 segundos. Ninguém precisa abrir o Supabase.</div></div>
    </div>`;

  document.querySelectorAll('[data-c]').forEach(el=>{
    const lista = el.dataset.t==='a'?CFG.fasesA:CFG.fasesE;
    const f = lista.find(x=>x.id===el.dataset.id); if(!f) return;
    el.onchange = ()=>{ f[el.dataset.c]=el.value; desenha(); };
  });
  const g=(i)=>+document.getElementById(i).value||0;
  document.getElementById('salvaM').onclick=()=>{
    CFG.meta_caixa=g('m1'); CFG.meta_objetivo=g('m2'); CFG.meta_acordos_mes=g('m3'); calcula(); desenha(); };
  document.getElementById('salvaA').onclick=()=>{
    CFG.alerta_parado=g('a1'); CFG.alerta_critico=g('a2'); CFG.wip_limite=g('a3'); calcula(); desenha(); };
}

/* ==================================================================
   NAVEGAÇÃO
   ================================================================== */
const TELAS=[['painel','Painel'],['acordos','Acordos'],['execucao','Execução'],
             ['financeiro','Financeiro'],['busca','Busca'],['ajustes','Ajustes']];
let atual='painel';
function nav(){
  // Acordos e Cadastros vivem em paginas proprias. Antes havia um botao
  // 'Acordos' aqui e um link 'Esteira de acordos' ao lado, apontando para
  // coisas diferentes com nomes parecidos — confuso de proposito nenhum.
  const FORA = {acordos:'/acordos'};
  document.getElementById('nav').innerHTML = TELAS.map(([id,r])=>
    FORA[id] ? `<a class="nav-link" href="${FORA[id]}">${r}</a>`
             : `<button class="${id===atual?'on':''}" data-t="${id}">${r}</button>`).join('')
    + `<a class="nav-link" href="/cadastros">Cadastros</a>`;
  document.querySelectorAll('#nav button').forEach(b=>b.onclick=()=>vai(b.dataset.t));
}
function vai(id){
  atual=id;
  document.querySelectorAll('.tela').forEach(s=>s.classList.remove('on'));
  document.getElementById('t-'+id).classList.add('on');
  nav(); desenha(); window.scrollTo({top:0});
}
function desenha(){
  if(atual==='painel') telaPainel();
  else if(atual==='acordos') telaAcordos();
  else if(atual==='execucao') telaExecucao();
  else if(atual==='financeiro') telaFinanceiro();
  else if(atual==='busca') telaBusca(document.getElementById('q').value);
  else if(atual==='ajustes') telaAjustes();
}
function ligaFichas(){
  document.querySelectorAll('[data-abrir]').forEach(el=>{
    el.onclick = ev=>{ ev.stopPropagation(); abre(el.dataset.abrir, el.dataset.id); };
  });
}
/* Da conciliação para a busca: um processo divergente só vira tarefa se dá
   para ver, num clique, o que o sistema sabe dele. */
function ligaBusca(){
  document.querySelectorAll('[data-busca]').forEach(el=>{
    el.onclick = ev=>{ ev.stopPropagation();
      document.getElementById('q').value = el.dataset.busca; vai('busca'); };
  });
}
function ligaFluxo(){
  document.querySelectorAll('.slab').forEach(s=>{
    s.onclick = ()=>{
      if(s.dataset.onf==='exec'){
        filtroE.fase = filtroE.fase===s.dataset.f ? null : s.dataset.f;
        if(atual!=='execucao') vai('execucao'); else desenha();
      }
    };
  });
}

document.getElementById('q').addEventListener('input', ev=>{
  if(ev.target.value.trim().length>=3 && atual!=='busca') vai('busca');
  else if(atual==='busca') telaBusca(ev.target.value);
});
document.getElementById('fx').onclick=fecha;
document.getElementById('veu').onclick=fecha;
document.addEventListener('keydown',e=>{ if(e.key==='Escape') fecha(); });


/* ---------- boot ---------- */
function carregando(msg, erro){
  document.getElementById('t-painel').innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;
      min-height:56vh;gap:16px;text-align:center">
      <svg width="52" height="52" viewBox="0 0 100 100" style="border-radius:15px;
        ${erro?'':'animation:pulsa 1.7s ease-in-out infinite'}">
        <rect width="100" height="100" fill="#202C26"/>
        <g fill="none" stroke="#C5DEB9" stroke-width="7" stroke-linecap="round">
          <path d="M 56.3 14.5 A 36 36 0 1 1 43.7 14.5"/>
          <path d="M 51.5 14.2 A 44 44 0 0 0 77.6 73.1"/></g></svg>
      <div style="font-family:'Sora',sans-serif;font-weight:700;font-size:17px">${esc(msg)}</div>
      ${erro?`<div style="max-width:52ch;font-size:12.5px;color:var(--txt-2);line-height:1.6">${erro}</div>`:''}
    </div>
    <style>@keyframes pulsa{0%,100%{opacity:1}50%{opacity:.4}}</style>`;
}

(async ()=>{
  nav();
  carregando('Carregando os dados do escritório…');
  try{
    await carrega();
    calcula();
    if(!EXEC.length && !TRAT.length){
      carregando('Banco conectado, mas ainda vazio',
        'O esquema está no ar e a conexão funciona — só faltam as linhas. '+
        'A carga é automática: abra a aba <b>Actions</b> do repositório no GitHub e rode '+
        '<b>Atualizar banco</b>. Em uns 20 segundos recarregue esta página.');
      return;
    }
    desenha();
  }catch(e){
    carregando('Não consegui falar com o banco',
      esc(e.message)+'<br><br>Confira se o projeto Supabase está ativo e se as políticas de leitura estão valendo.');
  }
})();
