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

/* O token de acesso vence de hora em hora. Pedir a ele antes de cada chamada
   faz a renovação acontecer sozinha; a segunda tentativa cobre o caso raro de
   ele vencer entre pedir e chegar. Sem isso, quem deixava a tela aberta era
   derrubado no meio de uma tratativa. */
async function api(caminho, opcoes, jaRenovou) {
  const t = await SESSAO.token().catch(() => null);
  const h = { apikey: SB.key, 'Content-Type': 'application/json', ...((opcoes || {}).headers || {}) };
  h.Authorization = 'Bearer ' + (t || SB.key);
  const r = await ANDON_REDE.buscar(`${SB.url}/rest/v1/${caminho}`, { ...opcoes, headers: h });
  if ((r.status === 401 || r.status === 403) && !jaRenovou) {
    // Recusada não teve efeito nenhum no banco: repetir é seguro.
    const novo = await SESSAO.renovar().catch(() => null);
    if (novo) return api(caminho, opcoes, true);
  }
  if (r.status === 401 || r.status === 403) throw new Error(logado()
    ? 'Sua sessão expirou. Entre de novo para salvar.'
    : 'Sessão não encontrada. Recarregue a página para entrar de novo.');
  if (!r.ok) {
    const bruto = await r.text();
    // O Postgres devolve um JSON tecnico. Sozinho, ele nao diz a ninguem o
    // que fazer — traduzimos os casos que a equipe encontra de verdade.
    let msg = bruto.slice(0, 240) || `erro ${r.status}`;
    let repetido = false;
    try {
      const d = JSON.parse(bruto);
      if (/invalid input syntax for type date/i.test(d.message || ''))
        msg = 'Alguma data ficou incompleta. Confira os campos de data e salve de novo.';
      else if (/invalid input syntax for type numeric/i.test(d.message || ''))
        msg = 'Algum valor não é um número válido. Confira o valor e as parcelas.';
      else if (/violates check constraint/i.test(d.message || ''))
        msg = 'Um dos campos ficou com opção inválida. Reabra a tratativa e escolha de novo.';
      // O índice único é a trava final: a tela também barra, mas quem está com
      // a aba aberta há horas não tem na lista a tratativa criada hoje por outra
      // pessoa — e descobrir isso só na hora de salvar, sem saída, é cruel.
      else if (/tratativa_processo_uk/i.test((d.message || '') + (d.details || ''))) {
        msg = 'Este processo já tem tratativa no sistema — um processo tem uma tratativa só.';
        repetido = true;
      }
      else if (d.message) msg = d.message;
    } catch { /* nao era JSON: fica o texto cru mesmo */ }
    const erro = new Error(msg);
    erro.processoRepetido = repetido;
    throw erro;
  }
  return r.status === 204 ? null : r.json();
}
const ler   = (t, q)    => api(`${t}?${q || 'select=*'}`);

/* O PostgREST corta em 1000 linhas por resposta, sem avisar. Sem paginar,
   1.407 tratativas apareciam como 1.000 e as contas saiam erradas. */
async function lerTudo(t, campos) {
  const out = []; let de = 0;
  for (;;) {
    const l = await api(`${t}?select=${campos || '*'}&order=id.asc&offset=${de}&limit=1000`);
    out.push(...l);
    if (l.length < 1000) break;
    de += 1000;
  }
  return out;
}
const criar = (t, o)    => api(t, { method: 'POST', body: JSON.stringify(o), headers: { Prefer: 'return=representation' } });
/* Quem salva por ultimo manda — foi a regra escolhida. O que protege o
   trabalho de todo mundo nao e travar a gravacao, e a tela se atualizar
   sozinha a cada 30s, para que ninguem esteja editando um dado velho. */
const mudar = (t, id, o) =>
  api(`${t}?id=eq.${id}`,
      { method: 'PATCH', body: JSON.stringify(o), headers: { Prefer: 'return=representation' } });

/* ---------- estado ---------- */
let TRAT = [], PESSOAS = [], REUS = [], ESCRS = [], CONTATOS = [], FASES = [];
/* O dinheiro depois do acordo fechado: de que verba ele e feito (VERBAS) e
   quando cada pedaco entra ou entrou (RECEB). Uma lista so de recebimentos,
   com o que veio do ADVBox e o que o sistema previu — duas listas para a
   mesma pergunta seria o caminho curto para dois numeros diferentes. */
let VERBAS = [], RECEB = [], CFG_VERBA = [], RANKING = [], FERIADOS = [], PARAM = [];
let aba = 'painel', busca = '';
const F = { periodo: '', de: '', ate: '', advogado: '', operador: '', produto: '', estado: '',
            tipo: '', fase: '', status: '', canal: '', parado: '' };

const NOME_MES = ['janeiro','fevereiro','março','abril','maio','junho',
                  'julho','agosto','setembro','outubro','novembro','dezembro'];

/* Traduz a escolha de periodo em um intervalo de datas. Vazio = tudo, que e
   o estado inicial: a tela abre mostrando o escritorio inteiro. */
/* Uma tratativa tem UMA data no tempo, não três.

   Antes valia qualquer um dos marcos — abertura, última atualização ou
   protocolo — e o resultado era o mesmo processo aparecendo em julho pela
   1ª tentativa e em agosto pela atualização. Somado, contava duas vezes.

   A regra agora é a do escritório: a tratativa vive na data da última
   atualização, e o acordo fechado vive na data do protocolo, que é o marco
   financeiro. Acordo fechado sem protocolo lançado cai na atualização, senão
   ele sumiria de todos os períodos. */
const dataDoPeriodo = t =>
  (t.status === FECHADO && t.data_protocolo) ? t.data_protocolo
                                             : (t.data_atualizacao || t.data || null);

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
  // Os meses oferecidos são os mesmos pelos quais o filtro recorta. Listar um
  // mês por outro marco ofereceria período que devolve lista vazia.
  const s = new Set();
  TRAT.forEach(t => { const d = dataDoPeriodo(t); if (d) s.add(d.slice(0, 7)); });
  return [...s].sort().reverse().slice(0, 36);
}

const UFS = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR',
             'PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];
const TIPOS   = ['ATIVO', 'PASSIVO', 'TRABALHISTA'];
const SITUACOES = ['PAGO', 'EM ATRASO', 'A VENCER'];
const FASES_P = ['Pré-sentença', 'Pós-sentença', 'Pós-acórdão'];
const CANAIS  = ['WHATSAPP', 'E-MAIL', 'TELEFONE', 'AUDIÊNCIA', 'AUTOS', 'NÃO APTO'];
const PRODUTOS = ['Limpa Nome (LN)', 'CCS', 'SCR', 'Bancários / Golpes', 'Estratégico', 'Trabalhista'];
const FECHADO = 'ACORDO FECHADO';

/* ---------- o caminho entre "acertado" e "fechado" ----------
   Acertar o acordo na conversa não é fechá-lo. Depois do sim vem a minuta,
   confeccionada pela parte contrária; depois a assinatura do advogado do caso;
   e só o protocolo torna o acordo fechado para o financeiro. São três esperas
   distintas, cada uma com a bola no pé de outra pessoa — e enquanto o sistema
   não as separava, tudo isso era "em tratativa" e ninguém sabia com quem o
   caso estava parado. */
const AGUARDA_MINUTA     = 'AGUARDANDO ENVIO DA MINUTA';
const AGUARDA_ASSINATURA = 'AGUARDANDO ASSINATURA DA MINUTA';
const AGUARDA_PROTOCOLO  = 'AGUARDANDO PROTOCOLO';
const FORMALIZANDO = [AGUARDA_MINUTA, AGUARDA_ASSINATURA, AGUARDA_PROTOCOLO];
const formalizando = s => FORMALIZANDO.includes(s);
/* Acertado com valor: as três fases de formalização mais o acordo fechado.
   É o conjunto que o financeiro precisa enxergar. */
const acertado = s => s === FECHADO || formalizando(s);

async function carrega() {
  const [t, p, r, e, c, f, pc, vb, cv, rk, fer, par] = await Promise.all([
    lerTudo('tratativa'),
    ler('pessoa', 'select=*&order=nome.asc'),
    ler('parte_adversa', 'select=id,nome,chave&order=nome.asc'),
    ler('escritorio_adverso', 'select=id,nome,chave&order=nome.asc'),
    // Só as colunas que a tela usa: contato e parcela são as tabelas mais
    // longas, e trazer o que não se usa é peso de rede em cada carregamento.
    lerTudo('contato', 'id,dono_tipo,dono_id,canal,valor,rotulo'),
    ler('config_fase', 'select=*&esteira=eq.acordo&order=ordem.asc'),
    lerTudo('acordo_recebimento'),
    lerTudo('acordo_verba'),
    ler('config_verba', 'select=*&order=ordem.asc'),
    ler('vw_ranking_operador', 'select=*'),
    // Feriados e a regra do recesso vêm do banco para que a conta feita aqui na
    // tela seja a mesma que o banco faz ao salvar. Duas tabelas de feriado
    // seriam o caminho curto para duas previsões diferentes.
    ler('feriado', 'select=data,abrangencia,uf'),
    ler('config_parametro', 'select=chave,valor')
  ]);
  TRAT = t; PESSOAS = p; REUS = r; ESCRS = e; CONTATOS = c; FASES = f;
  RECEB = pc; VERBAS = vb; CFG_VERBA = cv; RANKING = rk;
  FERIADOS = fer || []; PARAM = par || [];
}

/* ==================================================================
   PREVISÃO DE RECEBIMENTO

   A mesma regra do banco (previsao_recebimento), refeita aqui para que a
   data apareça no instante em que a pessoa preenche o prazo — e não só
   depois de salvar. Prazo corrido soma dias no calendário; prazo útil
   anda dia a dia pulando sábado, domingo e feriado. Feriado forense só
   conta se o escritório ligar `recesso_forense_suspende`.

   Repetir a regra em dois lugares é dívida assumida: era isso ou a
   operadora digitar o prazo e não ver nada acontecer. O teste compara as
   duas contas nos casos de borda para que não se separem em silêncio.
   ================================================================== */
const paramNum = (chave, padrao) => {
  const x = PARAM.find(p => p.chave === chave);
  return x ? (+x.valor || 0) : padrao;
};

function ehDiaUtil(iso, uf) {
  const dow = new Date(iso + 'T12:00:00').getDay();
  if (dow === 0 || dow === 6) return false;
  const forense = paramNum('recesso_forense_suspende', 0) === 1;
  return !FERIADOS.some(f => f.data === iso && (
    f.abrangencia === 'nacional' ||
    (f.abrangencia === 'estadual' && f.uf === (uf || '')) ||
    (f.abrangencia === 'forense' && forense)));
}

function somaDias(iso, n) {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return ISO(d);
}

function calculaPrevisao(protocolo, prazo, tipoPrazo, uf) {
  const n = +prazo;
  if (!protocolo || prazo === '' || prazo === null || prazo === undefined
      || !Number.isFinite(n)) return null;
  if (!/^ut/i.test(String(tipoPrazo || ''))) return somaDias(protocolo, n);
  if (n <= 0) return protocolo;
  let d = protocolo, faltam = n, guarda = 0;
  while (faltam > 0 && guarda++ < 4000) {
    d = somaDias(d, 1);
    if (ehDiaUtil(d, uf)) faltam--;
  }
  return d;
}

const advogados = () => PESSOAS.filter(p => p.ativo && (p.papeis || []).includes('advogado'));
const operadores = () => PESSOAS.filter(p => p.ativo && (p.papeis || []).includes('operador'));
const fase = id => FASES.find(x => x.id === id) || { nome: id || '—', cor: '#5B6878' };
const recebimentosDe = id => RECEB.filter(p => p.tratativa_id === id)
  .sort((a, b) => (a.vencimento || '').localeCompare(b.vencimento || ''));
const verbasDe = id => VERBAS.filter(v => v.tratativa_id === id);
const verba = id => CFG_VERBA.find(v => v.id === id) || { id, nome: id || '—', cor: '#5B6878' };
/* Um acordo por linha: as repeticoes do mesmo acordo ficam no historico mas
   nao contam de novo, senao 238 acordos virariam 241 no painel. */
const ehAcordo = t => t.status === FECHADO && t.acordo_principal !== false;

/* Acordo fechado, recusado, sem retorno, improcedente: o caso acabou.
   "Parado há 300 dias" aí não é atraso — é um caso que não tem mais para onde
   ir. O relógio só corre para quem ainda pode andar. */
const finalizada = t => !!fase(t.status).finalizada;
/* Dias parados, ou null quando não há relógio para correr. */
const parada = t => finalizada(t) ? null : dias(t.data_atualizacao || t.data);

/* Quanto a tratativa levou para acabar: da 1ª tentativa até a última mexida.
   Só faz sentido para caso encerrado — em caso vivo isso seria idade, não
   duração. Mesma conta do índice do banco: processo é comparado só por dígito,
   porque a mesma numeração aparece com ponto, hífen ou nada. */
function duracao(t) {
  if (!finalizada(t) || !t.data) return null;
  const fim = t.data_atualizacao || t.data;
  const d = Math.round((new Date(fim + 'T12:00:00') - new Date(t.data + 'T12:00:00')) / 864e5);
  return d >= 0 ? d : null;
}
const chaveProcesso = p => String(p || '').replace(/[^0-9]/g, '');
const jaExiste = (processo, exceto) => {
  const k = chaveProcesso(processo);
  if (!k) return null;
  return TRAT.find(t => chaveProcesso(t.processo) === k && t.id !== exceto) || null;
};

/* ---------- filtros ---------- */
function filtradas() {
  const b = busca.trim().toLowerCase();
  return TRAT.filter(t => {
    const [de, ate] = intervalo();
    if (de || ate) {
      const d = dataDoPeriodo(t);
      if (!d || (de && d < de) || (ate && d > ate)) return false;
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
      // Caso finalizado não entra em "parado há": ele não parou, ele acabou.
      const d = parada(t);
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
    </div>
    <div class="linha-resumo">
      <div class="resumo-filtro" id="resumo"></div>
      <button class="bt limpar" id="limpar">Limpar filtros</button>
    </div></div>`;

  document.querySelectorAll('[data-f]').forEach(el => el.onchange = () => {
    F[el.dataset.f] = el.value; desenha();
  });
  $('limpar').onclick = () => {
    Object.keys(F).forEach(k => F[k] = '');
    busca = ''; $('q').value = ''; desenha();
  };
}

function pintaResumo(l) {
  const fechados = l.filter(ehAcordo);
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
  const d = parada(t);
  const cls = d === null ? '' : d > 45 ? 'r' : d > 20 ? 'a' : 'v';
  const primeiroNome = n => String(n || '').split(' ')[0];
  return `<article class="card-t" data-abrir="${t.id}" style="--c:${fase(t.status).cor}">
    <div class="proc">${proc(t.processo)}
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

/* Faixa de total do quadro. Some o que está em tela, já filtrado, e diz sobre
   quantos casos a soma foi feita — sem isso o gestor não sabe se um total
   baixo é pouco dinheiro ou valor que ninguém preencheu. */
function totalQuadro(rotulo, itens, valorDe, um, muitos){
  const comValor = itens.filter(x=>+valorDe(x)>0);
  const v = soma(itens, valorDe);
  return `<div class="total-quadro">
    <span class="r">${rotulo}</span>
    <b class="mono">${brl2(v)}</b>
    <span class="o">${itens.length} ${itens.length===1?um:muitos}
      · <b>${comValor.length}</b> com valor</span>
    ${comValor.length?`<span class="fim">ticket médio ${brl(v/comValor.length)}</span>`:''}
  </div>`;
}

function telaKanban(l) {
  $('t-kanban').innerHTML = totalQuadro('Total na esteira', l, t => t.valor, 'tratativa', 'tratativas')
    + `<div class="esteira-cols">${FASES.map(f => {
    const itens = l.filter(t => t.status === f.id);
    const v = soma(itens, t => t.valor);
    const comValor = itens.filter(t => +t.valor > 0).length;
    return `<div class="col-k">
      <div class="topo-col">
        <div class="l1"><span class="pt" style="background:${f.cor};color:${f.cor}"></span>
          <b>${esc(f.nome)}</b><span class="qt">${itens.length}</span></div>
        <div class="vl">${v ? brl2(v) : '—'}</div>
        <div class="sb">${v ? `${comValor} de ${itens.length} com valor`
                            : itens.length ? 'nenhuma com valor' : 'vazio'}</div>
      </div>
      <div class="itens">${itens.length
        ? itens.slice(0, 60).map(cardT).join('')
          + (itens.length > 60 ? `<div class="sem-contato">+ ${itens.length - 60} não mostradas.
             O total acima já conta todas.</div>` : '')
        : '<div class="sem-contato">Vazio.</div>'}</div>
    </div>`;
  }).join('')}</div>`;
  ajustaEsteira();
}

/* Mede onde a esteira começa e dá a ela exatamente o que sobra da janela.
   Medir é o ponto: a barra de filtros muda de altura conforme a largura da
   tela, então qualquer número fixo aqui acerta numa tela e erra em todas as
   outras. Com a altura certa, a esteira rola por dentro, a barra de rolagem
   horizontal fica sempre ao alcance, e descer a página não desloca nada. */
function ajustaEsteira() {
  const cx = document.querySelector('#t-kanban .esteira-cols');
  if (!cx || !cx.offsetParent) return;
  // Distância do topo do documento: não muda com a rolagem, ao contrário do
  // topo relativo à janela, que mudaria a cada medição e nunca estabilizaria.
  const topo = cx.getBoundingClientRect().top + window.scrollY;
  let alt = Math.max(280, Math.round(window.innerHeight - topo - 14));
  cx.style.setProperty('--alt-esteira', alt + 'px');

  /* O que ainda passar da janela sai daqui. Em vez de tentar prever margens e
     espaçamentos que a página tem por baixo, a esteira devolve exatamente o
     que sobrou — e a página deixa de rolar por baixo dela, que era o que
     fazia tudo escorregar de lugar ao descer. */
  const passa = document.documentElement.scrollHeight - window.innerHeight;
  if (passa > 0 && alt - passa >= 280) cx.style.setProperty('--alt-esteira', (alt - passa) + 'px');
}
let ajusteAgendado = null;
window.addEventListener('resize', () => {
  clearTimeout(ajusteAgendado);
  ajusteAgendado = setTimeout(ajustaEsteira, 120);
});

/* ---------- lista ---------- */
/* ---------- tabelas que classificam ----------
   Uma implementação só, usada pela lista, pelo financeiro, pelo ranking e pela
   busca do painel. Cada coluna diz de onde tira o valor e se é número: ordenar
   pelo que está escrito na tela seria mais curto e erraria em três lugares —
   "R$ 1.000" viria antes de "R$ 900", "20 dias" antes de "9 dias", e o status
   sairia em ordem alfabética em vez da ordem do funil.

   Cada tabela guarda a própria escolha. Uma ordem só, global, faria o
   financeiro herdar a coluna escolhida na lista, que nem existe lá. */
const ORDENS = { lista: { campo: 'data', dir: -1 } };

function ordenaPor(chave, linhas, colunas) {
  const o = ORDENS[chave];
  const c = o && colunas.find(x => x.k === o.campo);
  if (!c) return [...linhas];
  const vazio = v => v === null || v === undefined || v === '';
  return [...linhas].sort((a, b) => {
    const x = c.v(a), y = c.v(b);
    // Sem valor vai para o fim, seja qual for o sentido: "—" no topo não informa nada.
    if (vazio(x)) return vazio(y) ? 0 : 1;
    if (vazio(y)) return -1;
    const r = c.num ? x - y : String(x).localeCompare(String(y), 'pt-BR', { numeric: true });
    return r * o.dir;
  });
}

function cabecalhoOrd(chave, colunas) {
  const o = ORDENS[chave] || {};
  return `<thead><tr>${colunas.map(c => {
    const ativa = o.campo === c.k;
    return `<th class="ord ${c.n ? 'n' : ''} ${ativa ? 'on' : ''}" data-ord="${esc(c.k)}"
      title="Classificar por ${esc(c.rot)}">${esc(c.rot)}<i class="seta">${
      ativa ? (o.dir === 1 ? '▲' : '▼') : '↕'}</i></th>`;
  }).join('')}</tr></thead>`;
}

/* O clique é ligado dentro da tabela, e não na tela inteira: numa mesma tela
   pode haver duas tabelas que classificam (o financeiro tem), e sem o escopo
   uma passaria a mandar na outra. */
function ligaOrd(chave, colunas, redesenha) {
  document.querySelectorAll(`[data-tb="${chave}"] [data-ord]`).forEach(th => th.onclick = () => {
    const k = th.dataset.ord, c = colunas.find(x => x.k === k), o = ORDENS[chave];
    /* Mesma coluna: inverte. Coluna nova: começa pelo sentido que interessa —
       texto de A a Z, número e data do maior/mais recente para o menor. */
    ORDENS[chave] = (o && o.campo === k)
      ? { campo: k, dir: -o.dir }
      : { campo: k, dir: (c && (c.num || c.data)) ? -1 : 1 };
    redesenha();
  });
}

/* ---------- copiar o número do processo ----------
   Pedido para todos os lugares onde ele aparece, então vira uma função só. O
   clique não pode subir: quase toda linha que mostra processo também abre a
   tratativa, e copiar abriria a gaveta junto. */
const proc = n => !n ? '<span class="mono">—</span>'
  : `<span class="proc-cx"><span class="mono">${esc(n)}</span>
      <button type="button" class="copiar-proc" data-copiar-proc="${esc(n)}"
        title="Copiar o número do processo" aria-label="Copiar o número do processo">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="9" y="9" width="12" height="12" rx="2.5"/>
          <path d="M5 15V5.5A2.5 2.5 0 0 1 7.5 3H15"/></svg></button></span>`;

/* Na fase de captura, de proposito. A linha da tabela tem o proprio onclick
   que abre a tratativa; um ouvinte comum no document so rodaria depois dele, e
   copiar abriria a gaveta junto. Capturando, este vem primeiro e corta o
   caminho antes de o clique chegar na linha. */
document.addEventListener('click', e => {
  const bt = e.target.closest && e.target.closest('[data-copiar-proc]');
  if (!bt) return;
  e.preventDefault(); e.stopPropagation();
  copia(bt.dataset.copiarProc);
  bt.classList.add('feito');
  setTimeout(() => bt.classList.remove('feito'), 1200);
}, true);

const COLUNAS = [
  { k: 'processo',  rot: 'Processo',  v: t => t.processo || '' },
  { k: 'autor',     rot: 'Autor',     v: t => t.autor || '' },
  { k: 'reu',       rot: 'Réu',       v: t => t.reu || '' },
  { k: 'status',    rot: 'Status',    n: true, num: true, v: t => fase(t.status).ordem ?? 99 },
  { k: 'fase',      rot: 'Fase',      v: t => t.fase || '' },
  { k: 'estado',    rot: 'UF',        v: t => t.estado || '' },
  { k: 'advogado',  rot: 'Advogado',  v: t => t.advogado || '' },
  { k: 'operador',  rot: 'Operador',  v: t => t.operador || '' },
  { k: 'data',      rot: 'Data',      data: true, v: t => t.data || '' },
  { k: 'valor',     rot: 'Valor',     n: true, num: true, v: t => +t.valor || 0 },
  { k: 'parada',    rot: 'Parado',    n: true, num: true, v: parada },
  { k: 'duracao',   rot: 'Levou',     n: true, num: true, v: duracao }
];

function telaLista(l) {
  const ord = ordenaPor('lista', l, COLUNAS);
  $('t-lista').innerHTML = `<div class="tb-rolagem"><table class="tb-lista" data-tb="lista">
    ${cabecalhoOrd('lista', COLUNAS)}<tbody>
    ${ord.slice(0, 600).map(t => {
      const d = parada(t);
      const dur = duracao(t);
      return `<tr data-abrir="${t.id}">
        <td>${proc(t.processo)}</td>
        <td>${esc((t.autor || '—').split(' ').slice(0, 3).join(' '))}</td>
        <td>${esc(t.reu || '—')}</td>
        <td><span class="marcador"><i style="background:${fase(t.status).cor};color:${fase(t.status).cor}"></i>${esc(fase(t.status).nome)}</span></td>
        <td>${esc(t.fase || '—')}</td>
        <td>${esc(t.estado || '—')}</td>
        <td>${esc(t.advogado || '—')}</td>
        <td>${esc(t.operador || '—')}</td>
        <td class="mono">${dtb(t.data)}</td>
        <td class="n">${t.valor ? brl2(t.valor) : '—'}</td>
        <td class="n" style="color:${d === null ? 'var(--txt-3)'
          : d > 45 ? 'var(--bad)' : d > 20 ? 'var(--warn)' : 'var(--txt-2)'}">${
          d === null ? (finalizada(t) ? 'encerrada' : '—') : d + 'd'}</td>
        <td class="n" style="color:var(--txt-2)">${
          dur === null ? '—' : dur === 0 ? 'mesmo dia'
          : dur + (dur === 1 ? ' dia' : ' dias')}</td>
      </tr>`;
    }).join('')}</tbody></table></div>
    <div class="resumo-filtro">${resumoDuracao(ord)}${
      ord.length > 600 ? ` · mostrando 600 de ${ord.length}` : ''}</div>`;

  ligaOrd('lista', COLUNAS, () => { telaLista(l); ligaAbrir(); });
}

/* Quanto tempo o escritório leva para encerrar uma tratativa, do primeiro
   contato ao desfecho. Só as encerradas entram: incluir caso vivo puxaria a
   média para baixo por um motivo que não é velocidade, é que ainda não acabou.

   Ressalva que muda o número: boa parte do histórico da planilha só trouxe uma
   data, e essas linhas caem como "mesmo dia". Somadas, derrubam a média de ~22
   para ~4 dias — e isso não é o escritório fechando rápido, é dado que faltou.
   Por isso as duas contas aparecem: a média cheia, que é o que foi pedido, e a
   média sem as linhas de data única, que é a que dá para usar. */
function resumoDuracao(l) {
  const d = l.map(duracao).filter(x => x !== null).sort((a, b) => a - b);
  if (!d.length) return 'Nenhuma tratativa encerrada neste filtro.';
  const media = a => Math.round(a.reduce((s, x) => s + x, 0) / a.length);
  const mediana = a => {
    const m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : Math.round((a[m - 1] + a[m]) / 2);
  };
  const dias = n => `${n} dia${n === 1 ? '' : 's'}`;
  const comDoisMarcos = d.filter(x => x > 0);
  const mesmoDia = d.length - comDoisMarcos.length;
  return `<b>${d.length}</b> encerradas · levaram em média <b>${dias(media(d))}</b>`
       + ` · mediana <b>${mediana(d)}</b> · mais rápida <b>${d[0]}</b>`
       + ` · mais demorada <b>${d[d.length - 1]}</b>`
       + (mesmoDia && comDoisMarcos.length
          ? `<br><b>${mesmoDia}</b> encerraram no mesmo dia da 1ª tentativa — no histórico da`
            + ` planilha isso quase sempre é uma data só, não um caso fechado no dia.`
            + ` Sem elas a média é <b>${dias(media(comDoisMarcos))}</b> e a mediana`
            + ` <b>${mediana(comDoisMarcos)}</b>.`
          : '');
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
const COL_BUSCA = [
  { k: 'processo', rot: 'Processo', v: t => t.processo || '' },
  { k: 'autor',    rot: 'Autor',    v: t => t.autor || '' },
  { k: 'reu',      rot: 'Réu',      v: t => t.reu || '' },
  { k: 'status',   rot: 'Status',   n: true, num: true, v: t => fase(t.status).ordem ?? 99 },
  { k: 'operador', rot: 'Operador', v: t => t.operador || '' },
  { k: 'data',     rot: 'Data',     data: true, v: t => t.data || '' },
  { k: 'valor',    rot: 'Valor',    n: true, num: true, v: t => +t.valor || 0 }
];

function resultadosDaBusca(l) {
  const procurando = busca.trim().length > 0;
  if (!procurando && l.length > 40) return '';
  if (!l.length) return '';
  const ord = ORDENS.busca ? ordenaPor('busca', l, COL_BUSCA)
    : [...l].sort((a, b) => (b.data_atualizacao || b.data || '')
        .localeCompare(a.data_atualizacao || a.data || ''));
  return `<div class="cx" style="margin-bottom:14px">
    <h3>${procurando ? `Encontradas — ${l.length}` : `Tratativas do recorte — ${l.length}`}</h3>
    <p class="sub">${procurando
      ? `Resultado de <b>${esc(busca.trim())}</b>. Clique para abrir.`
      : 'Poucos casos no filtro atual, então listo todos aqui. Clique para abrir.'}</p>
    <div class="tb-rolagem"><table class="tb-lista" data-tb="busca">
      ${cabecalhoOrd('busca', COL_BUSCA)}
      <tbody>${ord.slice(0, 60).map(t => `<tr data-abrir="${t.id}">
        <td>${proc(t.processo)}</td>
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

/* ==================================================================
   O DINHEIRO DEPOIS DO ACORDO FECHADO

   Um acordo nunca foi um numero so. R$ 5.300 pode ser R$ 3.000 de danos
   morais do cliente e R$ 2.300 de honorario do escritorio, pagos em datas
   diferentes, um ja em conta e outro em atraso. Ate aqui o sistema so
   sabia o total — e e do detalhe que saem comissao e previsao de caixa.

   Duas leituras, que respondem a perguntas diferentes:
     verba        de que o acordo e feito
     recebimento  quando cada pedaco entra, e se ja entrou
   ================================================================== */

/* A situacao vem da base congelada no dia da consolidacao. "A vencer" de
   ontem e "em atraso" hoje: quem decide isso e o calendario, nao o arquivo. */
/* Pago e pago: a situacao gravada OU uma data de pagamento. As duas dizem a
   mesma coisa, e ler so a primeira ja mostrou lancamento com data de pagamento
   preenchida aparecendo como EM ATRASO. */
function situacaoDe(r) {
  if (r.situacao === 'PAGO' || r.data_pagamento) return 'PAGO';
  if (r.vencimento && r.vencimento < ISO(HOJE)) return 'EM ATRASO';
  return 'A VENCER';
}
const CORSIT = { 'PAGO': 'var(--s5)', 'EM ATRASO': 'var(--bad)', 'A VENCER': 'var(--warn)' };

function caixaDe(l) {
  const ids = new Set(l.map(t => t.id));
  const todos = RECEB.filter(x => ids.has(x.tratativa_id));
  const pagos = todos.filter(x => situacaoDe(x) === 'PAGO');
  const abertos = todos.filter(x => situacaoDe(x) !== 'PAGO');
  const atrasados = todos.filter(x => situacaoDe(x) === 'EM ATRASO');
  return { todos, pagos, abertos, atrasados,
           recebido: soma(pagos, x => x.valor),
           aberto: soma(abertos, x => x.valor),
           atrasado: soma(atrasados, x => x.valor) };
}

let fSituacao = '';   // filtro proprio da tela financeira

const COL_PROTOCOLO = [
  { k: 'processo', rot: 'Processo', v: t => t.processo || '' },
  { k: 'autor',    rot: 'Autor',    v: t => t.autor || '' },
  { k: 'reu',      rot: 'Réu',      v: t => t.reu || '' },
  { k: 'advogado', rot: 'Advogado', v: t => t.advogado || '' },
  { k: 'operador', rot: 'Operador', v: t => t.operador || '' },
  { k: 'minuta',   rot: 'Minuta assinada', data: true, v: t => t.data_minuta_assinada || '' },
  { k: 'espera',   rot: 'Esperando há', n: true, num: true,
    v: t => t.data_minuta_assinada ? dias(t.data_minuta_assinada) : null },
  { k: 'valor',    rot: 'Valor', n: true, num: true, v: t => +t.valor || 0 }
];

/* O lançamento é a linha do dinheiro, então as colunas saem dele — mas processo
   e autor vêm da tratativa quando ela existe, que é o nome que a equipe conhece. */
const COL_LANC = [
  { k: 'processo',   rot: 'Processo', v: r => (TRAT.find(t => t.id === r.tratativa_id) || {}).processo || r.processo || '' },
  { k: 'autor',      rot: 'Autor',    v: r => (TRAT.find(t => t.id === r.tratativa_id) || {}).autor || r.autor || '' },
  { k: 'verba',      rot: 'Verba',    v: r => verba(r.verba).nome || '' },
  { k: 'parcela',    rot: 'Parcela',  v: r => r.parcela_rotulo || '' },
  { k: 'vencimento', rot: 'Vencimento', data: true, v: r => r.vencimento || '' },
  { k: 'pagamento',  rot: 'Pagamento',  data: true, v: r => r.data_pagamento || '' },
  { k: 'situacao',   rot: 'Situação', v: r => situacaoDe(r) },
  { k: 'valor',      rot: 'Valor', n: true, num: true, v: r => +r.valor || 0 }
];

/* Da minuta assinada ao protocolo: o pedaço do caminho que é do financeiro.
   É medido só onde as duas datas existem — inventar uma delas para aumentar a
   amostra daria um número bonito e falso. */
function tempoAteProtocolo(l) {
  const d = l.map(t => (t.data_minuta_assinada && t.data_protocolo)
      ? Math.round((new Date(t.data_protocolo + 'T12:00:00')
                  - new Date(t.data_minuta_assinada + 'T12:00:00')) / 864e5)
      : null)
    .filter(x => x !== null && x >= 0)
    .sort((a, b) => a - b);
  if (!d.length) return null;
  const m = Math.floor(d.length / 2);
  return { n: d.length,
           media: Math.round(d.reduce((s, x) => s + x, 0) / d.length),
           mediana: d.length % 2 ? d[m] : Math.round((d[m - 1] + d[m]) / 2),
           min: d[0], max: d[d.length - 1] };
}

/* Acordo acertado que ainda não é acordo fechado. Enquanto essas fases não
   existiam, tudo isso ficava como "em tratativa" e o financeiro só descobria o
   caso quando ele já estava protocolado. */
function blocoFormalizando(l) {
  const esperando = l.filter(t => t.status === AGUARDA_PROTOCOLO)
    .sort((a, b) => (a.data_minuta_assinada || a.data_atualizacao || '')
      .localeCompare(b.data_minuta_assinada || b.data_atualizacao || ''));
  const antes = FORMALIZANDO.slice(0, 2).map(s => ({ s, l: l.filter(t => t.status === s) }));
  const chegando = soma(antes.flatMap(x => x.l), t => t.valor);
  const t = tempoAteProtocolo(l.filter(x => x.data_minuta_assinada && x.data_protocolo));
  if (!esperando.length && !antes.some(x => x.l.length) && !t) return '';

  return `<div class="cx" style="margin-bottom:14px">
    <h3>Aguardando protocolo — ${esperando.length}</h3>
    <p class="sub">Minuta assinada e devolvida à parte contrária. A partir daqui o
       acompanhamento é do financeiro: vira <b>Acordo fechado</b> quando o protocolo
       acontecer. Clique para abrir e atualizar.</p>
    ${esperando.length ? `<div class="tb-rolagem"><table class="tb-lista" data-tb="protocolo">
      ${cabecalhoOrd('protocolo', COL_PROTOCOLO)}
      <tbody>${ordenaPor('protocolo', esperando, COL_PROTOCOLO).map(x => {
        const esp = x.data_minuta_assinada ? dias(x.data_minuta_assinada) : null;
        return `<tr data-abrir="${x.id}">
          <td>${proc(x.processo)}</td>
          <td>${esc((x.autor || '—').split(' ').slice(0, 3).join(' '))}</td>
          <td>${esc(x.reu || '—')}</td>
          <td>${esc(x.advogado || '—')}</td>
          <td>${esc(x.operador || '—')}</td>
          <td class="mono">${dtb(x.data_minuta_assinada)}</td>
          <td class="n" style="color:${esp === null ? 'var(--txt-3)'
            : esp > 30 ? 'var(--bad)' : esp > 15 ? 'var(--warn)' : 'var(--txt-2)'}">${
            esp === null ? 'sem data' : esp + 'd'}</td>
          <td class="n">${x.valor ? brl2(x.valor) : '—'}</td>
        </tr>`;
      }).join('')}
      <tr class="tot"><td colspan="7">Total aguardando protocolo</td>
        <td class="n">${brl2(soma(esperando, x => x.valor))}</td></tr>
      </tbody></table></div>`
      : '<div class="sem-contato">Nada aguardando protocolo neste filtro.</div>'}

    <div class="resumo-filtro">
      ${antes.map(x => `<b>${x.l.length}</b> ${fase(x.s).nome.toLowerCase()}`).join(' · ')}
      ${chegando ? ` · <b>${brl2(chegando)}</b> a caminho` : ''}
      ${t ? `<br>Da assinatura da minuta ao protocolo: <b>${t.n}</b> acordos já fizeram
        esse caminho · média <b>${t.media} dia${t.media === 1 ? '' : 's'}</b> ·
        mediana <b>${t.mediana}</b> · mais rápido <b>${t.min}</b> ·
        mais demorado <b>${t.max}</b>.`
      : '<br>Nenhum acordo tem as duas datas ainda — a média aparece assim que o primeiro protocolar.'}
    </div>
  </div>`;
}

function telaFinanceiro(l) {
  const acordos = l.filter(ehAcordo);
  const ids = new Set(acordos.map(t => t.id));
  const cx = caixaDe(acordos);
  const fechado = soma(acordos, t => t.valor);
  const vb = VERBAS.filter(v => ids.has(v.tratativa_id));

  /* ---- por verba ---- */
  const porVerba = CFG_VERBA.map(c => {
    const linhas = vb.filter(v => v.verba === c.id);
    const rec = cx.todos.filter(r => r.verba === c.id);
    return { ...c, acordos: new Set(linhas.map(x => x.tratativa_id)).size,
             total: soma(linhas, x => x.valor_total),
             pago: soma(rec.filter(r => situacaoDe(r) === 'PAGO'), x => x.valor),
             aberto: soma(rec.filter(r => situacaoDe(r) !== 'PAGO'), x => x.valor) };
  }).filter(x => x.total || x.pago || x.aberto);
  const totalVerbas = soma(porVerba, x => x.total) || 1;

  /* ---- por competencia ---- */
  const comp = {};
  cx.todos.forEach(r => {
    const m = (r.data_pagamento || r.vencimento || '').slice(0, 7);
    if (!m) return;
    comp[m] = comp[m] || { m, pago: 0, aberto: 0, n: 0 };
    comp[m].n++;
    if (situacaoDe(r) === 'PAGO') comp[m].pago += +r.valor || 0;
    else comp[m].aberto += +r.valor || 0;
  });
  const meses = Object.values(comp).sort((a, b) => a.m.localeCompare(b.m)).slice(-14);
  const teto = Math.max(...meses.map(x => x.pago + x.aberto), 1);

  /* ---- lancamentos ---- */
  const lanc = cx.todos
    .filter(r => !fSituacao || situacaoDe(r) === fSituacao)
    .sort((a, b) => (b.data_pagamento || b.vencimento || '')
      .localeCompare(a.data_pagamento || a.vencimento || ''));
  const trat = id => TRAT.find(t => t.id === id) || {};

  $('t-financeiro').innerHTML = `
    <div class="grade g4">
      ${kpi('Fechado no período', brl(fechado), `${acordos.length} acordos`, 'rgba(6,182,212,.28)')}
      ${kpi('Recebido em conta', brl(cx.recebido),
            `${cx.pagos.length} lançamentos · ${fechado ? (cx.recebido / fechado * 100).toFixed(0) : 0}% do fechado`,
            'rgba(163,230,53,.3)')}
      ${kpi('A receber', brl(cx.aberto), `${cx.abertos.length} lançamentos em aberto`, 'rgba(20,184,166,.26)')}
      ${kpi('Em atraso', brl(cx.atrasado),
            cx.atrasados.length ? `${cx.atrasados.length} lançamentos vencidos` : 'nada vencido',
            cx.atrasados.length ? 'rgba(251,113,133,.32)' : 'rgba(163,230,53,.26)')}
    </div>

    ${blocoFormalizando(l)}

    <div class="cx" style="margin-bottom:14px">
      <h3>De que é feito o dinheiro</h3>
      <p class="sub">O acordo dividido por natureza da verba. <b>DM</b> é o que vai para o
         cliente e <b>HS</b> é o honorário do escritório. O que aparecer em cinza são
         verbas do histórico que saíram de uso.</p>
      ${porVerba.length ? `<table class="tb">
        <tr><th>Verba</th><th class="n">Acordos</th><th class="n">Total</th>
            <th class="n">Recebido</th><th class="n">A receber</th></tr>
        ${porVerba.map(v => `<tr>
          <td><span class="marcador"><i style="background:${v.cor}"></i>${esc(v.nome)}</span>
            <div class="trilho"><i style="width:${v.total / totalVerbas * 100}%;background:${v.cor}"></i></div></td>
          <td class="n">${v.acordos}</td>
          <td class="n">${brl2(v.total)}</td>
          <td class="n" style="color:var(--s5)">${v.pago ? brl2(v.pago) : '—'}</td>
          <td class="n" style="color:${v.aberto ? 'var(--warn)' : 'var(--txt-3)'}">${v.aberto ? brl2(v.aberto) : '—'}</td>
        </tr>`).join('')}
        <tr class="tot"><td>Total</td><td class="n">${acordos.length}</td>
          <td class="n">${brl2(soma(porVerba, x => x.total))}</td>
          <td class="n">${brl2(cx.recebido)}</td>
          <td class="n">${brl2(cx.aberto)}</td></tr>
      </table>` : '<div class="sem-contato">Nenhuma verba discriminada no período.</div>'}
      ${(() => {
        /* A diferença entre o fechado e o discriminado não pode ficar
           escondida: um total menor passaria por erro do sistema quando na
           verdade é acordo que ainda não foi discriminado. E não basta dizer
           que existe — a lista abre cada um deles, que é o que resolve. */
        const pendentes = acordos.filter(t => {
          const v = vb.filter(x => x.tratativa_id === t.id);
          if (!v.length) return +t.valor > 0;
          return Math.abs((+t.valor || 0) - soma(v, x => x.valor_total)) >= 0.01;
        });
        if (!pendentes.length) return '';
        const falta = soma(pendentes, t => (+t.valor || 0)
          - soma(vb.filter(x => x.tratativa_id === t.id), x => x.valor_total));
        return `<div class="nota" style="margin:14px 0 0">
          <b>${pendentes.length}</b> acordo${pendentes.length === 1 ? '' : 's'}
          ${pendentes.length === 1 ? 'está' : 'estão'} sem discriminação fechada —
          <b>${brl2(Math.abs(falta))}</b> de diferença. São de antes de a discriminação
          virar obrigatória. Clique para abrir e separar as verbas:
          <div style="margin-top:9px;display:flex;flex-direction:column;gap:5px">
            ${pendentes.sort((a, b) => (+b.valor || 0) - (+a.valor || 0)).slice(0, 30)
              .map(t => `<button type="button" class="pendente" data-abrir="${t.id}">
                ${proc(t.processo)}
                <span class="nm">${esc((t.autor || '—').split(' ').slice(0, 3).join(' '))}</span>
                <b class="mono">${brl2(t.valor)}</b></button>`).join('')}
          </div>
        </div>`;
      })()}
    </div>

    <div class="cx" style="margin-bottom:14px">
      <h3>Entrada de caixa mês a mês</h3>
      <p class="sub">Verde é o que entrou; âmbar é o que está lançado e ainda não entrou.</p>
      ${meses.length ? `<div style="display:flex;gap:6px;align-items:flex-end">
        ${meses.map(x => `<div style="flex:1;min-width:0;max-width:96px;display:flex;
            flex-direction:column;align-items:center;gap:6px">
          <div style="height:150px;width:100%;display:flex;flex-direction:column-reverse;
               align-items:center;justify-content:flex-start">
            <div title="recebido ${brl2(x.pago)}" style="width:64%;height:${x.pago / teto * 100}%;
                 min-height:${x.pago ? 2 : 0}px;background:linear-gradient(180deg,#BEF264,#84CC16)"></div>
            <div title="a receber ${brl2(x.aberto)}" style="width:64%;height:${x.aberto / teto * 100}%;
                 min-height:${x.aberto ? 2 : 0}px;background:linear-gradient(180deg,#FCD34D,#F59E0B);
                 border-radius:4px 4px 0 0"></div>
          </div>
          <div style="font-size:10.5px;color:var(--txt-3)">${x.m.slice(5)}/${x.m.slice(2, 4)}</div>
          <div class="mono" style="font-size:10px;color:var(--txt-2)">${kk(x.pago + x.aberto)}</div>
        </div>`).join('')}
      </div>` : '<div class="sem-contato">Sem lançamento no período.</div>'}
    </div>

    <div class="cx">
      <h3>Lançamentos — ${lanc.length}</h3>
      <p class="sub">Cada linha é um recebimento: uma parcela, um vencimento, uma situação.
         Clique para abrir a tratativa.</p>
      <div class="filtros" style="margin-bottom:14px">
        <button class="chip ${!fSituacao ? 'on' : ''}" data-sit="">Todos</button>
        ${SITUACOES.map(s => `<button class="chip ${fSituacao === s ? 'on' : ''}" data-sit="${s}">
          ${s} — ${cx.todos.filter(r => situacaoDe(r) === s).length}</button>`).join('')}
      </div>
      ${lanc.length ? `<div class="tb-rolagem"><table class="tb-lista" data-tb="lanc">
        ${cabecalhoOrd('lanc', COL_LANC)}
        <tbody>${ordenaPor('lanc', lanc, COL_LANC).slice(0, 400).map(r => {
          const t = trat(r.tratativa_id), s = situacaoDe(r);
          return `<tr data-abrir="${r.tratativa_id}">
            <td>${proc(t.processo || r.processo)}</td>
            <td>${esc((t.autor || r.autor || '—').split(' ').slice(0, 3).join(' '))}</td>
            <td><span class="marcador"><i style="background:${verba(r.verba).cor}"></i>${esc(verba(r.verba).nome)}</span></td>
            <td class="mono">${esc(r.parcela_rotulo || '—')}</td>
            <td class="mono">${dtb(r.vencimento)}</td>
            <td class="mono">${dtb(r.data_pagamento)}</td>
            <td style="color:${CORSIT[s]}">${s}${r.origem_registro === 'sistema' ? ' <span style="color:var(--txt-3);font-size:10px">(previsão)</span>' : ''}</td>
            <td class="n">${brl2(r.valor)}</td>
          </tr>`;
        }).join('')}</tbody></table></div>
        ${lanc.length > 400 ? `<div class="resumo-filtro">Mostrando 400 de ${lanc.length}.</div>` : ''}`
      : '<div class="sem-contato">Nenhum lançamento nesse filtro.</div>'}
    </div>`;

  document.querySelectorAll('[data-sit]').forEach(b => b.onclick = () => {
    fSituacao = b.dataset.sit; desenha();
  });
  ligaOrd('lanc', COL_LANC, () => { telaFinanceiro(l); ligaAbrir(); });
  ligaOrd('protocolo', COL_PROTOCOLO, () => { telaFinanceiro(l); ligaAbrir(); });
}

/* ==================================================================
   RANKING DE OPERADOR
   Base para as regras de comissao. O ranking vem de view: se a tela
   calculasse por fora, um dia divergiria do painel.
   ================================================================== */
let ordemRanking = 'valor_fechado';
/* O ranking tem periodo proprio: os filtros do topo recortam tratativas, e o
   ranking recorta pessoas. Misturar os dois faria "operador" filtrar o proprio
   ranking, que nao faz sentido. */
let periodoRank = { modo: '', de: '', ate: '' };

function intervaloRank() {
  const m = periodoRank.modo;
  if (m === 'custom') return [periodoRank.de, periodoRank.ate];
  if (/^\d{4}-\d{2}$/.test(m)) {
    const [a, mes] = m.split('-').map(Number);
    return [`${m}-01`, ISO(new Date(a, mes, 0))];
  }
  if (/^\d{4}$/.test(m)) return [`${m}-01-01`, `${m}-12-31`];
  return ['', ''];
}

const anosDisponiveis = () => {
  const s = new Set();
  TRAT.forEach(t => [t.data, t.data_atualizacao, t.data_protocolo]
    .forEach(d => { if (d) s.add(d.slice(0, 4)); }));
  return [...s].sort().reverse();
};

/* Uma definicao so: a mesma funcao do banco que a view usa sem periodo. */
/* ==================================================================
   A TELA NÃO PODE ENVELHECER SOZINHA

   A sessão não expira mais por inatividade — foi pedido assim, e está certo.
   O efeito colateral não estava previsto: a aba fica aberta dias a fio, e o
   que aparece nela é a fotografia do banco no instante em que ela abriu.
   Duas pessoas no mesmo caso viam bases diferentes, e a que salvasse depois
   gravava os valores velhos por cima dos novos, sem erro nenhum na tela.

   A correção tem dois lados. Aqui é o primeiro: buscar de tempos em tempos
   só o que mudou — `updated_at` maior que o maior que já vimos. É uma
   chamada pequena, roda quando a aba volta ao foco e a cada minuto enquanto
   ela está visível. O segundo lado é a trava de gravação em `mudar()`.
   ================================================================== */
let ULTIMA_SINC = null;      // maior updated_at que esta tela já viu
let sincronizando = null;
/* Trinta segundos: perto o suficiente para duas pessoas no mesmo caso nao se
   atrapalharem, e barato — a busca traz so o que mudou desde a ultima vez. */
const A_CADA = 30000;

const maiorUpdated = (l, atual) => (l || []).reduce(
  (m, x) => (x.updated_at && (!m || x.updated_at > m)) ? x.updated_at : m, atual);

function marcaSincronia() {
  ULTIMA_SINC = maiorUpdated(TRAT, maiorUpdated(RECEB, maiorUpdated(VERBAS, null)));
}

function funde(lista, novas) {
  const mudou = [];
  (novas || []).forEach(n => {
    const i = lista.findIndex(x => x.id === n.id);
    if (i >= 0) lista[i] = n; else lista.push(n);
    mudou.push(n.id);
  });
  return mudou;
}

/* Devolve quantas linhas mudaram. Nunca lança: sincronizar é conveniência, e
   uma falha de rede aqui não pode virar erro vermelho por cima do trabalho de
   ninguém — na próxima passada tenta de novo. */
async function sincroniza(agora) {
  if (sincronizando) return sincronizando;
  if (!logado()) return 0;
  // Sem marco nenhum a tela nunca carregou direito: recarrega tudo.
  if (!ULTIMA_SINC) {
    if (!agora) return 0;
    await carrega(); marcaSincronia(); desenha();
    return TRAT.length;
  }
  sincronizando = (async () => {
    const desde = encodeURIComponent(ULTIMA_SINC);
    const [t, rc] = await Promise.all([
      ler('tratativa',          `select=*&updated_at=gt.${desde}&order=updated_at.asc&limit=500`),
      ler('acordo_recebimento', `select=*&updated_at=gt.${desde}&order=updated_at.asc&limit=500`)
    ]);
    const ids = funde(TRAT, t);
    funde(RECEB, rc);

    /* Verba e recebimento são apagados e regravados a cada salvamento, então
       o que sumiu não volta por `updated_at` — para as tratativas que mudaram,
       a lista é relida inteira. Se mudou muita coisa, sai mais barato (e mais
       seguro) recarregar tudo. */
    if (ids.length > 60) { await carrega(); marcaSincronia(); desenha(); return ids.length; }
    if (ids.length) {
      const dentro = new Set(ids);
      const lista = ids.join(',');
      const [vb, rec] = await Promise.all([
        ler('acordo_verba',       `select=*&tratativa_id=in.(${lista})`),
        ler('acordo_recebimento', `select=*&tratativa_id=in.(${lista})`)
      ]);
      VERBAS = VERBAS.filter(v => !dentro.has(v.tratativa_id)).concat(vb || []);
      RECEB  = RECEB .filter(r => !dentro.has(r.tratativa_id)).concat(rec || []);
    }

    const total = ids.length + (rc || []).length;
    if (total) {
      marcaSincronia();
      desenha();
    }
    return total;
  })().catch(() => 0).finally(() => { sincronizando = null; });
  return sincronizando;
}

/* Volta ao foco: sincroniza na hora. É o gesto mais comum da equipe — sair
   para o WhatsApp, tratar o caso, voltar para o sistema. */
function ligaSincronia() {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { sincroniza(); vejoSeMudouAVersao(); }
  });
  window.addEventListener('focus', () => sincroniza());
  window.addEventListener('online', () => sincroniza());
  setInterval(sincroniza, A_CADA);
  const bt = $('atualizar');
  if (bt) bt.onclick = () => atualizaAgora();
}

/* O botão. Faz o mesmo que o relógio de 30s, mas na hora e dizendo o que
   achou — quem clica quer saber se veio alguma coisa, e "nada mudou" é uma
   resposta tão boa quanto "3 tratativas atualizadas". */
async function atualizaAgora() {
  const bt = $('atualizar');
  if (bt) bt.classList.add('girando');
  try {
    const n = await sincroniza(true);
    vejoSeMudouAVersao();
    alerta(n ? `Atualizado: ${n} ${n === 1 ? 'registro mudou' : 'registros mudaram'}.`
             : 'Tudo em dia — nada mudou desde a última atualização.', 'ok');
  } finally {
    if (bt) bt.classList.remove('girando');
  }
}

/* ---------- a versão do próprio sistema ----------
   Mesma raiz do problema anterior: a aba aberta há dias também está rodando o
   JavaScript daquele dia. Nenhuma correção publicada chega a quem não recarrega.
   Aqui a tela pergunta ao servidor se o arquivo mudou e, se mudou, oferece a
   atualização — sem recarregar por conta própria, que jogaria fora o que
   estivesse sendo digitado. */
let VERSAO_TELA = null;
async function assinaturaDaTela() {
  try {
    const r = await fetch('/acordos.js', { method: 'HEAD', cache: 'no-store' });
    return r.headers.get('etag') || r.headers.get('last-modified') || null;
  } catch { return null; }
}
async function vejoSeMudouAVersao() {
  const agora = await assinaturaDaTela();
  if (!agora || !VERSAO_TELA || agora === VERSAO_TELA || $('nova-versao')) return;
  const b = document.createElement('div');
  b.id = 'nova-versao';
  b.className = 'nova-versao';
  b.innerHTML = `<span>Saiu uma versão nova do sistema.</span>
    <button type="button" class="bt p" id="recarregar-agora">Atualizar agora</button>`;
  document.body.appendChild(b);
  $('recarregar-agora').onclick = () => location.reload();
}

async function carregaRanking() {
  const [de, ate] = intervaloRank();
  RANKING = await api('rpc/ranking_operador', {
    method: 'POST',
    body: JSON.stringify({ p_de: de || null, p_ate: ate || null })
  }) || [];
}
const COLUNAS_RANK = [
  { id: 'valor_fechado',   rotulo: 'Valor fechado',   fmt: v => brl2(v) },
  { id: 'valor_recebido',  rotulo: 'Recebido',        fmt: v => brl2(v) },
  { id: 'acordos',         rotulo: 'Acordos',         fmt: v => v },
  { id: 'taxa_conversao',  rotulo: 'Conversão',       fmt: v => (+v).toFixed(1) + '%' },
  { id: 'tratativas',      rotulo: 'Tratativas',      fmt: v => v },
  { id: 'ticket_medio',    rotulo: 'Ticket médio',    fmt: v => brl2(v) },
];

function telaRanking() {
  const l = [...RANKING].sort((a, b) => (+b[ordemRanking] || 0) - (+a[ordemRanking] || 0));
  const teto = Math.max(...l.map(x => +x[ordemRanking] || 0), 1);
  const col = COLUNAS_RANK.find(c => c.id === ordemRanking);
  const ativos = l.filter(x => x.ativo);

  $('t-ranking').innerHTML = `
    <div class="cab">
      <div class="olho">Equipe · ${ativos.length} operadores na ativa</div>
      <h1>Ranking de operador</h1>
      <p>Tudo o que cada operador fez, do primeiro contato ao dinheiro em conta.
         Quem saiu do escritório continua aqui: o trabalho dele não deixou de existir,
         e sem ele o histórico de 2026 não fecha.</p>
    </div>

    <div class="filtros-linha" style="margin-bottom:14px">
      <label class="filtro periodo"><span>período</span>
        <select data-rp="modo">
          <option value="" ${!periodoRank.modo ? 'selected' : ''}>todo o período</option>
          <option value="custom" ${periodoRank.modo === 'custom' ? 'selected' : ''}>intervalo personalizado…</option>
          <optgroup label="por ano">${anosDisponiveis().map(a =>
            `<option value="${a}" ${periodoRank.modo === a ? 'selected' : ''}>${a}</option>`).join('')}</optgroup>
          <optgroup label="por mês">${mesesDisponiveis().map(m =>
            `<option value="${m}" ${periodoRank.modo === m ? 'selected' : ''}>${
              NOME_MES[+m.slice(5, 7) - 1]} de ${m.slice(0, 4)}</option>`).join('')}</optgroup>
        </select></label>
      <label class="filtro ${periodoRank.modo === 'custom' ? '' : 'oculto'}"><span>de</span>
        <input type="date" data-rp="de" value="${periodoRank.de}"></label>
      <label class="filtro ${periodoRank.modo === 'custom' ? '' : 'oculto'}"><span>até</span>
        <input type="date" data-rp="ate" value="${periodoRank.ate}"></label>
      <div class="filtro" style="min-width:auto;flex:1"></div>
      <div style="display:flex;gap:7px;flex-wrap:wrap;align-items:center">
        <span style="font-size:11px;color:var(--txt-3)">ordenar por</span>
        ${COLUNAS_RANK.map(c => `<button class="chip ${c.id === ordemRanking ? 'on' : ''}"
          data-rank="${c.id}">${c.rotulo}</button>`).join('')}
      </div>
    </div>

    <div class="tb-rolagem"><table class="tb-lista">
      <thead><tr><th>#</th><th>Operador</th><th class="n">Tratativas</th>
        <th class="n">Decididas</th><th class="n">Acordos</th><th class="n">Conversão</th>
        <th class="n">Valor fechado</th><th class="n">Recebido</th>
        <th class="n">A receber</th><th class="n">Ticket médio</th>
        <th class="n">Dias p/ protocolo</th></tr></thead>
      <tbody>${l.map((x, i) => `<tr>
        <td class="mono" style="color:var(--txt-3)">${i + 1}</td>
        <td><b>${esc(x.operador)}</b>${x.ativo ? '' : ' <span class="pilula off">saiu</span>'}
          <div class="trilho"><i style="width:${(+x[ordemRanking] || 0) / teto * 100}%;
            background:linear-gradient(90deg,#06B6D4,#A3E635)"></i></div></td>
        <td class="n">${x.tratativas}</td>
        <td class="n">${x.decididas}</td>
        <td class="n">${x.acordos}</td>
        <td class="n" style="color:${+x.taxa_conversao >= 25 ? 'var(--s6)'
          : +x.taxa_conversao >= 12 ? 'var(--warn)' : 'var(--txt-2)'}">${(+x.taxa_conversao).toFixed(1)}%</td>
        <td class="n">${brl2(x.valor_fechado)}</td>
        <td class="n" style="color:var(--s5)">${+x.valor_recebido ? brl2(x.valor_recebido) : '—'}</td>
        <td class="n" style="color:${+x.valor_a_receber ? 'var(--warn)' : 'var(--txt-3)'}">${+x.valor_a_receber ? brl2(x.valor_a_receber) : '—'}</td>
        <td class="n">${brl2(x.ticket_medio)}</td>
        <td class="n">${x.dias_ate_protocolo == null ? '—' : (+x.dias_ate_protocolo).toFixed(1)}</td>
      </tr>`).join('')}</tbody></table></div>
    <div class="resumo-filtro">Ordenado por <b>${col.rotulo}</b> · ${rotuloPeriodoRank()}.
      Uma tratativa entra no período quando qualquer marco dela caiu ali — abertura,
      atualização ou protocolo. O dinheiro entra pela data em que entrou.
      Os filtros do topo não se aplicam ao ranking.</div>`;

  document.querySelectorAll('[data-rank]').forEach(b => b.onclick = () => {
    ordemRanking = b.dataset.rank; desenha();
  });
  document.querySelectorAll('[data-rp]').forEach(el => el.onchange = () => protege(async () => {
    periodoRank[el.dataset.rp] = el.value;
    if (el.dataset.rp === 'modo' && el.value !== 'custom') { periodoRank.de = ''; periodoRank.ate = ''; }
    await carregaRanking();
    desenha();
  }));
}

function rotuloPeriodoRank() {
  const m = periodoRank.modo;
  if (!m) return 'histórico inteiro';
  if (m === 'custom') {
    if (!periodoRank.de && !periodoRank.ate) return 'intervalo ainda sem datas';
    return `de ${dtb(periodoRank.de) } até ${dtb(periodoRank.ate)}`;
  }
  if (/^\d{4}$/.test(m)) return 'ano de ' + m;
  return NOME_MES[+m.slice(5, 7) - 1] + ' de ' + m.slice(0, 4);
}

function telaPainel(l) {
  const fechadas   = l.filter(ehAcordo);
  const decididas  = l.filter(t => fase(t.status).conta_no_denominador);
  const vivas      = l.filter(t => !fase(t.status).conta_no_denominador);
  const fat        = faturadas(l).filter(ehAcordo);
  const semProt    = fechadas.filter(t => !t.data_protocolo);
  const taxa       = decididas.length ? fechadas.length / decididas.length * 100 : 0;
  const valorFat   = soma(fat, t => t.valor);
  const valorFech  = soma(fechadas, t => t.valor);
  const ticket     = fechadas.length ? valorFech / fechadas.length : 0;
  // Dinheiro: o que entrou em conta e o que ainda nao entrou, por lancamento.
  const cx         = caixaDe(l);
  const aReceber   = cx.abertos;
  const vencidas   = cx.atrasados;

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
    if (ehAcordo(t)) { o.ganhas++; o.valor += +t.valor || 0; }
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
      ${kpi('A receber', brl(soma(aReceber, p => p.valor)),
            vencidas.length ? `${vencidas.length} em atraso · ${brl(soma(vencidas, p => p.valor))}`
                            : `${aReceber.length} lançamentos em dia`,
            vencidas.length ? 'rgba(251,113,133,.3)' : 'rgba(20,184,166,.26)')}
      ${kpi('Aguardando protocolo', semProt.length,
            semProt.length ? `${brl(soma(semProt, t => t.valor))} fechados sem protocolar`
                           : 'nenhuma minuta parada',
            semProt.length ? 'rgba(245,158,11,.3)' : 'rgba(163,230,53,.26)')}
      ${kpi('Recebido em conta', brl(cx.recebido),
            `${cx.pagos.length} lançamentos pagos`, 'rgba(163,230,53,.28)')}
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
  previsao_manual: false, recebido: false, data_recebimento: null,
  chave_cliente: null
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

/* Quem esta logado e quem esta abrindo a tratativa. Preencher o operador
   sozinho e o mesmo que ja se faz com o status: poupa um clique por tratativa
   e evita o campo em branco, que depois some do ranking e da comissao. */
function operadorDaVez() {
  const eu = (sessao && (sessao.nome || sessao.email)) || '';
  if (!eu) return null;
  const achado = operadores().find(p => p.nome === eu)
    || operadores().find(p => (p.email || '').toLowerCase() === String(sessao.email || '').toLowerCase());
  return achado ? achado.nome : null;
}

function abreForm(t) {
  // Recado da tratativa anterior não vale para esta. Sem isto, sair do aviso de
  // processo repetido para a tratativa que existe deixava o erro na tela, e ele
  // passava a acusar de duplicada justamente a original.
  if ($('recado')) $('recado').innerHTML = '';
  rascunho = t ? { ...t } : vazio();
  if (!rascunho.id && !rascunho.operador) rascunho.operador = operadorDaVez();
  // Tratativa nova ganha a chave aqui, antes de qualquer digitação: assim ela
  // acompanha o rascunho guardado e repetir o salvamento nunca duplica.
  if (!rascunho.id && !rascunho.chave_cliente) rascunho.chave_cliente = ANDON_REDE.chaveNova();
  // A discriminação do acordo é editada aqui dentro, então vem junto.
  rascunho.verbas = t && t.id
    ? verbasDe(t.id).map(v => ({ id: v.id, verba: v.verba, detalhe: v.detalhe || '',
                                 valor_total: +v.valor_total || 0 }))
    : [];
  /* A tela abre onde o trabalho está. Tratativa nova começa na identificação;
     tratativa em andamento abre direto na etapa 2, que é onde a operadora mexe;
     acordo já fechado abre no faturamento, que é o que falta preencher.
     Abrir sempre na etapa 1 custava dois cliques a cada atualização. */
  etapa = !rascunho.id ? 1 : (rascunho.status === FECHADO ? 3 : 2);
  pintaForm();
  $('gav').classList.add('on'); $('veu').classList.add('on');
}

function podeFaturar() { return rascunho.status === FECHADO; }

function pintaForm() {
  const novo = !rascunho.id;
  $('gavT').innerHTML = `
    <h3 style="font-size:16px">${novo ? 'Nova tratativa'
      : (rascunho.processo ? proc(rascunho.processo) : 'Tratativa')}</h3>
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

  /* O recado sobrevive ao redesenho. Sem isto, "Tratativa salva." aparecia e
     sumia meio segundo depois, quando a releitura das parcelas repintava o
     formulário — e a operadora ficava sem saber se tinha salvado. */
  const recadoAtual = ($('recado') || {}).innerHTML || '';
  $('gavC').innerHTML = `<div id="recado">${recadoAtual}</div>
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
    <div id="aviso-duplicado"></div>
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

/* Os campos de dinheiro do acordo — discriminação, forma, prazo — moram ora na
   etapa de Tratativa, ora na de Faturamento, conforme o status. Ficam com os
   mesmos ids (`f3-…`) nos dois lugares de propósito: as duas situações são
   excludentes, nunca aparecem juntos, e assim leitura, previsão e discriminação
   continuam funcionando sem saber em que etapa foram desenhados. */
function blocoAcordo(r) {
  const parcelado = r.forma_pagamento === 'parcelado';
  return `${blocoVerbas(r.verbas || [], +r.valor || 0)}
    <div class="dupla">
      ${campo('Forma de pagamento', escolha('f3-forma',
        [{ v: 'unica', l: 'Parcela única' }, { v: 'parcelado', l: 'Parcelado' }], r.forma_pagamento))}
      ${parcelado ? campo('Quantas parcelas', entrada('f3-parcelas', 'number', r.qtd_parcelas, 'min="2" max="60"')) : '<div></div>'}
    </div>
    <div class="dupla">
      ${campo('Prazo p/ receber (dias)', entrada('f3-prazo', 'number', r.prazo_dias, 'min="0"'))}
      ${campo('Tipo de prazo', escolha('f3-tipoprazo',
        [{ v: 'uteis', l: 'úteis' }, { v: 'corridos', l: 'corridos' }], r.tipo_prazo))}
    </div>`;
}

const campoMinuta = r => campo('Minuta assinada em', entrada('f3-minuta', 'date', r.data_minuta_assinada),
  'A data em que o advogado responsável devolveu a minuta assinada.');

function etapaTratativa() {
  const r = rascunho;
  const emFormalizacao = formalizando(r.status);
  return `<div class="etapa ${etapa === 2 ? 'on' : ''}" id="e2">
    <div class="dupla">
      ${campo('Status', escolha('f2-status', FASES.map(f => ({ v: f.id, l: f.nome })), r.status),
        emFormalizacao
          ? 'O acordo está acertado e sendo formalizado. <b>Acordo Fechado</b> só depois do protocolo.'
          : 'Mudar para <b>Acordo Fechado</b> libera a etapa de Faturamento.')}
      ${campo('Última atualização', entrada('f2-atualizacao', 'date', r.data_atualizacao))}
    </div>
    ${campo('Valor (acordo / tratativa)', entrada('f2-valor', 'number', r.valor, 'step="0.01" min="0" placeholder="0,00"'))}
    ${emFormalizacao ? blocoAcordo(r) : ''}
    ${r.status === AGUARDA_PROTOCOLO ? campoMinuta(r) : ''}
    ${campo('Observações', `<textarea class="inp" id="f2-obs" rows="4">${esc(r.observacoes || '')}</textarea>`)}
    ${r.status === AGUARDA_PROTOCOLO ? `<div class="nota" style="margin-top:14px">
      Com a minuta assinada e o status em <b>Aguardando protocolo</b>, este acordo
      passa a aparecer no <b>Financeiro</b>. Daqui em diante o acompanhamento é de
      lá — e vira <b>Acordo Fechado</b> quando o protocolo acontecer.</div>` : ''}
  </div>`;
}

/* Faturamento só existe depois do acordo fechado. Antes disso a etapa fica
   vazia — e vazia mesmo, sem campos escondidos: os ids são compartilhados com
   a etapa de Tratativa, e dois campos com o mesmo id na página fariam a tela
   ler o valor errado. */
function etapaFaturamento() {
  const r = rascunho;
  if (!podeFaturar()) return `<div class="etapa ${etapa === 3 ? 'on' : ''}" id="e3">
    <div class="sem-contato">Esta etapa abre quando o status for <b>Acordo Fechado</b>,
      o que acontece depois do protocolo da minuta.</div></div>`;

  const p = r.id ? recebimentosDe(r.id) : [];
  const temProtocolo = !!r.data_protocolo;
  return `<div class="etapa ${etapa === 3 ? 'on' : ''}" id="e3">
    <div class="dupla">
      ${campo('Status', `<input class="inp" value="${esc(fase(r.status).nome)}" disabled>`)}
      ${campo('Valor (acordo / tratativa)', entrada('f3-valor', 'number', r.valor, 'step="0.01" min="0"'))}
    </div>
    ${blocoAcordo(r)}
    <div class="dupla">
      ${campoMinuta(r)}
      ${campo('Protocolada em <span style="text-transform:none;letter-spacing:0;color:var(--txt-3)">(faturamento)</span>',
        entrada('f3-protocolo', 'date', r.data_protocolo),
        'É esta data que conta como faturamento — não a assinatura da minuta.')}
    </div>
    ${temProtocolo
      ? campo(`Previsão de recebimento ${r.previsao_manual
          ? '<span style="text-transform:none;letter-spacing:0;color:var(--warn)">(digitada por você)</span>'
          : '<span style="text-transform:none;letter-spacing:0;color:var(--txt-3)">(calculada)</span>'}`,
        entrada('f3-previsao', 'date', r.previsao),
        r.previsao_manual
          ? 'O sistema parou de recalcular porque você digitou uma data. <button type="button" class="bt-mini" id="f3-recalcular">voltar a calcular</button>'
          : 'Sai sozinha do protocolo + prazo, pulando fim de semana e feriado. Digite por cima quando o combinado for outro.')
      : `<div class="dica" style="margin:0 0 14px">A previsão de recebimento abre quando a
         data do protocolo for preenchida — é dela que a conta sai.</div>`}
    ${campo('Observações', `<textarea class="inp" id="f3-obs" rows="3">${esc(r.observacoes || '')}</textarea>`)}
    <div class="dupla">
      ${campo('Recebido?', escolha('f3-recebido', [{ v: 'false', l: 'Não' }, { v: 'true', l: 'Sim' }], String(!!r.recebido)))}
      ${campo('Data do recebimento', entrada('f3-datarec', 'date', r.data_recebimento))}
    </div>
    ${blocoRecebimentos(p)}
  </div>`;
}

/* ==================================================================
   DISCRIMINAÇÃO DOS VALORES

   De que é feito este acordo: quanto é danos morais do cliente, quanto é
   honorário do escritório. É preenchida aqui, no ato do fechamento — não
   vem mais de fora. Sem ela não existe regra de comissão, e por isso o
   sistema não deixa fechar um acordo sem que alguém tenha decidido: ou
   discrimina, ou marca explicitamente como não discriminado.
   ================================================================== */
function blocoVerbas(v, valorAcordo) {
  const total = soma(v, x => x.valor_total);
  const falta = Math.round((valorAcordo - total) * 100) / 100;
  const fechado = rascunho.status === FECHADO;
  /* Só as verbas em uso. Uma que saiu de linha continua aparecendo onde já foi
     escolhida — senão a linha antiga trocaria de verba sozinha ao ser aberta. */
  const emUso = new Set(v.map(x => x.verba));
  const ops = (CFG_VERBA.length ? CFG_VERBA
    : [{ id: 'DM', nome: 'Danos morais', ativo: true },
       { id: 'HS', nome: 'Honorários', ativo: true },
       { id: 'TRABALHISTA', nome: 'Trabalhista', ativo: true },
       { id: 'OUTROS', nome: 'Outros', ativo: true }])
    .filter(o => o.ativo !== false || emUso.has(o.id));

  return `<div class="bloco" id="bloco-verbas">
    <h4>Discriminação dos valores${v.length ? ` — ${v.length}` : ''}
      ${fechado ? '<span style="color:var(--warn);letter-spacing:0;text-transform:none"> · obrigatória</span>' : ''}</h4>

    ${v.length ? `<table class="verbas-tb">
      <tr><th>Verba</th><th class="n">Valor</th><th>Detalhe</th><th></th></tr>
      ${v.map((x, i) => `<tr>
        <td><select class="inp" data-vb="verba" data-i="${i}">
          ${ops.map(o => opt(o.id, x.verba, o.nome)).join('')}</select></td>
        <td class="n"><input class="inp n" type="number" step="0.01" min="0"
          data-vb="valor_total" data-i="${i}" value="${x.valor_total || ''}"></td>
        <td><input class="inp" data-vb="detalhe" data-i="${i}"
          value="${esc(x.detalhe || '')}" placeholder="opcional"></td>
        <td><button type="button" class="rm" data-vb-remove="${i}" title="Remover">&times;</button></td>
      </tr>`).join('')}
      <tr class="tot"><td><b>Total discriminado</b></td>
        <td class="n"><b>${brl2(total)}</b></td><td colspan="2"></td></tr>
    </table>` : ''}

    <div class="acoes-verba">
      <button type="button" class="bt" id="vb-add">+ Adicionar verba</button>
    </div>

    ${v.length && falta ? `<div class="nota" style="margin:12px 0 0">
      ${falta > 0 ? `Faltam <b>${brl2(falta)}</b> para fechar com o valor do acordo.`
                  : `A discriminação passa <b>${brl2(-falta)}</b> do valor do acordo.`}
      A soma das verbas tem que dar exatamente o valor do acordo.</div>` : ''}
  </div>`;
}

/* Quando o dinheiro entra. Uma lista só: o que veio do ADVBox e o que o
   sistema previu, marcado como previsão para ninguém confundir com o realizado. */
/* Cada linha pode receber a baixa aqui mesmo. Era o que faltava para "lancar o
   pagamento no financeiro": marcar a tratativa inteira como recebida so serve
   quando tudo caiu de uma vez — em acordo parcelado, quem recebe e a parcela.
   Baixar a ultima parcela marca a tratativa sozinho, pela regra do banco. */
function blocoRecebimentos(p) {
  if (!p.length) return '';
  const rec = soma(p.filter(x => situacaoDe(x) === 'PAGO'), x => x.valor);
  const total = soma(p, x => x.valor);
  return `<div class="bloco"><h4>Recebimentos — ${p.length}</h4>
    <table class="parcelas-tb">${p.map(x => {
      const s = situacaoDe(x);
      return `<tr>
        <td>${x.parcela_rotulo ? `parcela ${esc(x.parcela_rotulo)}` : (x.verba ? esc(verba(x.verba).nome) : 'lançamento')}
          ${x.origem_registro === 'sistema' ? '<span class="dica" style="margin:0">previsão do sistema</span>' : ''}</td>
        <td class="mono" style="color:var(--txt-3)">${dtb(x.data_pagamento || x.vencimento)}</td>
        <td class="n">${brl2(x.valor)}</td>
        <td class="n" style="color:${CORSIT[s]}">${s}</td>
        <td class="n">${s === 'PAGO'
          ? `<button type="button" class="bt-mini" data-estornar="${x.id}"
               title="Desfazer a baixa deste lançamento">desfazer</button>`
          : `<button type="button" class="bt-mini baixar" data-baixar="${x.id}"
               title="Marcar este lançamento como recebido">dar baixa</button>`}</td>
      </tr>`;
    }).join('')}</table>
    <div class="dica">Recebido até aqui: <b>${brl2(rec)}</b> de ${brl2(total)}.${
      rec && rec < total ? ` Faltam <b>${brl2(total - rec)}</b>.` : ''}</div>
  </div>`;
}

/* A baixa vai direto ao banco e a tela relê a tratativa: e o banco que decide
   se ela passa a contar como recebida, e ler de volta e mais barato do que
   repetir aqui a regra de la. */
function ligaRecebimentos() {
  const mexe = async (id, pago) => {
    await mudar('acordo_recebimento', id, pago
      ? { situacao: 'PAGO', data_pagamento: ISO(HOJE) }
      : { situacao: 'A VENCER', data_pagamento: null });
    if (rascunho && rascunho.id) await releParcelas(rascunho.id);
    alerta(pago ? 'Recebimento baixado.' : 'Baixa desfeita.', 'ok');
  };
  document.querySelectorAll('[data-baixar]').forEach(b =>
    b.onclick = () => protege(() => mexe(+b.dataset.baixar, true)));
  document.querySelectorAll('[data-estornar]').forEach(b =>
    b.onclick = () => protege(() => mexe(+b.dataset.estornar, false)));
}

/* Mesma normalização que o banco usa em chave_nome(): a planilha antiga
   escreve "Ativos S.A" e o cadastro "ATIVOS S.A.", e sem isso os dois viram
   réus diferentes e os contatos não aparecem. */
const chaveNome = s => String(s || '').toUpperCase().normalize('NFD').replace(/[^A-Z0-9]/g, '');

/* Contatos do réu e do escritório, filtrados pela forma de contato escolhida:
   quem vai mandar e-mail não quer a lista de telefones no caminho. A lista
   completa dos dois canais fica na tela de Cadastros, a um clique daqui. */
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
  const querEmail = canal === 'E-MAIL';
  const de = (dono, tipo, rot) => dono
    ? CONTATOS.filter(c => c.dono_tipo === tipo && c.dono_id === dono.id
                        && (querEmail ? c.canal === 'E-MAIL' : c.canal !== 'E-MAIL'))
              .map(c => ({ ...c, de: rot })) : [];

  const todos = [...de(donoEsc, 'escritorio', 'escritório'), ...de(donoReu, 'parte', 'réu')];

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
    ${todos.length ? `
      ${todos.length > 1 ? `<div class="rot-grupo">
        <span>${querEmail ? 'E-mails' : 'Telefones'} — ${todos.length}</span><i class="traco"></i>
        <button type="button" class="copiar"
          data-copiar="${esc(todos.map(c => c.valor).join(querEmail ? ', ' : ' / '))}">copiar todos</button>
      </div>` : ''}
      ${todos.map(linha).join('')}`
      : `<div class="sem-contato">Nenhum contato de ${querEmail ? 'e-mail' : 'telefone'} cadastrado
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
      lerTudo('contato', 'id,dono_tipo,dono_id,canal,valor,rotulo')
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
    /* Primeiro o que é comum, depois o que é desta etapa: com o acordo já
       fechado os dois campos de valor existem ao mesmo tempo (um aqui, outro no
       faturamento escondido), e quem está digitando é quem tem que mandar. */
    coletaAcordo();
    Object.assign(r, {
      status: v('f2-status'), data_atualizacao: v('f2-atualizacao') || null,
      valor: numero(v('f2-valor')), observacoes: v('f2-obs') || null
    });
  } else {
    Object.assign(r, {
      recebido: v('f3-recebido') === 'true',
      data_recebimento: v('f3-datarec') || null,
      observacoes: v('f3-obs') || null
    });
    coletaAcordo();
  }
  talvezGuardeRascunho();
}

/* Os campos de dinheiro do acordo trocam de etapa conforme o status, e alguns
   nem aparecem — a previsão só existe depois do protocolo, a minuta só a partir
   de "Aguardando protocolo". Por isso a leitura é campo a campo, e só do que
   está na tela: ler um campo ausente devolveria vazio e apagaria em silêncio um
   dado que a outra etapa tinha gravado. */
function coletaAcordo() {
  const r = rascunho;
  const pega = (id, chave, converte) => {
    const el = $(id);
    if (el) r[chave] = converte ? converte(el.value) : (el.value || null);
  };
  pega('f3-valor', 'valor', numero);
  pega('f3-minuta', 'data_minuta_assinada');
  pega('f3-protocolo', 'data_protocolo');
  pega('f3-forma', 'forma_pagamento');
  pega('f3-prazo', 'prazo_dias', numero);
  pega('f3-tipoprazo', 'tipo_prazo');
  if ($('f3-forma'))
    r.qtd_parcelas = $('f3-forma').value === 'parcelado'
      ? numero($('f3-parcelas') ? $('f3-parcelas').value : null) : null;

  if ($('f3-previsao')) {
    /* Manual e uma decisao de quem digitou, marcada no proprio campo (ver
       ligaForm). Deduzir por comparacao dava falso positivo: bastava o banco
       recalcular diferente para o sistema achar que alguem tinha digitado. */
    const digitada = $('f3-previsao').value || null;
    r.previsao = digitada;
    if (!r.previsao_manual) r.previsao = previsaoDoPrazo() || digitada;
  }
  if ($('bloco-verbas')) r.verbas = leVerbasDaTela();
}

/* O banco recusou por processo repetido. Busca a tratativa que existe — ela
   pode ter sido criada hoje por outra pessoa e nem estar na lista desta aba —
   e põe na tela com um clique para abrir. */
async function ofereceAExistente(processo) {
  const k = chaveProcesso(processo);
  const achadas = await ler('tratativa',
    `select=*&processo=ilike.*${encodeURIComponent(k.slice(0, 7))}*&limit=40`).catch(() => []);
  const t = (achadas || []).find(x => chaveProcesso(x.processo) === k)
         || jaExiste(processo, rascunho.id);
  if (t) {
    const i = TRAT.findIndex(x => x.id === t.id);
    if (i >= 0) TRAT[i] = t; else TRAT.push(t);
    marcaSincronia();
  }
  $('recado').innerHTML = `<div class="nota">
    <b>Nada foi gravado.</b> O processo ${esc(processo)} já tem tratativa no sistema —
    um processo tem uma tratativa só.
    ${t ? `<div class="dado" style="margin-top:8px">
        <span class="marcador"><i style="background:${fase(t.status).cor}"></i>${esc(fase(t.status).nome)}</span>
        · ${esc(t.autor || 'sem autor')} × ${esc(t.reu || '—')}
        · ${esc(t.operador || 'sem operador')}</div>
      <div class="acoes-conflito">
        <button type="button" class="bt p" id="cf-abrir">Abrir a que existe</button>
      </div>`
    : ' Recarregue a tela para encontrá-la.'}
  </div>`;
  if (t) $('cf-abrir').onclick = () => { esqueceRascunho(); abreForm(t); desenha(); };
}

/* Enquanto a tratativa nova não existe no banco, cada passada pelo formulário
   deixa uma cópia neste navegador. Fechar sem querer, F5, queda de energia:
   o trabalho volta. Some quando a tratativa é salva ou quando a pessoa
   clica em Cancelar — aí ela desistiu de propósito. */
function talvezGuardeRascunho() {
  if (rascunho && !rascunho.id && String(rascunho.processo || '').trim())
    guardaRascunho(rascunho);
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
  $('cancelar').onclick = () => { esqueceRascunho(); fechaGaveta(); };
  $('salvar').onclick = () => protege(salvar);

  ['f-canal', 'f-reu', 'f-escritorio'].forEach(id => {
    const el = $(id); if (el) el.onchange = pintaContatos;
  });
  const proc = $('f-processo');
  if (proc) { proc.oninput = avisaDuplicado; proc.onchange = avisaDuplicado; avisaDuplicado(); }
  // Mudar o status troca os campos que a etapa mostra: redesenha.
  const st2 = $('f2-status');
  if (st2) st2.onchange = () => { coleta(); pintaForm(); };
  const fp = $('f3-forma');
  if (fp) fp.onchange = () => { coleta(); pintaForm(); };
  // O valor é o total que a discriminação tem que fechar: mudou, o bloco refaz a conta.
  const vl = $('f2-valor');
  if (vl) vl.onchange = () => { coleta(); pintaForm(); };

  ligaPrevisao();
  ligaVerbas();
  ligaRecebimentos();
  pintaContatos();
}

/* A previsão sai dos três campos que a definem: protocolo, prazo e tipo de
   prazo. Mexeu em qualquer um, ela se refaz na hora — sem salvar, sem esperar
   o banco. Quem digitar uma data por cima manda: o sistema para de recalcular
   e diz isso na tela, com um botão para voltar atrás. */
function previsaoDoPrazo() {
  const v = id => { const el = $(id); return el ? el.value : ''; };
  return calculaPrevisao(v('f3-protocolo'), v('f3-prazo'), v('f3-tipoprazo'),
                         rascunho.estado);
}

function ligaPrevisao() {
  const campoPrev = $('f3-previsao');
  const prot = $('f3-protocolo');
  /* A previsão só existe depois do protocolo — é dele que a conta sai. Então
     ganhar ou perder essa data muda quais campos a etapa tem, e nos dois
     sentidos: preencher abre a previsão, apagar a fecha. */
  if (!campoPrev) {
    if (prot) prot.onchange = () => { if (prot.value) { coleta(); pintaForm(); } };
    return;
  }

  const recalcula = () => {
    if (rascunho.previsao_manual) return;
    const d = previsaoDoPrazo();
    campoPrev.value = d || '';
    rascunho.previsao = d || null;
  };
  ['f3-protocolo', 'f3-prazo', 'f3-tipoprazo'].forEach(id => {
    const el = $(id);
    if (el) {
      el.oninput = recalcula;
      // Apagou o protocolo: a previsão deixa de existir, então redesenha.
      el.onchange = () => {
        if (prot && !prot.value) { coleta(); pintaForm(); return; }
        recalcula();
      };
    }
  });

  // Digitou por cima: a partir daqui a data é dela.
  campoPrev.onchange = () => {
    const calculada = previsaoDoPrazo();
    const digitada = campoPrev.value || null;
    rascunho.previsao = digitada;
    rascunho.previsao_manual = !!(digitada && digitada !== calculada);
    coleta(); pintaForm();
  };

  const voltar = $('f3-recalcular');
  if (voltar) voltar.onclick = () => {
    rascunho.previsao_manual = false;
    coleta(); pintaForm();
  };

  // Abriu sem previsão mas com os dados para calculá-la: calcula.
  if (!rascunho.previsao_manual && !campoPrev.value) recalcula();
}

/* ---------- discriminação dos valores ---------- */
function leVerbasDaTela() {
  const linhas = rascunho.verbas ? rascunho.verbas.map(x => ({ ...x })) : [];
  document.querySelectorAll('[data-vb]').forEach(el => {
    const i = +el.dataset.i;
    if (!linhas[i]) return;
    linhas[i][el.dataset.vb] = el.dataset.vb === 'valor_total'
      ? (numero(el.value) || 0) : el.value;
  });
  return linhas;
}

function ligaVerbas() {
  if (!$('bloco-verbas')) return;
  const refaz = () => { rascunho.verbas = leVerbasDaTela(); coleta(); pintaForm(); };

  document.querySelectorAll('[data-vb]').forEach(el => {
    el.onchange = refaz;
  });
  document.querySelectorAll('[data-vb-remove]').forEach(b => b.onclick = () => {
    const l = leVerbasDaTela();
    l.splice(+b.dataset.vbRemove, 1);
    rascunho.verbas = l; coleta(); pintaForm();
  });
  const add = $('vb-add');
  if (add) add.onclick = () => {
    const l = leVerbasDaTela();
    // O que sobra do valor do acordo já entra sugerido: é quase sempre o certo.
    const falta = Math.round(((+rascunho.valor || 0) - soma(l, x => x.valor_total)) * 100) / 100;
    l.push({ verba: (CFG_VERBA[0] || {}).id || 'DM', detalhe: '',
             valor_total: falta > 0 ? falta : 0 });
    rascunho.verbas = l; coleta(); pintaForm();
  };
}

/* Um processo, uma tratativa. Enquanto a pessoa digita, o sistema já mostra o
   lançamento que existe com um botão para abrir — é mais útil avisar na hora
   do que deixar preencher a tela inteira para recusar no fim. A comparação é
   só por dígito: 5001234-56.2026.8.26.0100 e 500123456202682601 00 são o
   mesmo processo, e foi exatamente assim que nasceram os duplicados antigos. */
function avisaDuplicado() {
  const cx = $('aviso-duplicado');
  if (!cx) return null;
  const el = $('f-processo');
  const t = jaExiste(el ? el.value : rascunho.processo, rascunho.id);
  if (!t) { cx.innerHTML = ''; return null; }
  const f = fase(t.status);
  cx.innerHTML = `<div class="ja-existe">
    <div class="tit">Este processo já está no sistema</div>
    <div class="dado"><span class="marcador"><i style="background:${f.cor}"></i>${
      esc(f.nome)}</span> · ${esc(t.autor || 'sem autor')} × ${esc(t.reu || '—')}
      · ${esc(t.operador || 'sem operador')} · 1ª tentativa ${dtb(t.data)}</div>
    <button type="button" class="bt" id="abrir-existente">Abrir esta tratativa</button>
  </div>`;
  $('abrir-existente').onclick = () => { esqueceRascunho(); abreForm(t); };
  return t;
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
  const igual = jaExiste(rascunho.processo, rascunho.id);
  if (igual) {
    etapa = 1; pintaForm();
    // alerta() já escapa o texto: escapar aqui de novo viraria "&amp;" na tela.
    alerta(`O processo ${igual.processo} já tem tratativa no sistema (${
      igual.autor || 'sem autor'} × ${igual.reu || '—'}). Abra a que existe `
      + 'e edite ali — duplicar o mesmo processo não é permitido.', 'erro');
    return false;
  }
  return true;
}

/* Acordo fechado sem discriminação não entra. Não é rigor por rigor: é dela
   que sai a comissão, e um campo em branco hoje vira uma conta impossível
   depois. Quem fechou sem separar as verbas tem a opção de dizer isso — o que
   o sistema não aceita é ninguém ter decidido. */
function validaDiscriminacao() {
  const r = rascunho;
  if (r.status !== FECHADO) return true;
  const v = r.verbas || [];
  const valor = +r.valor || 0;
  if (!valor) return true;
  if (!v.length) {
    etapa = 3;
    alerta('Acordo fechado precisa da discriminação dos valores. Abra o Faturamento '
         + 'e separe as verbas.', 'erro');
    pintaForm();
    return false;
  }
  const semValor = v.filter(x => !(+x.valor_total));
  if (semValor.length) {
    etapa = 3;
    alerta('Há verba sem valor na discriminação. Preencha ou remova a linha.', 'erro');
    pintaForm();
    return false;
  }
  const dif = Math.round((valor - soma(v, x => x.valor_total)) * 100) / 100;
  if (Math.abs(dif) >= 0.01) {
    etapa = 3;
    alerta(`A discriminação soma ${brl2(soma(v, x => x.valor_total))} e o acordo é de `
         + `${brl2(valor)}. ${dif > 0 ? 'Faltam ' + brl2(dif) : 'Sobram ' + brl2(-dif)}.`, 'erro');
    pintaForm();
    return false;
  }
  return true;
}

async function salvar() {
  coleta();
  if (!validaIdentificacao()) return;
  if (!validaDiscriminacao()) return;
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
  if (!r.id) {
    dados.origem_registro = 'sistema';
    // Chave própria da tratativa nova: se a conexão cair depois de a gravação
    // ter chegado, a repetição esbarra no índice único em vez de criar uma
    // segunda tratativa. É o que torna seguro tentar de novo.
    dados.chave_cliente = r.chave_cliente || (r.chave_cliente = ANDON_REDE.chaveNova());
  }

  /* Grava e, aconteça o que acontecer, só segue com a linha gravada na mão.

     Aqui estava o bug que fez uma tratativa sumir depois de dizer "salva": o
     aviso de sucesso vinha no fim da função, sem ninguém ter conferido se a
     resposta trouxe a linha. Resposta vazia — por qualquer motivo — passava
     por gravação boa, e o rascunho de resgate era apagado junto. A pessoa via
     "Tratativa salva.", a tratativa não existia, e não sobrava nem o rascunho.

     Agora sucesso é uma linha, não a ausência de erro. E quando a resposta não
     traz linha, o sistema PERGUNTA ao servidor se ela existe: para tratativa
     nova, pela chave própria que foi junto na gravação; para edição, pelo id.
     É para isso que a chave existe — e ela vale para qualquer falha, não só
     para as que o erro do banco descrevia com as palavras certas. */
  let salvo = null, falha = null;
  try {
    salvo = r.id ? await mudar('tratativa', r.id, dados) : await criar('tratativa', dados);
  } catch (e) { falha = e; }

  let gravada = (salvo && salvo[0]) || null;
  if (!gravada) gravada = await confereGravacao(r, dados);

  if (!gravada) {
    guardaRascunho(dados);
    /* Processo que já existe e não é nosso: em vez de um beco sem saída, o
       registro que existe aparece na hora com um botão para abrir. Só chega
       aqui depois de a conferência acima ter descartado a hipótese de a
       gravação ser nossa e ter dado certo. */
    if (falha && falha.processoRepetido) { await ofereceAExistente(dados.processo); return; }
    const e = falha || new Error('A gravação não chegou ao sistema. Tente de novo.');
    // Diante de um erro de gravação, a primeira dúvida é "perdi o que
    // digitei?". A resposta vem junto com o erro, não depois.
    e.message += ' Nada do que você preencheu foi perdido — está tudo aqui na '
               + 'tela, e também guardado neste computador.';
    throw e;
  }

  const id = gravada.id;
  esqueceRascunho();

  /* A gravação terminou. Daqui para baixo é atualização de tela — e ela não
     pode transformar um salvamento que deu certo em erro vermelho. Era o que
     acontecia: a releitura do banco inteiro (nove chamadas, mais de um mega)
     falhava numa piscada de rede e a operadora via "Failed to fetch" sobre uma
     tratativa que estava salva. */
  const i = TRAT.findIndex(t => t.id === gravada.id);
  if (i >= 0) TRAT[i] = gravada; else TRAT.push(gravada);
  rascunho = { ...gravada };
  marcaSincronia();   // a nossa própria gravação já está vista
  pintaForm();        // redesenha a gaveta, e com ela o espaço do recado
  desenha();

  alerta('Tratativa salva.', 'ok');
  // A discriminação vai depois da tratativa porque precisa do id dela.
  // Falhar aqui não desfaz o salvamento — mas precisa ser dito.
  try { await gravaVerbas(id, r.verbas || []); }
  catch (e) { alerta('Tratativa salva, mas a discriminação não subiu: '
                   + (e.message || e) + ' Clique em Salvar de novo.', 'erro'); }
  releParcelas(id).catch(() => { });
}

/* A resposta não trouxe a linha. Antes de dizer qualquer coisa a quem digitou,
   pergunta ao servidor se a gravação existe — pela chave própria quando é
   tratativa nova, pelo id quando é edição.

   É o que torna seguro repetir uma gravação: se a primeira tentativa chegou e
   só a resposta se perdeu, a linha está lá e isso é sucesso, não erro. Antes
   isso dependia de o texto do erro conter certas palavras, e bastou eu traduzir
   uma mensagem para português para a conferência parar de acontecer. */
async function confereGravacao(r, dados) {
  const q = r.id
    ? `select=*&id=eq.${r.id}&limit=1`
    : (dados.chave_cliente
        ? `select=*&chave_cliente=eq.${encodeURIComponent(dados.chave_cliente)}&limit=1`
        : null);
  if (!q) return null;
  const l = await ler('tratativa', q).catch(() => null);
  return (l && l[0]) || null;
}

/* A tela é a dona da discriminação: o que está aqui substitui o que havia.
   Meio-termo (mesclar linha a linha) deixaria sobra invisível de importação
   antiga, e a conta da comissão sairia errada sem ninguém ver. */
async function gravaVerbas(id, linhas) {
  const antes = verbasDe(id);
  const iguais = antes.length === linhas.length && antes.every((a, i) =>
    a.verba === linhas[i].verba &&
    (a.detalhe || '') === (linhas[i].detalhe || '') &&
    Math.abs((+a.valor_total || 0) - (+linhas[i].valor_total || 0)) < 0.005);
  if (iguais) return;

  if (antes.length) await api(`acordo_verba?tratativa_id=eq.${id}`, { method: 'DELETE' });
  let novas = [];
  if (linhas.length) {
    novas = await criar('acordo_verba', linhas.map(x => ({
      tratativa_id: id, id_acordo: rascunho.id_acordo || null,
      processo: rascunho.processo || null,
      verba: x.verba, detalhe: semVazio(x.detalhe),
      valor_total: +x.valor_total || 0,
      valor_pago: 0, valor_em_aberto: 0, qtd_lancamentos: 0,
      origem_registro: 'sistema'
    }))) || [];
  }
  VERBAS = VERBAS.filter(v => v.tratativa_id !== +id).concat(novas);
  desenha();
}

/* Relê só o que o banco pode ter mudado sozinho por causa deste salvamento:
   as parcelas e a própria linha (previsão calculada, campos normalizados). */
async function releParcelas(id) {
  const [linha, parcelas] = await Promise.all([
    ler('tratativa', `select=*&id=eq.${id}&limit=1`),
    ler('acordo_recebimento', `select=*&tratativa_id=eq.${id}&order=vencimento.asc`)
  ]);
  RECEB = RECEB.filter(p => p.tratativa_id !== +id).concat(parcelas || []);
  const nova = linha && linha[0];
  if (nova) {
    const i = TRAT.findIndex(t => t.id === nova.id);
    if (i >= 0) TRAT[i] = nova;
    if (rascunho && rascunho.id === nova.id) { rascunho = { ...nova }; pintaForm(); }
  }
  desenha();
}

/* ---------- resgate do que foi digitado ----------
   Salvamento que falha por rede deixa a gaveta aberta com tudo no lugar, mas
   um F5 ou um navegador fechado por engano levaria o trabalho junto. O
   rascunho fica guardado neste navegador até dar certo. */
const RASCUNHO = 'andon.tratativa_pendente';
function guardaRascunho(dados) {
  try { localStorage.setItem(RASCUNHO, JSON.stringify({ quando: Date.now(), dados })); }
  catch (e) { /* sem espaço: a gaveta aberta ainda tem tudo */ }
}
function esqueceRascunho() {
  try { localStorage.removeItem(RASCUNHO); } catch (e) { }
}
function rascunhoGuardado() {
  try { return JSON.parse(localStorage.getItem(RASCUNHO) || 'null'); } catch (e) { return null; }
}

/* Se sobrou um rascunho de um salvamento que não terminou, oferece de volta em
   vez de deixar a pessoa descobrir sozinha que perdeu o trabalho. */
function ofereceResgate() {
  const g = rascunhoGuardado();
  if (!g || !g.dados) return;
  const quando = new Date(g.quando || Date.now());
  const hora = String(quando.getHours()).padStart(2, '0') + ':'
             + String(quando.getMinutes()).padStart(2, '0');
  $('aviso').innerHTML = `<div class="nota" style="max-width:2100px;margin:16px auto 0;
    width:calc(100% - 40px);display:flex;gap:12px;align-items:center;flex-wrap:wrap">
    <span style="flex:1;min-width:240px">A tratativa que você começou às <b>${hora}</b>
      (${esc(g.dados.processo || 'sem número')}) não chegou a ser salva.
      Ela continua guardada neste computador.</span>
    <button class="bt p" id="resgatar">Abrir e salvar</button>
    <button class="bt" id="descartar">Descartar</button></div>`;
  $('resgatar').onclick = () => {
    $('aviso').innerHTML = '';
    abreForm({ ...vazio(), ...g.dados, id: undefined });
  };
  $('descartar').onclick = () => { esqueceRascunho(); $('aviso').innerHTML = ''; };
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

/* Quem está logado, em duas larguras. Em tela larga, o nome inteiro; em tela
   apertada, só as iniciais num círculo — que ocupam 90px a menos e continuam
   dizendo de quem é a sessão. Antes o nome simplesmente sumia abaixo de
   1200px, e a barra ficava sem dono. */
function pintaSessao() {
  const nome = (sessao && (sessao.nome || sessao.email)) || '';
  const iniciais = nome.split(/\s+/).filter(Boolean).slice(0, 2)
    .map(p => p[0]).join('').toUpperCase() || '?';
  $('sessao').innerHTML = `
    <span class="eu" title="${esc(nome)}">
      <i class="ini">${esc(iniciais)}</i><span class="quem">${esc(nome)}</span>
    </span>
    <button class="bt" id="sair">Sair</button>`;
  $('sair').onclick = () => SESSAO.sair();
}

const TELAS = [{ id: 'painel',     rotulo: 'Painel de Gestão' },
               { id: 'financeiro', rotulo: 'Financeiro' },
               { id: 'ranking',    rotulo: 'Ranking' },
               { id: 'kanban',     rotulo: 'Esteira' },
               { id: 'lista',      rotulo: 'Tratativas' }];

function desenha() {
  $('nav').innerHTML = TELAS.map(t =>
    `<button class="${t.id === aba ? 'on' : ''}" data-aba="${t.id}">${t.rotulo}</button>`).join('')
    + `<a class="nav-link" href="/cadastros">Cadastros</a>`
    + `<button class="bt p" id="nova" style="margin-left:10px">+ Nova tratativa</button>`;
  $('nova').onclick = () => abreForm(null);
  document.querySelectorAll('[data-aba]').forEach(b => b.onclick = () => { aba = b.dataset.aba; desenha(); });
  TELAS.forEach(t => $('t-' + t.id).classList.toggle('on', t.id === aba));

  const l = filtradas();
  // O ranking le o historico inteiro; deixar a barra de filtros por cima
  // dele faria a tela parecer filtrada quando nao esta.
  $('filtros').style.display = aba === 'ranking' ? 'none' : '';
  if (aba !== 'ranking') { pintaFiltros(); pintaResumo(l); }
  if (aba === 'painel') telaPainel(l);
  else if (aba === 'financeiro') telaFinanceiro(l);
  else if (aba === 'ranking') telaRanking();
  else if (aba === 'kanban') telaKanban(l);
  else telaLista(l);


  ligaAbrir();
}

/* Qualquer coisa com data-abrir abre a tratativa: linha de lista, card da
   esteira, lançamento do financeiro. Fica em função própria porque a lista se
   redesenha sozinha ao trocar a ordenação, e sem religar isso as linhas
   parariam de abrir — sem erro nenhum, só um clique que não faz nada. */
function ligaAbrir() {
  document.querySelectorAll('[data-abrir]').forEach(b => b.onclick = () =>
    abreForm(TRAT.find(t => t.id === +b.dataset.abrir)));
}

$('q').addEventListener('input', e => { busca = e.target.value; desenha(); });
$('fx').onclick = fechaGaveta;
$('veu').onclick = fechaGaveta;
document.addEventListener('keydown', e => { if (e.key === 'Escape') fechaGaveta(); });

/* Falhar ao carregar não pode ser um beco sem saída com texto em inglês:
   quase sempre é rede, e quase sempre a segunda tentativa passa. */
async function inicia() {
  $('t-painel').innerHTML = '<div class="carregando">Carregando…</div>';
  pintaSessao();
  try {
    await carrega();
    marcaSincronia();
    desenha();
    ofereceResgate();
    ligaSincronia();
    assinaturaDaTela().then(v => { VERSAO_TELA = v; });
  } catch (e) {
    $('t-painel').innerHTML = `<div class="vazio">
      Não consegui carregar as tratativas.<br><br>${esc(e.message)}<br><br>
      <button class="bt p" id="tentar-de-novo">Tentar de novo</button></div>`;
    $('tentar-de-novo').onclick = inicia;
  }
}
inicia();
