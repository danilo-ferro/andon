-- =====================================================================
-- ANDON — esquema completo
-- Canaverde & Aguiar Advogados Associados
-- =====================================================================
-- Espelho fiel das migrations já aplicadas no projeto Supabase.
-- Serve para versionamento e para recriar o banco do zero quando for
-- hora de sair do projeto de teste para o definitivo.
--
-- Ordem: rode este arquivo UMA vez num projeto limpo. A carga de dados
-- vem depois — pela Edge Function `carregar` (recomendado, veja
-- docs/COMO-COLOCAR-NO-AR.md) ou pelos arquivos supabase/carga_*.sql.
-- =====================================================================

-- Limpeza do esquema anterior, caso exista
drop table if exists teste_resultado, template_mensagem, perfil_usuario,
  acordo_parcela, acordo_status_historico, acordo_interacao, acordo,
  execucao_status_historico, execucao_item, andamento, processo,
  contato, escritorio_adverso, contraparte, cliente, vara, foro, tese, produto,
  operador, advogado, meta, feriado, tabela_oab, parametro_repasse,
  parametro_composicao, parametro_ciclo cascade;

drop type if exists fase_processual, canal_contato, origem_acordo, etapa_acordo,
  status_acordo, tipo_execucao, origem_receita, status_execucao, status_parcela,
  tipo_andamento, tipo_saldo cascade;

-- =====================================================================
-- 1. EXECUÇÃO — espelha o MAPA EXECUÇÃO. Cada linha é um VALOR, não um
--    processo: o mesmo processo pode ter parte levantada e um saldo
--    remanescente ainda executando.
-- =====================================================================
create table execucao (
  id            bigserial primary key,
  n_controle    text,
  produto       text,
  advogado      text,
  cliente       text,
  processo      text not null,
  valor         numeric(14,2) not null default 0,
  foro          text,
  vara          text,
  status        text not null,
  data_expedicao        date,
  ultimo_andamento      text,
  data_ultimo_andamento date,
  observacoes   text,
  data_recebimento      date,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index on execucao (status);
create index on execucao (processo);
create index on execucao (data_recebimento);
create index on execucao (data_ultimo_andamento);

comment on table execucao is
  'Carga via carrega_execucao(). Status MLE - ACORDO nao soma receita: ja faturou em acordo_faturado.';

-- =====================================================================
-- 2. TRATATIVA — espelha o CONTROLE DE TRATATIVAS. Só negociação;
--    quando fecha, o dado completo vive em acordo_faturado.
-- =====================================================================
create table tratativa (
  id          bigserial primary key,
  fase        text,              -- PRÉ / PÓS
  estado      text,
  advogado    text,
  processo    text not null,
  autor       text,
  reu         text,
  escritorio_adverso text,
  canal       text,              -- E-MAIL / WHATSAPP / ...
  data        date,
  status      text not null,
  observacoes text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index on tratativa (status);
create index on tratativa (processo);
create index on tratativa (data);

-- =====================================================================
-- 3. ACORDO FATURADO — espelha o RELATÓRIO FATURAMENTO.
--    data_protocolo é o marco financeiro.
-- =====================================================================
create table acordo_faturado (
  id          bigserial primary key,
  origem      text,              -- ATIVO / PASSIVO
  fase        text,              -- PRÉ / PÓS
  advogado    text,
  produto     text,
  autor       text,
  reu         text,
  processo    text not null,
  data_minuta date,
  valor       numeric(14,2) not null default 0,
  protocolado text,
  data_protocolo   date,
  estado      text,
  previsao    date,
  recebido    text,
  data_recebimento date,
  observacoes text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index on acordo_faturado (data_protocolo);
create index on acordo_faturado (data_recebimento);
create index on acordo_faturado (processo);

-- =====================================================================
-- 4. TRABALHISTA — conduzido por advogado parceiro. Entra só para
--    métrica de faturamento; a operação não é gerida por este sistema.
-- =====================================================================
create table acordo_trabalhista (
  id          bigserial primary key,
  autor       text,
  reu         text,
  processo    text,
  data        date,
  valor       numeric(14,2) not null default 0,
  previsao    date,
  recebido    text,
  data_recebimento date,
  observacoes text,
  created_at  timestamptz not null default now()
);

-- =====================================================================
-- 5. ADVBOX — receita já lançada no sistema financeiro atual
-- =====================================================================
create table advbox_resumo (
  categoria text primary key,
  valor     numeric(14,2) not null default 0,
  ano       integer not null default 2026
);
create table advbox_mes (
  id        bigserial primary key,
  categoria text not null,
  mes       text not null,       -- AAAA-MM
  qtd       integer not null default 0,
  valor     numeric(14,2) not null default 0,
  unique (categoria, mes)
);

-- =====================================================================
-- 6. CONFIGURAÇÃO — fases, grupos e metas editáveis pela tela Ajustes
-- =====================================================================
create table config_grupo (
  id        text primary key,
  esteira   text not null check (esteira in ('acordo','execucao')),
  nome      text not null,
  descricao text,
  cor       text not null,
  ordem     integer not null default 0
);

create table config_fase (
  id          text primary key,   -- igual ao status gravado na base
  esteira     text not null check (esteira in ('acordo','execucao')),
  nome        text not null,
  grupo_id    text references config_grupo(id),
  cor         text not null,
  ordem       integer not null default 0,
  descricao   text,
  confianca   integer,            -- % usado na previsão ponderada
  prazo_dias  integer,            -- dias estimados até o caixa
  conta_no_denominador boolean not null default false,
  conta_receita        boolean not null default false
);

create table config_meta (
  chave     text primary key,
  valor     numeric(14,2) not null,
  rotulo    text,
  ano       integer not null default 2026
);

create table config_parametro (
  chave     text primary key,
  valor     numeric(14,2),
  texto     text,
  rotulo    text
);

create or replace function toca_updated_at() returns trigger as $$
begin new.updated_at := now(); return new; end $$ language plpgsql;

create trigger t_exec  before update on execucao        for each row execute function toca_updated_at();
create trigger t_trat  before update on tratativa       for each row execute function toca_updated_at();
create trigger t_fat   before update on acordo_faturado for each row execute function toca_updated_at();

-- =====================================================================
-- 7. CONFIGURAÇÃO INICIAL
-- =====================================================================

insert into config_grupo (id, esteira, nome, descricao, cor, ordem) values
  ('contato','acordo','Em contato','A bola esta com a equipe','#6366F1',1),
  ('travado','acordo','Travado no processo','Vivo, mas depende de ato de terceiro','#F59E0B',2),
  ('ganho','acordo','Ganho','Acordo fechado, vai para faturamento','#A3E635',3),
  ('perdido','acordo','Perdido','Desfecho negativo','#FB7185',4),
  ('cumpr','execucao','Em cumprimento','Sem deposito ainda','#6366F1',1),
  ('levan','execucao','Levantamento','Depositado — corrida ate o caixa','#06B6D4',2),
  ('caixa','execucao','Caixa','Recebido em conta','#A3E635',3),
  ('fora','execucao','Fora da receita','Ja faturado em acordos','#A855F7',4);

-- Fases de ACORDO (nomes reais da planilha de tratativas).
-- conta_no_denominador: só desfechos entram na taxa de sucesso. Um caso
-- "aguardando audiência" está vivo — contá-lo como perda derrubaria a
-- taxa por um motivo que não tem a ver com a negociação.
insert into config_fase (id, esteira, nome, grupo_id, cor, ordem, conta_no_denominador) values
  ('AGUARDANDO RETORNO','acordo','Aguardando retorno','contato','#6366F1',1,false),
  ('EM TRATATIVA','acordo','Em tratativa','contato','#A855F7',2,false),
  ('AGUARD. CONTESTAÇÃO','acordo','Aguard. contestação','travado','#F59E0B',3,false),
  ('AGUARDANDO RECURSO','acordo','Aguardando recurso','travado','#EAB308',4,false),
  ('MLE','acordo','MLE','travado','#D97706',5,false),
  ('ACORDO FECHADO','acordo','Acordo fechado','ganho','#A3E635',6,true),
  ('RECUSADO','acordo','Recusado','perdido','#FB7185',7,true),
  ('SEM RETORNO','acordo','Sem retorno','perdido','#F43F5E',8,true),
  ('IMPROCEDENTE','acordo','Improcedente','perdido','#BE123C',9,true);

-- Fases de EXECUÇÃO (status reais do mapa)
insert into config_fase (id, esteira, nome, grupo_id, cor, ordem, descricao, confianca, prazo_dias, conta_receita) values
  ('CS','execucao','CS','cumpr','#6366F1',1,'Cumprimento definitivo',null,null,false),
  ('CS-P','execucao','CS-P','cumpr','#A855F7',2,'Cumprimento provisorio',null,null,false),
  ('MLE SEM DESPACHO','execucao','MLE sem despacho','levan','#06B6D4',3,'Formulario de levantamento juntado',70,70,false),
  ('EXPEDIDO','execucao','Expedido','levan','#14B8A6',4,'Juiz deferiu e expediu',85,38,false),
  ('COM DESPACHO','execucao','Com despacho','levan','#22C55E',5,'Serventuario autorizou o banco',95,11,false),
  ('RECEBIDO','execucao','Recebido','caixa','#A3E635',6,'Valor em conta',null,null,true),
  ('MLE - ACORDO','execucao','MLE · Acordo','fora','#A855F7',7,'Nasceu de acordo ja faturado — nao soma receita',null,null,false);

insert into config_meta (chave, valor, rotulo) values
  ('caixa_ano',      4000000,'Meta de caixa efetivo no ano'),
  ('objetivo_ano',   6500000,'Objetivo total: caixa mais plantado'),
  ('acordos_mes',     140000,'Meta mensal do departamento de Acordos');

insert into config_parametro (chave, valor, rotulo) values
  ('alerta_parado',      45,'Dias parado para acender atencao'),
  ('alerta_critico',     90,'Dias parado para acender critico'),
  ('wip_limite',         60,'Limite de casos em curso por coluna'),
  ('pct_cliente',        65,'Percentual do cliente no repasse'),
  ('pre_alvo_honorario', 33.33,'Pre-sentenca: alvo de honorarios'),
  ('pos_min_honorario',  20,'Pos-sentenca: minimo de honorarios'),
  ('piso_oab_2026',    null,'Piso da tabela OAB de 2026 — pendente de cadastro');

-- =====================================================================
-- 8. CARGA — parser que recebe um blob delimitado por | e quebra em linhas.
--    Serve para a carga inicial e para reimportar planilha depois.
-- =====================================================================
create or replace function nz(t text) returns text as $$
  select nullif(btrim(t), '')
$$ language sql immutable;

create or replace function nzd(t text) returns date as $$
  select case when btrim(coalesce(t,''))='' then null else btrim(t)::date end
$$ language sql immutable;

create or replace function carrega_execucao(blob text) returns integer as $$
declare v integer;
begin
  insert into execucao (n_controle,produto,advogado,cliente,processo,valor,foro,vara,status,
                        data_expedicao,ultimo_andamento,data_ultimo_andamento,observacoes,data_recebimento)
  select nz(p[1]),nz(p[2]),nz(p[3]),nz(p[4]),p[5],coalesce(nz(p[6])::numeric,0),nz(p[7]),nz(p[8]),p[9],
         nzd(p[10]),nz(p[11]),nzd(p[12]),nz(p[13]),nzd(p[14])
  from (select string_to_array(l,'|') p from unnest(string_to_array(blob, E'\n')) l where btrim(l)<>'') s;
  get diagnostics v = row_count; return v;
end $$ language plpgsql;

create or replace function carrega_tratativa(blob text) returns integer as $$
declare v integer;
begin
  insert into tratativa (fase,estado,advogado,processo,autor,reu,escritorio_adverso,canal,data,status,observacoes)
  select nz(p[1]),nz(p[2]),nz(p[3]),p[4],nz(p[5]),nz(p[6]),nz(p[7]),nz(p[8]),nzd(p[9]),p[10],nz(p[11])
  from (select string_to_array(l,'|') p from unnest(string_to_array(blob, E'\n')) l where btrim(l)<>'') s;
  get diagnostics v = row_count; return v;
end $$ language plpgsql;

create or replace function carrega_faturado(blob text) returns integer as $$
declare v integer;
begin
  insert into acordo_faturado (origem,fase,advogado,produto,autor,reu,processo,data_minuta,valor,
                               protocolado,data_protocolo,estado,previsao,recebido,data_recebimento,observacoes)
  select nz(p[1]),nz(p[2]),nz(p[3]),nz(p[4]),nz(p[5]),nz(p[6]),p[7],nzd(p[8]),coalesce(nz(p[9])::numeric,0),
         nz(p[10]),nzd(p[11]),nz(p[12]),nzd(p[13]),nz(p[14]),nzd(p[15]),nz(p[16])
  from (select string_to_array(l,'|') p from unnest(string_to_array(blob, E'\n')) l where btrim(l)<>'') s;
  get diagnostics v = row_count; return v;
end $$ language plpgsql;

-- =====================================================================
-- 9. VIEWS — toda métrica nasce aqui, uma vez só.
--    A tela nunca recalcula número. Se painel e relatório divergirem,
--    é porque alguém calculou fora daqui.
-- =====================================================================

-- Plantado: em execução e ainda não é caixa. MLE - ACORDO fica de fora.
create or replace view vw_plantado as
select e.* from execucao e
where e.status in ('CS','CS-P','MLE SEM DESPACHO','EXPEDIDO','COM DESPACHO');

-- Receita realizada, das três origens. A trava anti-duplicidade vive aqui:
-- MLE - ACORDO nunca entra, porque já entrou como acordo faturado.
create or replace view vw_receita as
select 'MLE'::text as origem, e.processo, e.cliente as parte, e.advogado, e.produto,
       null::text as estado, e.data_recebimento as data, e.valor
from execucao e where e.status='RECEBIDO' and e.data_recebimento is not null
union all
select 'Acordo', f.processo, f.autor, f.advogado, f.produto, f.estado, f.data_recebimento, f.valor
from acordo_faturado f where upper(coalesce(f.recebido,''))='SIM' and f.data_recebimento is not null
union all
select 'Trabalhista', t.processo, t.autor, null, null, null, t.data_recebimento, t.valor
from acordo_trabalhista t where upper(coalesce(t.recebido,''))='SIM' and t.data_recebimento is not null;

comment on view vw_receita is
  'Fonte unica da receita. MLE - ACORDO fica de fora por construcao — e a trava anti-duplicidade.';

create or replace view vw_receita_mes as
select origem, to_char(data,'YYYY-MM') as mes, count(*) qtd, sum(valor) valor
from vw_receita group by 1,2;

-- Previsão ponderada: cada etapa vale o que ela promete de verdade.
create or replace view vw_previsao as
select cf.id as etapa, cf.nome, cf.cor, cf.confianca, cf.prazo_dias,
       count(e.id) qtd, coalesce(sum(e.valor),0) bruto,
       round(coalesce(sum(e.valor),0) * cf.confianca / 100.0, 2) ponderado
from config_fase cf
left join execucao e on e.status = cf.id
where cf.esteira='execucao' and cf.confianca is not null
group by cf.id, cf.nome, cf.cor, cf.confianca, cf.prazo_dias, cf.ordem
order by cf.ordem;

-- Taxa de sucesso. Só desfechos no denominador: um caso aguardando
-- audiência está vivo, contá-lo como perda mentiria para baixo.
create or replace view vw_decididos as
select t.* from tratativa t
join config_fase cf on cf.id = t.status and cf.esteira='acordo'
where cf.conta_no_denominador;

create or replace view vw_kanban_acordo as
select cf.id, cf.nome, cf.cor, cf.grupo_id, cf.ordem, count(t.id) qtd,
       round(avg(current_date - t.data)::numeric,0) idade_media
from config_fase cf
left join tratativa t on t.status = cf.id
where cf.esteira='acordo'
group by cf.id, cf.nome, cf.cor, cf.grupo_id, cf.ordem order by cf.ordem;

create or replace view vw_kanban_execucao as
select cf.id, cf.nome, cf.cor, cf.grupo_id, cf.ordem, count(e.id) qtd,
       coalesce(sum(e.valor),0) valor
from config_fase cf
left join execucao e on e.status = cf.id
where cf.esteira='execucao'
group by cf.id, cf.nome, cf.cor, cf.grupo_id, cf.ordem order by cf.ordem;

-- Conciliação: a mesma receita contada por dois caminhos.
create or replace view vw_conciliacao as
with eq as (
  select 'MLE' o, coalesce(sum(valor),0) v from vw_receita where origem='MLE'
  union all select 'Acordos', coalesce(sum(valor),0) from vw_receita where origem='Acordo'
  union all select 'Trabalhista', coalesce(sum(valor),0) from vw_receita where origem='Trabalhista'
),
ab as (
  select 'MLE' o, coalesce(sum(valor),0) v from advbox_resumo where categoria='Mle'
  union all select 'Acordos', coalesce(sum(valor),0) from advbox_resumo where categoria like 'Acordo P%'
  union all select 'Trabalhista', coalesce(sum(valor),0) from advbox_resumo where categoria='Acordo Trabalhista'
)
select eq.o as origem, eq.v as controle_equipe, ab.v as advbox, ab.v - eq.v as diferenca
from eq join ab on ab.o = eq.o;

-- Painel do gestor, em uma linha
create or replace view vw_painel as
with r as (select coalesce(sum(valor),0) v from vw_receita where extract(year from data)=2026),
     p as (select coalesce(sum(valor),0) v from vw_plantado),
     mc as (select valor v from config_meta where chave='caixa_ano'),
     mo as (select valor v from config_meta where chave='objetivo_ano')
select r.v recebido, p.v plantado, r.v+p.v alcancado, mc.v meta_caixa, mo.v meta_objetivo,
       round(r.v/nullif(mc.v,0)*100,1) pct_caixa,
       round((r.v+p.v)/nullif(mo.v,0)*100,1) pct_objetivo,
       round(greatest(mc.v-r.v,0)/nullif(12-extract(month from current_date)+1,0),2) takt_mes,
       round(r.v/nullif(extract(month from current_date),0),2) ritmo_mes
from r,p,mc,mo;

-- =====================================================================
-- 10. SEGURANÇA
-- =====================================================================
-- Leitura aberta para a equipe (sem login, como pedido);
-- escrita só com sessão autenticada.
alter table execucao            enable row level security;
alter table tratativa           enable row level security;
alter table acordo_faturado     enable row level security;
alter table acordo_trabalhista  enable row level security;
alter table advbox_resumo       enable row level security;
alter table advbox_mes          enable row level security;
alter table config_grupo        enable row level security;
alter table config_fase         enable row level security;
alter table config_meta         enable row level security;
alter table config_parametro    enable row level security;

-- Os papéis anon/authenticated já existem no Supabase. Este bloco só
-- serve para o arquivo também rodar num Postgres comum (teste local).
do $$
begin
  if not exists (select 1 from pg_roles where rolname='anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then
    create role authenticated nologin;
  end if;
end $$;

do $$
declare t text;
begin
  foreach t in array array['execucao','tratativa','acordo_faturado','acordo_trabalhista',
    'advbox_resumo','advbox_mes','config_grupo','config_fase','config_meta','config_parametro']
  loop
    execute format('create policy leitura_%s on %I for select to anon, authenticated using (true)', t, t);
    execute format('create policy escrita_%s on %I for all to authenticated using (true) with check (true)', t, t);
  end loop;
end $$;

-- Views rodam com a permissão de quem consulta, não de quem criou.
-- Sem isso, uma view poderia contornar o RLS das tabelas por baixo.
alter view vw_plantado         set (security_invoker = on);
alter view vw_receita          set (security_invoker = on);
alter view vw_receita_mes      set (security_invoker = on);
alter view vw_previsao         set (security_invoker = on);
alter view vw_decididos        set (security_invoker = on);
alter view vw_kanban_acordo    set (security_invoker = on);
alter view vw_kanban_execucao  set (security_invoker = on);
alter view vw_conciliacao      set (security_invoker = on);
alter view vw_painel           set (security_invoker = on);

-- search_path fixo nas funções, para que ninguém consiga sequestrá-las
-- criando um objeto com o mesmo nome em outro schema.
alter function nz(text)                 set search_path = public, pg_temp;
alter function nzd(text)                set search_path = public, pg_temp;
alter function carrega_execucao(text)   set search_path = public, pg_temp;
alter function carrega_tratativa(text)  set search_path = public, pg_temp;
alter function carrega_faturado(text)   set search_path = public, pg_temp;
alter function toca_updated_at()        set search_path = public, pg_temp;
