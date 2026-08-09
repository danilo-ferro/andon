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
const SESSAO = {
  ler:    () => { try { return JSON.parse(localStorage.getItem('andon.sessao') || 'null'); } catch { return null; } },
  gravar: s  => localStorage.setItem('andon.sessao', JSON.stringify(s)),
  limpar: () => localStorage.removeItem('andon.sessao')
};
let sessao = SESSAO.ler();
const logado = () => !!(sessao && sessao.access_token);

async function api(caminho, opcoes) {
  const h = { apikey: SB.key, 'Content-Type': 'application/json', ...((opcoes || {}).headers || {}) };
  h.Authorization = 'Bearer ' + (logado() ? sessao.access_token : SB.key);
  const r = await fetch(`${SB.url}/rest/v1/${caminho}`, { ...opcoes, headers: h });
  if (r.status === 401 || r.status === 403) throw new Error(logado()
    ? 'Sua sessão expirou. Entre de novo para salvar.'
    : 'Só quem está logado pode gravar. Use o botão Entrar, no alto à direita.');
  if (!r.ok) throw new Error((await r.text()).slice(0, 240) || `erro ${r.status}`);
  return r.status === 204 ? null : r.json();
}
const ler   = (t, q)    => api(`${t}?${q || 'select=*'}`);
const criar = (t, o)    => api(t, { method: 'POST', body: JSON.stringify(o), headers: { Prefer: 'return=representation' } });
const mudar = (t, id, o) => api(`${t}?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify(o), headers: { Prefer: 'return=representation' } });

/* ---------- estado ---------- */
let TRAT = [], PESSOAS = [], REUS = [], ESCRS = [], CONTATOS = [], FASES = [], PARCELAS = [];
let aba = 'kanban', busca = '';
const F = { de: '', ate: '', advogado: '', operador: '', produto: '', estado: '',
            tipo: '', fase: '', status: '', canal: '', parado: '' };

const UFS = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR',
             'PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];
const TIPOS   = ['ATIVO', 'PASSIVO'];
const FASES_P = ['Pré-sentença', 'Pós-sentença', 'Pós-acórdão'];
const CANAIS  = ['WHATSAPP', 'E-MAIL', 'TELEFONE', 'AUDIÊNCIA', 'AUTOS', 'NÃO APTO'];
const PRODUTOS = ['Limpa Nome (LN)', 'CCS', 'SCR', 'Bancários / Golpes', 'Estratégico', 'Trabalhista'];
const FECHADO = 'ACORDO FECHADO';

async function carrega() {
  const [t, p, r, e, c, f, pc] = await Promise.all([
    ler('tratativa', 'select=*&order=data.desc.nullslast&limit=5000'),
    ler('pessoa', 'select=*&order=nome.asc'),
    ler('parte_adversa', 'select=id,nome,chave&order=nome.asc'),
    ler('escritorio_adverso', 'select=id,nome,chave&order=nome.asc'),
    ler('contato', 'select=*'),
    ler('config_fase', 'select=*&esteira=eq.acordo&order=ordem.asc'),
    ler('acordo_parcela', 'select=*&order=numero.asc')
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
    if (F.de   && (!t.data || t.data < F.de))  return false;
    if (F.ate  && (!t.data || t.data > F.ate)) return false;
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

  $('filtros').innerHTML = `<div class="filtros-cx"><div class="filtros-linha">
      <label class="filtro"><span>de</span><input type="date" data-f="de" value="${F.de}"></label>
      <label class="filtro"><span>até</span><input type="date" data-f="ate" value="${F.ate}"></label>
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
  return `<article class="card-t" data-abrir="${t.id}" style="--c:${fase(t.status).cor}">
    <div class="proc"><span>${esc(t.processo)}</span>
      ${d !== null ? `<span class="tempo ${cls}">${d}d</span>` : ''}</div>
    <div class="partes">${esc((t.autor || '—').split(' ').slice(0, 3).join(' '))}</div>
    <div class="contra">× ${esc(t.reu || '—')}</div>
    ${t.valor ? `<div class="cif">${brl2(t.valor)}</div>` : ''}
    <div class="selos">
      ${t.fase ? `<span class="pilula">${esc(t.fase)}</span>` : ''}
      ${t.estado ? `<span class="pilula">${esc(t.estado)}</span>` : ''}
      ${t.canal ? `<span class="pilula">${esc(t.canal)}</span>` : ''}
      ${t.operador ? `<span class="pilula ope">${esc(t.operador.split(' ')[0])}</span>` : ''}
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
   FORMULÁRIO DE TRÊS ETAPAS
   ================================================================== */
let rascunho = null, etapa = 1;

const vazio = () => ({
  tipo: '', fase: 'Pré-sentença', estado: '', advogado: '', produto: '', processo: '',
  autor: '', reu: '', escritorio_adverso: '', canal: 'WHATSAPP', operador: '',
  data: ISO(HOJE), status: 'AGUARDANDO RETORNO', observacoes: '',
  valor: '', data_atualizacao: ISO(HOJE),
  data_minuta_assinada: '', data_protocolo: '', forma_pagamento: 'unica',
  qtd_parcelas: '', prazo_dias: '', tipo_prazo: 'uteis', previsao: '',
  previsao_manual: false, recebido: false, data_recebimento: ''
});

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

function etapaIdentificacao() {
  const r = rascunho;
  return `<div class="etapa ${etapa === 1 ? 'on' : ''}" id="e1">
    <div class="dupla">
      ${campo('Tipo', escolha('f-tipo', TIPOS, r.tipo, 'selecione'))}
      ${campo('Fase processual', escolha('f-fase', FASES_P, r.fase))}
    </div>
    <div class="dupla">
      ${campo('Estado (UF)', escolha('f-estado', UFS, r.estado, 'selecione'))}
      ${campo('Advogado *', escolha('f-advogado', advogados().map(p => p.nome), r.advogado, 'selecione'))}
    </div>
    <div class="dupla">
      ${campo('Produto / Tese', escolha('f-produto', PRODUTOS, r.produto, '—'))}
      ${campo('Nº do processo *', entrada('f-processo', 'text', r.processo))}
    </div>
    ${campo('Autor (cliente)', entrada('f-autor', 'text', r.autor))}
    <div class="dupla">
      ${campo('Réu *', escolha('f-reu', REUS.map(x => x.nome), r.reu, 'selecione'))}
      ${campo('Escritório (adv. do réu)', escolha('f-escritorio', ESCRS.map(x => x.nome), r.escritorio_adverso, 'selecione'))}
    </div>
    <div class="dupla">
      ${campo('Forma de contato', escolha('f-canal', CANAIS, r.canal))}
      ${campo('Operador responsável', escolha('f-operador', operadores().map(p => p.nome), r.operador, 'selecione'))}
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

/* Contatos do réu e do escritório, filtrados pela forma de contato escolhida. */
function pintaContatos() {
  const cx = $('caixa-contatos');
  if (!cx) return;
  const canal = (($('f-canal') || {}).value) || rascunho.canal;
  const nomeReu = (($('f-reu') || {}).value) || rascunho.reu;
  const nomeEsc = (($('f-escritorio') || {}).value) || rascunho.escritorio_adverso;
  const chave = s => String(s || '').toUpperCase().normalize('NFD').replace(/[^A-Z0-9]/g, '');

  const dono = (lista, nome, tipo) => {
    const alvo = lista.find(x => chave(x.nome) === chave(nome));
    return alvo ? CONTATOS.filter(c => c.dono_tipo === tipo && c.dono_id === alvo.id) : [];
  };
  const querEmail = canal === 'E-MAIL';
  const filtra = l => l.filter(c => querEmail ? c.canal === 'E-MAIL' : c.canal !== 'E-MAIL');

  const doReu = filtra(dono(REUS, nomeReu, 'parte')).map(c => ({ ...c, de: 'réu' }));
  const doEsc = filtra(dono(ESCRS, nomeEsc, 'escritorio')).map(c => ({ ...c, de: 'escritório' }));
  const todos = [...doEsc, ...doReu];

  cx.innerHTML = `<h4>Contatos para esta tratativa</h4>
    ${todos.length
      ? todos.map(c => `<div class="contato-item">
          <span class="de">${c.de}</span>
          <span class="v">${esc(c.valor)}${c.rotulo ? ` · ${esc(c.rotulo)}` : ''}</span>
          <button class="copiar" data-copiar="${esc(c.valor)}">copiar</button>
        </div>`).join('')
      : `<div class="sem-contato">Nenhum contato de ${querEmail ? 'e-mail' : 'telefone'} cadastrado
         para ${nomeReu || 'este réu'}${nomeEsc ? ' nem para ' + esc(nomeEsc) : ''}.
         Cadastre em <a href="/cadastros" style="color:var(--s4)">Cadastros</a> e eles aparecem aqui.</div>`}`;

  cx.querySelectorAll('[data-copiar]').forEach(b => b.onclick = () => {
    navigator.clipboard?.writeText(b.dataset.copiar);
    b.textContent = 'copiado'; setTimeout(() => b.textContent = 'copiar', 1500);
  });
}

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
      valor: v('f2-valor') === '' ? null : +v('f2-valor'), observacoes: v('f2-obs') || null
    });
  } else {
    const previsaoDigitada = v('f3-previsao') || null;
    Object.assign(r, {
      data_minuta_assinada: v('f3-minuta') || null,
      valor: v('f3-valor') === '' ? null : +v('f3-valor'),
      data_protocolo: v('f3-protocolo') || null,
      forma_pagamento: v('f3-forma'),
      qtd_parcelas: v('f3-forma') === 'parcelado' ? (+v('f3-parcelas') || null) : null,
      prazo_dias: v('f3-prazo') === '' ? null : +v('f3-prazo'),
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
  if (etapa === 1) pintaContatos();
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
    tipo: r.tipo, fase: r.fase, estado: r.estado, advogado: r.advogado, produto: r.produto,
    processo: r.processo, autor: r.autor, reu: r.reu, escritorio_adverso: r.escritorio_adverso,
    canal: r.canal, operador: r.operador, data: r.data, status: r.status,
    observacoes: r.observacoes, valor: r.valor, data_atualizacao: r.data_atualizacao,
    data_minuta_assinada: r.data_minuta_assinada, data_protocolo: r.data_protocolo,
    forma_pagamento: r.forma_pagamento, qtd_parcelas: r.qtd_parcelas,
    prazo_dias: r.prazo_dias, tipo_prazo: r.tipo_prazo,
    previsao: r.previsao, previsao_manual: !!r.previsao_manual,
    recebido: !!r.recebido, data_recebimento: r.data_recebimento
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
  $('sessao').innerHTML = logado()
    ? `<span style="font-size:11.5px;color:var(--txt-3)">${esc(sessao.email || '')}</span>
       <button class="bt" id="sair">Sair</button>`
    : `<a class="bt p" href="/cadastros">Entrar</a>`;
  if (logado()) $('sair').onclick = () => { SESSAO.limpar(); sessao = null; pintaSessao(); desenha(); };
}

const TELAS = [{ id: 'kanban', rotulo: 'Esteira' }, { id: 'lista', rotulo: 'Tratativas' }];

function desenha() {
  $('nav').innerHTML = TELAS.map(t =>
    `<button class="${t.id === aba ? 'on' : ''}" data-aba="${t.id}">${t.rotulo}</button>`).join('')
    + `<a class="nav-link" href="/cadastros">Cadastros</a>`;
  document.querySelectorAll('[data-aba]').forEach(b => b.onclick = () => { aba = b.dataset.aba; desenha(); });
  TELAS.forEach(t => $('t-' + t.id).classList.toggle('on', t.id === aba));

  const l = filtradas();
  pintaFiltros(); pintaResumo(l);
  aba === 'kanban' ? telaKanban(l) : telaLista(l);

  if (!logado()) $('aviso').innerHTML = `<div class="nota"
    style="max-width:2100px;margin:16px auto 0;width:calc(100% - 40px)">
    <b>Somente leitura.</b> Para criar ou alterar tratativas, entre pela tela de Cadastros.</div>`;

  document.querySelectorAll('[data-abrir]').forEach(b => b.onclick = () =>
    abreForm(TRAT.find(t => t.id === +b.dataset.abrir)));
}

$('q').addEventListener('input', e => { busca = e.target.value; desenha(); });
$('fx').onclick = fechaGaveta;
$('veu').onclick = fechaGaveta;
document.addEventListener('keydown', e => { if (e.key === 'Escape') fechaGaveta(); });

(async function inicia() {
  $('t-kanban').innerHTML = '<div class="carregando">Carregando…</div>';
  pintaSessao();
  try {
    await carrega();
    desenha();
    const bt = document.createElement('button');
    bt.className = 'bt p'; bt.textContent = '+ Nova tratativa';
    bt.style.marginLeft = '10px';
    bt.onclick = () => abreForm(null);
    $('nav').appendChild(bt);
  } catch (e) {
    $('t-kanban').innerHTML = `<div class="vazio">Não consegui ler o banco.<br><br>${esc(e.message)}</div>`;
  }
})();
