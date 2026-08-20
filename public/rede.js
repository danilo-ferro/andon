/* ==================================================================
   ANDON · rede

   `fetch` só rejeita quando a requisição não completou: o wi-fi caiu, o
   antivírus cortou a conexão, o cabo saiu, o computador dormiu. Não há
   resposta nenhuma — nem código, nem corpo. O navegador diz apenas
   "Failed to fetch", em inglês, e era isso que chegava na tela da equipe.

   Duas coisas erradas nisso. A primeira é a mensagem: ninguém sabe o que
   fazer com "Failed to fetch". A segunda, mais grave, é desistir na
   primeira falha — uma queda de meio segundo virava trabalho perdido.

   Aqui a requisição é repetida três vezes, com intervalo crescente, e o
   que sobra vira uma frase em português que diz o que aconteceu e que o
   que foi digitado continua na tela.

   Repetir um POST seria arriscado — ele pode ter chegado, e a resposta é
   que se perdeu — então quem cria registro manda uma chave própria e
   deixa o banco recusar a segunda cópia. Veja `tratativa.chave_cliente`.
   ================================================================== */
(function () {
  var TENTATIVAS = 3;
  var espera = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  function metodo(opcoes) {
    return String((opcoes && opcoes.method) || 'GET').toUpperCase();
  }
  /* Repetir só é seguro em quem pode ser repetido sem mudar o resultado.
     POST entra na lista porque quem cria manda chave própria — sem ela,
     a segunda tentativa criaria uma segunda tratativa. */
  function podeRepetir(opcoes) {
    if (opcoes && opcoes.semRepetir) return false;
    return ['GET', 'HEAD', 'PATCH', 'PUT', 'DELETE', 'POST'].indexOf(metodo(opcoes)) !== -1;
  }

  function erroDeRede(causa) {
    var e = new Error(navigator.onLine === false
      ? 'O computador está sem internet. Reconecte e tente de novo.'
      : 'A conexão com o sistema caiu no meio do caminho. Tente de novo.');
    e.rede = true;
    e.causa = causa;
    return e;
  }

  async function buscar(url, opcoes) {
    var ultimo = null;
    for (var i = 0; i < TENTATIVAS; i++) {
      try {
        return await fetch(url, opcoes);
      } catch (e) {
        ultimo = e;
        if (!podeRepetir(opcoes) || i === TENTATIVAS - 1) break;
        await espera(500 * Math.pow(2, i));   // 0,5s · 1s
      }
    }
    throw erroDeRede(ultimo);
  }

  /* Chave de gravação: existe só para que repetir não duplique. */
  function chaveNova() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'k' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
  }

  window.ANDON_REDE = { buscar: buscar, chaveNova: chaveNova, erroDeRede: erroDeRede };
})();
