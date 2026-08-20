/* ==================================================================
   ANDON · tema de cores

   Carregado no <head> de todas as paginas, antes de qualquer coisa ser
   desenhada: se rodasse depois, a tela piscaria no tema errado a cada
   carregamento.

   A escolha vive em dois lugares de proposito. No navegador, para valer
   instantaneamente e sem depender de rede. E na pessoa, no banco, para
   acompanhar quem troca de maquina — quem escolheu claro no escritorio
   nao volta ao escuro ao abrir o sistema em casa. A gravacao no banco
   passa por uma funcao que so mexe na coluna do tema da propria pessoa;
   escrever em `pessoa` continua sendo coisa de gestor.
   ================================================================== */
(function () {
  var CHAVE = 'andon.tema';
  var PADRAO = 'escuro';

  // amostra: [fundo, sinal, texto] — e o que aparece no seletor
  var TEMAS = [
    { id: 'escuro',  rotulo: 'Escuro',  nota: 'o padrão da casa',   amostra: ['#06080D', '#22C55E', '#EAF0F8'] },
    { id: 'grafite', rotulo: 'Grafite', nota: 'escuro mais suave',  amostra: ['#16181D', '#54C97C', '#DFE3E9'] },
    { id: 'claro',   rotulo: 'Claro',   nota: 'fundo branco',       amostra: ['#F3F5F9', '#16A34A', '#0F172A'] },
    { id: 'pastel',  rotulo: 'Pastel',  nota: 'tons suaves',        amostra: ['#F7F3EE', '#4FA36A', '#3C3440'] }
  ];

  function valido(t) {
    for (var i = 0; i < TEMAS.length; i++) if (TEMAS[i].id === t) return t;
    return PADRAO;
  }
  function lido() {
    try { return valido(localStorage.getItem(CHAVE)); } catch (e) { return PADRAO; }
  }
  function pinta(t) {
    document.documentElement.setAttribute('data-tema', valido(t));
  }

  /* Guarda no banco sem travar a tela: a cor ja mudou: se a rede falhar, a
     escolha continua valendo neste navegador e sobe na proxima troca. */
  function guardaNoBanco(t) {
    var s = window.ANDON_SESSAO && window.ANDON_SESSAO.ler();
    if (!s || !s.access_token || !s.url) return;
    fetch(s.url + '/rest/v1/rpc/definir_tema', {
      method: 'POST',
      headers: { apikey: s.key, 'Content-Type': 'application/json',
                 Authorization: 'Bearer ' + s.access_token },
      body: JSON.stringify({ p_tema: t })
    }).catch(function () { });
  }

  function aplicar(t, gravar) {
    t = valido(t);
    pinta(t);
    try { localStorage.setItem(CHAVE, t); } catch (e) { }
    if (gravar !== false) guardaNoBanco(t);
    desenhaSeletor();
    return t;
  }

  pinta(lido());

  window.ANDON_TEMA = {
    temas: TEMAS,
    atual: lido,
    aplicar: aplicar,
    /* Usado pela tela de entrada: o tema vem do cadastro da pessoa e passa a
       valer neste navegador sem ser reescrito de volta no banco. */
    adotar: function (t) { if (t) aplicar(t, false); }
  };

  /* ---------------- seletor ---------------- */
  var caixa = null;

  function amostraHtml(cores) {
    return '<span class="amostra">' + cores.map(function (c) {
      return '<i style="background:' + c + '"></i>';
    }).join('') + '</span>';
  }

  function desenhaSeletor() {
    if (!caixa) return;
    var hoje = lido();
    var bt = caixa.querySelector('.tema-bt .tema-am');
    if (bt) {
      var t = TEMAS.filter(function (x) { return x.id === hoje; })[0] || TEMAS[0];
      bt.innerHTML = t.amostra.map(function (c) {
        return '<i style="background:' + c + '"></i>';
      }).join('');
    }
    var menu = caixa.querySelector('.tema-menu');
    if (!menu) return;
    menu.innerHTML = '<div class="tit">Cores do sistema</div>' + TEMAS.map(function (t) {
      return '<button class="tema-op ' + (t.id === hoje ? 'on' : '') + '" data-tema="' + t.id + '">'
        + amostraHtml(t.amostra)
        + '<span class="txt"><b>' + t.rotulo + '</b><span>' + t.nota + '</span></span>'
        + '<span class="marca-ok">&#10003;</span></button>';
    }).join('');
    menu.querySelectorAll('[data-tema]').forEach(function (b) {
      b.onclick = function () { aplicar(b.dataset.tema); menu.hidden = true; };
    });
  }

  function montaSeletor() {
    var dir = document.querySelector('.topo-dir');
    if (!dir || document.querySelector('.tema-cx')) return;
    caixa = document.createElement('div');
    caixa.className = 'tema-cx';
    caixa.innerHTML =
      '<button class="tema-bt" type="button" title="Cores do sistema" aria-haspopup="true">'
      + '<span class="tema-am"></span><span>Tema</span></button>'
      + '<div class="tema-menu" hidden></div>';
    // Antes do bloco de sessao, para o botao Sair continuar sendo o ultimo.
    var sessao = dir.querySelector('#sessao');
    if (sessao) dir.insertBefore(caixa, sessao); else dir.appendChild(caixa);

    var menu = caixa.querySelector('.tema-menu');
    caixa.querySelector('.tema-bt').onclick = function (e) {
      e.stopPropagation();
      menu.hidden = !menu.hidden;
    };
    document.addEventListener('click', function (e) {
      if (!menu.hidden && !caixa.contains(e.target)) menu.hidden = true;
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') menu.hidden = true;
    });
    desenhaSeletor();
  }

  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', montaSeletor);
  else montaSeletor();
})();
