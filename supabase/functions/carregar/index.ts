// ANDON · carga de dados a partir do repositorio GitHub
// Le os arquivos .psv publicados no repo e chama os loaders do banco.
// Chamada uma vez a cada push que altere a pasta /dados (GitHub Actions).
//
//   GET /functions/v1/carregar
//   GET /functions/v1/carregar?ref=<branch-ou-tag>
//
// O repositorio de origem e fixo: nao ha como apontar a carga para outra
// fonte. Uma chamada indevida so refaz a sincronizacao com o proprio repo,
// que e a fonte da verdade — nao ha como injetar dado de fora.
//
// O repositorio precisa ser PUBLICO para o raw.githubusercontent responder.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const DONO = 'danilo-ferro';
const NOME = 'andon';
const RAMOS = ['main', 'master'];

// so_planilha: a limpeza apaga apenas o que veio de /dados e preserva o que
// a equipe criou pela tela. Sem isso, o primeiro push depois de a equipe
// comecar a trabalhar apagaria o trabalho dela.
// A ordem importa: a tratativa entra primeiro porque verba e recebimento se
// amarram nela pelo ID_ACORDO. Trocar a ordem deixaria o financeiro orfao.
const FONTES = [
  { arquivo: 'execucao.psv',            rpc: 'carrega_execucao',     tabela: 'execucao',           so_planilha: true  },
  { arquivo: 'tratativa.psv',           rpc: 'carrega_tratativa',    tabela: 'tratativa',          so_planilha: true  },
  { arquivo: 'acordo_verba.psv',        rpc: 'carrega_verba',        tabela: 'acordo_verba',       so_planilha: true  },
  { arquivo: 'acordo_recebimento.psv',  rpc: 'carrega_recebimento',  tabela: 'acordo_recebimento', so_planilha: true  },
  { arquivo: 'faturado.psv',            rpc: 'carrega_faturado',     tabela: 'acordo_faturado',    so_planilha: true  },
  { arquivo: 'advbox.psv',              rpc: 'carrega_advbox',       tabela: 'advbox_lancamento',  so_planilha: false },
];

// contato.psv saiu daqui de proposito. Reus, escritorios e contatos passaram
// a ser curadoria da equipe de acordos: elas identificam o que esta errado e
// corrigem pela tela. Enquanto o arquivo fosse recarregado, apagar um e-mail
// errado nao adiantaria — ele voltaria no push seguinte, sem erro nenhum.
// O arquivo continua no repositorio como registro da importacao inicial.

const LOTE = 250;

// So aceita nome de ramo/tag: letras, numeros, . _ - e /. Nada de host proprio.
const refValida = (r: string) => /^[\w.\-\/]{1,120}$/.test(r) && !r.includes('..');

async function baixa(ref: string | null, arquivo: string) {
  const refs = ref ? [ref] : RAMOS;
  let ultimo = '';
  for (const r of refs) {
    const url = `https://raw.githubusercontent.com/${DONO}/${NOME}/${r}/dados/${arquivo}`;
    try {
      const resp = await fetch(url, { headers: { 'Cache-Control': 'no-cache' } });
      if (resp.ok) return { texto: await resp.text(), url };
      ultimo = `${resp.status} em ${url}`;
    } catch (e) {
      ultimo = `${String(e)} em ${url}`;
    }
  }
  throw new Error(ultimo || 'nao foi possivel baixar ' + arquivo);
}

Deno.serve(async (req: Request) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Content-Type': 'application/json; charset=utf-8',
  };
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const ref = new URL(req.url).searchParams.get('ref');
  if (ref && !refValida(ref)) {
    return new Response(
      JSON.stringify({ ok: false, erro: 'ref invalida' }),
      { status: 400, headers: cors },
    );
  }

  const db = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const relatorio: Record<string, unknown>[] = [];

  for (const f of FONTES) {
    try {
      const { texto, url } = await baixa(ref, f.arquivo);
      const linhas = texto.replace(/\r/g, '').trim().split('\n').filter((l) => l.trim().length > 0);
      if (linhas.length === 0) {
        relatorio.push({ tabela: f.tabela, ok: false, erro: 'arquivo vazio', origem: url });
        continue;
      }

      const limpeza = f.so_planilha
        ? db.from(f.tabela).delete().eq('origem_registro', 'planilha')
        : db.from(f.tabela).delete().neq('id', -1);
      const { error: eDel } = await limpeza;
      if (eDel) {
        relatorio.push({ tabela: f.tabela, ok: false, erro: 'limpeza: ' + eDel.message });
        continue;
      }

      let carregadas = 0, falhou: string | null = null;
      for (let i = 0; i < linhas.length; i += LOTE) {
        const pedaco = linhas.slice(i, i + LOTE);
        const { error } = await db.rpc(f.rpc, { blob: pedaco.join('\n') });
        if (error) { falhou = `lote ${Math.floor(i / LOTE) + 1}: ${error.message}`; break; }
        carregadas += pedaco.length;
      }

      const { count } = await db.from(f.tabela).select('*', { count: 'exact', head: true });
      relatorio.push(falhou
        ? { tabela: f.tabela, ok: false, erro: falhou, carregadas, no_banco: count, origem: url }
        : { tabela: f.tabela, ok: true, no_arquivo: linhas.length, no_banco: count, origem: url });
    } catch (e) {
      relatorio.push({ tabela: f.tabela, ok: false, erro: String(e) });
    }
  }

  const tudoOk = relatorio.length > 0 && relatorio.every((x) => x.ok);
  return new Response(
    JSON.stringify({
      ok: tudoOk,
      quando: new Date().toISOString(),
      relatorio,
      dica: tudoOk ? 'Dados no ar. Recarregue o ANDON.'
        : 'Confira se o repositorio danilo-ferro/andon e publico e se a pasta /dados foi enviada no push.',
    }, null, 2),
    { status: tudoOk ? 200 : 500, headers: cors },
  );
});
