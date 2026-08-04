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

O status precisa bater exatamente com um `id` da tabela `config_fase`.
Se não bater, a linha entra mas fica fora do kanban.

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
