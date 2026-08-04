# ANDON

Sistema de gestão do **Canaverde & Aguiar Advogados Associados** — Acordos,
Execução e Financeiro numa base só.

O nome vem do painel de sinalização da Toyota: a luz que mostra o estado da
linha e deixa qualquer um puxar a corda quando algo trava. O escritório vai
gerenciar pelo modelo toyotista, e o sistema é desenhado em cima disso.

---

## O que ele resolve

Hoje a mesma receita é contada em quatro lugares — Mapa de Execução, Controle
de Tratativas, Relatório de Faturamento e ADVBox. Eles não fecham entre si:
há **R$ 156 mil de divergência acumulada** em 2026. O ANDON existe para que
exista um número só, calculado num lugar só.

---

## Estrutura

```
COMECE-AQUI.md     leia este primeiro

.github/workflows/
  deploy.yml       a cada push, manda o Supabase se atualizar

public/            front, sem build — HTML, CSS e JS puros
  index.html
  andon.css
  andon.js         lê o Supabase por REST; nenhuma métrica é recalculada aqui

supabase/
  01-esquema.sql   tabelas, views, funções e RLS — roda do zero
  carga_*.sql      carga manual, alternativa à Edge Function
  functions/
    carregar/      Edge Function que lê /dados e popula o banco

dados/             fonte da verdade dos dados, delimitado por |
  execucao.psv     946 valores em execução
  tratativa.psv    1.396 tratativas de acordo
  faturado.psv     187 acordos faturados

docs/
  COMO-FUNCIONA.md
```

## Como se atualiza

Push no GitHub → a Vercel republica o site e o GitHub Actions manda o Supabase
recarregar os dados de `/dados`. Ninguém abre o Supabase para nada.

---

## As cinco decisões que sustentam o sistema

**1. Em execução, cada linha é um VALOR, não um processo.** O mesmo processo
pode ter dez mil já levantados e dois mil ainda executando. Se o status ficasse
no processo, seria preciso escolher uma verdade e perder as outras.

**2. `MLE - ACORDO` nunca soma receita.** São levantamentos que nasceram de
acordo pago por depósito judicial — já entraram na receita quando o acordo foi
faturado. A trava vive na view `vw_receita`, não na tela: é impossível duplicar
mesmo digitando errado.

**3. Protocolo é o marco financeiro.** Não a assinatura da minuta.

**4. Só desfecho entra no denominador da taxa de sucesso.** Um caso aguardando
audiência está vivo. Contá-lo como perda derrubaria a taxa por um motivo que
não tem nada a ver com a qualidade da negociação.

**5. Métrica se calcula uma vez, no banco.** Toda métrica é uma view. Tela,
relatório e exportação leem a mesma view. Se dois números divergirem, alguém
calculou fora daqui — e isso é bug de implementação, não de interpretação.

---

## O que os dados de 2026 mostram

- **WhatsApp fecha 2,4× mais acordo que e-mail** — 31,9% contra 13,5% — e mesmo
  assim o e-mail é usado 5× mais.
- **Pós-sentença converte 2× mais que pré.** O pré consome 70% do esforço da
  equipe e entrega 54% dos acordos.
- **49,3% do objetivo de R$ 6,5 mi em julho**, com ritmo de caixa na metade do
  necessário para fechar o ano.

---

## Ambiente

| Peça | Onde |
|---|---|
| Banco | Supabase · projeto `andon` (`nkodijlsftdlzcmgjahk`, sa-east-1) |
| Front | Vercel, servindo `public/` |
| Carga | Edge Function `carregar`, disparada pelo GitHub Actions a cada push |

A chave publicável do Supabase em `andon.js` é de leitura e está protegida por
RLS — pode ficar no repositório. A `service_role` **nunca** entra aqui.

---

## Próximos passos

1. Carregar `advbox_resumo` e `advbox_mes` — sem elas a tela de Financeiro
   fica sem a composição da receita e a conciliação não fecha contra nada.
2. Cadastrar o piso da tabela OAB de 2026 (`config_parametro.piso_oab_2026`) —
   é o único número que falta para o repasse calcular sozinho.
3. Ligar o login do Supabase para habilitar escrita pela tela. As políticas de
   escrita já existem e valem para `authenticated`; hoje ninguém se autentica,
   então na prática o sistema é só leitura.
4. Trocar os prazos estimados do funil (70 / 38 / 11 dias) pela mediana real,
   assim que houver histórico de expedição e recebimento no mesmo lugar.
