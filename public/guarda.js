/* ==================================================================
   ANDON · guarda de sessão
   Carregado antes de tudo em cada página. Sem sessão válida, manda para
   a tela de login; nada do sistema chega a ser desenhado.

   Também renova o token: o Supabase expira o acesso em uma hora, e sem
   renovar a equipe seria derrubada no meio do expediente com um erro de
   permissão que não explica nada.
   ================================================================== */
(function () {
  var CHAVE = 'andon.sessao';
  var PUBLICA = ['/entrar', '/entrar.html'];

  function leSessao() {
    try { return JSON.parse(localStorage.getItem(CHAVE) || 'null'); } catch (e) { return null; }
  }
  function paraLogin() {
    var volta = location.pathname + location.search;
    location.replace('/entrar?volta=' + encodeURIComponent(volta));
  }

  window.ANDON_SESSAO = {
    chave: CHAVE,
    ler: leSessao,
    gravar: function (s) { localStorage.setItem(CHAVE, JSON.stringify(s)); },
    limpar: function () { localStorage.removeItem(CHAVE); },
    sair: function () { localStorage.removeItem(CHAVE); location.replace('/entrar'); }
  };

  if (PUBLICA.indexOf(location.pathname) !== -1) return;

  var s = leSessao();
  if (!s || !s.access_token) return paraLogin();

  // Sessao criada antes de os papeis existirem nao sabe quem e gestor.
  // Pedir login de novo e mais seguro que adivinhar: adivinhar para cima
  // daria o painel do escritorio a quem nao deve ter, e para baixo tiraria
  // o painel de quem deve.
  if (!Array.isArray(s.papeis)) return paraLogin();

  // O painel principal reune Execucao e Financeiro. Quem nao e gestor
  // trabalha so em Acordos e vai direto para la, sem passar por uma tela
  // cheia de numero que nao e da alcada dela.
  var gestor = (s.papeis || []).indexOf('gestor') !== -1;
  var raiz = location.pathname === '/' || location.pathname === '/index.html';
  if (!gestor && raiz) return location.replace('/acordos');

  window.ANDON_SESSAO.gestor = gestor;

  // Faltando menos de dois minutos para expirar, renova antes de a tela
  // começar a pedir dados — senão o primeiro carregamento já falha.
  var agora = Math.floor(Date.now() / 1000);
  if (s.expires_at && s.expires_at - agora < 120) {
    if (!s.refresh_token) return paraLogin();
    document.documentElement.style.visibility = 'hidden';
    fetch(s.url + '/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      headers: { apikey: s.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: s.refresh_token })
    })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
      .then(function (d) {
        s.access_token = d.access_token;
        s.refresh_token = d.refresh_token || s.refresh_token;
        s.expires_at = Math.floor(Date.now() / 1000) + (d.expires_in || 3600);
        localStorage.setItem(CHAVE, JSON.stringify(s));
        document.documentElement.style.visibility = '';
      })
      .catch(paraLogin);
  }
})();
