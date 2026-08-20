/* ==================================================================
   ANDON · guarda de sessão
   Carregado antes de tudo em cada página. Sem sessão válida, manda para
   a tela de login; nada do sistema chega a ser desenhado.

   O Supabase vence o token de acesso em uma hora. Isso é do desenho dele
   e não dá para desligar — o que dá para fazer, e é o que este arquivo
   faz, é renovar antes de vencer, sozinho, para sempre. A sessão só
   acaba quando alguém clica em Sair.

   Antes a renovação acontecia uma vez, na abertura da página, e só se
   faltassem menos de dois minutos. Quem deixava a tela aberta durante o
   expediente era derrubado no meio de uma tratativa com um "sua sessão
   expirou" que não explicava nada. Agora são quatro gatilhos:

     · um relógio que renova cinco minutos antes de vencer;
     · a volta para a aba, porque o relógio não corre com a máquina
       suspensa e o notebook fechado no almoço não dispara nada;
     · a volta da internet;
     · a própria chamada ao banco, que pede o token antes de sair e
       tenta de novo uma vez se ainda assim voltar recusada.
   ================================================================== */
(function () {
  var CHAVE = 'andon.sessao';
  var PUBLICA = ['/entrar', '/entrar.html'];
  var FOLGA = 300;   // renova com cinco minutos de sobra
  var PERTO = 60;    // menos que isto e o token nao serve para uma chamada nova

  function agora() { return Math.floor(Date.now() / 1000); }
  function leSessao() {
    try { return JSON.parse(localStorage.getItem(CHAVE) || 'null'); } catch (e) { return null; }
  }
  function gravaSessao(s) { localStorage.setItem(CHAVE, JSON.stringify(s)); }
  function paraLogin() {
    var volta = location.pathname + location.search;
    location.replace('/entrar?volta=' + encodeURIComponent(volta));
  }

  var renovando = null;   // promessa em voo, para duas telas não renovarem juntas
  var relogio = null;

  function renovar() {
    if (renovando) return renovando;
    var s = leSessao();
    if (!s || !s.refresh_token || !s.url) return Promise.reject(new Error('sem sessao'));

    renovando = fetch(s.url + '/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      headers: { apikey: s.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: s.refresh_token })
    })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('renovacao ' + r.status)); })
      .then(function (d) {
        var atual = leSessao() || s;
        atual.access_token = d.access_token;
        atual.refresh_token = d.refresh_token || atual.refresh_token;
        atual.expires_at = agora() + (d.expires_in || 3600);
        gravaSessao(atual);
        agenda();
        return atual.access_token;
      })
      .catch(function (e) {
        // O refresh_token gira a cada uso. Se outra aba renovou primeiro, esta
        // recebe recusa mesmo com a sessão viva — o localStorage já tem o novo.
        var atual = leSessao();
        if (atual && atual.expires_at && atual.expires_at - agora() > PERTO)
          return atual.access_token;
        throw e;
      })
      .then(function (t) { renovando = null; return t; },
            function (e) { renovando = null; throw e; });

    return renovando;
  }

  /* Token bom para usar agora. Se está vencendo, renova antes de devolver —
     é isto que impede a tela de sair com um token que já não vale. */
  function token() {
    if (renovando) return renovando;
    var s = leSessao();
    if (!s || !s.access_token) return Promise.reject(new Error('sem sessao'));
    if (!s.expires_at || s.expires_at - agora() > PERTO) return Promise.resolve(s.access_token);
    return renovar();
  }

  function agenda() {
    var s = leSessao();
    if (!s || !s.expires_at) return;
    if (relogio) clearTimeout(relogio);
    var falta = (s.expires_at - agora() - FOLGA) * 1000;
    relogio = setTimeout(function () { renovar().catch(function () { }); },
                         Math.max(falta, 10000));
  }

  window.ANDON_SESSAO = {
    chave: CHAVE,
    ler: leSessao,
    gravar: function (s) { gravaSessao(s); agenda(); },
    limpar: function () { localStorage.removeItem(CHAVE); },
    sair: function () {
      if (relogio) clearTimeout(relogio);
      localStorage.removeItem(CHAVE);
      location.replace('/entrar');
    },
    token: token,
    renovar: renovar
  };

  if (PUBLICA.indexOf(location.pathname) !== -1) return;

  var s = leSessao();
  if (!s || !s.access_token) return paraLogin();

  // Sessao criada antes de os papeis existirem nao sabe quem e gestor.
  // Pedir login de novo e mais seguro que adivinhar: adivinhar para cima
  // daria o painel do escritorio a quem nao deve ter, e para baixo tiraria
  // o painel de quem deve.
  if (!Array.isArray(s.papeis)) return paraLogin();

  // Vencido e sem como renovar: não há sessão a salvar.
  if (s.expires_at && s.expires_at - agora() < PERTO && !s.refresh_token) return paraLogin();

  // O painel principal reune Execucao e Financeiro. Quem nao e gestor
  // trabalha so em Acordos e vai direto para la, sem passar por uma tela
  // cheia de numero que nao e da alcada dela.
  var gestor = (s.papeis || []).indexOf('gestor') !== -1;
  var raiz = location.pathname === '/' || location.pathname === '/index.html';
  if (!gestor && raiz) return location.replace('/acordos');

  window.ANDON_SESSAO.gestor = gestor;

  // Já vencido na abertura: começa a renovar agora. A tela não precisa esperar
  // parada — quem pede dado ao banco pede o token antes, e o token só chega
  // quando esta renovação terminar.
  if (s.expires_at && s.expires_at - agora() < FOLGA) renovar().catch(function () { });
  agenda();

  // A máquina suspensa não deixa o relógio correr, e o notebook fechado no
  // almoço voltaria com o token vencido e nenhum aviso disparado.
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') token().catch(function () { });
  });
  window.addEventListener('online', function () { token().catch(function () { }); });

  // Outra aba renovou: o relógio desta passa a contar do novo vencimento.
  window.addEventListener('storage', function (ev) { if (ev.key === CHAVE) agenda(); });
})();
