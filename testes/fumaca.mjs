/* Varredura larga: abre todas as telas, mexe no que a equipe mexe todo dia e
   confere que nada estourou. Não substitui os testes específicos — serve para
   pegar a quebra grosseira, a que derruba a tela inteira. */
import { abre, relata, fases, COMPLETA, CADASTROS } from './base.mjs';

const out = {};
const banco = {
  ...CADASTROS,
  config_fase: fases(),
  tratativa: [
    { id: 1, processo: '5000001-11.2026.8.26.0100', ...COMPLETA, autor: 'ANA SOUZA',
      status: 'EM TRATATIVA', data: '2026-08-01', data_atualizacao: '2026-08-20',
      updated_at: '2026-08-20T10:00:00+00:00' },
    { id: 2, processo: '5000002-22.2026.8.26.0100', ...COMPLETA, autor: 'BRUNO LIMA',
      status: 'ACORDO FECHADO', valor: 5000, forma_pagamento: 'unica',
      data: '2026-07-01', data_atualizacao: '2026-08-05', data_protocolo: '2026-08-05',
      previsao: '2026-09-05', updated_at: '2026-08-05T10:00:00+00:00' },
    { id: 3, processo: '5000003-33.2026.8.26.0100', ...COMPLETA, autor: 'CARLA DIAS',
      status: 'RECUSADO', data: '2026-06-01', data_atualizacao: '2026-06-20',
      updated_at: '2026-06-20T10:00:00+00:00' },
    { id: 4, processo: '5000004-44.2026.8.26.0100', ...COMPLETA, autor: 'DANIEL ROCHA',
      status: 'AGUARDANDO PROTOCOLO', valor: 2000, forma_pagamento: 'unica',
      data_minuta_assinada: '2026-08-10',
      data: '2026-07-15', data_atualizacao: '2026-08-10',
      updated_at: '2026-08-10T10:00:00+00:00' }
  ],
  acordo_verba: [{ id: 71, tratativa_id: 2, verba: 'DM', detalhe: null, valor_total: 5000 },
                 { id: 72, tratativa_id: 4, verba: 'HS', detalhe: null, valor_total: 2000 }],
  acordo_recebimento: [
    { id: 11, tratativa_id: 2, processo: '5000002-22.2026.8.26.0100', verba: 'DM',
      valor: 5000, vencimento: '2026-09-05', situacao: 'A VENCER',
      updated_at: '2026-08-05T10:00:00+00:00' }
  ]
};

const { navegador, pg, erros } = await abre(banco);

/* ===== todas as abas abrem ===== */
for (const [aba, alvo] of [['painel', '#t-painel'], ['financeiro', '#t-financeiro'],
                           ['ranking', '#t-ranking'], ['kanban', '#t-kanban'],
                           ['lista', '#t-lista']]) {
  await pg.click(`[data-aba="${aba}"]`); await pg.waitForTimeout(600);
  const tem = await pg.$eval(alvo, e => e.textContent.trim().length > 0);
  out[`1_abre_${aba}`] = tem ? 'ok' : 'FALHA';
}

/* ===== a lista mostra as quatro e classifica ===== */
await pg.click('[data-aba="lista"]'); await pg.waitForTimeout(500);
const autores = () => pg.$$eval('#t-lista tbody tr', l => l.map(tr => tr.cells[1].textContent.trim()));
out['2_linhas'] = (await autores()).length;
const antes = JSON.stringify(await autores());
await pg.click('#t-lista th[data-ord="autor"]'); await pg.waitForTimeout(400);
out['2_classificou'] = antes !== JSON.stringify(await autores()) ? 'ok' : 'FALHA';

/* ===== a busca acha por número, por nome e por dígito ===== */
const procura = async t => { await pg.fill('#q', t); await pg.waitForTimeout(450); return autores(); };
out['3_por_numero'] = (await procura('5000002-22.2026.8.26.0100')).length === 1 ? 'ok' : 'FALHA';
out['3_por_digito'] = (await procura('50000022220268260100')).length === 1 ? 'ok' : 'FALHA';
out['3_por_nome']   = (await procura('CARLA')).length === 1 ? 'ok' : 'FALHA';
await procura('');

/* ===== abrir, editar e salvar uma tratativa ===== */
await procura('5000001');
await pg.click('#t-lista tbody tr'); await pg.waitForTimeout(700);
out['4_abriu'] = await pg.isVisible('#gav.on') ? 'ok' : 'FALHA';
await pg.fill('#f2-obs', 'anotação do teste de fumaça'); await pg.waitForTimeout(200);
await pg.click('#salvar'); await pg.waitForTimeout(1300);
out['4_recado'] = (await pg.textContent('#recado')).replace(/\s+/g, ' ').trim().slice(0, 30);
out['4_gravou'] = (banco.tratativa.find(t => t.id === 1) || {}).observacoes;
out['4_salvou'] = out['4_gravou'] === 'anotação do teste de fumaça' ? 'ok' : 'FALHA';

/* ===== clicar fora não fecha; o × fecha ===== */
await pg.mouse.click(60, 450); await pg.waitForTimeout(400);
out['5_clique_fora_nao_fecha'] = await pg.isVisible('#gav.on') ? 'ok' : 'FALHA';
await pg.click('#fx'); await pg.waitForTimeout(400);
out['5_x_fecha'] = await pg.isVisible('#gav.on') ? 'FALHA' : 'ok';

/* ===== o acordo fechado abre no faturamento com a discriminação ===== */
await procura('5000002');
await pg.click('#t-lista tbody tr'); await pg.waitForTimeout(700);
out['6_etapa'] = await pg.$eval('.passo.on', e => e.textContent.replace(/\s+/g, ' ').trim());
out['6_discriminacao'] = await pg.$$eval('#bloco-verbas [data-vb="verba"]', l => l.map(x => x.value));
await pg.click('#salvar'); await pg.waitForTimeout(1400);
out['6_salvou'] = (await pg.textContent('#recado')).replace(/\s+/g, ' ').trim().slice(0, 20);
out['6_discriminacao_ficou'] = (await pg.$$eval('#bloco-verbas [data-vb="verba"]',
  l => l.map(x => x.value))).length === 1 ? 'ok' : 'FALHA';
await pg.click('#fx'); await pg.waitForTimeout(300);

/* ===== a nova tratativa cobra a Identificação inteira ===== */
await procura('');
await pg.click('#nova'); await pg.waitForTimeout(700);
await pg.click('#salvar'); await pg.waitForTimeout(900);
out['7_cobrou'] = (await pg.textContent('#recado')).includes('obrigatórios') ? 'ok' : 'FALHA';
out['7_marcou'] = (await pg.$$eval('.inp.falta', l => l.length)) > 0 ? 'ok' : 'FALHA';
await pg.click('#cancelar'); await pg.waitForTimeout(300);

/* ===== o botão Atualizar responde ===== */
await pg.click('#atualizar'); await pg.waitForTimeout(1300);
out['8_atualizou'] = (await pg.textContent('#aviso')).replace(/\s+/g, ' ').trim().slice(0, 40);

/* ===== copiar o número do processo não abre a tratativa ===== */
await pg.click('[data-aba="lista"]'); await pg.waitForTimeout(400);
await pg.click('#t-lista tbody tr [data-copiar-proc]'); await pg.waitForTimeout(500);
out['9_copiar_nao_abre'] = await pg.isVisible('#gav.on') ? 'FALHA' : 'ok';

relata('fumaca', out, erros);
await navegador.close();
