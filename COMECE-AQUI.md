# COMECE POR AQUI

Danilo, o banco já está no ar. Falta um passo só: ligar a Vercel.

---

## O que já está pronto

| Peça | Estado |
|---|---|
| Repositório no GitHub | no ar, público |
| Banco no Supabase | projeto `andon`, em São Paulo — tabelas, views e trava de duplicidade |
| Dados | 946 valores em execução, 1.396 tratativas, 187 acordos faturados |
| Carga automática | Edge Function `carregar`, disparada pelo GitHub Actions a cada push |

Você não precisa abrir o Supabase para nada.

---

## PASSO ÚNICO — Ligar a Vercel no GitHub

1. Abra `https://vercel.com` e entre com a conta do **GitHub**
2. Clique em **Add New…** → **Project**
3. Na lista, ache `andon` e clique em **Import**
4. **Não mexa em nada.** Clique em **Deploy**

Em um minuto ele te dá um link. Esse link é o sistema.

O `vercel.json` já diz à Vercel que o site mora na pasta `public/`. Não há
build: é HTML, CSS e JavaScript puros.

---

# ACABOU

A partir de agora funciona assim, sozinho:

```
você altera um arquivo no GitHub
            ↓
o site atualiza sozinho na Vercel
o banco atualiza sozinho no Supabase
```

---

## Quando quiser atualizar os dados

Os dados ficam na pasta `dados`, em três arquivos:

| Arquivo | O que tem dentro |
|---|---|
| `dados/execucao.psv` | os 946 valores em execução |
| `dados/tratativa.psv` | as 1.396 tratativas de acordo |
| `dados/faturado.psv` | os 187 acordos faturados |

Troque o conteúdo deles e dê push. O banco se atualiza sozinho, em uns
20 segundos. Pode acompanhar na aba **Actions** do repositório: bolinha verde
deu certo, bolinha vermelha deu erro e a mensagem explica o motivo.

O formato de cada arquivo está em `docs/COMO-FUNCIONA.md`.

---

## O repositório precisa continuar público

A Edge Function lê os `.psv` pelo `raw.githubusercontent`, que só responde em
repositório público. Se um dia o repositório virar privado, a carga para de
funcionar — e aí o caminho é passar os dados por outro meio.

Não há senha nem dado sigiloso nos arquivos. A chave do Supabase que está em
`public/andon.js` é de leitura e está protegida por RLS. A `service_role`
nunca entra no repositório.

---

## Duas coisas que ainda faltam dados

Estas duas telas ficam vazias até alguém carregar a base delas — não é erro:

- **Financeiro → Composição da receita** espera a tabela `advbox_resumo`,
  que é o extrato do ADVBox. Não existe arquivo em `dados/` para ela ainda.
- **Trabalhista** espera `acordo_trabalhista`, conduzido pelo parceiro.

---

## Se algo der errado

Copie a mensagem que aparecer na tela e me mande. Não precisa entender.

| O que você vê | O que é |
|---|---|
| Bolinha vermelha na aba Actions | A mensagem do passo "Carregar os dados" diz o motivo |
| Site abre mas os números estão zerados | O Actions ainda está rodando, ou o repositório ficou privado |
| Vercel mostra página em branco | Confira se o arquivo `vercel.json` está na pasta principal |
