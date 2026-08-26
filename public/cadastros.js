/* ==================================================================
   ANDON · Cadastros — Equipe, Réus e Escritórios
   Alimenta o bloco "Contatos para esta tratativa": ao escolher réu,
   escritório e forma de contato, o formulário mostra o que está aqui.
   ================================================================== */
const SB = {
  url: 'https://nkodijlsftdlzcmgjahk.supabase.co',
  key: 'sb_publishable_s6EH8fDfeVrBVJVz9i_E9A_QYcgkf88'
};

const esc = s => String(s ?? '').replace(/[&<>"]/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const $ = id => document.getElementById(id);

/* ---------- sessão ----------
   A leitura funciona com a chave pública. A escrita exige sessão: sem ela
   o banco recusa, e é isso que impede alguém de fora apagar a base. */
const SESSAO = window.ANDON_SESSAO;
let sessao = SESSAO.ler();
const logado = () => !!(sessao && sessao.access_token);

function cabecalhos(token, extra) {
  const h = { apikey: SB.key, 'Content-Type': 'application/json', ...(extra || {}) };
  h.Authorization = 'Bearer ' + (token || SB.key);
  return h;
}

/* Pede o token antes de cada chamada: é assim que a renovação acontece sozinha
   e ninguém é derrubado por deixar a tela aberta. A segunda tentativa cobre o
   token que vence entre pedir e chegar — recusada não mexeu no banco. */
async function api(caminho, opcoes, jaRenovou) {
  const t = await SESSAO.token().catch(() => null);
  const r = await ANDON_REDE.buscar(`${SB.url}/rest/v1/${caminho}`, {
    ...opcoes, headers: cabecalhos(t, opcoes && opcoes.headers)
  });
  if ((r.status === 401 || r.status === 403) && !jaRenovou) {
    const novo = await SESSAO.renovar().catch(() => null);
    if (novo) return api(caminho, opcoes, true);
  }
  if (r.status === 401 || r.status === 403) {
    throw new Error(logado()
      ? 'Sua sessão expirou. Entre de novo para salvar.'
      : 'Sessão não encontrada. Recarregue a página para entrar de novo.');
  }
  if (!r.ok) throw new Error((await r.text()).slice(0, 200) || `erro ${r.status}`);
  return r.status === 204 ? null : r.json();
}

const ler    = (t, q)   => api(`${t}?${q || 'select=*'}`);
const criar  = (t, o)   => api(t, { method: 'POST',  body: JSON.stringify(o), headers: { Prefer: 'return=representation' } });
const mudar  = (t, id, o) => api(`${t}?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify(o), headers: { Prefer: 'return=representation' } });
const apagar = (t, id)  => api(`${t}?id=eq.${id}`, { method: 'DELETE' });

async function autenticar(caminho, corpo) {
  const r = await fetch(`${SB.url}/auth/v1/${caminho}`, {
    method: 'POST',
    headers: { apikey: SB.key, 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo)
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.msg || d.error_description || d.message || `erro ${r.status}`);
  return d;
}

/* ---------- estado ---------- */
let PESSOAS = [], REUS = [], ESCRITORIOS = [], CONTATOS = [];
let aba = '', busca = '';   // definida abaixo, depois de saber os papeis

/* Equipe é onde se define quem é gestor. Deixar isso à mão de qualquer
   operador seria dar a ele o próprio acesso ao painel do escritório. */
const ehGestor = () => ((sessao && sessao.papeis) || []).includes('gestor');
const TELAS = [
  { id: 'equipe',      rotulo: 'Equipe', soGestor: true },
  { id: 'reus',        rotulo: 'Réus' },
  { id: 'escritorios', rotulo: 'Escritórios' }
].filter(t => !t.soGestor || ehGestor());
aba = TELAS[0].id;

/* Chegada por link vindo da tela de tratativa:
   /cadastros?aba=reus&id=12   abre o cadastro daquele réu
   /cadastros?aba=reus&nome=X  abre o formulário de novo réu já com o nome
   Sem isso a operadora teria que achar o registro na lista à mão, com a
   tratativa aberta em outra aba esperando. */
const PARAM = new URLSearchParams(location.search);
const PEDIDO = {
  aba:  PARAM.get('aba') || '',
  id:   +PARAM.get('id') || 0,
  nome: PARAM.get('nome') || ''
};
if (TELAS.some(t => t.id === PEDIDO.aba)) aba = PEDIDO.aba;

/* Voltar é voltar para onde a pessoa estava, e não para um lugar fixo: quem
   veio de Acordos volta para Acordos. Só quando não dá para saber de onde ela
   veio — link colado, favorito, aba nova — é que vale o padrão do papel dela;
   mandar a operadora para o painel do escritório seria jogá-la numa tela que
   ela nem pode abrir. */
const NOME_TELA = { '/': 'Painel', '/index.html': 'Painel',
                    '/acordos': 'Acordos', '/acordos.html': 'Acordos' };

function VOLTA() {
  let veio = '';
  try {
    const u = new URL(document.referrer || '');
    if (u.origin === location.origin) veio = u.pathname + u.search;
  } catch (e) { /* sem referrer: segue para o padrão */ }
  // Voltar para o próprio Cadastros seria ficar parado no mesmo lugar.
  if (/^\/cadastros/.test(veio)) veio = '';
  const url = veio || (ehGestor() ? '/' : '/acordos');
  return { url, rotulo: NOME_TELA[url.split('?')[0]] || '', daPagina: !!veio };
}

/* Aviso para as outras abas: a tratativa aberta em outra aba recarrega os
   contatos sozinha. O valor muda sempre para o evento disparar de novo. */
let ping = 0;
function avisaOutrasAbas() {
  try { localStorage.setItem('andon.cadastro_mudou', Date.now() + '.' + (++ping)); }
  catch (e) { /* navegador sem localStorage: só não avisa */ }
}

async function carrega() {
  const [p, r, e, c] = await Promise.all([
    ler('pessoa', 'select=*&order=ativo.desc,nome.asc'),
    ler('parte_adversa', 'select=*&order=nome.asc'),
    ler('escritorio_adverso', 'select=*&order=nome.asc'),
    ler('contato', 'select=*&order=canal.asc,valor.asc')
  ]);
  PESSOAS = p; REUS = r; ESCRITORIOS = e; CONTATOS = c;
}

const contatosDe = (tipo, id) => CONTATOS.filter(c => c.dono_tipo === tipo && c.dono_id === id);
const casa = (txt) => !busca || String(txt || '').toLowerCase().includes(busca.toLowerCase());

/* ==================================================================
   EQUIPE
   ================================================================== */
const PAPEIS = [
  { id: 'advogado',   rotulo: 'Advogado',  classe: 'adv' },
  { id: 'operador',   rotulo: 'Operador',  classe: 'ope' },
  { id: 'gestor',     rotulo: 'Gestor',    classe: 'ges' },
  { id: 'financeiro', rotulo: 'Financeiro', classe: 'ope' }
];
const papelClasse = p => (PAPEIS.find(x => x.id === p) || {}).classe || '';
const papelRotulo = p => (PAPEIS.find(x => x.id === p) || {}).rotulo || p;

function telaEquipe() {
  const l = PESSOAS.filter(p => casa(p.nome) || casa(p.email) || (p.apelidos || []).some(casa));
  const ativos = l.filter(p => p.ativo), inativos = l.filter(p => !p.ativo);

  const cartao = p => `
    <article class="reg ${p.ativo ? '' : 'off'}" data-editar="pessoa" data-id="${p.id}">
      <div class="corpo">
        <div class="nome">${esc(p.nome)}</div>
        <div class="meta">
          ${(p.papeis || []).map(x => `<span class="pilula ${papelClasse(x)}">${papelRotulo(x)}</span>`).join('')}
          ${p.ativo ? '' : '<span class="pilula off">inativo</span>'}
          ${p.email ? `<span>${esc(p.email)}</span>` : '<span>sem e-mail</span>'}
        </div>
      </div>
    </article>`;

  $('t-equipe').innerHTML = `
    <div class="cab">
      <div class="olho">Cadastro · ${PESSOAS.length} pessoas</div>
      <h1>Equipe</h1>
      <p>Advogados, operadores e gestores. Quem sai do escritório vira <b>inativo</b> em vez de
         ser apagado: some dos seletores, mas os filtros do histórico continuam achando o
         trabalho dele.</p>
    </div>
    <div class="barra-acao">
      <button class="bt p" data-novo="pessoa">+ Nova pessoa</button>
      <span class="conta">${ativos.length} ativos · ${inativos.length} inativos</span>
    </div>
    ${l.length ? `<div class="lista">${ativos.map(cartao).join('')}</div>
      ${inativos.length ? `<h3 style="margin:26px 0 12px;font-size:11px;letter-spacing:.16em;
        text-transform:uppercase;color:var(--txt-3);font-family:'JetBrains Mono',monospace">
        Inativos</h3><div class="lista">${inativos.map(cartao).join('')}</div>` : ''}`
      : '<div class="vazio">Nenhuma pessoa encontrada para esta busca.</div>'}`;
}

function formPessoa(p) {
  p = p || { nome: '', email: '', papeis: [], apelidos: [], ativo: true, observacoes: '' };
  abreGaveta(p.id ? 'Editar pessoa' : 'Nova pessoa', `
    <div class="campo">
      <label>Nome completo</label>
      <input class="inp" id="f-nome" value="${esc(p.nome)}" placeholder="ex.: Mariah Aguiar">
    </div>
    <div class="campo">
      <label>E-mail</label>
      <input class="inp" id="f-email" type="email" value="${esc(p.email || '')}"
             placeholder="usado depois para o login">
    </div>
    <div class="campo">
      <label>Papéis</label>
      <div class="marca-linha">
        ${PAPEIS.map(x => `<label><input type="checkbox" class="f-papel" value="${x.id}"
          ${(p.papeis || []).includes(x.id) ? 'checked' : ''}> ${x.rotulo}</label>`).join('')}
      </div>
    </div>
    <div class="campo">
      <label>Apelidos no histórico</label>
      <input class="inp" id="f-apelidos" value="${esc((p.apelidos || []).join(', '))}"
             placeholder="MAX, Dr. Max">
      <div class="dica">Separe por vírgula. As planilhas antigas guardam o nome curto e
        maiúsculo. Sem o apelido, filtrar por <b>Max Canaverde</b> não acharia as 695
        tratativas gravadas como <b>MAX</b>.</div>
    </div>
    <div class="campo">
      <label>Situação</label>
      <div class="marca-linha">
        <label><input type="checkbox" id="f-ativo" ${p.ativo ? 'checked' : ''}> Ativo</label>
      </div>
      <div class="dica">Desmarcar tira a pessoa dos seletores sem apagar o histórico dela.</div>
    </div>
    <div class="campo">
      <label>Observações</label>
      <textarea class="inp" id="f-obs" rows="3">${esc(p.observacoes || '')}</textarea>
    </div>
    <div class="acoes-form">
      <button class="bt p" id="f-salvar">Salvar</button>
      <button class="bt" id="f-cancelar">Cancelar</button>
      ${p.id ? '<button class="bt perigo" id="f-apagar">Apagar</button>' : ''}
    </div>`);

  $('f-salvar').onclick = () => protege(async () => {
    const nome = $('f-nome').value.trim();
    if (!nome) return alerta('O nome é obrigatório.', 'erro');
    const dados = {
      nome,
      email: $('f-email').value.trim() || null,
      papeis: [...document.querySelectorAll('.f-papel:checked')].map(x => x.value),
      apelidos: $('f-apelidos').value.split(',').map(s => s.trim()).filter(Boolean),
      ativo: $('f-ativo').checked,
      observacoes: $('f-obs').value.trim() || null
    };
    p.id ? await mudar('pessoa', p.id, dados) : await criar('pessoa', dados);
    await recarrega(`${nome} salvo.`, 'ok');
  });

  $('f-cancelar').onclick = fechaGaveta;
  if (p.id) $('f-apagar').onclick = () => protege(async () => {
    if (!confirm(`Apagar ${p.nome}?\n\nSe esta pessoa tem histórico, prefira desmarcar "Ativo" — apagar pode deixar filtros antigos sem dono.`)) return;
    await apagar('pessoa', p.id);
    await recarrega(`${p.nome} apagado.`, 'ok');
  });
}

/* ==================================================================
   RÉUS e ESCRITÓRIOS — mesma tela, tabelas diferentes
   ================================================================== */
const CFG = {
  reus: {
    tabela: 'parte_adversa', dono: 'parte', lista: () => REUS,
    titulo: 'Réus', singular: 'réu',
    texto: 'As empresas do outro lado. Os contatos daqui aparecem na tela de tratativa quando o operador escolhe o réu e a forma de contato.'
  },
  escritorios: {
    tabela: 'escritorio_adverso', dono: 'escritorio', lista: () => ESCRITORIOS,
    titulo: 'Escritórios', singular: 'escritório',
    texto: 'Os escritórios que defendem os réus. Mesma lógica dos réus: o que estiver aqui aparece na hora da tratativa.'
  }
};

function telaParte(qual) {
  const c = CFG[qual];
  const l = c.lista().filter(x => casa(x.nome) ||
    contatosDe(c.dono, x.id).some(k => casa(k.valor)));
  const semContato = c.lista().filter(x => !contatosDe(c.dono, x.id).length).length;

  $('t-' + qual).innerHTML = `
    <div class="cab">
      <div class="olho">Cadastro · ${c.lista().length} ${c.titulo.toLowerCase()}</div>
      <h1>${c.titulo}</h1>
      <p>${c.texto}</p>
    </div>
    <div class="barra-acao">
      <button class="bt p" data-novo="${qual}">+ Novo ${c.singular}</button>
      <span class="conta">${semContato} ainda sem contato</span>
    </div>
    ${l.length ? `<div class="lista">${l.map(x => {
      const k = contatosDe(c.dono, x.id);
      const em = k.filter(y => y.canal === 'E-MAIL').length;
      const te = k.length - em;
      return `<article class="reg ${x.ativo === false ? 'off' : ''}
        ${PEDIDO.id === x.id && PEDIDO.aba === qual ? 'alvo' : ''}"
        data-editar="${qual}" data-id="${x.id}">
        <div class="corpo">
          <div class="nome">${esc(x.nome)}</div>
          <div class="meta">
            ${k.length ? `<span><b>${em}</b> e-mail${em === 1 ? '' : 's'}</span>
                          <span><b>${te}</b> telefone${te === 1 ? '' : 's'}</span>`
                       : '<span>sem contato cadastrado</span>'}
          </div>
        </div>
      </article>`;
    }).join('')}</div>` : `<div class="vazio">Nenhum ${c.singular} encontrado para esta busca.</div>`}`;
}

function formParte(qual, x) {
  const c = CFG[qual];
  // Sem id é cadastro novo, mesmo vindo com nome preenchido: é assim que o
  // link da tratativa abre um réu que ainda não existe, já com o nome dele.
  const novo = !x || !x.id;
  x = x || { nome: '', documento: '', observacoes: '', ativo: true };
  const k = novo ? [] : contatosDe(c.dono, x.id);

  abreGaveta(novo ? `Novo ${c.singular}` : esc(x.nome), `
    <div class="campo">
      <label>Nome</label>
      <input class="inp" id="f-nome" value="${esc(x.nome)}">
    </div>
    ${qual === 'reus' ? `<div class="campo">
      <label>CNPJ / CPF</label>
      <input class="inp" id="f-doc" value="${esc(x.documento || '')}">
    </div>` : ''}
    <div class="campo">
      <label>Observações</label>
      <textarea class="inp" id="f-obs" rows="2">${esc(x.observacoes || '')}</textarea>
    </div>
    <div class="acoes-form">
      <button class="bt p" id="f-salvar">Salvar</button>
      <button class="bt" id="f-cancelar">Cancelar</button>
      ${novo ? '' : '<button class="bt perigo" id="f-apagar">Apagar</button>'}
    </div>

    ${novo ? `<div class="dica" style="margin-top:18px">Salve primeiro para poder adicionar contatos.</div>` : `
    <div class="bloco" style="margin-top:22px">
      <h4>Contatos — ${k.length}</h4>
      <div id="lista-contatos">
        ${k.length ? k.map(y => `
          <div class="contato-linha">
            <span class="canal ${y.canal === 'E-MAIL' ? 'email' : 'tel'}">${y.canal === 'E-MAIL' ? 'E-MAIL' : 'TEL'}</span>
            <span class="valor">${esc(y.valor)}${y.rotulo ? ` <span class="rot">· ${esc(y.rotulo)}</span>` : ''}</span>
            <button class="rm" data-rmcontato="${y.id}" title="Remover">&times;</button>
          </div>`).join('')
        : '<div class="dica">Nenhum contato ainda. Adicione abaixo e ele passa a aparecer na tela de tratativa.</div>'}
      </div>
      <div class="novo-contato">
        <select class="inp" id="c-canal">
          <option value="E-MAIL">E-mail</option>
          <option value="TELEFONE">Telefone</option>
        </select>
        <input class="inp" id="c-valor" placeholder="e-mail ou telefone">
        <input class="inp" id="c-rotulo" placeholder="rótulo (opcional)">
        <button class="bt p" id="c-add">Adicionar</button>
      </div>
    </div>`}`);

  $('f-salvar').onclick = () => protege(async () => {
    const nome = $('f-nome').value.trim();
    if (!nome) return alerta('O nome é obrigatório.', 'erro');
    const dados = { nome, observacoes: $('f-obs').value.trim() || null };
    if (qual === 'reus') dados.documento = ($('f-doc').value || '').trim() || null;
    const salvo = x.id ? await mudar(c.tabela, x.id, dados) : await criar(c.tabela, dados);
    await recarrega(`${nome} salvo.`, 'ok');
    const id = x.id || (salvo && salvo[0] && salvo[0].id);
    if (id) formParte(qual, c.lista().find(y => y.id === id));
  });

  $('f-cancelar').onclick = fechaGaveta;

  if (!novo) {
    $('f-apagar').onclick = () => protege(async () => {
      if (!confirm(`Apagar ${x.nome} e os ${k.length} contatos dele?`)) return;
      await apagar(c.tabela, x.id);
      await recarrega(`${x.nome} apagado.`, 'ok');
    });

    $('c-add').onclick = () => protege(async () => {
      const valor = $('c-valor').value.trim();
      if (!valor) return alerta('Digite o e-mail ou telefone.', 'erro');
      const canal = $('c-canal').value;
      if (canal === 'E-MAIL' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(valor))
        return alerta('Esse e-mail não parece válido.', 'erro');
      await criar('contato', {
        dono_tipo: c.dono, dono_id: x.id, canal,
        valor: canal === 'E-MAIL' ? valor.toLowerCase() : valor,
        rotulo: $('c-rotulo').value.trim() || null,
        origem_registro: 'sistema'
      });
      await recarrega('Contato adicionado.', 'ok');
      formParte(qual, c.lista().find(y => y.id === x.id));
    });

    document.querySelectorAll('[data-rmcontato]').forEach(b => b.onclick = () => protege(async () => {
      await apagar('contato', b.dataset.rmcontato);
      await recarrega('Contato removido.', 'ok');
      formParte(qual, c.lista().find(y => y.id === x.id));
    }));
  }
}

/* ==================================================================
   GAVETA, AVISOS E SESSÃO
   ================================================================== */
function abreGaveta(titulo, html) {
  $('gavT').innerHTML = `<h3 style="font-size:16px">${titulo}</h3>`;
  $('gavC').innerHTML = `<div id="recado"></div>` + html;
  $('gav').classList.add('on');
  $('veu').classList.add('on');
}
function fechaGaveta() {
  $('gav').classList.remove('on');
  $('veu').classList.remove('on');
}

/* Mensagem aparece dentro da gaveta quando a gaveta esta aberta: o aviso no
   topo da pagina passa despercebido por quem esta olhando o formulario.
   Erro e instrucao nao somem sozinhos — so o "salvo com sucesso" some. */
function alerta(msg, tipo) {
  const html = `<div class="nota ${tipo === 'erro' ? '' : 'info'}">${esc(msg)}</div>`;
  const naGaveta = $('gav').classList.contains('on') && $('recado');
  if (naGaveta) { $('recado').innerHTML = html; return; }
  $('aviso').innerHTML = `<div class="nota ${tipo === 'erro' ? '' : 'info'}"
    style="max-width:2100px;margin:16px auto 0;width:calc(100% - 40px)">${esc(msg)}</div>`;
  if (tipo === 'ok') setTimeout(() => { $('aviso').innerHTML = ''; }, 4000);
}

/* Uma única porta para toda gravação: mostra o erro na tela em vez de
   morrer no console, que é onde ninguém olha. */
async function protege(fn) {
  try { await fn(); }
  catch (e) { alerta(e.message || String(e), 'erro'); }
}

async function recarrega(msg, tipo) {
  await carrega();
  desenha();
  avisaOutrasAbas();
  if (msg) alerta(msg, tipo || 'info');
}

function pintaSessao() {
  const nome = (sessao && (sessao.nome || sessao.email)) || 'conectado';
  const iniciais = nome.split(/\s+/).filter(Boolean).slice(0, 2)
    .map(x => x[0]).join('').toUpperCase() || '?';
  $('sessao').innerHTML = logado()
    ? `<span class="eu" title="${esc(nome)}">
         <i class="ini">${esc(iniciais)}</i><span class="quem">${esc(nome)}</span></span>
       <button class="bt" id="senha">Trocar senha</button>
       <button class="bt" id="sair">Sair</button>`
    : `<a class="bt p" href="/entrar">Entrar</a>`;

  if (logado()) {
    $('sair').onclick = () => SESSAO.sair();
    $('senha').onclick = formSenha;
  }
}

/* Quem recebeu senha provisoria troca por uma propria aqui. Usa a sessao
   aberta, entao nao depende de e-mail chegar — o que costuma travar equipe. */
function formSenha() {
  abreGaveta('Trocar senha', `
    <div class="nota info" style="margin-bottom:18px">
      A nova senha vale na hora. Se voce recebeu uma senha provisoria,
      troque agora — ela e conhecida por quem a distribuiu.
    </div>
    <div class="campo"><label>Nova senha</label>
      <input class="inp" id="s-nova" type="password" autocomplete="new-password"></div>
    <div class="campo"><label>Repita a nova senha</label>
      <input class="inp" id="s-rep" type="password" autocomplete="new-password">
      <div class="dica">Minimo de 8 caracteres.</div></div>
    <div class="acoes-form">
      <button class="bt p" id="s-salvar">Trocar</button>
      <button class="bt" id="s-cancelar">Cancelar</button>
    </div>`);

  $('s-salvar').onclick = () => protege(async () => {
    const nova = $('s-nova').value, rep = $('s-rep').value;
    if (nova.length < 8) return alerta('A senha precisa ter ao menos 8 caracteres.', 'erro');
    if (nova !== rep)    return alerta('As duas senhas nao sao iguais.', 'erro');
    const r = await fetch(`${SB.url}/auth/v1/user`, {
      method: 'PUT',
      headers: { apikey: SB.key, 'Content-Type': 'application/json',
                 Authorization: 'Bearer ' + await SESSAO.token() },
      body: JSON.stringify({ password: nova })
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.msg || d.message || `erro ${r.status}`);
    alerta('Senha trocada. Use a nova no proximo acesso.', 'ok');
    setTimeout(fechaGaveta, 1200);
  });
  $('s-cancelar').onclick = fechaGaveta;
}

function formLogin() {
  abreGaveta('Entrar', `
    <div class="nota info" style="margin-bottom:18px">
      A leitura desta tela é aberta. <b>Gravar exige login</b> — é o que impede
      que alguém de fora altere ou apague a base.
    </div>
    <div class="campo"><label>E-mail</label>
      <input class="inp" id="l-email" type="email" autocomplete="username"></div>
    <div class="campo"><label>Senha</label>
      <input class="inp" id="l-senha" type="password" autocomplete="current-password">
      <div class="dica">Mínimo de 6 caracteres. Ninguém além de você vê esta senha —
        nem eu, nem o administrador do sistema.</div></div>
    <div class="acoes-form">
      <button class="bt p" id="l-entrar">Entrar</button>
      <button class="bt" id="l-criar">Criar conta</button>
      <button class="bt" id="l-cancelar">Cancelar</button>
    </div>`);

  const credenciais = () => ({
    email: $('l-email').value.trim(),
    password: $('l-senha').value
  });

  const aplica = d => {
    if (!d.access_token) {
      alerta('Conta criada, mas ainda falta confirmar. Procure o e-mail do Supabase '
           + '(veja o spam), clique no link de confirmação e volte aqui para entrar. '
           + 'Se o e-mail não chegar, me avise que eu confirmo a conta por dentro.', 'info');
      return;
    }
    sessao = { access_token: d.access_token, refresh_token: d.refresh_token,
               email: (d.user && d.user.email) || $('l-email').value.trim() };
    SESSAO.gravar(sessao);
    fechaGaveta(); pintaSessao(); desenha();
    alerta('Conectado. Agora dá para gravar.', 'ok');
  };

  $('l-entrar').onclick = () => protege(async () =>
    aplica(await autenticar('token?grant_type=password', credenciais())));

  $('l-criar').onclick = () => protege(async () => {
    const c = credenciais();
    if (!c.email || c.password.length < 6)
      return alerta('Informe o e-mail e uma senha de ao menos 6 caracteres.', 'erro');
    aplica(await autenticar('signup', c));
  });

  $('l-cancelar').onclick = fechaGaveta;
}

/* ==================================================================
   ROTEADOR
   ================================================================== */
function desenha() {
  const v = VOLTA();
  $('nav').innerHTML =
    `<a class="nav-link voltar" id="voltar" href="${esc(v.url)}">&#8592; Voltar${
      v.rotulo ? ' para ' + v.rotulo : ''}</a>`
    + TELAS.map(t =>
      `<button class="${t.id === aba ? 'on' : ''}" data-aba="${t.id}">${t.rotulo}</button>`).join('');
  // Havendo histórico, volta por ele: a tela anterior reaparece como estava,
  // com filtro e rolagem no lugar. Aba nova não tem histórico e segue pelo href.
  $('voltar').onclick = ev => {
    if (!v.daPagina || history.length <= 1) return;
    ev.preventDefault(); history.back();
  };
  document.querySelectorAll('[data-aba]').forEach(b => b.onclick = () => {
    aba = b.dataset.aba; busca = ''; $('q').value = ''; desenha();
  });

  TELAS.forEach(t => $('t-' + t.id).classList.toggle('on', t.id === aba));

  if (aba === 'equipe') telaEquipe(); else telaParte(aba);


  document.querySelectorAll('[data-novo]').forEach(b => b.onclick = () => {
    const q = b.dataset.novo;
    q === 'pessoa' ? formPessoa(null) : formParte(q, null);
  });
  document.querySelectorAll('[data-editar]').forEach(b => b.onclick = () => {
    const q = b.dataset.editar, id = +b.dataset.id;
    if (q === 'pessoa') formPessoa(PESSOAS.find(p => p.id === id));
    else formParte(q, CFG[q].lista().find(x => x.id === id));
  });
}

$('q').addEventListener('input', e => { busca = e.target.value; desenha(); });
$('fx').onclick = fechaGaveta;
$('veu').onclick = fechaGaveta;
document.addEventListener('keydown', e => { if (e.key === 'Escape') fechaGaveta(); });

/* Abre direto o registro pedido pelo link da tratativa. */
function abreOPedido() {
  if (!PEDIDO.aba || !CFG[PEDIDO.aba]) return;
  const lista = CFG[PEDIDO.aba].lista();
  if (PEDIDO.id) {
    const achado = lista.find(x => x.id === PEDIDO.id);
    if (achado) return formParte(PEDIDO.aba, achado);
  }
  if (PEDIDO.nome) {
    const chave = s => String(s || '').toUpperCase().normalize('NFD').replace(/[^A-Z0-9]/g, '');
    const igual = lista.find(x => chave(x.nome) === chave(PEDIDO.nome));
    // Já existe com outra grafia: edita o que existe em vez de criar um duplicado.
    return formParte(PEDIDO.aba, igual || { nome: PEDIDO.nome, observacoes: '', ativo: true });
  }
}

async function inicia() {
  $('t-' + aba).innerHTML = '<div class="carregando">Carregando…</div>';
  pintaSessao();
  try {
    await carrega();
    desenha();
    abreOPedido();
    ligaAtualizacao();
  } catch (e) {
    $('t-' + aba).innerHTML = `<div class="vazio">
      Não consegui carregar os cadastros.<br><br>${esc(e.message)}<br><br>
      <button class="bt p" id="tentar-de-novo">Tentar de novo</button></div>`;
    $('tentar-de-novo').onclick = inicia;
  }
}
inicia();


/* ==================================================================
   A TELA SE ATUALIZA SOZINHA

   Réus, escritórios e contatos são curadoria de várias pessoas ao mesmo
   tempo. Sem isto, quem deixasse a aba aberta ficava com a lista do
   momento em que abriu — e cadastrava de novo o que outra pessoa já tinha
   cadastrado. A recarga é a mesma que a da abertura: aqui as listas são
   curtas, e buscar tudo é mais simples e mais seguro do que buscar
   pedaços e tentar juntar.

   Nunca recarrega com uma gaveta aberta: jogaria fora o que está sendo
   digitado. Volta a valer assim que ela fecha.
   ================================================================== */
var A_CADA = 30000;
var atualizando = false;

async function atualizaCadastros(avisar) {
  if (atualizando) return;
  var gav = $('gav');
  if (gav && gav.classList.contains('on')) return;   // tem gente digitando
  atualizando = true;
  var bt = $('atualizar');
  if (bt) bt.classList.add('girando');
  try {
    await carrega();
    desenha();
    if (avisar) alerta('Cadastros atualizados.', 'ok');
  } catch (e) {
    if (avisar) alerta('Não consegui atualizar agora: ' + (e.message || e), 'erro');
  } finally {
    atualizando = false;
    if (bt) bt.classList.remove('girando');
  }
}

function ligaAtualizacao() {
  var bt = $('atualizar');
  if (bt) bt.onclick = function () { atualizaCadastros(true); };
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') atualizaCadastros(false);
  });
  window.addEventListener('focus', function () { atualizaCadastros(false); });
  setInterval(function () { atualizaCadastros(false); }, A_CADA);
}
