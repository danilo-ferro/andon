/* Registro sem data nenhuma não pode entrar em recorte por período, e não pode
   sumir em silêncio.

   O gatilho do banco preenchia data_atualizacao com CURRENT_DATE quando um
   acordo fechado chegava sem data alguma. Seis acordos antigos entraram em
   "setembro de 2026" com R$ 40.399,68, num mês que de verdade tem dois acordos
   e R$ 3.000 — e a cada recarga da base eles pulavam para o mês da recarga.
   Corrigido o gatilho, a data fica nula; este teste cuida do outro lado: sem
   data eles somem de todo recorte, então a lista tem que dizer que existem. */
import { abre, relata, fases, COMPLETA, CADASTROS } from './base.mjs';

const out = {};
const semData = (processo, autor, valor) => ({
  processo, autor, valor, tipo: 'ATIVO', status: 'ACORDO FECHADO',
  acordo_principal: true, forma_pagamento: 'unica', fase: 'Pós-sentença',
  advogado: 'Max Canaverde',
  reu: null, operador: null, estado: null, canal: null, produto: null,
  escritorio_adverso: null, data: null, data_atualizacao: null, data_protocolo: null,
  updated_at: '2026-09-02T22:22:16+00:00'
});

const banco = {
  ...CADASTROS,
  config_fase: fases('EM TRATATIVA', 'ACORDO FECHADO'),
  tratativa: [
    // Os dois acordos de setembro de verdade.
    { id: 201, processo: '5010916-87.2026.4.03.6301', ...COMPLETA, autor: 'FABIOLA PONTES BAU',
      reu: 'BANCO BRADESCO S.A.', status: 'ACORDO FECHADO', valor: 1500, forma_pagamento: 'unica',
      data: '2026-09-02', data_atualizacao: '2026-09-02', data_protocolo: '2026-09-02',
      updated_at: '2026-09-02T10:00:00+00:00' },
    { id: 202, processo: '5011428-70.2026.4.03.6301', ...COMPLETA, autor: 'MARCELA DO ESPIRITO',
      status: 'ACORDO FECHADO', valor: 1500, forma_pagamento: 'unica',
      data: '2026-09-01', data_atualizacao: '2026-09-02', data_protocolo: '2026-09-02',
      updated_at: '2026-09-02T10:00:00+00:00' },
    // As seis sem data nenhuma, como o gatilho corrigido as deixa.
    semData('1002155-82.2025.8.26.0001', 'ERIVALDO BEZERRA DE', 3400),
    semData('0002178-96.2026.8.26.0005', 'ANNA KAROLINE SANTOS', 900),
    semData('0003955-80.2026.8.26.0405', 'RENATO JULIO DE', 20723.68),
    semData('1034655-35.2024.8.26.0003', 'ANGELICA SOARES DA', 5646),
    semData('0001623-82.2026.8.26.0198', 'STEFANIE RIBEIRO', 2600),
    semData('0004807-48.2026.8.26.0068', 'VITÓRIA RODRIGO DA', 7130),
    // Uma viva e incompleta: continua no aviso.
    { id: 400, processo: '4000001-11.2026.8.26.0100', ...COMPLETA, autor: 'VIVA INCOMPLETA',
      produto: null, data: '2026-08-01', data_atualizacao: '2026-08-20',
      updated_at: '2026-08-20T10:00:00+00:00' },
    // Uma fechada e completa, de agosto: não entra no aviso, e aparece no mês dela.
    { id: 401, processo: '4000002-22.2026.8.26.0100', ...COMPLETA, autor: 'FECHADA COMPLETA',
      status: 'ACORDO FECHADO', valor: 800, forma_pagamento: 'unica',
      data: '2026-08-01', data_atualizacao: '2026-08-10', data_protocolo: '2026-08-10',
      updated_at: '2026-08-10T10:00:00+00:00' }
  ]
};
banco.tratativa.slice(2, 8).forEach((t, i) => { t.id = 300 + i; });

const { navegador, pg, erros } = await abre(banco);
const resumo = () => pg.$eval('.resumo-filtro', e => e.textContent.replace(/\s+/g, ' ').trim());
const autores = () => pg.$$eval('#t-lista tbody tr', l => l.map(tr => tr.cells[1].textContent.trim()));
const poePeriodo = async v => { await pg.selectOption('[data-f="periodo"]', v); await pg.waitForTimeout(500); };

await pg.click('[data-aba="lista"]'); await pg.waitForTimeout(500);

/* ===== setembro só pode ter os dois que são de setembro ===== */
await poePeriodo('2026-09');
out['1_setembro'] = await autores();
out['1_resumo'] = await resumo();
out['1_so_os_dois'] = (out['1_setembro'].length === 2) ? 'ok' : 'FALHA';
out['1_valor_certo'] = out['1_resumo'].includes('R$ 3.000') ? 'ok' : 'FALHA';

/* ===== agosto não ganhou nada emprestado ===== */
await poePeriodo('2026-08');
out['2_agosto'] = await autores();

/* ===== sem recorte, todas aparecem ===== */
await poePeriodo('');
out['3_todas'] = (await autores()).length;

/* ===== o aviso conta as sem data, mesmo fechadas ===== */
out['4_texto'] = (await pg.$eval('#t-lista .nota', e => e.textContent.replace(/\s+/g, ' ').trim()))
  .replace(' ver lista', '');
out['4_diz_quantas_sem_data'] = out['4_texto'].includes('6 estão sem data nenhuma') ? 'ok' : 'FALHA';

await pg.click('#ver-faltantes'); await pg.waitForTimeout(400);
out['5_listadas'] = await pg.$$eval('#t-lista .pendente .nm', l => l.map(x => x.textContent.trim()));
out['5_fechada_completa_fora'] = out['5_listadas'].includes('FECHADA COMPLETA') ? 'FALHA' : 'ok';
out['5_viva_incompleta_dentro'] = out['5_listadas'].includes('VIVA INCOMPLETA') ? 'ok' : 'FALHA';
out['5_avisa_que_falta_data'] = (await pg.$eval('#t-lista .pendente .falta-lista',
  e => e.textContent)).includes('data da 1ª tentativa') ? 'ok' : 'FALHA';

/* ===== clicar numa delas abre a tratativa na Identificação ===== */
await pg.click('#t-lista .pendente'); await pg.waitForTimeout(700);
out['6_abriu'] = await pg.isVisible('#gav.on') ? 'ok' : 'FALHA';
out['6_etapa'] = await pg.$eval('.passo.on', e => e.textContent.replace(/\s+/g, ' ').trim());

relata('sem-data', out, erros);
await navegador.close();
