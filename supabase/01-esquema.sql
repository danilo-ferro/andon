-- =====================================================================
-- ANDON — esquema completo
-- Canaverde & Aguiar Advogados Associados
-- =====================================================================
-- Espelho fiel do banco em producao (projeto Supabase `andon`), gerado a
-- partir do catalogo do proprio Postgres. Serve para versionamento e para
-- recriar o banco do zero — mudanca de projeto, ambiente de teste, ou o
-- dia em que for preciso provar de onde veio cada coisa.
--
-- Ordem: rode este arquivo UMA vez num projeto limpo. A carga dos dados
-- vem depois, pela Edge Function `carregar` — veja docs/COMO-FUNCIONA.md.
--
-- Nada aqui usa a service_role. Toda leitura exige `authenticated`, e toda
-- escrita ou passa por RLS ou por funcao SECURITY DEFINER de escopo estreito.
-- =====================================================================

-- =====================================================================
-- 0. FUNCOES DE APOIO
--    Vem antes das tabelas porque duas colunas as usam como default.
-- =====================================================================

-- Acento fora, sem depender da extensao unaccent: uma tabela de traducao
-- resolve o portugues inteiro e nao adiciona dependencia ao projeto novo.
create or replace function unaccent_simples(t text) returns text
  language sql immutable set search_path to 'public','pg_temp' as $$
  select translate(coalesce(t,''), 'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
                                   'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')
$$;

-- Nome vira chave comparavel: sem acento, sem pontuacao, sem caixa. E o que
-- permite reconhecer "MARIA DA SILVA" e "Maria da Silva" como a mesma pessoa.
create or replace function chave_nome(t text) returns text
  language sql immutable set search_path to 'public','pg_temp' as $$
  select upper(regexp_replace(unaccent_simples(coalesce(t,'')), '[^A-Za-z0-9]', '', 'g'))
$$;

-- Numero de processo vira chave comparavel: so os digitos. A mesma numeracao
-- chega com ponto, com hifen ou sem nada, e sem isto o mesmo processo entrava
-- duas vezes sem ninguem perceber.
create or replace function chave_processo(p text) returns text
  language sql immutable set search_path to 'public','pg_temp' as $$
  select nullif(regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g'), '')
$$;

-- =====================================================================
-- 1. EXECUCAO — espelha o MAPA EXECUCAO. Cada linha e um VALOR, nao um
--    processo: o mesmo processo pode ter parte levantada e um saldo
--    remanescente ainda executando.
-- =====================================================================
create table execucao (
  id                     bigserial primary key,
  n_controle             text,
  produto                text,
  advogado               text,
  cliente                text,
  processo               text not null,
  valor                  numeric(14,2) default 0 not null,
  foro                   text,
  vara                   text,
  status                 text not null,
  data_expedicao         date,
  ultimo_andamento       text,
  data_ultimo_andamento  date,
  observacoes            text,
  data_recebimento       date,
  created_at             timestamptz default now() not null,
  updated_at             timestamptz default now() not null,
  origem_registro        text default 'sistema' not null
    constraint execucao_origem_ck check (origem_registro in ('planilha','sistema','erp'))
);

-- =====================================================================
-- 2. TRATATIVA — a negociacao do acordo, do primeiro contato ao caixa.
--    Um processo, uma tratativa: a trava esta no indice unico mais abaixo.
-- =====================================================================
create table tratativa (
  id                     bigserial primary key,
  fase                   text,
  estado                 text,
  advogado               text,
  processo               text not null,
  autor                  text,
  reu                    text,
  escritorio_adverso     text,
  canal                  text,
  data                   date,               -- 1a tentativa
  status                 text not null,      -- id em config_fase
  observacoes            text,
  created_at             timestamptz default now() not null,
  updated_at             timestamptz default now() not null,
  origem_registro        text default 'sistema' not null
    constraint tratativa_origem_ck check (origem_registro in ('planilha','sistema','erp')),
  tipo                   text,
  produto                text,
  operador               text,
  valor                  numeric(14,2),
  data_atualizacao       date,
  -- O caminho entre "acertado" e "fechado": a minuta e confeccionada pela
  -- parte contraria, assinada pelo advogado do caso e so entao protocolada.
  data_minuta_assinada   date,
  data_protocolo         date,               -- marco financeiro, nao a minuta
  forma_pagamento        text
    constraint tratativa_forma_pagamento_check
      check (forma_pagamento is null or forma_pagamento in ('unica','parcelado')),
  qtd_parcelas           integer,
  prazo_dias             integer,
  tipo_prazo             text
    constraint tratativa_tipo_prazo_check
      check (tipo_prazo is null or tipo_prazo in ('uteis','corridos')),
  previsao               date,
  previsao_manual        boolean default false not null,
  recebido               boolean default false not null,
  data_recebimento       date,
  -- Chave sorteada pela tela antes de qualquer digitacao. Se a conexao cair
  -- depois de a gravacao ter chegado, a repeticao esbarra no indice unico em
  -- vez de criar uma segunda tratativa.
  chave_cliente          text,
  id_acordo              text,
  -- Um acordo por linha: as repeticoes do mesmo acordo ficam no historico
  -- mas nao contam de novo, senao 235 acordos virariam 241 no painel.
  acordo_principal       boolean default true not null
);

create table acordo_parcela (
  id                     bigserial primary key,
  tratativa_id           bigint not null references tratativa(id) on delete cascade,
  numero                 integer not null,
  valor                  numeric(14,2) not null,
  previsao               date,
  recebido               boolean default false not null,
  data_recebimento       date,
  observacoes            text,
  created_at             timestamptz default now() not null,
  updated_at             timestamptz default now() not null,
  unique (tratativa_id, numero)
);

-- =====================================================================
-- 3. O DINHEIRO DEPOIS DO ACORDO FECHADO
--    Duas tabelas porque sao duas perguntas: DE QUE o acordo e feito, e
--    QUANDO cada pedaco entra. Sem a primeira nao existe regra de comissao.
-- =====================================================================
create table config_verba (
  id          text primary key,
  nome        text not null,
  descricao   text,
  cor         text default '#5B6878' not null,
  ordem       integer default 99 not null,
  -- Verba que saiu de linha nao aparece mais para escolher, mas continua
  -- visivel onde ja foi usada: apagar da lista faria a linha antiga trocar
  -- de verba sozinha ao ser aberta.
  ativo       boolean default true not null
);

create table acordo_verba (
  id                 bigint generated always as identity primary key,
  tratativa_id       bigint references tratativa(id) on delete cascade,
  id_acordo          text,
  processo           text,
  verba              text not null references config_verba(id),
  detalhe            text,
  qtd_lancamentos    integer default 0 not null,
  valor_pago         numeric(14,2) default 0 not null,
  valor_em_aberto    numeric(14,2) default 0 not null,
  valor_total        numeric(14,2) default 0 not null,
  origem_registro    text default 'planilha' not null,
  created_at         timestamptz default now() not null,
  updated_at         timestamptz default now() not null
);

-- Existe UMA lista de recebimentos, nao duas. O que o ADVBox lancou entra
-- como 'planilha'; o que o sistema preve ao fechar um acordo entra como
-- 'sistema' e some assim que o lancamento real chega. Duas listas para a
-- mesma pergunta seria o caminho mais curto para dois numeros diferentes.
create table acordo_recebimento (
  id                 bigint generated always as identity primary key,
  tratativa_id       bigint references tratativa(id) on delete set null,
  id_acordo          text,
  processo           text,
  categoria_advbox   text,
  tipo               text,
  fase               text,
  verba              text references config_verba(id),
  detalhe            text,
  parcela_rotulo     text,
  parcela_num        integer,
  parcela_total      integer,
  vencimento         date,
  competencia        text,
  data_pagamento     date,
  situacao           text default 'A VENCER' not null
    check (situacao in ('PAGO','EM ATRASO','A VENCER')),
  valor              numeric(14,2) default 0 not null,
  advogado           text,
  descricao_original text,
  origem_registro    text default 'planilha' not null,
  created_at         timestamptz default now() not null,
  updated_at         timestamptz default now() not null
);

-- =====================================================================
-- 4. BASES ANTIGAS — insumo de conciliacao, nao fonte de verdade
-- =====================================================================
create table acordo_faturado (
  id                bigserial primary key,
  origem            text,
  fase              text,
  advogado          text,
  produto           text,
  autor             text,
  reu               text,
  processo          text not null,
  data_minuta       date,
  valor             numeric(14,2) default 0 not null,
  protocolado       text,
  data_protocolo    date,
  estado            text,
  previsao          date,
  recebido          text,
  data_recebimento  date,
  observacoes       text,
  created_at        timestamptz default now() not null,
  updated_at        timestamptz default now() not null,
  origem_registro   text default 'sistema' not null
    constraint acordo_faturado_origem_ck check (origem_registro in ('planilha','sistema','erp'))
);

create table acordo_trabalhista (
  id                bigserial primary key,
  autor             text,
  reu               text,
  processo          text,
  data              date,
  valor             numeric(14,2) default 0 not null,
  previsao          date,
  recebido          text,
  data_recebimento  date,
  observacoes       text,
  created_at        timestamptz default now() not null
);

-- Extrato do ADVBox, uma linha por lancamento. Fonte unica do lado ADVBox
-- da conciliacao.
create table advbox_lancamento (
  id            bigserial primary key,
  conta         text,
  centro_custo  text,
  setor         text,
  tipo          text,
  vencimento    date,
  competencia   text,
  pagamento     date,
  categoria     text not null,
  descricao     text,
  valor         numeric(14,2) default 0 not null,
  processo      text,
  partes        text,
  created_at    timestamptz default now() not null
);

-- =====================================================================
-- 5. CADASTROS — curadoria da equipe de acordos
-- =====================================================================
create table pessoa (
  id          bigserial primary key,
  nome        text not null,
  chave       text unique generated always as (chave_nome(nome)) stored,
  email       text,
  papeis      text[] default '{}' not null
    constraint pessoa_papeis_ck
      check (papeis <@ array['advogado','operador','gestor','financeiro']),
  apelidos    text[] default '{}' not null,
  ativo       boolean default true not null,
  observacoes text,
  created_at  timestamptz default now() not null,
  updated_at  timestamptz default now() not null,
  tema        text          -- cor do sistema escolhida por esta pessoa
);

create table parte_adversa (
  id              bigserial primary key,
  nome            text not null unique,
  documento       text,
  observacoes     text,
  ativo           boolean default true not null,
  created_at      timestamptz default now() not null,
  updated_at      timestamptz default now() not null,
  origem_registro text default 'sistema' not null,
  chave           text generated always as (chave_nome(nome)) stored
);

create table escritorio_adverso (
  id              bigserial primary key,
  nome            text not null unique,
  observacoes     text,
  ativo           boolean default true not null,
  created_at      timestamptz default now() not null,
  updated_at      timestamptz default now() not null,
  origem_registro text default 'sistema' not null,
  chave           text generated always as (chave_nome(nome)) stored
);

create table parte_escritorio (
  parte_id      bigint not null references parte_adversa(id) on delete cascade,
  escritorio_id bigint not null references escritorio_adverso(id) on delete cascade,
  primary key (parte_id, escritorio_id)
);

create table contato (
  id              bigserial primary key,
  dono_tipo       text not null check (dono_tipo in ('parte','escritorio')),
  dono_id         bigint not null,
  canal           text not null,
  valor           text not null,
  rotulo          text,
  preferencial    boolean default false not null,
  ativo           boolean default true not null,
  created_at      timestamptz default now() not null,
  updated_at      timestamptz default now() not null,
  origem_registro text default 'sistema' not null,
  unique (dono_tipo, dono_id, canal, valor)
);

-- =====================================================================
-- 6. CONFIGURACAO — fases, grupos, metas e feriados
-- =====================================================================
create table config_grupo (
  id        text primary key,
  esteira   text not null check (esteira in ('acordo','execucao')),
  nome      text not null,
  descricao text,
  cor       text not null,
  ordem     integer default 0 not null
);

create table config_fase (
  id          text primary key,   -- igual ao status gravado na base
  esteira     text not null check (esteira in ('acordo','execucao')),
  nome        text not null,
  grupo_id    text references config_grupo(id),
  cor         text not null,
  ordem       integer default 0 not null,
  descricao   text,
  confianca   integer,            -- % usado na previsao ponderada
  prazo_dias  integer,            -- dias estimados ate o caixa
  -- Duas colunas separadas de proposito: uma diz o que entra na taxa de
  -- sucesso, a outra diz o que parou de correr. Nada garante que continuem
  -- coincidindo — as fases de formalizacao sao prova disso.
  conta_no_denominador boolean default false not null,
  conta_receita        boolean default false not null,
  finalizada           boolean default false not null
);

create table config_meta (
  chave  text primary key,
  valor  numeric(14,2) not null,
  rotulo text,
  ano    integer default 2026 not null
);

create table config_parametro (
  chave  text primary key,
  valor  numeric(14,2),
  texto  text,
  rotulo text
);

create table feriado (
  id          bigserial primary key,
  data        date not null,
  nome        text not null,
  abrangencia text default 'nacional' not null
    check (abrangencia in ('nacional','estadual','forense')),
  uf          text default '' not null,
  unique (data, abrangencia, uf)
);

-- =====================================================================
-- 7. INDICES
-- =====================================================================
create index acordo_faturado_data_protocolo_idx   on acordo_faturado (data_protocolo);
create index acordo_faturado_data_recebimento_idx on acordo_faturado (data_recebimento);
create index acordo_faturado_origem_idx           on acordo_faturado (origem_registro);
create index acordo_faturado_processo_idx         on acordo_faturado (processo);
create index acordo_parcela_previsao_idx          on acordo_parcela (previsao);
create index acordo_parcela_recebido_idx          on acordo_parcela (recebido);
create index acordo_receb_idacordo_ix             on acordo_recebimento (id_acordo);
create index acordo_receb_situacao_ix             on acordo_recebimento (situacao);
create index acordo_receb_tratativa_ix            on acordo_recebimento (tratativa_id);
create index acordo_receb_venc_ix                 on acordo_recebimento (vencimento);
create index acordo_verba_idacordo_ix             on acordo_verba (id_acordo);
create index acordo_verba_tratativa_ix            on acordo_verba (tratativa_id);
create index advbox_lancamento_categoria_idx      on advbox_lancamento (categoria);
create index advbox_lancamento_pagamento_idx      on advbox_lancamento (pagamento);
create index advbox_lancamento_processo_idx       on advbox_lancamento (processo);
create index contato_dono_tipo_dono_id_canal_idx  on contato (dono_tipo, dono_id, canal) where ativo;
create index contato_origem_idx                   on contato (origem_registro);
create unique index escritorio_adverso_chave_uk   on escritorio_adverso (chave);
create index escritorio_adverso_origem_idx        on escritorio_adverso (origem_registro);
create index execucao_data_recebimento_idx        on execucao (data_recebimento);
create index execucao_data_ultimo_andamento_idx   on execucao (data_ultimo_andamento);
create index execucao_origem_idx                  on execucao (origem_registro);
create index execucao_processo_idx                on execucao (processo);
create index execucao_status_idx                  on execucao (status);
create index feriado_data_idx                     on feriado (data);
create unique index parte_adversa_chave_uk        on parte_adversa (chave);
create index parte_adversa_origem_idx             on parte_adversa (origem_registro);
create index pessoa_apelidos_idx                  on pessoa using gin (apelidos);
create index pessoa_papeis_idx                    on pessoa using gin (papeis);
create index tratativa_data_idx                   on tratativa (data);
create index tratativa_id_acordo_ix               on tratativa (id_acordo);
create index tratativa_operador_idx               on tratativa (operador);
create index tratativa_origem_idx                 on tratativa (origem_registro);
create index tratativa_previsao_idx               on tratativa (previsao);
create index tratativa_processo_idx               on tratativa (processo);
create index tratativa_produto_idx                on tratativa (produto);
create index tratativa_protocolo_idx              on tratativa (data_protocolo);
create index tratativa_status_idx                 on tratativa (status);

-- As duas travas que impedem duplicidade de tratativa, cada uma contra um
-- acidente diferente:
--   * mesma numeracao de processo escrita de outro jeito;
--   * mesma gravacao repetida porque a rede caiu e a tela tentou de novo.
create unique index tratativa_processo_uk on tratativa (chave_processo(processo))
  where chave_processo(processo) is not null;
create unique index tratativa_chave_cliente_uk on tratativa (chave_cliente)
  where chave_cliente is not null;

-- =====================================================================
-- 8. FUNCOES
-- =====================================================================

-- ---- utilitarios de leitura da carga ----
create or replace function nz(t text) returns text
  language sql immutable set search_path to 'public','pg_temp' as $$
  select nullif(btrim(t), '')
$$;

create or replace function nzd(t text) returns date
  language sql immutable set search_path to 'public','pg_temp' as $$
  select case when btrim(coalesce(t,''))='' then null else btrim(t)::date end
$$;

create or replace function toca_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

-- ---- pessoas ----
-- O nome gravado na tratativa e texto livre; a pessoa e um cadastro. Esta
-- funcao e a ponte, e aceita apelido: "Nathalia" e "Nathalia Gomes" sao a
-- mesma operadora, e o ranking depende disso para nao rachar em duas linhas.
create or replace function pessoa_por_nome(t text) returns bigint
  language sql stable set search_path to 'public','pg_temp' as $$
  select p.id from pessoa p
  where p.chave = chave_nome(t)
     or exists (select 1 from unnest(p.apelidos) a where chave_nome(a) = chave_nome(t))
  order by p.ativo desc, p.id
  limit 1
$$;

create or replace function nome_canonico(t text) returns text
  language sql stable set search_path to 'public','pg_temp' as $$
  select coalesce((select p.nome from pessoa p where p.id = pessoa_por_nome(t)), nz(t))
$$;

-- Quem e gestor decide o que a RLS libera. SECURITY DEFINER porque a propria
-- politica de `pessoa` chamaria a si mesma para responder isso.
create or replace function e_gestor() returns boolean
  language sql stable security definer set search_path to 'public','pg_temp' as $$
  select exists (select 1 from pessoa g
                 where g.email = (auth.jwt() ->> 'email') and 'gestor' = any(g.papeis))
$$;

-- Canal estreito de escrita: a pessoa muda o proprio tema e nada mais. Sem
-- isto seria preciso abrir `pessoa` para update, o que abriria papeis junto.
create or replace function definir_tema(p_tema text) returns text
  language plpgsql security definer set search_path to 'public' as $$
declare v_email text;
begin
  if p_tema is not null and p_tema not in ('escuro','grafite','claro','pastel') then
    raise exception 'tema desconhecido: %', p_tema;
  end if;
  v_email := lower(coalesce(auth.jwt() ->> 'email', ''));
  if v_email = '' then
    raise exception 'sem sessao';
  end if;
  update public.pessoa set tema = p_tema where lower(email) = v_email;
  return p_tema;
end $$;

-- ---- calendario e prazos ----
-- A mesma conta existe identica no navegador (public/acordos.js). Duas
-- implementacoes da mesma regra e um risco assumido de propriedade: a tela
-- precisa responder enquanto se digita, sem ida ao banco, e o banco precisa
-- responder sem depender da tela. Os testes comparam as duas.
create or replace function pascoa(ano integer) returns date
  language plpgsql immutable set search_path to 'public','pg_temp' as $$
declare a int; b int; c int; d int; e int; f int; g int; h int;
        i int; k int; l int; m int; mes int; dia int;
begin
  a := ano % 19;      b := ano / 100;   c := ano % 100;
  d := b / 4;         e := b % 4;       f := (b + 8) / 25;
  g := (b - f + 1) / 3;
  h := (19*a + b - d - g + 15) % 30;
  i := c / 4;         k := c % 4;
  l := (32 + 2*e + 2*i - h - k) % 7;
  m := (a + 11*h + 22*l) / 451;
  mes := (h + l - 7*m + 114) / 31;
  dia := ((h + l - 7*m + 114) % 31) + 1;
  return make_date(ano, mes, dia);
end $$;

create or replace function semeia_feriados(ano integer) returns integer
  language plpgsql set search_path to 'public','pg_temp' as $$
declare p date := pascoa(ano); v integer;
begin
  insert into feriado (data, nome, abrangencia) values
    (make_date(ano, 1, 1),  'Confraternização Universal','nacional'),
    (make_date(ano, 4,21),  'Tiradentes','nacional'),
    (make_date(ano, 5, 1),  'Dia do Trabalho','nacional'),
    (make_date(ano, 9, 7),  'Independência','nacional'),
    (make_date(ano,10,12),  'Nossa Senhora Aparecida','nacional'),
    (make_date(ano,11, 2),  'Finados','nacional'),
    (make_date(ano,11,15),  'Proclamação da República','nacional'),
    (make_date(ano,11,20),  'Consciência Negra','nacional'),
    (make_date(ano,12,25),  'Natal','nacional'),
    (p - 48,                'Carnaval (segunda)','nacional'),
    (p - 47,                'Carnaval (terça)','nacional'),
    (p -  2,                'Sexta-feira Santa','nacional'),
    (p + 60,                'Corpus Christi','nacional')
  on conflict (data, abrangencia, uf) do nothing;
  get diagnostics v = row_count; return v;
end $$;

create or replace function eh_dia_util(d date, p_uf text default null,
                                       incluir_forense boolean default false)
  returns boolean language sql stable set search_path to 'public','pg_temp' as $$
  select extract(isodow from d) < 6
     and not exists (
       select 1 from feriado f
       where f.data = d
         and ( f.abrangencia = 'nacional'
            or (f.abrangencia = 'estadual' and f.uf = coalesce(p_uf,''))
            or (f.abrangencia = 'forense'  and incluir_forense) )
     )
$$;

create or replace function soma_dias_uteis(inicio date, dias integer, p_uf text default null,
                                           incluir_forense boolean default false)
  returns date language plpgsql stable set search_path to 'public','pg_temp' as $$
declare d date := inicio; restantes integer := dias;
begin
  if inicio is null or dias is null then return null; end if;
  if dias <= 0 then return inicio; end if;
  while restantes > 0 loop
    d := d + 1;
    if eh_dia_util(d, p_uf, incluir_forense) then restantes := restantes - 1; end if;
  end loop;
  return d;
end $$;

-- Previsao de recebimento: protocolo + prazo, pulando fim de semana e feriado
-- quando o prazo e em dias uteis. O recesso forense so conta se o parametro
-- `recesso_forense_suspende` estiver ligado.
create or replace function previsao_recebimento(protocolo date, prazo_dias integer,
                                                tipo_prazo text default 'corridos',
                                                p_uf text default null)
  returns date language sql stable set search_path to 'public','pg_temp' as $$
  select case
    when protocolo is null or prazo_dias is null then null
    when lower(unaccent_simples(coalesce(tipo_prazo,''))) like 'ut%'
      then soma_dias_uteis(protocolo, prazo_dias, p_uf,
             coalesce((select valor from config_parametro
                       where chave='recesso_forense_suspende'),0) = 1)
    else protocolo + prazo_dias
  end
$$;

-- ---- regras da tratativa ----
-- A previsao e derivada, nao digitada — a nao ser que alguem tenha digitado.
-- E acordo fechado sem data de atualizacao ganha a melhor data que a propria
-- linha tem, nunca "hoje" por preguica.
create or replace function ao_salvar_tratativa() returns trigger
  language plpgsql set search_path to 'public','pg_temp' as $$
begin
  if not new.previsao_manual then
    new.previsao := previsao_recebimento(new.data_protocolo, new.prazo_dias,
                                         new.tipo_prazo, new.estado);
  end if;
  if new.status = 'ACORDO FECHADO' and new.data_atualizacao is null then
    new.data_atualizacao := coalesce(new.data_protocolo, new.data_minuta_assinada,
                                     new.data, current_date);
  end if;
  return new;
end $$;

create or replace function ao_salvar_tratativa_parcelas() returns trigger
  language plpgsql set search_path to 'public','pg_temp' as $$
begin
  if new.status = 'ACORDO FECHADO' and new.valor is not null and new.previsao is not null then
    perform gera_parcelas(new.id);
  end if;
  return null;
end $$;

-- Previsao de caixa a partir do acordo fechado. Lancamento de verdade manda:
-- onde o ADVBox ja lancou, o sistema nao chuta; e parcela paga nunca e refeita,
-- porque pagamento e fato, nao previsao.
create or replace function gera_parcelas(p_tratativa bigint) returns integer
  language plpgsql set search_path to 'public','pg_temp' as $$
declare t record; base numeric(14,2); resto numeric(14,2); n integer; i integer; v integer := 0;
begin
  select * into t from tratativa where id = p_tratativa;
  if t is null or t.valor is null or t.previsao is null then return 0; end if;

  if exists (select 1 from acordo_recebimento
              where tratativa_id = p_tratativa and origem_registro = 'planilha') then
    return 0;
  end if;

  n := case when t.forma_pagamento = 'parcelado' then greatest(coalesce(t.qtd_parcelas,1),1) else 1 end;
  base  := round(t.valor / n, 2);
  resto := t.valor - (base * n);

  delete from acordo_recebimento
   where tratativa_id = p_tratativa and origem_registro = 'sistema' and situacao <> 'PAGO';

  for i in 1..n loop
    insert into acordo_recebimento (
      tratativa_id, id_acordo, processo, tipo, fase, verba, advogado,
      parcela_rotulo, parcela_num, parcela_total, vencimento, competencia,
      situacao, valor, descricao_original, origem_registro)
    values (
      p_tratativa, t.id_acordo, t.processo, t.tipo, t.fase, null, t.advogado,
      case when n > 1 then i || '/' || n else null end,
      case when n > 1 then i else null end,
      case when n > 1 then n else null end,
      (t.previsao + ((i - 1) * interval '1 month'))::date,
      to_char((t.previsao + ((i - 1) * interval '1 month'))::date, 'MM/YYYY'),
      'A VENCER',
      case when i = n then base + resto else base end,
      'Previsao gerada pelo sistema a partir do acordo.',
      'sistema');
    v := v + 1;
  end loop;
  return v;
end $$;

-- Liga verba e recebimento a tratativa pelo id do acordo, e apaga a previsao
-- do sistema onde o lancamento real ja chegou.
create or replace function amarra_financeiro() returns void
  language plpgsql set search_path to 'public','pg_temp' as $$
begin
  update acordo_verba v
     set tratativa_id = t.id
    from tratativa t
   where t.id_acordo = v.id_acordo and t.acordo_principal
     and v.tratativa_id is distinct from t.id;

  update acordo_recebimento r
     set tratativa_id = t.id
    from tratativa t
   where t.id_acordo = r.id_acordo and t.acordo_principal
     and r.tratativa_id is distinct from t.id;

  delete from acordo_recebimento s
   where s.origem_registro = 'sistema'
     and exists (select 1 from acordo_recebimento p
                  where p.origem_registro = 'planilha'
                    and p.tratativa_id = s.tratativa_id);
end $$;

-- Conciliacao com a base antiga de faturamento. So preenche o que falta e so
-- cria tratativa para acordo faturado que nao tem nenhuma — senao o
-- faturamento dele sumiria da tela de Acordos.
create or replace function sincroniza_faturamento() returns integer
  language plpgsql set search_path to 'public','pg_temp' as $$
declare v integer;
begin
  with melhor as (
    select distinct on (processo) processo, origem, produto, data_minuta, valor,
           data_protocolo, previsao, recebido, data_recebimento
    from acordo_faturado where processo is not null
    order by processo, valor desc nulls last
  )
  update tratativa t set
    tipo                 = coalesce(t.tipo, upper(m.origem)),
    produto              = coalesce(t.produto, m.produto),
    valor                = coalesce(t.valor, m.valor),
    data_minuta_assinada = coalesce(t.data_minuta_assinada, m.data_minuta),
    data_protocolo       = coalesce(t.data_protocolo, m.data_protocolo),
    previsao             = coalesce(t.previsao, m.previsao),
    recebido             = coalesce(t.recebido,false) or upper(coalesce(m.recebido,''))='SIM',
    data_recebimento     = coalesce(t.data_recebimento, m.data_recebimento),
    data_atualizacao     = coalesce(t.data_atualizacao, m.data_protocolo, m.data_minuta, t.data)
  from melhor m
  where m.processo = t.processo
    and (t.valor is null or t.data_protocolo is null);
  get diagnostics v = row_count;

  insert into tratativa (processo, autor, reu, advogado, produto, estado, tipo, fase,
                         status, data, data_atualizacao, valor, data_minuta_assinada,
                         data_protocolo, previsao, recebido, data_recebimento,
                         observacoes, origem_registro)
  select distinct on (f.processo)
         f.processo, f.autor, f.reu, f.advogado, f.produto, f.estado, upper(f.origem),
         case when upper(unaccent_simples(coalesce(f.fase,''))) like 'PRE%' then 'Pré-sentença'
              when upper(unaccent_simples(coalesce(f.fase,''))) like 'POS%' then 'Pós-sentença'
              else null end,
         'ACORDO FECHADO', coalesce(f.data_minuta, f.data_protocolo),
         coalesce(f.data_protocolo, f.data_minuta), f.valor, f.data_minuta,
         f.data_protocolo, f.previsao, upper(coalesce(f.recebido,''))='SIM',
         f.data_recebimento, f.observacoes, 'planilha'
  from acordo_faturado f
  where f.processo is not null
    and not exists (select 1 from tratativa t where t.processo = f.processo)
  order by f.processo, f.valor desc nulls last;

  perform gera_parcelas(id) from tratativa
   where status='ACORDO FECHADO' and valor is not null and previsao is not null;

  return v;
end $$;

-- ---- ranking de operador ----
-- Base para as regras de comissao. Recorta por periodo por conta propria: os
-- filtros da tela recortam tratativas, o ranking recorta pessoas, e misturar
-- os dois faria "operador" filtrar o proprio ranking.
create or replace function ranking_operador(p_de date default null, p_ate date default null)
returns table(operador text, ativo boolean, tratativas bigint, processos bigint,
              decididas bigint, acordos bigint, protocoladas bigint,
              valor_fechado numeric, valor_recebido numeric, valor_a_receber numeric,
              taxa_conversao numeric, ticket_medio numeric, dias_ate_protocolo numeric,
              primeira_tratativa date, ultima_tratativa date)
  language sql stable set search_path to 'public','pg_temp' as $$
with no_periodo as (
  select t.*
  from tratativa t
  where t.operador is not null
    and (p_de is null and p_ate is null
         or exists (
           select 1 from unnest(array[t.data, t.data_atualizacao, t.data_protocolo]) m
            where m is not null
              and (p_de is null or m >= p_de)
              and (p_ate is null or m <= p_ate)))
), base as (
  select
    t.operador,
    count(*)                                                       as tratativas,
    count(distinct t.processo)                                     as processos,
    count(*) filter (where f.conta_no_denominador)                 as decididas,
    count(*) filter (where t.status = 'ACORDO FECHADO'
                       and t.acordo_principal)                     as acordos,
    sum(t.valor) filter (where t.status = 'ACORDO FECHADO'
                          and t.acordo_principal)                  as valor_fechado,
    count(*) filter (where t.data_protocolo is not null)           as protocoladas,
    min(t.data)                                                    as primeira_tratativa,
    max(coalesce(t.data_atualizacao, t.data))                      as ultima_tratativa,
    avg(t.data_protocolo - t.data) filter (
        where t.data_protocolo is not null and t.data is not null
          and t.data_protocolo >= t.data)                          as dias_ate_protocolo
  from no_periodo t
  left join config_fase f on f.id = t.status and f.esteira = 'acordo'
  group by t.operador
), caixa as (
  -- Dinheiro entra pela data em que entrou, nao pela data da tratativa.
  select t.operador,
         sum(r.valor) filter (where r.situacao = 'PAGO')  as recebido,
         sum(r.valor) filter (where r.situacao <> 'PAGO') as a_receber
  from acordo_recebimento r
  join tratativa t on t.id = r.tratativa_id
  where t.operador is not null
    and (p_de is null and p_ate is null
         or (coalesce(r.data_pagamento, r.vencimento) is not null
             and (p_de is null or coalesce(r.data_pagamento, r.vencimento) >= p_de)
             and (p_ate is null or coalesce(r.data_pagamento, r.vencimento) <= p_ate)))
  group by t.operador
)
select
  b.operador, p.ativo,
  b.tratativas, b.processos, b.decididas, b.acordos, b.protocoladas,
  coalesce(b.valor_fechado, 0), coalesce(c.recebido, 0), coalesce(c.a_receber, 0),
  case when b.decididas > 0
       then round(b.acordos::numeric * 100 / b.decididas, 1) else 0 end,
  case when b.acordos > 0
       then round(coalesce(b.valor_fechado,0) / b.acordos, 2) else 0 end,
  round(b.dias_ate_protocolo, 1),
  b.primeira_tratativa, b.ultima_tratativa
from base b
left join caixa  c on c.operador = b.operador
left join pessoa p on p.nome     = b.operador
order by coalesce(b.valor_fechado, 0) desc
$$;

-- ---- carga a partir dos .psv de /dados ----
-- Cada arquivo e um blob delimitado por "|". Vem da Edge Function `carregar`,
-- que le o repositorio no GitHub. Ninguem abre o Supabase para carregar dado.
create or replace function carrega_execucao(blob text) returns integer
  language plpgsql set search_path to 'public','pg_temp' as $$
declare v integer;
begin
  insert into execucao (n_controle,produto,advogado,cliente,processo,valor,foro,vara,status,
                        data_expedicao,ultimo_andamento,data_ultimo_andamento,observacoes,
                        data_recebimento,origem_registro)
  select nz(p[1]),nz(p[2]),nome_canonico(p[3]),nz(p[4]),p[5],coalesce(nz(p[6])::numeric,0),
         nz(p[7]),nz(p[8]),p[9],nzd(p[10]),nz(p[11]),nzd(p[12]),nz(p[13]),nzd(p[14]),'planilha'
  from (select string_to_array(l,'|') p from unnest(string_to_array(blob, E'\n')) l where btrim(l)<>'') s;
  get diagnostics v = row_count; return v;
end $$;

create or replace function carrega_tratativa(blob text) returns integer
  language plpgsql set search_path to 'public','pg_temp' as $$
declare v integer;
begin
  insert into tratativa (
    id_acordo, fase, estado, advogado, processo, autor, reu, escritorio_adverso,
    canal, operador, data, status, observacoes, tipo, produto,
    data_minuta_assinada, valor, data_protocolo, previsao, recebido,
    data_recebimento, data_atualizacao, forma_pagamento, qtd_parcelas,
    acordo_principal, previsao_manual, origem_registro)
  select
    nz(p[1]), nz(p[2]), nz(p[3]), nome_canonico(p[4]), p[5], nz(p[6]), nz(p[7]), nz(p[8]),
    nz(p[9]), nome_canonico(p[10]), nzd(p[11]), coalesce(nz(p[12]),'AGUARDANDO RETORNO'),
    nz(p[13]), nz(p[14]), nz(p[15]),
    nzd(p[16]), nullif(btrim(p[17]),'')::numeric, nzd(p[18]), nzd(p[19]),
    coalesce(nz(p[20]),'false')::boolean,
    nzd(p[21]), nzd(p[22]), nz(p[23]), nullif(btrim(p[24]),'')::integer,
    coalesce(nz(p[25]),'true')::boolean,
    -- A previsao veio da base, nao de calculo. Sem marcar como manual, o
    -- gatilho a recalcularia a partir de um prazo que nao existe e a apagaria.
    nzd(p[19]) is not null,
    'planilha'
  from (select string_to_array(l,'|') p
        from unnest(string_to_array(blob, E'\n')) l where btrim(l) <> '') s
  -- A trava de processo unico vale tambem para a carga: um arquivo com o mesmo
  -- processo duas vezes nao reintroduz a duplicidade que ja foi limpa.
  on conflict (chave_processo(processo)) where chave_processo(processo) is not null
  do nothing;
  get diagnostics v = row_count; return v;
end $$;

create or replace function carrega_faturado(blob text) returns integer
  language plpgsql set search_path to 'public','pg_temp' as $$
declare v integer;
begin
  insert into acordo_faturado (origem,fase,advogado,produto,autor,reu,processo,data_minuta,valor,
                               protocolado,data_protocolo,estado,previsao,recebido,data_recebimento,
                               observacoes,origem_registro)
  select nz(p[1]),nz(p[2]),nome_canonico(p[3]),nz(p[4]),nz(p[5]),nz(p[6]),p[7],nzd(p[8]),
         coalesce(nz(p[9])::numeric,0),nz(p[10]),nzd(p[11]),nz(p[12]),nzd(p[13]),nz(p[14]),
         nzd(p[15]),nz(p[16]),'planilha'
  from (select string_to_array(l,'|') p from unnest(string_to_array(blob, E'\n')) l where btrim(l)<>'') s;
  get diagnostics v = row_count;
  perform sincroniza_faturamento();
  return v;
end $$;

create or replace function carrega_verba(blob text) returns integer
  language plpgsql set search_path to 'public','pg_temp' as $$
declare v integer;
begin
  insert into acordo_verba (id_acordo, processo, verba, detalhe, qtd_lancamentos,
                            valor_pago, valor_em_aberto, valor_total, origem_registro)
  select nz(p[1]), nz(p[2]), upper(btrim(p[3])), nz(p[4]),
         coalesce(nullif(btrim(p[5]),'')::integer, 0),
         coalesce(nullif(btrim(p[6]),'')::numeric, 0),
         coalesce(nullif(btrim(p[7]),'')::numeric, 0),
         coalesce(nullif(btrim(p[8]),'')::numeric, 0),
         'planilha'
  from (select string_to_array(l,'|') p
        from unnest(string_to_array(blob, E'\n')) l where btrim(l) <> '') s;
  get diagnostics v = row_count;
  perform amarra_financeiro();
  return v;
end $$;

create or replace function carrega_recebimento(blob text) returns integer
  language plpgsql set search_path to 'public','pg_temp' as $$
declare v integer;
begin
  insert into acordo_recebimento (
    id_acordo, processo, categoria_advbox, tipo, fase, verba, detalhe,
    parcela_rotulo, parcela_num, parcela_total, vencimento, competencia,
    data_pagamento, situacao, valor, advogado, descricao_original, origem_registro)
  select nz(p[1]), nz(p[2]), nz(p[3]), nz(p[4]), nz(p[5]),
         nullif(upper(btrim(p[6])),''), nz(p[7]),
         nz(p[8]), nullif(btrim(p[9]),'')::integer, nullif(btrim(p[10]),'')::integer,
         nzd(p[11]), nz(p[12]), nzd(p[13]),
         coalesce(nz(p[14]),'A VENCER'),
         coalesce(nullif(btrim(p[15]),'')::numeric, 0),
         nome_canonico(p[16]), nz(p[17]), 'planilha'
  from (select string_to_array(l,'|') p
        from unnest(string_to_array(blob, E'\n')) l where btrim(l) <> '') s;
  get diagnostics v = row_count;
  perform amarra_financeiro();
  return v;
end $$;

create or replace function carrega_advbox(blob text) returns integer
  language plpgsql set search_path to 'public','pg_temp' as $$
declare v integer;
begin
  insert into advbox_lancamento (conta,centro_custo,setor,tipo,vencimento,competencia,
                                 pagamento,categoria,descricao,valor,processo,partes)
  select nz(p[1]),nz(p[2]),nz(p[3]),nz(p[4]),nzd(p[5]),nz(p[6]),
         nzd(p[7]),p[8],nz(p[9]),coalesce(nz(p[10])::numeric,0),nz(p[11]),nz(p[12])
  from (select string_to_array(l,'|') p from unnest(string_to_array(blob, E'\n')) l where btrim(l)<>'') s;
  get diagnostics v = row_count; return v;
end $$;

-- Contato so entra na carga inicial: dai em diante e curadoria da equipe.
-- Enquanto a carga lia o arquivo a cada push, apagar um e-mail errado nao
-- adiantava nada — ele voltava no push seguinte.
create or replace function carrega_contato(blob text) returns integer
  language plpgsql set search_path to 'public','pg_temp' as $$
declare v integer;
begin
  create temp table _c on commit drop as
  select nz(p[1]) tipo, nz(p[2]) nome, chave_nome(nz(p[2])) chave, nz(p[3]) canal, nz(p[4]) valor
  from (select string_to_array(l,'|') p
        from unnest(string_to_array(blob, E'\n')) l where btrim(l)<>'') s;

  insert into parte_adversa (nome, origem_registro)
  select distinct on (c.chave) c.nome, 'planilha' from _c c
  where c.tipo='parte' and c.nome is not null
    and not exists (select 1 from parte_adversa p where p.chave = c.chave)
  order by c.chave, c.nome
  on conflict (nome) do nothing;

  insert into escritorio_adverso (nome, origem_registro)
  select distinct on (c.chave) c.nome, 'planilha' from _c c
  where c.tipo='escritorio' and c.nome is not null
    and not exists (select 1 from escritorio_adverso e where e.chave = c.chave)
  order by c.chave, c.nome
  on conflict (nome) do nothing;

  insert into contato (dono_tipo, dono_id, canal, valor, origem_registro)
  select c.tipo, coalesce(p.id, e.id), c.canal, c.valor, 'planilha'
  from _c c
  left join parte_adversa      p on c.tipo='parte'      and p.chave = c.chave
  left join escritorio_adverso e on c.tipo='escritorio' and e.chave = c.chave
  where c.canal is not null and c.valor is not null
    and coalesce(p.id, e.id) is not null
  on conflict (dono_tipo, dono_id, canal, valor) do nothing;

  get diagnostics v = row_count; return v;
end $$;

-- =====================================================================
-- 9. GATILHOS
-- =====================================================================
create trigger t_exec    before update on execucao           for each row execute function toca_updated_at();
create trigger t_trat    before update on tratativa          for each row execute function toca_updated_at();
create trigger t_fat     before update on acordo_faturado    for each row execute function toca_updated_at();
create trigger t_parte   before update on parte_adversa      for each row execute function toca_updated_at();
create trigger t_escr    before update on escritorio_adverso for each row execute function toca_updated_at();
create trigger t_cont    before update on contato            for each row execute function toca_updated_at();
create trigger t_parcela before update on acordo_parcela     for each row execute function toca_updated_at();
create trigger t_pessoa  before update on pessoa             for each row execute function toca_updated_at();
create trigger toca_acordo_verba        before update on acordo_verba
  for each row execute function toca_updated_at();
create trigger toca_acordo_recebimento  before update on acordo_recebimento
  for each row execute function toca_updated_at();

create trigger t_trat_calcula   before insert or update on tratativa
  for each row execute function ao_salvar_tratativa();
create trigger t_trat_parcelas  after  insert or update on tratativa
  for each row execute function ao_salvar_tratativa_parcelas();

-- =====================================================================
-- 10. VIEWS
--     Toda metrica e uma view. Tela, relatorio e exportacao leem a mesma.
--     Se dois numeros divergirem, alguem calculou fora daqui — e isso e bug
--     de implementacao, nao de interpretacao.
-- =====================================================================

-- Valor ainda em execucao, antes do caixa.
create or replace view vw_plantado as
  select id, n_controle, produto, advogado, cliente, processo, valor, foro, vara,
         status, data_expedicao, ultimo_andamento, data_ultimo_andamento,
         observacoes, data_recebimento, created_at, updated_at
    from execucao e
   where status = any (array['CS','CS-P','MLE SEM DESPACHO','EXPEDIDO','COM DESPACHO']);

-- Receita de verdade, de todas as origens. `MLE - ACORDO` fica de fora de
-- proposito: e levantamento de acordo ja faturado, e contar de novo seria
-- duplicar a mesma entrada. A trava vive aqui, nao na tela.
create or replace view vw_receita as
  select 'MLE'::text as origem, e.processo, e.cliente as parte, e.advogado, e.produto,
         null::text as estado, e.data_recebimento as data, e.valor
    from execucao e
   where e.status = 'RECEBIDO' and e.data_recebimento is not null
  union all
  select 'Acordo'::text, t.processo, t.autor, t.advogado, t.produto,
         t.estado, t.data_recebimento, t.valor
    from tratativa t
   where t.status = 'ACORDO FECHADO' and t.recebido and t.data_recebimento is not null
  union all
  select 'Trabalhista'::text, tb.processo, tb.autor, null::text, null::text,
         null::text, tb.data_recebimento, tb.valor
    from acordo_trabalhista tb
   where upper(coalesce(tb.recebido,'')) = 'SIM' and tb.data_recebimento is not null;

create or replace view vw_receita_mes as
  select origem, to_char(data::timestamptz, 'YYYY-MM') as mes,
         count(*) as qtd, sum(valor) as valor
    from vw_receita
   group by origem, to_char(data::timestamptz, 'YYYY-MM');

create or replace view vw_previsao as
  select cf.id as etapa, cf.nome, cf.cor, cf.confianca, cf.prazo_dias,
         count(e.id) as qtd,
         coalesce(sum(e.valor), 0) as bruto,
         round(coalesce(sum(e.valor), 0) * cf.confianca::numeric / 100.0, 2) as ponderado
    from config_fase cf
    left join execucao e on e.status = cf.id
   where cf.esteira = 'execucao' and cf.confianca is not null
   group by cf.id, cf.nome, cf.cor, cf.confianca, cf.prazo_dias, cf.ordem
   order by cf.ordem;

-- Denominador da taxa de sucesso: so o que teve desfecho. Um caso aguardando
-- audiencia esta vivo, e conta-lo como perda derrubaria a taxa por um motivo
-- que nao tem nada a ver com a qualidade da negociacao.
create or replace view vw_decididos as
  select t.id, t.fase, t.estado, t.advogado, t.processo, t.autor, t.reu,
         t.escritorio_adverso, t.canal, t.data, t.status, t.observacoes,
         t.created_at, t.updated_at
    from tratativa t
    join config_fase cf on cf.id = t.status and cf.esteira = 'acordo'
   where cf.conta_no_denominador;

create or replace view vw_kanban_acordo as
  select cf.id, cf.nome, cf.cor, cf.grupo_id, cf.ordem,
         count(t.id) as qtd,
         round(avg(current_date - t.data), 0) as idade_media
    from config_fase cf
    left join tratativa t on t.status = cf.id
   where cf.esteira = 'acordo'
   group by cf.id, cf.nome, cf.cor, cf.grupo_id, cf.ordem
   order by cf.ordem;

create or replace view vw_kanban_execucao as
  select cf.id, cf.nome, cf.cor, cf.grupo_id, cf.ordem,
         count(e.id) as qtd,
         coalesce(sum(e.valor), 0) as valor
    from config_fase cf
    left join execucao e on e.status = cf.id
   where cf.esteira = 'execucao'
   group by cf.id, cf.nome, cf.cor, cf.grupo_id, cf.ordem
   order by cf.ordem;

create or replace view vw_painel as
  with r as (select coalesce(sum(valor), 0) v from vw_receita
              where extract(year from data) = 2026),
       p as (select coalesce(sum(valor), 0) v from vw_plantado),
       mc as (select valor v from config_meta where chave = 'caixa_ano'),
       mo as (select valor v from config_meta where chave = 'objetivo_ano')
  select r.v as recebido, p.v as plantado, r.v + p.v as alcancado,
         mc.v as meta_caixa, mo.v as meta_objetivo,
         round(r.v / nullif(mc.v, 0) * 100, 1) as pct_caixa,
         round((r.v + p.v) / nullif(mo.v, 0) * 100, 1) as pct_objetivo,
         round(greatest(mc.v - r.v, 0)
               / nullif(12 - extract(month from current_date) + 1, 0), 2) as takt_mes,
         round(r.v / nullif(extract(month from current_date), 0), 2) as ritmo_mes
    from r, p, mc, mo;

create or replace view vw_equipe as
  select id, nome, email, papeis, apelidos, ativo,
         'advogado' = any (papeis) as e_advogado,
         'operador' = any (papeis) as e_operador,
         'gestor'   = any (papeis) as e_gestor,
         (select count(*) from tratativa t where pessoa_por_nome(t.advogado) = pessoa.id)
           as tratativas_como_advogado,
         (select count(*) from tratativa t where pessoa_por_nome(t.operador) = pessoa.id)
           as tratativas_como_operador
    from pessoa
   order by ativo desc, nome;

create or replace view vw_contato_tratativa as
  select 'parte'::text as dono_tipo, p.nome as dono_nome, p.chave as dono_chave,
         c.canal, c.valor, c.rotulo, c.preferencial
    from contato c join parte_adversa p on p.id = c.dono_id
   where c.dono_tipo = 'parte' and c.ativo
  union all
  select 'escritorio'::text, e.nome, e.chave, c.canal, c.valor, c.rotulo, c.preferencial
    from contato c join escritorio_adverso e on e.id = c.dono_id
   where c.dono_tipo = 'escritorio' and c.ativo;

-- ---- financeiro do acordo ----
-- Um acordo, uma linha, com tudo o que o financeiro pergunta: quanto foi
-- fechado, quanto entrou, quanto falta, o que esta atrasado.
create or replace view vw_acordo_financeiro as
  select t.id as tratativa_id, t.id_acordo, t.processo, t.autor, t.reu,
         t.escritorio_adverso, t.advogado, t.operador, t.produto, t.estado,
         t.tipo, t.fase, t.data as data_acordo, t.data_protocolo,
         t.valor as valor_acordo,
         coalesce(r.pago, 0)        as valor_pago,
         coalesce(r.em_aberto, 0)   as valor_em_aberto,
         coalesce(t.valor, 0) - coalesce(r.pago, 0) as saldo_a_receber,
         coalesce(r.lancamentos, 0) as qtd_lancamentos,
         coalesce(r.atrasados, 0)   as lancamentos_em_atraso,
         coalesce(r.valor_atrasado, 0) as valor_em_atraso,
         r.primeiro_pagamento, r.ultimo_pagamento,
         t.forma_pagamento, t.qtd_parcelas,
         coalesce(r.parcelas_pagas, 0) as parcelas_pagas,
         case
           when coalesce(r.lancamentos, 0) = 0 then 'SEM LANÇAMENTO'
           when coalesce(r.em_aberto, 0) = 0   then 'QUITADO'
           when coalesce(r.pago, 0) > 0        then 'PARCIAL'
           else 'EM ABERTO'
         end as situacao_financeira
    from tratativa t
    left join lateral (
      select count(*) as lancamentos,
             sum(x.valor) filter (where x.situacao = 'PAGO')  as pago,
             sum(x.valor) filter (where x.situacao <> 'PAGO') as em_aberto,
             count(*)     filter (where x.situacao = 'EM ATRASO') as atrasados,
             sum(x.valor) filter (where x.situacao = 'EM ATRASO') as valor_atrasado,
             count(*)     filter (where x.situacao = 'PAGO'
                                    and x.parcela_num is not null) as parcelas_pagas,
             min(x.data_pagamento) as primeiro_pagamento,
             max(x.data_pagamento) as ultimo_pagamento
        from acordo_recebimento x
       where x.tratativa_id = t.id) r on true
   where t.status = 'ACORDO FECHADO' and t.acordo_principal;

-- Cada recebimento com o semaforo pronto: recebido, vencido, vence na semana,
-- em dia. O verde/amarelo/vermelho da tela sai daqui, nao de conta na tela.
create or replace view vw_previsao_financeiro as
  select r.id as recebimento_id, t.id as tratativa_id, t.id_acordo, t.processo,
         t.autor, t.reu, t.advogado, t.operador, t.produto, t.estado, t.tipo,
         r.verba, r.detalhe,
         r.parcela_num as numero, coalesce(r.parcela_total, 1) as de,
         r.valor, r.vencimento as previsao, r.competencia, r.data_pagamento,
         r.situacao, r.origem_registro,
         r.situacao = 'PAGO' as recebido,
         r.vencimento - current_date as dias_para_vencer,
         case
           when r.situacao = 'PAGO'               then 'recebido'
           when r.vencimento is null              then 'sem previsao'
           when r.vencimento < current_date       then 'vencido'
           when r.vencimento <= current_date + 7  then 'vence na semana'
           else 'em dia'
         end as semaforo
    from acordo_recebimento r
    join tratativa t on t.id = r.tratativa_id;

create or replace view vw_verba_mes as
  select r.verba,
         coalesce(v.nome, r.verba) as verba_nome,
         coalesce(v.cor, '#5B6878') as cor,
         coalesce(r.competencia,
                  to_char(coalesce(r.data_pagamento, r.vencimento)::timestamptz, 'MM/YYYY'))
           as competencia,
         to_char(coalesce(r.data_pagamento, r.vencimento)::timestamptz, 'YYYY-MM') as mes,
         count(*) as lancamentos,
         sum(r.valor) as valor,
         sum(r.valor) filter (where r.situacao = 'PAGO')      as valor_pago,
         sum(r.valor) filter (where r.situacao = 'EM ATRASO') as valor_atrasado,
         sum(r.valor) filter (where r.situacao = 'A VENCER')  as valor_a_vencer
    from acordo_recebimento r
    left join config_verba v on v.id = r.verba
   group by r.verba, coalesce(v.nome, r.verba), coalesce(v.cor, '#5B6878'),
            coalesce(r.competencia,
                     to_char(coalesce(r.data_pagamento, r.vencimento)::timestamptz, 'MM/YYYY')),
            to_char(coalesce(r.data_pagamento, r.vencimento)::timestamptz, 'YYYY-MM');

-- O ranking sem recorte de periodo, para quem so quer o historico inteiro.
create or replace view vw_ranking_operador as
  select * from ranking_operador(null::date, null::date);

-- ---- conciliacao com o ADVBox ----
-- O ANDON nao existe so para ter um numero: enquanto as bases forem varias,
-- ele existe para dizer exatamente onde elas discordam.
create or replace view advbox_mes as
  select categoria,
         to_char(pagamento::timestamptz, 'YYYY-MM') as mes,
         count(*)::integer as qtd,
         round(sum(valor), 2)::numeric(14,2) as valor
    from advbox_lancamento
   where pagamento is not null
   group by categoria, to_char(pagamento::timestamptz, 'YYYY-MM');

create or replace view advbox_resumo as
  with l as (
    select categoria, valor, extract(year from pagamento)::integer as ano
      from advbox_lancamento where pagamento is not null),
  ded as (
    select coalesce(valor, 0) v from config_parametro where chave = 'advbox_deducoes')
  select l.categoria, round(sum(l.valor), 2)::numeric(14,2) as valor, l.ano
    from l group by l.categoria, l.ano
  union all
  select 'RECEITA BRUTA', round(sum(l.valor), 2)::numeric(14,2), l.ano
    from l group by l.ano
  union all
  select '0. DEDUÇÕES', ((select v from ded))::numeric(14,2), l.ano
    from l group by l.ano
  union all
  select 'RECEITA LIQUIDA',
         (round(sum(l.valor), 2) - (select v from ded))::numeric(14,2), l.ano
    from l group by l.ano;

create or replace view vw_conciliacao as
  with anos as (
    select distinct extract(year from pagamento)::integer a
      from advbox_lancamento where pagamento is not null),
  eq as (
    select 'MLE'::text o, coalesce(sum(valor), 0) v from vw_receita
     where origem = 'MLE' and extract(year from data)::integer in (select a from anos)
    union all
    select 'Acordos', coalesce(sum(valor), 0) from vw_receita
     where origem = 'Acordo' and extract(year from data)::integer in (select a from anos)
    union all
    select 'Trabalhista', coalesce(sum(valor), 0) from vw_receita
     where origem = 'Trabalhista' and extract(year from data)::integer in (select a from anos)),
  ab as (
    select 'MLE'::text o, coalesce(sum(valor), 0) v from advbox_lancamento
     where categoria = 'Mle'
    union all
    select 'Acordos', coalesce(sum(valor), 0) from advbox_lancamento
     where categoria like 'Acordo P%'
    union all
    select 'Trabalhista', coalesce(sum(valor), 0) from advbox_lancamento
     where categoria = 'Acordo Trabalhista')
  select eq.o as origem, eq.v as controle_equipe, ab.v as advbox,
         ab.v - eq.v as diferenca
    from eq join ab on ab.o = eq.o;

create or replace view vw_conciliacao_processo as
  with anos as (
    select distinct extract(year from pagamento)::integer a
      from advbox_lancamento where pagamento is not null),
  eq as (
    select processo, sum(valor) v, count(*)::integer q from vw_receita
     where processo is not null and extract(year from data)::integer in (select a from anos)
     group by processo),
  ab as (
    select processo, sum(valor) v, count(*)::integer q from advbox_lancamento
     where processo is not null group by processo)
  select coalesce(eq.processo, ab.processo) as processo,
         coalesce(eq.v, 0)::numeric(14,2) as controle,
         coalesce(eq.q, 0) as qtd_controle,
         coalesce(ab.v, 0)::numeric(14,2) as advbox,
         coalesce(ab.q, 0) as qtd_advbox,
         (coalesce(ab.v, 0) - coalesce(eq.v, 0))::numeric(14,2) as diferenca,
         case when eq.processo is null then 'so_advbox'
              when ab.processo is null then 'so_controle'
              else 'valor_diferente' end as situacao
    from eq full join ab on ab.processo = eq.processo
   where abs(coalesce(ab.v, 0) - coalesce(eq.v, 0)) >= 0.01;

-- O mesmo valor dos dois lados sob numeros de processo diferentes: quase
-- sempre e ponto no lugar do hifen. Nao muda o total, mas e o tipo de coisa
-- que vira pagamento em duplicidade.
create or replace view vw_conciliacao_par as
  with a as (select processo, advbox v from vw_conciliacao_processo
              where situacao = 'so_advbox'),
       b as (select processo, controle v from vw_conciliacao_processo
              where situacao = 'so_controle'),
       uv as (select v from a group by v having count(*) = 1
              intersect
              select v from b group by v having count(*) = 1)
  select a.processo as processo_advbox, b.processo as processo_controle, a.v as valor
    from a join b on b.v = a.v join uv on uv.v = a.v;

-- =====================================================================
-- 11. SEGURANCA (RLS)
--     Toda tabela tem RLS ligada e nenhuma politica aceita `anon`. A chave
--     publicavel que esta nos arquivos de public/ sozinha nao abre nada:
--     o papel dela e `anon`, e a base so responde a quem entrou pelo login.
--     Ficou registrado porque nao foi sempre assim — ate a tela de login
--     existir, a leitura era liberada para `anon` num repositorio publico.
-- =====================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'execucao','tratativa','acordo_parcela','acordo_verba','acordo_recebimento',
    'acordo_faturado','acordo_trabalhista','advbox_lancamento','pessoa',
    'parte_adversa','escritorio_adverso','parte_escritorio','contato',
    'config_grupo','config_fase','config_meta','config_parametro','config_verba','feriado']
  loop
    execute format('alter table %I enable row level security', t);
    execute format($f$create policy leitura_%1$s on %1$I
                      for select to authenticated using (true)$f$, t);
  end loop;

  -- Escrita da operacao: quem entrou trabalha. O controle de quem pode o que
  -- e de papel na tela, nao de tabela — nesta equipe todo mundo que entra
  -- mexe em tratativa, cadastro e financeiro.
  foreach t in array array[
    'execucao','tratativa','acordo_parcela','acordo_verba','acordo_recebimento',
    'acordo_faturado','acordo_trabalhista','advbox_lancamento',
    'parte_adversa','escritorio_adverso','parte_escritorio','contato','feriado']
  loop
    execute format($f$create policy escrita_%1$s on %1$I
                      for all to authenticated using (true) with check (true)$f$, t);
  end loop;

  -- Configuracao e equipe sao do gestor. Papel, meta e fase mudam o que o
  -- sistema conta — nao e coisa para qualquer sessao alterar.
  foreach t in array array['pessoa','config_grupo','config_fase','config_meta',
                           'config_parametro','config_verba']
  loop
    execute format($f$create policy escrita_%1$s on %1$I
                      for all to authenticated using (e_gestor()) with check (e_gestor())$f$, t);
  end loop;
end $$;

-- Views herdam a permissao de quem consulta, nunca a de quem as criou.
alter view vw_plantado             set (security_invoker = on);
alter view vw_receita              set (security_invoker = on);
alter view vw_receita_mes          set (security_invoker = on);
alter view vw_previsao             set (security_invoker = on);
alter view vw_decididos            set (security_invoker = on);
alter view vw_kanban_acordo        set (security_invoker = on);
alter view vw_kanban_execucao      set (security_invoker = on);
alter view vw_painel               set (security_invoker = on);
alter view vw_equipe               set (security_invoker = on);
alter view vw_contato_tratativa    set (security_invoker = on);
alter view vw_acordo_financeiro    set (security_invoker = on);
alter view vw_previsao_financeiro  set (security_invoker = on);
alter view vw_verba_mes            set (security_invoker = on);
alter view vw_ranking_operador     set (security_invoker = on);
alter view vw_conciliacao          set (security_invoker = on);
alter view vw_conciliacao_processo set (security_invoker = on);
alter view vw_conciliacao_par      set (security_invoker = on);
alter view advbox_resumo           set (security_invoker = on);
alter view advbox_mes              set (security_invoker = on);

-- =====================================================================
-- 12. CONFIGURACAO INICIAL
--     Nao e dado de negocio: e o vocabulario do sistema. A carga de /dados
--     depende de as fases existirem antes.
-- =====================================================================
insert into config_grupo (id, esteira, nome, descricao, cor, ordem) values
  ('contato','acordo','Em contato','A bola esta com a equipe','#6366F1',1),
  ('travado','acordo','Travado no processo','Vivo, mas depende de ato de terceiro','#F59E0B',2),
  ('formaliza','acordo','Formalizando','Acertado na conversa, aguardando minuta e protocolo','#06B6D4',3),
  ('ganho','acordo','Ganho','Acordo fechado, vai para faturamento','#A3E635',4),
  ('perdido','acordo','Perdido','Desfecho negativo','#FB7185',5),
  ('cumpr','execucao','Em cumprimento','Sem deposito ainda','#6366F1',1),
  ('levan','execucao','Levantamento','Depositado — corrida ate o caixa','#06B6D4',2),
  ('caixa','execucao','Caixa','Recebido em conta','#A3E635',3),
  ('fora','execucao','Fora da receita','Ja faturado em acordos','#A855F7',4);

-- As tres fases de formalizacao ficam fora do denominador e fora de
-- "finalizada" de proposito: o desfecho ainda nao aconteceu (conta-las como
-- decididas derrubaria a taxa por um caso que esta indo bem) e o relogio TEM
-- que correr ali, porque e exatamente onde o caso fica parado esperando ato
-- de outra pessoa. Ver isso parado e o motivo de o painel existir.
insert into config_fase (id, esteira, nome, grupo_id, cor, ordem, descricao,
                         confianca, prazo_dias, conta_no_denominador, conta_receita, finalizada) values
  ('AGUARDANDO RETORNO','acordo','Aguardando retorno','contato','#6366F1',1,null,null,null,false,false,false),
  ('EM TRATATIVA','acordo','Em tratativa','contato','#A855F7',2,null,null,null,false,false,false),
  ('AGUARDANDO ENVIO DA MINUTA','acordo','Aguardando envio da minuta','formaliza','#22D3EE',3,
   'Acordo acertado. A minuta e confeccionada pela parte contraria — a bola esta com ela.',null,null,false,false,false),
  ('AGUARDANDO ASSINATURA DA MINUTA','acordo','Aguardando assinatura da minuta','formaliza','#38BDF8',4,
   'Minuta recebida e encaminhada ao advogado responsavel pelo caso para assinar.',null,null,false,false,false),
  ('AGUARDANDO PROTOCOLO','acordo','Aguardando protocolo','formaliza','#818CF8',5,
   'Minuta assinada e devolvida a parte contraria. Daqui em diante quem cuida e o financeiro.',null,null,false,false,false),
  ('ACORDO FECHADO','acordo','Acordo fechado','ganho','#A3E635',6,null,null,null,true,false,true),
  ('RECUSADO','acordo','Recusado','perdido','#FB7185',7,null,null,null,true,false,true),
  ('SEM RETORNO','acordo','Sem retorno','perdido','#F43F5E',8,null,null,null,true,false,true),
  ('AGUARDANDO AUDIÊNCIA','acordo','Aguardando audiência','travado','#EBC15C',9,null,null,null,false,false,false),
  ('AGUARD. CONTESTAÇÃO','acordo','Aguard. contestação','travado','#F59E0B',10,null,null,null,false,false,false),
  ('AGUARDANDO RECURSO','acordo','Aguardando recurso','travado','#EAB308',11,null,null,null,false,false,false),
  ('MLE','acordo','MLE','travado','#D97706',12,null,null,null,false,false,false),
  ('EM EXECUÇÃO','acordo','Em execução','travado','#7CC4E0',13,null,null,null,false,false,false),
  ('IMPROCEDENTE','acordo','Improcedente','perdido','#BE123C',14,null,null,null,true,false,true),
  ('CS','execucao','CS','cumpr','#6366F1',1,'Cumprimento definitivo',null,null,false,false,false),
  ('CS-P','execucao','CS-P','cumpr','#A855F7',2,'Cumprimento provisorio',null,null,false,false,false),
  ('MLE SEM DESPACHO','execucao','MLE sem despacho','levan','#06B6D4',3,'Formulario de levantamento juntado',70,70,false,false,false),
  ('EXPEDIDO','execucao','Expedido','levan','#14B8A6',4,'Juiz deferiu e expediu',85,38,false,false,false),
  ('COM DESPACHO','execucao','Com despacho','levan','#22C55E',5,'Serventuario autorizou o banco',95,11,false,false,false),
  ('RECEBIDO','execucao','Recebido','caixa','#A3E635',6,'Valor em conta',null,null,false,true,true),
  ('MLE - ACORDO','execucao','MLE · Acordo','fora','#A855F7',7,'Nasceu de acordo ja faturado — nao soma receita',null,null,false,false,false);

insert into config_verba (id, nome, descricao, cor, ordem, ativo) values
  ('DM','Danos morais','Indenizacao do cliente','#6366F1',1,true),
  ('HS','Honorarios','Honorarios do escritorio','#14B8A6',2,true),
  -- Existiu enquanto o acordo podia ser fechado sem separar as duas verbas.
  ('DM+HS','DM + HS','Acordo fechado sem discriminar as duas verbas','#A855F7',3,false),
  ('TRABALHISTA','Trabalhista','Acordo trabalhista','#F59E0B',4,true),
  ('OUTROS','Outros','Verbas que nao se encaixam nas anteriores','#94A3B8',5,true);

insert into config_meta (chave, valor, rotulo, ano) values
  ('acordos_mes',  140000.00,'Meta mensal do departamento de Acordos',2026),
  ('caixa_ano',   4000000.00,'Meta de caixa efetivo no ano',2026),
  ('objetivo_ano',6500000.00,'Objetivo total: caixa mais plantado',2026);

insert into config_parametro (chave, valor, texto, rotulo) values
  ('advbox_deducoes',          214105.18,null,'ADVBox — deducoes do ano, para a receita liquida'),
  ('alerta_critico',               90.00,null,'Dias parado para acender critico'),
  ('alerta_parado',                45.00,null,'Dias parado para acender atencao'),
  ('pct_cliente',                  65.00,null,'Percentual do cliente no repasse'),
  ('piso_oab_2026',                 null,null,'Piso da tabela OAB de 2026 — pendente de cadastro'),
  ('pos_min_honorario',            20.00,null,'Pos-sentenca: minimo de honorarios'),
  ('pre_alvo_honorario',           33.33,null,'Pre-sentenca: alvo de honorarios'),
  ('recesso_forense_suspende',      0.00,null,'Recesso forense (20/12 a 20/01) suspende o prazo do acordo? 1 = sim, 0 = nao'),
  ('wip_limite',                   60.00,null,'Limite de casos em curso por coluna');

-- Recesso forense: 20/12 a 20/01, dias corridos. Fica marcado como
-- `forense` e nao como feriado nacional porque so suspende prazo quando o
-- parametro `recesso_forense_suspende` estiver ligado — hoje esta desligado,
-- e a previsao de recebimento passa por cima dele.
create or replace function semeia_recesso(ano integer) returns integer
  language plpgsql set search_path to 'public','pg_temp' as $$
declare v integer;
begin
  insert into feriado (data, nome, abrangencia)
  select d::date, 'Recesso forense', 'forense'
    from generate_series(make_date(ano,12,20), make_date(ano+1,1,20), interval '1 day') d
  on conflict (data, abrangencia, uf) do nothing;
  get diagnostics v = row_count; return v;
end $$;

-- Feriados nacionais, calculados (Pascoa movel inclusa), e o recesso, cinco
-- anos a frente. A previsao de recebimento depende deles: sem feriado
-- cadastrado, prazo em dias uteis cai em cima de feriado sem ninguem notar.
select semeia_feriados(a) from generate_series(2025, 2030) a;
select semeia_recesso(a)  from generate_series(2025, 2029) a;
