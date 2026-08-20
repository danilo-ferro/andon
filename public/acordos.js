/* ==================================================================
   ANDON · Acordos — esteira, lista e o formulário de três etapas
   Identificação → Tratativa → Faturamento. A terceira só abre quando o
   status vira Acordo Fechado, porque não existe faturamento sem acordo.
   ================================================================== */
const SB = {
  url: 'https://nkodijlsftdlzcmgjahk.supabase.co',
  key: 'sb_publishable_s6EH8fDfeVrBVJVz9i_E9A_QYcgkf88'
};

const $   = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const brl  = v => (+v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const brl2 = v => (+v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 });
const kk   = v => v >= 1e6 ? (v / 1e6).toFixed(2).replace('.', ',') + ' mi'
                : v >= 1e3 ? Math.round(v / 1e3) + ' mil' : Math.round(v || 0);
const dtb  = s => s ? s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4) : '—';
const soma = (l, f) => l.reduce((s, x) => s + (+f(x) || 0), 0);

const AGORA = new Date();
const HOJE  = new Date(AGORA.getFullYear(), AGORA.getMonth(), AGORA.getDate(), 12);
const ISO   = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dias  = s => s ? Math.round((HOJE - new Date(s + 'T12:00:00')) / 864e5) : null;

/* ---------- sessão e acesso ao banco ---------- */
const SESSAO = window.ANDON_SESSAO;
let sessao = SESSAO.ler();
const logado = () => !!(sessao && sessao.access_token);

async function api(caminho, opcoes) {
  const h = { apikey: SB.key, 'Content-Type': 'application/json', ...((opcoes || {}).headers || {}) };
  h.Authorization = 'Bearer ' + (logado() ? sessao.access_token : SB.key);
  const r = await fetch(`${SB.url}/rest/v1/${caminho}`, { ...opcoes, headers: h });
  if (r.status === 401 || r.status === 403) throw new Error(logado()
    ? 'Sua sessão expirou. Entre de novo para salvar.'
    : 'Sessão não encontrada. Recarregue a página para entrar de novo.');
  if (!r.ok) {
    const bruto = await r.text();
    // O Postgres devolve um JSON tecnico. Sozinho, ele nao diz a ninguem o
    // que fazer — traduzimos os casos que a equipe encontra de verdade.
    let msg = bruto.slice(0, 240) || `erro ${r.status}`;
    try {
      const d = JSON.parse(bruto);
      if (/invalid input syntax for type date/i.test(d.message || ''))
        msg = 'Alguma data ficou incompleta. Confira os campos de data e salve de novo.';
      else if (/invalid input syntax for type numeric/i.test(d.message || ''))
        msg = 'Algum valor não é um número válido. Confira o valor e as parcelas.';
      else if (/violates check constraint/i.test(d.message || ''))
        msg = 'Um dos campos ficou com opção inválida. Reabra a tratativa e escolha de novo.';
      else if (d.message) msg = d.message;
    } catch { /* nao era JSON: fica o texto cru mesmo */ }
    throw new Error(msg);
  }
  return r.status === 204 ? null : r.json();
}
const ler   = (t, q)    => api(`${t}?${q || 'select=*'}`);

/* O PostgREST corta em 1000 linhas por resposta, sem avisar. Sem paginar,
   1.407 tratativas apareciam como 1.000 e as contas saiam erradas. */
async function lerTudo(t, extra) {
  const out = []; let de = 0;
  for (;;) {
    const l = await api(`${t}?select=*&order=id.asc&offset=${de}&limit=1000${extra || ''}`);
    out.push(...l);
    if (l.length < 1000) break;
    de += 1000;
  }
  return out;
}
const criar = (t, o)    => api(t, { method: 'POST', body: JSON.stringify(o), headers: { Prefer: 'return=representation' } });
const mudar = (t, id, o) => api(`${t}?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify(o), headers: { Prefer: 'return=representation' } });

/* ---------- estado ---------- */
let TRAT = [], PESSOAS = [], REUS = [], ESCRS = [], CONTATOS = [], FASES = [], PARCELAS = [];
let aba = 'painel', busca = '';
const F = { periodo: '', de: '', ate: '', advogado: '', operador: '', produto: '', estado: '',
            tipo: '', fase: '', status: '', canal: '', parado: '' };

const NOME_MES = ['janeiro','fevereiro','março','abril','maio','junho',
                  'julho','agosto','setembro','outubro','novembro','dezembro'];

/* Traduz a escolha de periodo em um intervalo de datas. Vazio = tudo, que e
   o estado inicial: a tela abre mostrando o escritorio inteiro. */
function intervalo() {
  if (F.periodo === 'custom') return [F.de, F.ate];
  if (/^\d{4}-\d{2}$/.test(F.periodo)) {
    const [a, m] = F.periodo.split('-').map(Number);
    return [`${F.periodo}-01`, ISO(new Date(a, m, 0))];
  }
  return ['', ''];
}

/* Meses que existem de fato nos dados, do mais recente para o mais antigo. */
function mesesDisponiveis() {
  const s = new Set();
  TRAT.forEach(t => {
    [t.data, t.data_atualizacao, t.data_protocolo].forEach(d => { if (d) s.add(d.slice(0, 7)); });
  });
  return [...s].sort().reverse().slice(0, 36);
}

const UFS = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR',
             'PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];
const TIPOS   = ['ATIVO', 'PASSIVO'];
const FASES_P = ['Pré-sentença', 'Pós-sentença', 'Pós-acórdão'];
const CANAIS  = ['WHATSAPP', 'E-MAIL', 'TELEFONE', 'AUDIÊNCIA', 'AUTOS', 'NÃO APTO'];
const PRODUTOS = ['Limpa Nome (LN)', 'CCS', 'SCR', 'Bancários / Golpes', 'Estratégico', 'Trabalhista'];
const FECHADO = 'ACORDO FECHADO';

async function carrega() {
  const [t, p, r, e, c, f, pc] = await Promise.all([
    lerTudo('tratativa'),
    ler('pessoa', 'select=*&order=nome.asc'),
    ler('parte_adversa', 'select=id,nome,chave&order=nome.asc'),
    ler('escritorio_adverso', 'select=id,nome,chave&order=nome.asc'),
    lerTudo('contato'),
    ler('config_fase', 'select=*&esteira=eq.acordo&order=ordem.asc'),
    lerTudo('acordo_parcela')
  ]);
  TRAT = t; PESSOAS = p; REUS = r; ESCRS = e; CONTATOS = c; FASES = f; PARCELAS = pc;
}

const advogados = () => PESSOAS.filter(p => p.ativo && (p.papeis || []).includes('advogado'));
const operadores = () => PESSOAS.filter(p => p.ativo && (p.papeis || []).includes('operador'));
const fase = id => FASES.find(x => x.id === id) || { nome: id || '—', cor: '#5B6878' };
const parcelasDe = id => PARCELAS.filter(p => p.tratativa_id === id);

/* ---------- filtros ---------- */
function filtradas() {
  const b = busca.trim().toLowerCase();
  return TRAT.filter(t => {
    const [de, ate] = intervalo();
    if (de || ate) {
      // Uma tratativa entra no periodo se qualquer marco dela caiu ali:
      // abertura, ultima atualizacao ou protocolo. Filtrar so pela abertura
      // esconderia acordo antigo que fechou e faturou dentro do mes.
      const marcos = [t.data, t.data_atualizacao, t.data_protocolo].filter(Boolean);
      if (!marcos.some(d => (!de || d >= de) && (!ate || d <= ate))) return false;
    }
    if (F.advogado && t.advogado !== F.advogado) return false;
    if (F.operador && t.operador !== F.operador) return false;
    if (F.produto  && t.produto  !== F.produto)  return false;
    if (F.estado   && t.estado   !== F.estado)   return false;
    if (F.tipo     && t.tipo     !== F.tipo)     return false;
    if (F.fase     && t.fase     !== F.fase)     return false;
    if (F.status   && t.status   !== F.status)   return false;
    if (F.canal    && t.canal    !== F.canal)    return false;
    if (F.parado) {
      const d = dias(t.data_atualizacao || t.data);
      if (d === null || d < +F.parado) return false;
    }
    if (b) {
      const alvo = [t.processo, t.autor, t.reu, t.escritorio_adverso, t.advogado,
                    t.operador, t.observacoes].join(' ').toLowerCase();
      if (!alvo.includes(b)) return false;
    }
    return true;
  });
}

function pintaFiltros() {
  const op = (v, l, sel) => `<option value="${esc(v)}" ${v === sel ? 'selected' : ''}>${esc(l)}</option>`;
  const sel = (id, rot, itens, atual, vazio) => `
    <label class="filtro"><span>${rot}</span>
      <select data-f="${id}">${op('', vazio || 'todos', atual)}
        ${itens.map(i => op(i.v ?? i, i.l ?? i, atual)).join('')}</select></label>`;

  const meses = mesesDisponiveis().map(m => ({
    v: m, l: NOME_MES[+m.slice(5, 7) - 1] + ' de ' + m.slice(0, 4) }));
  const custom = F.periodo === 'custom';

  $('filtros').innerHTML = `<div class="filtros-cx"><div class="filtros-linha">
      <label class="filtro periodo"><span>período</span>
        <select data-f="periodo">
          ${op('', 'todo o período', F.periodo)}
          ${op('custom', 'intervalo personalizado…', F.periodo)}
          ${meses.map(m => op(m.v, m.l, F.periodo)).join('')}
        </select></label>
      <label class="filtro ${custom ? '' : 'oculto'}"><span>de</span>
        <input type="date" data-f="de" value="${F.de}"></label>
      <label class="filtro ${custom ? '' : 'oculto'}"><span>até</span>
        <input type="date" data-f="ate" value="${F.ate}"></label>
      ${sel('advogado', 'advogado', advogados().map(p => p.nome), F.advogado)}
      ${sel('operador', 'operador', operadores().map(p => p.nome), F.operador)}
      ${sel('produto', 'produto/tese', PRODUTOS, F.produto)}
      ${sel('estado', 'UF', UFS, F.estado)}
      ${sel('tipo', 'tipo', TIPOS, F.tipo)}
      ${sel('fase', 'fase processual', FASES_P, F.fase)}
      ${sel('status', 'status', FASES.map(f => ({ v: f.id, l: f.nome })), F.status)}
      ${sel('canal', 'forma de contato', CANAIS, F.canal)}
      ${sel('parado', 'parado há', [{ v: '15', l: '+15 dias' }, { v: '30', l: '+30 dias' },
        { v: '45', l: '+45 dias' }, { v: '90', l: '+90 dias' }], F.parado, 'qualquer')}
      <button class="bt limpar" id="limpar">Limpar</button>
    </div>
    <div class="resumo-filtro" id="resumo"></div></div>`;

  document.querySelectorAll('[data-f]').forEach(el => el.onchange = () => {
    F[el.dataset.f] = el.value; desenha();
  });
  $('limpar').onclick = () => {
    Object.keys(F).forEach(k => F[k] = '');
    busca = ''; $('q').value = ''; desenha();
  };
}

function pintaResumo(l) {
  const fechados = l.filter(t => t.status === FECHADO);
  const decididos = l.filter(t => (fase(t.status).conta_no_denominador));
  const taxa = decididos.length ? (fechados.length / decididos.length * 100) : 0;
  const valor = soma(fechados, t => t.valor);
  const semProt = fechados.filter(t => !t.data_protocolo).length;
  $('resumo').innerHTML =
    `<b>${l.length}</b> tratativas · <b>${fechados.length}</b> fechadas · `
    + `taxa <b>${taxa.toFixed(1)}%</b> sobre ${decididos.length} decididas · `
    + `valor <b>${brl(valor)}</b>`
    + (fechados.length ? ` · ticket <b>${brl(valor / fechados.length)}</b>` : '')
    + (semProt ? ` · <b>${semProt}</b> aguardando protocolo` : '');
}

/* ---------- kanban ---------- */
function cardT(t) {
  const d = dias(t.data_atualizacao || t.data);
  const cls = d === null ? '' : d > 45 ? 'r' : d > 20 ? 'a' : 'v';
  const primeiroNome = n => String(n || '').split(' ')[0];
  return `<article class="card-t" data-abrir="${t.id}" style="--c:${fase(t.status).cor}">
    <div class="proc"><span>${esc(t.processo)}</span>
      ${d !== null ? `<span class="tempo ${cls}">${d}d</span>` : ''}</div>

    <div class="partes">${esc(t.autor || 'Sem autor informado')}</div>
    <div class="contra"><i>×</i><span>${esc(t.reu || 'sem réu informado')}</span></div>

    ${t.valor ? `<div class="cif">${brl2(t.valor)}</div>` : ''}

    ${t.escritorio_adverso ? `<div class="linha-dado">escritório <b>${esc(t.escritorio_adverso)}</b></div>` : ''}
    <div class="linha-dado">advogado <b>${esc(t.advogado || '—')}</b></div>
    ${t.data_protocolo ? `<div class="linha-dado">protocolado <b>${dtb(t.data_protocolo)}</b></div>`
      : t.data ? `<div class="linha-dado">1ª tentativa <b>${dtb(t.data)}</b></div>` : ''}
    ${t.previsao && !t.recebido ? `<div class="linha-dado">previsão <b>${dtb(t.previsao)}</b></div>` : ''}

    <div class="selos">
      ${t.tipo ? `<span class="pilula">${esc(t.tipo)}</span>` : ''}
      ${t.fase ? `<span class="pilula">${esc(t.fase)}</span>` : ''}
      ${t.estado ? `<span class="pilula">${esc(t.estado)}</span>` : ''}
      ${t.produto ? `<span class="pilula">${esc(t.produto)}</span>` : ''}
      ${t.canal ? `<span class="pilula">${esc(t.canal)}</span>` : ''}
    </div>

    <div class="rodape">
      <span class="op">${t.operador ? esc(t.operador) : '<span style="color:var(--txt-3)">sem operador</span>'}</span>
      ${t.recebido ? '<span class="pilula ges">recebido</span>' : ''}
    </div>
  </article>`;
}

function telaKanban(l) {
  $('t-kanban').innerHTML = `<div class="esteira-cols">${FASES.map(f => {
    const itens = l.filter(t => t.status === f.id);
    const v = soma(itens, t => t.valor);
    return `<div class="col-k">
      <div class="topo-col">
        <div class="l1"><span class="pt" style="background:${f.cor};color:${f.cor}"></span>
          <b>${esc(f.nome)}</b><span class="qt">${itens.length}</span></div>
        <div class="vl">${v ? brl(v) : '—'}</div>
      </div>
      <div class="itens">${itens.length
        ? itens.slice(0, 60).map(cardT).join('')
          + (itens.length > 60 ? `<div class="sem-contato">+ ${itens.length - 60} não mostradas. Use os filtros.</div>` : '')
        : '<div class="sem-contato">Vazio.</div>'}</div>
    </div>`;
  }).join('')}</div>`;
}

/* ---------- lista ---------- */
function telaLista(l) {
  const ord = [...l].sort((a, b) => (b.data || '').localeCompare(a.data || ''));
  $('t-lista').innerHTML = `<div class="tb-rolagem"><table class="tb-lista">
    <thead><tr>
      <th>Processo</th><th>Autor</th><th>Réu</th><th>Status</th>
      <th>Fase</th><th>UF</th><th>Advogado</th><th>Operador</th>
      <th>Data</th><th class="n">Valor</th><th class="n">Parado</th>
    </tr></thead><tbody>
    ${ord.slice(0, 600).map(t => {
      const d = dias(t.data_atualizacao || t.data);
      return `<tr data-abrir="${t.id}">
        <td class="mono">${esc(t.processo)}</td>
        <td>${esc((t.autor || '—').split(' ').slice(0, 3).join(' '))}</td>
        <td>${esc(t.reu || '—')}</td>
        <td><span class="marcador"><i style="background:${fase(t.status).cor};color:${fase(t.status).cor}"></i>${esc(fase(t.status).nome)}</span></td>
        <td>${esc(t.fase || '—')}</td>
        <td>${esc(t.estado || '—')}</td>
        <td>${esc(t.advogado || '—')}</td>
        <td>${esc(t.operador || '—')}</td>
        <td class="mono">${dtb(t.data)}</td>
        <td class="n">${t.valor ? brl2(t.valor) : '—'}</td>
        <td class="n" style="color:${d > 45 ? 'var(--bad)' : d > 20 ? 'var(--warn)' : 'var(--txt-2)'}">${d === null ? '—' : d + 'd'}</td>
      </tr>`;
    }).join('')}</tbody></table></div>
    ${ord.length > 600 ? `<div class="resumo-filtro">Mostrando 600 de ${ord.length}. Refine os filtros.</div>` : ''}`;
}


/* ==================================================================
   PAINEL DE GESTÃO — tudo respeita os filtros do topo
   ================================================================== */
let recorte = 'operador';

const RECORTES = [
  { id: 'operador',  rotulo: 'Operador',  campo: t => t.operador },
  { id: 'advogado',  rotulo: 'Advogado',  campo: t => t.advogado },
  { id: 'produto',   rotulo: 'Produto',   campo: t => t.produto },
  { id: 'canal',     rotulo: 'Contato',   campo: t => t.canal },
  { id: 'fase',      rotulo: 'Fase',      campo: t => t.fase },
  { id: 'tipo',      rotulo: 'Tipo',      campo: t => t.tipo },
  { id: 'estado',    rotulo: 'UF',        campo: t => t.estado },
  { id: 'reu',       rotulo: 'Réu',       campo: t => t.reu },
  { id: 'escritorio',rotulo: 'Escritório',campo: t => t.escritorio_adverso }
];

function kpi(rot, val, obs, cor) {
  return `<div class="kpi" style="--gl:${cor || 'rgba(99,102,241,.24)'}">
    <div class="r">${rot}</div><div class="v">${val}</div>
    ${obs ? `<div class="o">${obs}</div>` : ''}</div>`;
}

/* Faturamento é reconhecido na data do protocolo, não na assinatura da
   minuta — foi a regra que o Danilo definiu. */
const faturadas = l => l.filter(t => t.data_protocolo);

/* Quando ha busca ou um recorte estreito, o gestor quer chegar no caso, nao
   so no numero. Sem isto ele tinha que trocar de aba para abrir a tratativa
   que acabou de procurar. */
function resultadosDaBusca(l) {
  const procurando = busca.trim().length > 0;
  if (!procurando && l.length > 40) return '';
  if (!l.length) return '';
  const ord = [...l].sort((a, b) => (b.data_atualizacao || b.data || '')
    .localeCompare(a.data_atualizacao || a.data || ''));
  return `<div class="cx" style="margin-bottom:14px">
    <h3>${procurando ? `Encontradas — ${l.length}` : `Tratativas do recorte — ${l.length}`}</h3>
    <p class="sub">${procurando
      ? `Resultado de <b>${esc(busca.trim())}</b>. Clique para abrir.`
      : 'Poucos casos no filtro atual, então listo todos aqui. Clique para abrir.'}</p>
    <div class="tb-rolagem"><table class="tb-lista">
      <thead><tr><th>Processo</th><th>Autor</th><th>Réu</th><th>Status</th>
        <th>Operador</th><th>Data</th><th class="n">Valor</th></tr></thead>
      <tbody>${ord.slice(0, 60).map(t => `<tr data-abrir="${t.id}">
        <td class="mono">${esc(t.processo)}</td>
        <td>${esc((t.autor || '—').split(' ').slice(0, 3).join(' '))}</td>
        <td>${esc(t.reu || '—')}</td>
        <td><span class="marcador"><i style="background:${fase(t.status).cor};
          color:${fase(t.status).cor}"></i>${esc(fase(t.status).nome)}</span></td>
        <td>${esc(t.operador || '—')}</td>
        <td class="mono">${dtb(t.data_atualizacao || t.data)}</td>
        <td class="n">${t.valor ? brl2(t.valor) : '—'}</td>
      </tr>`).join('')}</tbody></table></div>
    ${ord.length > 60 ? `<div class="resumo-filtro">Mostrando 60 de ${ord.length}.
      Refine a busca ou use a aba Tratativas.</div>` : ''}
  </div>`;
}

function telaPainel(l) {
  const fechadas   = l.filter(t => t.status === FECHADO);
  const decididas  = l.filter(t => fase(t.status).conta_no_denominador);
  const vivas      = l.filter(t => !fase(t.status).conta_no_denominador);
  const fat        = faturadas(l);
  const semProt    = fechadas.filter(t => !t.data_protocolo);
  const taxa       = decididas.length ? fechadas.length / decididas.length * 100 : 0;
  const valorFat   = soma(fat, t => t.valor);
  const valorFech  = soma(fechadas, t => t.valor);
  const ticket     = fechadas.length ? valorFech / fechadas.length : 0;
  const aReceber   = PARCELAS.filter(p => !p.recebido &&
                       l.some(t => t.id === p.tratativa_id));
  const vencidas   = aReceber.filter(p => p.previsao && p.previsao < ISO(HOJE));

  /* ---- evolução mês a mês ---- */
  // Um mes entra quando houve protocolo nele. Meses sem movimento entre dois
  // com movimento continuam na linha: o buraco tem que ficar visivel.
  const meses = {};
  fat.forEach(t => {
    const m = t.data_protocolo.slice(0, 7);
    meses[m] = meses[m] || { m, faturado: 0, protocoladas: 0 };
    meses[m].faturado += +t.valor || 0;
    meses[m].protocoladas++;
  });
  const chaves = Object.keys(meses).sort();
  if (chaves.length > 1) {
    const fim = chaves[chaves.length - 1];
    let [a, mm] = chaves[0].split('-').map(Number);
    while (`${a}-${String(mm).padStart(2, '0')}` <= fim) {
      const k = `${a}-${String(mm).padStart(2, '0')}`;
      meses[k] = meses[k] || { m: k, faturado: 0, protocoladas: 0 };
      if (++mm > 12) { mm = 1; a++; }
    }
  }
  const linha = Object.values(meses).sort((a, b) => a.m.localeCompare(b.m)).slice(-14);
  const teto  = Math.max(...linha.map(x => x.faturado), 1);
  const rotMes = m => {
    const N = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
    return N[+m.slice(5, 7) - 1] + '/' + m.slice(2, 4);
  };

  /* ---- recorte com taxa de conversão ---- */
  const R = RECORTES.find(x => x.id === recorte);
  const mapa = new Map();
  l.forEach(t => {
    const k = R.campo(t) || '—';
    const o = mapa.get(k) || { k, total: 0, dec: 0, ganhas: 0, valor: 0 };
    o.total++;
    if (fase(t.status).conta_no_denominador) o.dec++;
    if (t.status === FECHADO) { o.ganhas++; o.valor += +t.valor || 0; }
    mapa.set(k, o);
  });
  const linhas = [...mapa.values()]
    .map(o => ({ ...o, taxa: o.dec ? o.ganhas / o.dec * 100 : 0 }))
    .sort((a, b) => b.valor - a.valor || b.total - a.total).slice(0, 14);
  const maxV = Math.max(...linhas.map(x => x.valor), 1);

  $('t-painel').innerHTML = `
    <div class="grade g4">
      ${kpi('Faturamento do período', brl(valorFat),
            `${fat.length} minutas protocoladas`, 'rgba(163,230,53,.28)')}
      ${kpi('Acordos fechados', fechadas.length,
            `${brl(valorFech)} negociados`, 'rgba(6,182,212,.28)')}
      ${kpi('Ticket médio', brl(ticket),
            fechadas.length ? `sobre ${fechadas.length} acordos` : 'sem acordo no período', 'rgba(168,85,247,.26)')}
      ${kpi('Taxa de conversão', taxa.toFixed(1) + '%',
            `${fechadas.length} de ${decididas.length} decididas`,
            taxa >= 25 ? 'rgba(163,230,53,.3)' : 'rgba(245,158,11,.26)')}
    </div>

    <div class="grade g4">
      ${kpi('Tratativas no período', l.length,
            `${new Set(l.map(t => t.processo)).size} processos distintos`, 'rgba(99,102,241,.26)')}
      ${kpi('Vivas na esteira', vivas.length,
            'ainda podem virar acordo', 'rgba(20,184,166,.26)')}
      ${kpi('Aguardando protocolo', semProt.length,
            semProt.length ? `${brl(soma(semProt, t => t.valor))} fechados sem protocolar`
                           : 'nenhuma minuta parada',
            semProt.length ? 'rgba(245,158,11,.3)' : 'rgba(163,230,53,.26)')}
      ${kpi('Parcelas a receber', aReceber.length,
            vencidas.length ? `${vencidas.length} já vencidas · ${brl(soma(vencidas, p => p.valor))}`
                            : `${brl(soma(aReceber, p => p.valor))} em dia`,
            vencidas.length ? 'rgba(251,113,133,.3)' : 'rgba(163,230,53,.26)')}
    </div>

    ${resultadosDaBusca(l)}

    <div class="cx" style="margin-bottom:14px">
      <h3>Evolução mês a mês</h3>
      <p class="sub">Faturamento por mês, contado na data do protocolo. O número abaixo
         de cada barra é a quantidade de minutas protocoladas naquele mês.</p>
      ${linha.length ? `<div style="display:flex;gap:6px;align-items:flex-end;justify-content:flex-start">
        ${linha.map(x => `<div style="flex:1;min-width:0;max-width:96px;display:flex;
            flex-direction:column;align-items:center;gap:6px">
          <div style="height:150px;width:100%;display:flex;align-items:flex-end;
               justify-content:center">
            <div title="${brl2(x.faturado)} em ${x.protocoladas} minuta${x.protocoladas === 1 ? '' : 's'}"
                 style="width:64%;height:${x.faturado / teto * 100}%;min-height:${x.faturado ? 2 : 0}px;
                 background:linear-gradient(180deg,#BEF264,#84CC16);border-radius:4px 4px 0 0"></div>
          </div>
          <div style="font-size:10.5px;color:var(--txt-3)">${rotMes(x.m)}</div>
          <div class="mono" style="font-size:10px;color:var(--txt-2)">${x.faturado ? kk(x.faturado) : ''}</div>
          <div class="mono" style="font-size:9.5px;color:var(--txt-3)">${x.protocoladas || ''}</div>
        </div>`).join('')}
      </div>
      <div style="margin-top:14px;font-size:11.5px;color:var(--txt-3)">
        Total no período <b class="mono" style="color:var(--txt);font-size:13px">${brl(
          linha.reduce((s, x) => s + x.faturado, 0))}</b>
        em ${linha.reduce((s, x) => s + x.protocoladas, 0)} minutas
      </div>`
      : '<div class="sem-contato">Sem movimento no período selecionado.</div>'}
    </div>

    <div class="cx">
      <h3>Onde o acordo acontece</h3>
      <p class="sub">Mesmo recorte, três leituras: volume, conversão e dinheiro.
         A taxa só aparece onde houve ao menos um caso decidido.</p>
      <div class="filtros" style="margin-bottom:14px">
        ${RECORTES.map(x => `<button class="chip ${x.id === recorte ? 'on' : ''}"
          data-recorte="${x.id}">${x.rotulo}</button>`).join('')}
      </div>
      ${linhas.length ? `<table class="tb">
        <tr><th>${R.rotulo}</th><th class="n">Tratativas</th><th class="n">Fechados</th>
            <th class="n">Taxa</th><th class="n">Valor</th></tr>
        ${linhas.map(x => `<tr>
          <td>${esc(x.k)}<div class="trilho"><i style="width:${x.valor / maxV * 100}%;
            background:linear-gradient(90deg,#06B6D4,#A3E635)"></i></div></td>
          <td class="n">${x.total}</td>
          <td class="n">${x.ganhas}</td>
          <td class="n" style="color:${!x.dec ? 'var(--txt-3)'
            : x.taxa >= 25 ? 'var(--s6)' : x.taxa >= 12 ? 'var(--warn)' : 'var(--bad)'}">
            ${x.dec ? x.taxa.toFixed(1) + '%' : '—'}</td>
          <td class="n">${x.valor ? brl(x.valor) : '—'}</td>
        </tr>`).join('')}
      </table>` : '<div class="sem-contato">Nada no período selecionado.</div>'}
    </div>`;

  document.querySelectorAll('[data-recorte]').forEach(b => b.onclick = () => {
    recorte = b.dataset.recorte; desenha();
  });
}

/* ==================================================================
   FORMULÁRIO DE TRÊS ETAPAS
   ================================================================== */
let rascunho = null, etapa = 1;

/* Campo nao preenchido nasce null, nao string vazia. O banco recusa '' em
   coluna de data, e quem salva na etapa 1 ou 2 nunca chega a tocar nos
   campos do faturamento — eles iriam vazios do mesmo jeito. */
const vazio = () => ({
  tipo: null, fase: 'Pré-sentença', estado: null, advogado: null, produto: null,
  processo: '', autor: null, reu: null, escritorio_adverso: null,
  canal: 'WHATSAPP', operador: null,
  data: ISO(HOJE), status: 'AGUARDANDO RETORNO', observacoes: null,
  valor: null, data_atualizacao: ISO(HOJE),
  data_minuta_assinada: null, data_protocolo: null, forma_pagamento: 'unica',
  qtd_parcelas: null, prazo_dias: null, tipo_prazo: 'uteis', previsao: null,
  previsao_manual: false, recebido: false, data_recebimento: null
});

/* Ultima barreira antes do banco. Uma unica string vazia numa coluna de data
   derruba o salvamento inteiro, e o erro que chega na tela e o texto cru do
   Postgres — que nao diz a ninguem qual campo estava errado. */
const semVazio = v => (v === '' || v === undefined) ? null : v;
const numero   = v => {
  if (v === '' || v === null || v === undefined) return null;
  const n = +v;
  return Number.isFinite(n) ? n : null;
};

function abreForm(t) {
  rascunho = t ? { ...t } : vazio();
  etapa = 1;
  pintaForm();
  $('gav').classList.add('on'); $('veu').classList.add('on');
}

function podeFaturar() { return rascunho.status === FECHADO; }

function pintaForm() {
  const novo = !rascunho.id;
  $('gavT').innerHTML = `
    <h3 style="font-size:16px">${novo ? 'Nova tratativa' : esc(rascunho.processo || 'Tratativa')}</h3>
    <div class="passos">
      ${[['1', 'Identificação'], ['2', 'Tratativa'], ['3', 'Faturamento']].map(([n, r], i) => {
        const num = i + 1;
        const travado = num === 3 && !podeFaturar();
        return `<span class="passo ${etapa === num ? 'on' : ''} ${travado ? 'travado' : 'livre'}"
          ${travado ? '' : `data-etapa="${num}"`}>
          <span class="num">${travado ? '&#128274;' : n}</span>${r}</span>`
          + (num < 3 ? '<span class="seta-passo">›</span>' : '');
      }).join('')}
    </div>`;

  $('gavC').innerHTML = `<div id="recado"></div>
    ${etapaIdentificacao()}${etapaTratativa()}${etapaFaturamento()}
    <div class="rodape-form">
      ${etapa > 1 ? '<button class="bt" data-ir="' + (etapa - 1) + '">← Voltar</button>' : ''}
      <div class="dir">
        ${etapa < 3 ? `<button class="bt" id="avancar" ${etapa === 2 && !podeFaturar() ? 'disabled' : ''}>
          ${etapa === 2 ? 'Faturamento' : 'Tratativa'} →</button>` : ''}
        <button class="bt" id="cancelar">Cancelar</button>
        <button class="bt p" id="salvar">Salvar</button>
      </div>
    </div>`;

  ligaForm();
}

const opt = (v, atual, rot) =>
  `<option value="${esc(v)}" ${String(v) === String(atual ?? '') ? 'selected' : ''}>${esc(rot ?? v)}</option>`;
const campo = (rot, html, dica) =>
  `<div class="campo"><label>${rot}</label>${html}${dica ? `<div class="dica">${dica}</div>` : ''}</div>`;
const entrada = (id, tipo, val, extra) =>
  `<input class="inp" id="${id}" type="${tipo}" value="${esc(val ?? '')}" ${extra || ''}>`;
const escolha = (id, itens, atual, vazioRot) =>
  `<select class="inp" id="${id}">${vazioRot ? opt('', atual, vazioRot) : ''}
    ${itens.map(i => opt(i.v ?? i, atual, i.l ?? i)).join('')}</select>`;
/* Réu apagado do cadastro, advogado que saiu do escritório: o nome continua
   gravado na tratativa e some da lista. Sem isto o seletor voltaria a "selecione"
   e o próximo salvamento apagaria o dado sem ninguém pedir. */
const comAtual = (lista, atual) =>
  atual && !lista.includes(atual) ? [atual, ...lista] : lista;

function etapaIdentificacao() {
  const r = rascunho;
  return `<div class="etapa ${etapa === 1 ? 'on' : ''}" id="e1">
    <div class="dupla">
      ${campo('Tipo', escolha('f-tipo', TIPOS, r.tipo, 'selecione'))}
      ${campo('Fase processual', escolha('f-fase', FASES_P, r.fase))}
    </div>
    <div class="dupla">
      ${campo('Estado (UF)', escolha('f-estado', UFS, r.estado, 'selecione'))}
      ${campo('Advogado *', escolha('f-advogado', comAtual(advogados().map(p => p.nome), r.advogado), r.advogado, 'selecione'))}
    </div>
    <div class="dupla">
      ${campo('Produto / Tese', escolha('f-produto', PRODUTOS, r.produto, '—'))}
      ${campo('Nº do processo *', entrada('f-processo', 'text', r.processo))}
    </div>
    ${campo('Autor (cliente)', entrada('f-autor', 'text', r.autor))}
    <div class="dupla">
      ${campo('Réu *', escolha('f-reu', comAtual(REUS.map(x => x.nome), r.reu), r.reu, 'selecione'))}
      ${campo('Escritório (adv. do réu)', escolha('f-escritorio', comAtual(ESCRS.map(x => x.nome), r.escritorio_adverso), r.escritorio_adverso, 'selecione'))}
    </div>
    <div class="dupla">
      ${campo('Forma de contato', escolha('f-canal', CANAIS, r.canal))}
      ${campo('Operador responsável', escolha('f-operador', comAtual(operadores().map(p => p.nome), r.operador), r.operador, 'selecione'))}
    </div>
    <div class="dupla">
      ${campo('Data da 1ª tentativa', entrada('f-data', 'date', r.data))}
      ${campo('Status', escolha('f-status', FASES.map(f => ({ v: f.id, l: f.nome })), r.status))}
    </div>
    ${campo('Observações <span style="text-transform:none;letter-spacing:0;color:var(--txt-3)">(acompanha todas as etapas)</span>',
      `<textarea class="inp" id="f-obs" rows="3">${esc(r.observacoes || '')}</textarea>`)}
    <div class="caixa-contatos" id="caixa-contatos"></div>
  </div>`;
}

function etapaTratativa() {
  const r = rascunho;
  return `<div class="etapa ${etapa === 2 ? 'on' : ''}" id="e2">
    <div class="dupla">
      ${campo('Status', escolha('f2-status', FASES.map(f => ({ v: f.id, l: f.nome })), r.status),
        'Mudar para <b>Acordo Fechado</b> libera a etapa de Faturamento.')}
      ${campo('Última atualização', entrada('f2-atualizacao', 'date', r.data_atualizacao))}
    </div>
    ${campo('Valor (acordo / tratativa)', entrada('f2-valor', 'number', r.valor, 'step="0.01" min="0" placeholder="0,00"'))}
    ${campo('Observações', `<textarea class="inp" id="f2-obs" rows="4">${esc(r.observacoes || '')}</textarea>`)}
  </div>`;
}

function etapaFaturamento() {
  const r = rascunho;
  const parcelado = r.forma_pagamento === 'parcelado';
  const p = r.id ? parcelasDe(r.id) : [];
  return `<div class="etapa ${etapa === 3 ? 'on' : ''}" id="e3">
    <div class="dupla">
      ${campo('Status', `<input class="inp" value="${esc(fase(r.status).nome)}" disabled>`)}
      ${campo('Minuta assinada em', entrada('f3-minuta', 'date', r.data_minuta_assinada))}
    </div>
    <div class="dupla">
      ${campo('Valor (acordo / tratativa)', entrada('f3-valor', 'number', r.valor, 'step="0.01" min="0"'))}
      ${campo('Protocolada em <span style="text-transform:none;letter-spacing:0;color:var(--txt-3)">(faturamento)</span>',
        entrada('f3-protocolo', 'date', r.data_protocolo),
        'É esta data que conta como faturamento — não a assinatura da minuta.')}
    </div>
    <div class="dupla">
      ${campo('Forma de pagamento', escolha('f3-forma', [{ v: 'unica', l: 'Parcela única' }, { v: 'parcelado', l: 'Parcelado' }], r.forma_pagamento))}
      ${parcelado ? campo('Quantas parcelas', entrada('f3-parcelas', 'number', r.qtd_parcelas, 'min="2" max="60"')) : '<div></div>'}
    </div>
    <div class="dupla">
      ${campo('Prazo p/ receber (dias)', entrada('f3-prazo', 'number', r.prazo_dias, 'min="0"'))}
      ${campo('Tipo de prazo', escolha('f3-tipoprazo', [{ v: 'uteis', l: 'úteis' }, { v: 'corridos', l: 'corridos' }], r.tipo_prazo))}
    </div>
    <div class="dupla">
      ${campo('Previsão / próx. recebimento <span style="text-transform:none;letter-spacing:0;color:var(--txt-3)">(editável)</span>',
        entrada('f3-previsao', 'date', r.previsao),
        'Calculada a partir do protocolo, pulando fins de semana e feriados. Se você digitar, o sistema respeita e para de recalcular.')}
      ${campo('Recebido?', escolha('f3-recebido', [{ v: 'false', l: 'Não' }, { v: 'true', l: 'Sim' }], String(!!r.recebido)))}
    </div>
    ${campo('Data do recebimento', entrada('f3-datarec', 'date', r.data_recebimento))}
    ${p.length ? `<div class="bloco"><h4>Parcelas — ${p.length}</h4>
      <table class="parcelas-tb">${p.map(x => `<tr>
        <td>${x.numero} de ${p.length}</td>
        <td class="mono" style="color:var(--txt-3)">${dtb(x.previsao)}</td>
        <td class="n">${brl2(x.valor)}</td>
        <td class="n" style="color:${x.recebido ? 'var(--s5)' : 'var(--txt-3)'}">${x.recebido ? 'recebido' : 'a receber'}</td>
      </tr>`).join('')}</table>
      <div class="dica">Geradas pelo banco a partir do valor, da quantidade e da previsão. Salve para atualizar.</div></div>` : ''}
    ${campo('Observações', `<textarea class="inp" id="f3-obs" rows="3">${esc(r.observacoes || '')}</textarea>`)}
  </div>`;
}

/* Mesma normalização que o banco usa em chave_nome(): a planilha antiga
   escreve "Ativos S.A" e o cadastro "ATIVOS S.A.", e sem isso os dois viram
   réus diferentes e os contatos não aparecem. */
const chaveNome = s => String(s || '').toUpperCase().normalize('NFD').replace(/[^A-Z0-9]/g, '');

/* Contatos do réu e do escritório escolhidos.
   Mostra e-mails E telefones — a operadora escreve por e-mail e liga no mesmo
   atendimento, e antes só via o canal marcado no campo "forma de contato".
   O canal escolhido vem primeiro, que é o que ela vai usar agora. */
function pintaContatos() {
  const cx = $('caixa-contatos');
  if (!cx) return;
  const canal   = (($('f-canal') || {}).value) || rascunho.canal;
  const nomeReu = (($('f-reu') || {}).value) || rascunho.reu;
  const nomeEsc = (($('f-escritorio') || {}).value) || rascunho.escritorio_adverso;

  const acha = (lista, nome) => nome
    ? lista.find(x => chaveNome(x.nome) === chaveNome(nome)) : null;
  const donoReu = acha(REUS, nomeReu);
  const donoEsc = acha(ESCRS, nomeEsc);
  const de = (dono, tipo, rot) => dono
    ? CONTATOS.filter(c => c.dono_tipo === tipo && c.dono_id === dono.id)
              .map(c => ({ ...c, de: rot })) : [];

  const todos  = [...de(donoEsc, 'escritorio', 'escritório'), ...de(donoReu, 'parte', 'réu')];
  const emails = todos.filter(c => c.canal === 'E-MAIL');
  const fones  = todos.filter(c => c.canal !== 'E-MAIL');
  const grupos = (canal === 'E-MAIL' ? [['E-mails', emails, ', '], ['Telefones', fones, ' / ']]
                                     : [['Telefones', fones, ' / '], ['E-mails', emails, ', ']])
    .filter(g => g[1].length);

  /* Atalho para o cadastro, em outra aba e já no registro certo. Réu que
     ainda não existe abre o formulário de novo réu com o nome preenchido. */
  const atalho = (qual, lista, nome, rot) => {
    if (!nome) return '';
    const alvo = acha(lista, nome);
    const q = alvo ? `aba=${qual}&id=${alvo.id}` : `aba=${qual}&nome=${encodeURIComponent(nome)}`;
    return `<a class="bt-mini" href="/cadastros?${q}" target="_blank" rel="noopener"
       title="${alvo ? 'Abrir' : 'Cadastrar'} ${esc(nome)} em outra aba">${rot} &#8599;</a>`;
  };

  const linha = c => `<div class="contato-item">
    <span class="de">${c.de}</span>
    <span class="v">${esc(c.valor)}${c.rotulo ? ` · ${esc(c.rotulo)}` : ''}</span>
    <button type="button" class="copiar" data-copiar="${esc(c.valor)}">copiar</button>
  </div>`;

  cx.innerHTML = `
    <div class="cab-contatos">
      <h4>Contatos para esta tratativa</h4>
      ${atalho('reus', REUS, nomeReu, 'Réu')}
      ${atalho('escritorios', ESCRS, nomeEsc, 'Escritório')}
      <button type="button" class="bt-mini" id="recarregar-contatos"
        title="Buscar de novo o que foi editado no cadastro">atualizar</button>
    </div>
    ${grupos.length ? grupos.map(([rot, l, junta]) => `
      <div class="contato-grupo">
        <div class="rot-grupo"><span>${rot} — ${l.length}</span><i class="traco"></i>
          ${l.length > 1 ? `<button type="button" class="copiar"
            data-copiar="${esc(l.map(c => c.valor).join(junta))}">copiar todos</button>` : ''}
        </div>
        ${l.map(linha).join('')}
      </div>`).join('')
      : `<div class="sem-contato">Nenhum contato cadastrado
         para ${esc(nomeReu || 'este réu')}${nomeEsc ? ' nem para ' + esc(nomeEsc) : ''}.
         Use os botões acima para cadastrar — eles abrem em outra aba, e ao voltar
         para cá os contatos aparecem sozinhos.</div>`}`;

  cx.querySelectorAll('[data-copiar]').forEach(b => {
    const rotulo = b.textContent;
    b.onclick = () => {
      copia(b.dataset.copiar);
      b.textContent = 'copiado'; b.classList.add('feito');
      setTimeout(() => { b.textContent = rotulo; b.classList.remove('feito'); }, 1500);
    };
  });
  $('recarregar-contatos').onclick = () => protege(() => atualizaCadastros());
}

/* navigator.clipboard só existe em contexto seguro; o textarea escondido é o
   caminho que funciona em qualquer navegador que a equipe use. */
function copia(texto) {
  if (navigator.clipboard && window.isSecureContext)
    return navigator.clipboard.writeText(texto).catch(() => porTextarea(texto));
  porTextarea(texto);
}
function porTextarea(texto) {
  const t = document.createElement('textarea');
  t.value = texto;
  t.style.cssText = 'position:fixed;left:-9999px;top:0';
  document.body.appendChild(t); t.select();
  try { document.execCommand('copy'); } catch (e) { /* nada a fazer */ }
  t.remove();
}

/* ---------- cadastro editado em outra aba ----------
   A operadora abre o cadastro do réu numa aba, corrige o e-mail e volta.
   Sem isto, ela teria que fechar a tratativa e digitar tudo de novo para ver
   o contato novo. O rascunho não é tocado: o que já foi digitado continua. */
let atualizandoCadastros = false;
async function atualizaCadastros() {
  if (atualizandoCadastros) return;
  atualizandoCadastros = true;
  try {
    const [r, e, c] = await Promise.all([
      ler('parte_adversa', 'select=id,nome,chave&order=nome.asc'),
      ler('escritorio_adverso', 'select=id,nome,chave&order=nome.asc'),
      lerTudo('contato')
    ]);
    const nomes = l => l.map(x => x.nome).join('');
    const listaMudou = nomes(r) !== nomes(REUS) || nomes(e) !== nomes(ESCRS);
    REUS = r; ESCRS = e; CONTATOS = c;
    if (!rascunho) return;
    // Se réus ou escritórios entraram ou saíram, os seletores precisam ser
    // refeitos. coleta() guarda o que está na tela antes, e pintaForm()
    // redesenha a partir do rascunho — nada digitado se perde.
    if (listaMudou) { coleta(); pintaForm(); } else pintaContatos();
  } finally { atualizandoCadastros = false; }
}

/* O aviso vem pelo localStorage porque o evento 'storage' dispara nas OUTRAS
   abas, e é exatamente isso que queremos: quem salvou já viu o resultado. */
window.addEventListener('storage', ev => {
  if (ev.key === 'andon.cadastro_mudou') atualizaCadastros().catch(() => { });
});

function coleta() {
  const v = id => { const el = $(id); return el ? el.value : undefined; };
  const r = rascunho;
  if (etapa === 1) {
    Object.assign(r, {
      tipo: v('f-tipo') || null, fase: v('f-fase'), estado: v('f-estado') || null,
      advogado: v('f-advogado') || null, produto: v('f-produto') || null,
      processo: (v('f-processo') || '').trim(), autor: v('f-autor') || null,
      reu: v('f-reu') || null, escritorio_adverso: v('f-escritorio') || null,
      canal: v('f-canal') || null, operador: v('f-operador') || null,
      data: v('f-data') || null, status: v('f-status'), observacoes: v('f-obs') || null
    });
  } else if (etapa === 2) {
    Object.assign(r, {
      status: v('f2-status'), data_atualizacao: v('f2-atualizacao') || null,
      valor: numero(v('f2-valor')), observacoes: v('f2-obs') || null
    });
  } else {
    const previsaoDigitada = v('f3-previsao') || null;
    Object.assign(r, {
      data_minuta_assinada: v('f3-minuta') || null,
      valor: numero(v('f3-valor')),
      data_protocolo: v('f3-protocolo') || null,
      forma_pagamento: v('f3-forma'),
      qtd_parcelas: v('f3-forma') === 'parcelado' ? numero(v('f3-parcelas')) : null,
      prazo_dias: numero(v('f3-prazo')),
      tipo_prazo: v('f3-tipoprazo'),
      recebido: v('f3-recebido') === 'true',
      data_recebimento: v('f3-datarec') || null,
      observacoes: v('f3-obs') || null
    });
    // Só marca como manual se a data digitada difere da que o banco calculou.
    r.previsao_manual = !!(previsaoDigitada && previsaoDigitada !== r.previsao);
    r.previsao = previsaoDigitada;
  }
}

function ligaForm() {
  document.querySelectorAll('[data-etapa]').forEach(b => b.onclick = () => {
    coleta(); etapa = +b.dataset.etapa; pintaForm();
  });
  const av = $('avancar');
  if (av) av.onclick = () => {
    coleta();
    if (etapa === 1 && !validaIdentificacao()) return;
    etapa = Math.min(etapa + 1, 3); pintaForm();
  };
  document.querySelectorAll('[data-ir]').forEach(b => b.onclick = () => {
    coleta(); etapa = +b.dataset.ir; pintaForm();
  });
  $('cancelar').onclick = fechaGaveta;
  $('salvar').onclick = () => protege(salvar);

  ['f-canal', 'f-reu', 'f-escritorio'].forEach(id => {
    const el = $(id); if (el) el.onchange = pintaContatos;
  });
  const st2 = $('f2-status');
  if (st2) st2.onchange = () => { coleta(); pintaForm(); };
  const fp = $('f3-forma');
  if (fp) fp.onchange = () => { coleta(); pintaForm(); };
  pintaContatos();
}

function validaIdentificacao() {
  const faltando = [];
  if (!rascunho.processo) faltando.push('número do processo');
  if (!rascunho.advogado) faltando.push('advogado');
  if (!rascunho.reu)      faltando.push('réu');
  if (faltando.length) {
    alerta('Falta preencher: ' + faltando.join(', ') + '.', 'erro');
    return false;
  }
  return true;
}

async function salvar() {
  coleta();
  if (!validaIdentificacao()) return;
  const r = rascunho;
  const dados = {
    tipo: semVazio(r.tipo), fase: semVazio(r.fase), estado: semVazio(r.estado),
    advogado: semVazio(r.advogado), produto: semVazio(r.produto),
    processo: String(r.processo || '').trim(),
    autor: semVazio(r.autor), reu: semVazio(r.reu),
    escritorio_adverso: semVazio(r.escritorio_adverso),
    canal: semVazio(r.canal), operador: semVazio(r.operador),
    data: semVazio(r.data), status: r.status,
    observacoes: semVazio(r.observacoes),
    valor: numero(r.valor), data_atualizacao: semVazio(r.data_atualizacao),
    data_minuta_assinada: semVazio(r.data_minuta_assinada),
    data_protocolo: semVazio(r.data_protocolo),
    forma_pagamento: semVazio(r.forma_pagamento),
    qtd_parcelas: numero(r.qtd_parcelas),
    prazo_dias: numero(r.prazo_dias), tipo_prazo: semVazio(r.tipo_prazo),
    previsao: semVazio(r.previsao), previsao_manual: !!r.previsao_manual,
    recebido: !!r.recebido, data_recebimento: semVazio(r.data_recebimento)
  };
  if (!r.id) dados.origem_registro = 'sistema';

  const salvo = r.id ? await mudar('tratativa', r.id, dados) : await criar('tratativa', dados);
  const id = r.id || (salvo && salvo[0] && salvo[0].id);
  await carrega();
  desenha();
  const atualizada = TRAT.find(t => t.id === id);
  if (atualizada) { rascunho = { ...atualizada }; pintaForm(); }
  alerta('Tratativa salva.', 'ok');
}

/* ---------- utilidades de tela ---------- */
function fechaGaveta() {
  $('gav').classList.remove('on'); $('veu').classList.remove('on'); rascunho = null;
}
function alerta(msg, tipo) {
  const html = `<div class="nota ${tipo === 'erro' ? '' : 'info'}">${esc(msg)}</div>`;
  if ($('gav').classList.contains('on') && $('recado')) { $('recado').innerHTML = html; return; }
  $('aviso').innerHTML = `<div class="nota ${tipo === 'erro' ? '' : 'info'}"
    style="max-width:2100px;margin:16px auto 0;width:calc(100% - 40px)">${esc(msg)}</div>`;
  if (tipo === 'ok') setTimeout(() => { $('aviso').innerHTML = ''; }, 4000);
}
async function protege(fn) {
  try { await fn(); } catch (e) { alerta(e.message || String(e), 'erro'); }
}

function pintaSessao() {
  $('sessao').innerHTML = `<span class="quem">${esc((sessao && (sessao.nome || sessao.email)) || '')}</span>
     <button class="bt" id="sair">Sair</button>`;
  $('sair').onclick = () => SESSAO.sair();
}

const TELAS = [{ id: 'painel', rotulo: 'Painel de Gestão' },
               { id: 'kanban', rotulo: 'Esteira' },
               { id: 'lista',  rotulo: 'Tratativas' }];

function desenha() {
  $('nav').innerHTML = TELAS.map(t =>
    `<button class="${t.id === aba ? 'on' : ''}" data-aba="${t.id}">${t.rotulo}</button>`).join('')
    + `<a class="nav-link" href="/cadastros">Cadastros</a>`
    + `<button class="bt p" id="nova" style="margin-left:10px">+ Nova tratativa</button>`;
  $('nova').onclick = () => abreForm(null);
  document.querySelectorAll('[data-aba]').forEach(b => b.onclick = () => { aba = b.dataset.aba; desenha(); });
  TELAS.forEach(t => $('t-' + t.id).classList.toggle('on', t.id === aba));

  const l = filtradas();
  pintaFiltros(); pintaResumo(l);
  if (aba === 'painel') telaPainel(l);
  else if (aba === 'kanban') telaKanban(l);
  else telaLista(l);


  document.querySelectorAll('[data-abrir]').forEach(b => b.onclick = () =>
    abreForm(TRAT.find(t => t.id === +b.dataset.abrir)));
}

$('q').addEventListener('input', e => { busca = e.target.value; desenha(); });
$('fx').onclick = fechaGaveta;
$('veu').onclick = fechaGaveta;
document.addEventListener('keydown', e => { if (e.key === 'Escape') fechaGaveta(); });

(async function inicia() {
  $('t-painel').innerHTML = '<div class="carregando">Carregando…</div>';
  pintaSessao();
  try {
    await carrega();
    desenha();
  } catch (e) {
    $('t-painel').innerHTML = `<div class="vazio">Não consegui ler o banco.<br><br>${esc(e.message)}</div>`;
  }
})();
