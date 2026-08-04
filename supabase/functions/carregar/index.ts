// ANDON · carga de dados a partir do repositorio GitHub
// Le os arquivos .psv publicados no repo e chama os loaders do banco.
// Chame uma vez apos cada push que altere a pasta /dados.
//
//   GET /functions/v1/carregar
//   GET /functions/v1/carregar?repo=<url-base-alternativa>
//
// O repositorio precisa ser PUBLICO para o raw.githubusercontent responder.
// Ja esta implantada no projeto Supabase. Este arquivo existe para
// versionamento e para reimplantar com `supabase functions deploy carregar`.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const DONO = 'danilo-ferro';
const NOME = 'andon';
const RAMOS = ['main', 'master'];

const FONTES = [
  { arquivo: 'execucao.psv',  rpc: 'carrega_execucao',  tabela: 'execucao'        },
  { arquivo: 'tratativa.psv', rpc: 'carrega_tratativa', tabela: 'tratativa'       },
  { arquivo: 'faturado.psv',  rpc: 'carrega_faturado',  tabela: 'acordo_faturado' },
];

const LOTE = 250;

async function baixa(base: string | null, arquivo: string) {
  const bases = base
    ? [base]
    : RAMOS.map((r) => `https://raw.githubusercontent.com/${DONO}/${NOME}/${r}/dados`);
  let ultimo = '';
  for (const b of bases) {
    const url = `${b}/${arquivo}`;
    try {
      const r = await fetch(url, { headers: { 'Cache-Control': 'no-cache' } });
      if (r.ok) return { texto: await r.text(), url };
      ultimo = `${r.status} em ${url}`;
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

  const base = new URL(req.url).searchParams.get('repo');
  const db = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const relatorio: Record<string, unknown>[] = [];

  for (const f of FONTES) {
    try {
      const { texto, url } = await baixa(base, f.arquivo);
      const linhas = texto.replace(/\r/g, '').trim().split('\n').filter((l) => l.trim().length > 0);
      if (linhas.length === 0) {
        relatorio.push({ tabela: f.tabela, ok: false, erro: 'arquivo vazio', origem: url });
        continue;
      }

      const { error: eDel } = await db.from(f.tabela).delete().neq('id', -1);
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
