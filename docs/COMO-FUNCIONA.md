# Como o ANDON se atualiza sozinho

Referência técnica. Para colocar no ar pela primeira vez, veja
`COMECE-AQUI.md` na pasta principal.

## O caminho

```
push no GitHub
   ├─► Vercel  ─── republica public/ automaticamente (integração nativa)
   └─► GitHub Actions (.github/workflows/deploy.yml)
          └─► chama a Edge Function `carregar` no Supabase
                 └─► lê dados/*.psv direto do raw.githubusercontent
                        └─► apaga e recarrega as tabelas
```

O repositório é a fonte da verdade. O banco é uma cópia derivada dele.
Recarregar é sempre seguro: a função limpa a tabela antes de inserir.

## Por que a função lê do GitHub

Para que ninguém precise colar SQL de 400 KB no editor do Supabase — o que
já falhou antes por limite de tamanho. A função baixa o arquivo e insere em
lotes de 250 linhas.

## O formato .psv

Uma linha por registro, campos separados por `|`, sem cabeçalho, datas em
`AAAA-MM-DD`. Campo vazio vira nulo.

| Arquivo | Campos, em ordem |
|---|---|
| `execucao.psv` | controle, produto, advogado, cliente, processo, valor, foro, vara, status, data_expedição, último_andamento, data_último_andamento, observações, data_recebimento |
| `tratativa.psv` | fase, estado, advogado, processo, autor, réu, escritório_adverso, canal, data, status, observações |
| `faturado.psv` | origem, fase, advogado, produto, autor, réu, processo, data_minuta, valor, protocolado, data_protocolo, estado, previsão, recebido, data_recebimento, observações |
| `advbox.psv` | conta, centro_custo, setor, tipo, vencimento, competência, pagamento, categoria, descrição, valor, processo, partes |

O status precisa bater exatamente com um `id` da tabela `config_fase`.
Se não bater, a linha entra mas fica fora do kanban.

No `advbox.psv`, a `categoria` precisa bater com os nomes do resumo do
ADVBox — `Mle`, `Acordo Pré Ativo`, `Acordo Pós Passivo`, `Acordo
Trabalhista` e assim por diante. A conciliação agrupa por esses nomes: um
`MLE` em caixa alta, ou com o prefixo `1.` que vem da exportação, sai do
grupo e vira divergência falsa.

## Por que o ADVBox entra pelo detalhe

Antes o sistema guardava só o total por categoria. Total guardado à mão é
número que diverge da origem sem ninguém perceber — que é justamente o
problema que o ANDON existe para resolver.

Hoje entra uma linha por lançamento, e `advbox_resumo` e `advbox_mes` são
views calculadas em cima delas. De quebra, o detalhe traz o número do
processo: é o que permite `vw_conciliacao_processo` dizer *em quais
processos* os dois lados discordam, em vez de só *quanto*.

A dedução do ano é a única coisa que não vem no extrato — ele exporta
apenas receitas. Ela vive em `config_parametro`, chave `advbox_deducoes`.

## As views que a tela consome

Métrica se calcula uma vez, no banco. A tela lê e mostra.

| View | Serve a |
|---|---|
| `vw_painel` | recebido e plantado do painel |
| `vw_receita_mes` | gráfico de caixa mês a mês, por origem |
| `vw_previsao` | previsão ponderada do Financeiro |
| `vw_conciliacao` | as três linhas de divergência |
| `vw_conciliacao_processo` | divergência processo a processo |
| `vw_conciliacao_par` | mesmo valor sob dois números de processo |

O que **não** vem de view é o que depende de meta editável na tela de
Ajustes — takt, percentuais, ritmo. Ali a tela simula, e simulação não é
fato: por isso pode viver no navegador.

## Se o esquema do banco mudar

O passo "Aplicar mudanças no esquema" do workflow fica desligado por padrão.
Para ligar: GitHub → Settings → Secrets and variables → Actions → New secret,
com o nome `DATABASE_URL` e a string de conexão do Supabase
(Project Settings → Database → Connection string → URI).

A partir daí, todo push também aplica `supabase/01-esquema.sql`.

## Trocar o projeto Supabase

Quando sair do projeto de teste para o definitivo, mude em dois lugares:

1. `public/andon.js` — `SB.url` e `SB.key`
2. `.github/workflows/deploy.yml` — a variável `FUNCAO`

E reimplante a função: `supabase functions deploy carregar`.
