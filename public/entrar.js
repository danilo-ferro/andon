/* ==================================================================
   ANDON · tela de entrada
   ================================================================== */
const SB = {
  url: 'https://nkodijlsftdlzcmgjahk.supabase.co',
  key: 'sb_publishable_s6EH8fDfeVrBVJVz9i_E9A_QYcgkf88'
};

/* Quem entrou por último no navegador. Só o e-mail — senha nunca fica
   guardada aqui, nem no código: este repositório é público. Quem quiser o
   preenchimento completo manda o navegador salvar a senha. */
const ULTIMO = 'andon.ultimo_email';
const PADRAO = 'canaverdeadvogados8@gmail.com';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function recado(msg, tipo) {
  $('recado').innerHTML = msg
    ? `<div class="nota ${tipo === 'erro' ? '' : 'info'}">${esc(msg)}</div>` : '';
}

function destino(papeis) {
  const v = new URLSearchParams(location.search).get('volta') || '';
  // Só caminho interno: um "volta" apontando para fora viraria um jeito de
  // usar a nossa tela de login para levar alguém a outro site.
  const pedido = (/^\/[^/\\]/.test(v) || v === '/') ? v : '';
  // Quem não é gestor trabalha só em Acordos: o painel principal traz
  // Execução e Financeiro, que não são o trabalho dela.
  const gestor = (papeis || []).includes('gestor');
  if (!gestor) return (pedido === '/' || !pedido) ? '/acordos' : pedido;
  return pedido || '/';
}

/* Papéis vêm do cadastro de equipe, não do login: é lá que o gestor define
   quem é quem, e mudar um papel não pode exigir recriar conta.
   Usa o token recém-obtido, não a chave pública: a base só responde a quem
   está autenticado. */
async function papeisDe(email, token) {
  try {
    const r = await fetch(
      `${SB.url}/rest/v1/pessoa?select=nome,papeis&email=eq.${encodeURIComponent(email)}&limit=1`,
      { headers: { apikey: SB.key, Authorization: 'Bearer ' + token } });
    const l = r.ok ? await r.json() : [];
    return l[0] || {};
  } catch { return {}; }
}

async function auth(caminho, corpo, token) {
  const h = { apikey: SB.key, 'Content-Type': 'application/json' };
  if (token) h.Authorization = 'Bearer ' + token;
  const r = await fetch(`${SB.url}/auth/v1/${caminho}`, {
    method: 'POST', headers: h, body: JSON.stringify(corpo)
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const bruto = d.msg || d.error_description || d.message || `erro ${r.status}`;
    throw new Error(/invalid login credentials/i.test(bruto)
      ? 'E-mail ou senha não conferem.'
      : /email not confirmed/i.test(bruto)
        ? 'Esta conta ainda não foi confirmada. Me avise que eu libero.'
        : bruto);
  }
  return d;
}

$('email').value = localStorage.getItem(ULTIMO) || PADRAO;
if ($('email').value) $('senha').focus();

$('ver').onclick = () => {
  const c = $('senha');
  const escondida = c.type === 'password';
  c.type = escondida ? 'text' : 'password';
  $('ver').textContent = escondida ? 'ocultar' : 'ver';
  c.focus();
};

$('form').onsubmit = async e => {
  e.preventDefault();
  const bt = $('entrar');
  bt.disabled = true; bt.textContent = 'Entrando…'; recado('');
  try {
    const email = $('email').value.trim();
    const d = await auth('token?grant_type=password', { email, password: $('senha').value });
    localStorage.setItem(ULTIMO, email);
    const pessoa = await papeisDe(email, d.access_token);
    window.ANDON_SESSAO.gravar({
      access_token: d.access_token,
      refresh_token: d.refresh_token,
      expires_at: Math.floor(Date.now() / 1000) + (d.expires_in || 3600),
      email: (d.user && d.user.email) || email,
      nome: pessoa.nome
            || (d.user && d.user.user_metadata && d.user.user_metadata.nome) || null,
      papeis: pessoa.papeis || [],
      url: SB.url, key: SB.key
    });
    location.replace(destino(pessoa.papeis));
  } catch (err) {
    recado(err.message || String(err), 'erro');
    bt.disabled = false; bt.textContent = 'Entrar';
    $('senha').select();
  }
};

/* Troca de senha sem sair da tela: quem recebeu senha provisória troca aqui
   mesmo, sem depender de e-mail chegar — o que costuma travar o primeiro
   acesso da equipe. */
$('trocar').onclick = () => {
  const jaAberto = $('bloco-troca');
  if (jaAberto) return jaAberto.remove();
  const bloco = document.createElement('div');
  bloco.id = 'bloco-troca';
  bloco.style.marginTop = '16px';
  bloco.innerHTML = `
    <div class="nota info" style="margin-bottom:14px">
      Confirme a senha atual e escolha a nova. Vale imediatamente.
    </div>
    <div class="campo"><label>Senha atual</label>
      <input class="inp" id="t-atual" type="password" autocomplete="current-password"></div>
    <div class="campo"><label>Nova senha</label>
      <input class="inp" id="t-nova" type="password" autocomplete="new-password"></div>
    <button class="bt p entrar-bt" id="t-ok" type="button">Trocar senha</button>`;
  $('form').after(bloco);

  $('t-ok').onclick = async () => {
    const bt = $('t-ok');
    bt.disabled = true; bt.textContent = 'Trocando…'; recado('');
    try {
      const email = $('email').value.trim();
      const nova = $('t-nova').value;
      if (nova.length < 8) throw new Error('A nova senha precisa ter ao menos 8 caracteres.');
      const s = await auth('token?grant_type=password',
        { email, password: $('t-atual').value });
      const r = await fetch(`${SB.url}/auth/v1/user`, {
        method: 'PUT',
        headers: { apikey: SB.key, 'Content-Type': 'application/json',
                   Authorization: 'Bearer ' + s.access_token },
        body: JSON.stringify({ password: nova })
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.msg || d.message || `erro ${r.status}`);
      bloco.remove();
      $('senha').value = '';
      recado('Senha trocada. Entre com a nova.', 'info');
    } catch (err) {
      recado(err.message || String(err), 'erro');
      bt.disabled = false; bt.textContent = 'Trocar senha';
    }
  };
};
