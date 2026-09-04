/* O que todo teste precisa: um navegador, uma sessão e um Supabase de mentira.

   O `banco` é um objeto comum — cada tabela é uma chave. A rota imita o pedaço
   do PostgREST que a tela usa de verdade: os filtros `eq.`, `in.` e `gt.`, o
   POST devolvendo a linha criada, o PATCH devolvendo a alterada. Imitar de
   menos já custou caro aqui: um mock que ignorava `chave_cliente=eq.` devolvia
   a tabela inteira e "encontrava" uma linha que não existia — a asserção
   passava por acaso. */
import { chromium } from 'playwright';

export const CHROMIUM = '/opt/pw-browsers/chromium';
export const ENDERECO = 'http://127.0.0.1:8898';

export function fases(...ids) {
  const todas = {
    'AGUARDANDO RETORNO': { nome: 'Aguardando retorno', cor: '#6366F1', ordem: 1, conta_no_denominador: false, finalizada: false },
    'EM TRATATIVA':       { nome: 'Em tratativa',       cor: '#A855F7', ordem: 2, conta_no_denominador: false, finalizada: false },
    'AGUARDANDO PROTOCOLO': { nome: 'Aguardando protocolo', cor: '#22D3EE', ordem: 5, conta_no_denominador: false, finalizada: false },
    'ACORDO FECHADO':     { nome: 'Acordo fechado',     cor: '#A3E635', ordem: 6, conta_no_denominador: true,  finalizada: true },
    'RECUSADO':           { nome: 'Recusado',           cor: '#FB7185', ordem: 7, conta_no_denominador: true,  finalizada: true }
  };
  return (ids.length ? ids : Object.keys(todas))
    .map(id => ({ id, esteira: 'acordo', ...todas[id] }));
}

/* Uma tratativa com a Identificação inteira preenchida — que é o mínimo para
   o sistema aceitar salvar. Sobrescreva só o que o teste quer diferente. */
export const COMPLETA = {
  tipo: 'PASSIVO', fase: 'Pós-sentença', estado: 'SP', advogado: 'Max Canaverde',
  produto: 'CCS', autor: 'FULANA DE TAL', reu: 'BANCO BRADESCO S.A.',
  escritorio_adverso: 'Mascarenhas', canal: 'WHATSAPP', operador: 'Nathalia Gomes',
  data: '2026-06-01', status: 'EM TRATATIVA', acordo_principal: true
};

export const CADASTROS = {
  config_verba: [{ id: 'DM', nome: 'Danos morais', cor: '#6366F1', ordem: 1, ativo: true },
                 { id: 'HS', nome: 'Honorários',   cor: '#22D3EE', ordem: 2, ativo: true }],
  pessoa: [{ id: 9, nome: 'Danilo Ferro', papeis: ['operador', 'gestor'], ativo: true, email: 'd@x.com' },
           { id: 12, nome: 'Nathalia Gomes', papeis: ['operador'], ativo: true, email: 'n@x.com' },
           { id: 1, nome: 'Max Canaverde', papeis: ['advogado'], ativo: true }],
  parte_adversa: [{ id: 1, nome: 'BANCO BRADESCO S.A.', chave: 'B' }],
  escritorio_adverso: [{ id: 1, nome: 'Mascarenhas', chave: 'M' }],
  acordo_verba: [], acordo_recebimento: [], vw_tratativa_excluida: [],
  feriado: [], config_parametro: [], vw_ranking_operador: [], ranking_operador: [],
  contato: []
};

export async function abre(banco, opcoes = {}) {
  const { papeis = ['operador', 'gestor'], nome = 'Danilo Ferro', email = 'd@x.com',
          largura = 1500, altura = 950, aoResponder } = opcoes;
  const navegador = await chromium.launch({ executablePath: CHROMIUM });
  const ctx = await navegador.newContext({ viewport: { width: largura, height: altura } });
  const erros = [], pedidos = [];

  await ctx.addInitScript(([n, e, p]) => localStorage.setItem('andon.sessao', JSON.stringify({
    access_token: 't', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 7200,
    email: e, nome: n, papeis: p, url: 'https://x.supabase.co', key: 'k'
  })), [nome, email, papeis]);

  await ctx.route('**/rest/v1/**', r => {
    const q = r.request(), u = new URL(q.url()), alvo = u.pathname.split('/').pop();
    const json = x => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(x) });
    pedidos.push({ metodo: q.method(), alvo, url: q.url(), corpo: q.postData() });

    if (aoResponder) {
      const meu = aoResponder({ q, u, alvo, banco, json, r });
      if (meu !== undefined) return meu;
    }

    const id = +(u.searchParams.get('id') || '').replace('eq.', '');
    if (q.method() === 'PATCH') {
      const linha = (banco[alvo] || []).find(x => x.id === id);
      if (!linha) return json([]);
      Object.assign(linha, JSON.parse(q.postData() || '{}'), { updated_at: new Date().toISOString() });
      return json([linha]);
    }
    if (q.method() === 'POST') {
      const corpo = JSON.parse(q.postData() || '{}');
      const lista = Array.isArray(corpo) ? corpo : [corpo];
      const proximo = Math.max(900, ...(banco[alvo] || []).map(x => +x.id || 0)) + 1;
      const novas = lista.map((x, i) => ({ ...x, id: proximo + i, updated_at: new Date().toISOString() }));
      banco[alvo] = (banco[alvo] || []).concat(novas);
      return json(novas);
    }
    if (q.method() === 'DELETE') {
      const dentro = (u.searchParams.get('id') || '');
      if (dentro.startsWith('in.(')) {
        const ids = new Set(dentro.slice(4, -1).split(',').filter(Boolean).map(Number));
        banco[alvo] = (banco[alvo] || []).filter(x => !ids.has(x.id));
      } else if (id) {
        banco[alvo] = (banco[alvo] || []).filter(x => x.id !== id);
      }
      return r.fulfill({ status: 204, body: '' });
    }

    let l = banco[alvo] ?? [];
    if (id) l = l.filter(x => x.id === id);
    for (const campo of ['tratativa_id', 'chave_cliente']) {
      const v = u.searchParams.get(campo) || '';
      if (v.startsWith('eq.')) {
        const alvoV = decodeURIComponent(v.slice(3));
        l = l.filter(x => String(x[campo]) === alvoV);
      }
      if (v.startsWith('in.(')) {
        const s = new Set(v.slice(4, -1).split(',').map(Number));
        l = l.filter(x => s.has(x[campo]));
      }
    }
    for (const campo of ['updated_at', 'excluida_em']) {
      const gt = u.searchParams.get(campo) || '';
      if (gt.startsWith('gt.')) l = l.filter(x => x[campo] && x[campo] > gt.slice(3));
    }
    return json(l);
  });

  const pg = await ctx.newPage();
  pg.on('pageerror', e => erros.push(e.stack || e.message));
  pg.on('console', m => {
    // Ruído do ambiente de teste, não do sistema: fonte externa bloqueada.
    if (m.type() === 'error' && !/404|CERT|ERR_NAME|CONNECTION_RESET|TUNNEL/.test(m.text()))
      erros.push('console: ' + m.text());
  });
  await pg.goto(ENDERECO + (opcoes.pagina || '/acordos'), { waitUntil: 'networkidle' });
  await pg.waitForTimeout(700);
  return { navegador, ctx, pg, erros, pedidos };
}

export function relata(nome, out, erros) {
  out.ERROS = erros;
  console.log(JSON.stringify(out, null, 2));
  const ruim = Object.entries(out).filter(([k, v]) =>
    k !== 'ERROS' && (v === 'FALHOU' || (typeof v === 'string' && v.includes('FALHA'))));
  if (erros.length || ruim.length) {
    console.error(`\n${nome}: FALHOU`);
    process.exitCode = 1;
  } else {
    console.error(`\n${nome}: ok`);
  }
}
