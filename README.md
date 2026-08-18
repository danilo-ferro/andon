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
com o extrato do ADVBox carregado, a diferença medida é de **R$ 227 mil** em
2026. O ANDON existe para que exista um número só, calculado num lugar só —
e, enquanto as bases forem várias, para dizer exatamente onde elas discordam.

---

## Estrutura

```
COMECE-AQUI.md     leia este primeiro

.github/workflows/
  deploy.yml       a cada push, manda o Supabase se atualizar

public/            front, sem build — HTML, CSS e JS puros
  index.html
  andon.css
  andon.js         lê o Supabase por REST; os fatos vêm de views, não daqui

supabase/
  01-esquema.sql   tabelas, views, funções e RLS — roda do zero
  functions/
    carregar/      Edge Function que lê /dados e popula o banco

dados/             fonte da verdade dos dados, delimitado por |
  execucao.psv     946 valores em execução
  tratativa.psv    1.396 tratativas de acordo
  faturado.psv     187 acordos faturados
  advbox.psv       592 lançamentos do ADVBox

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

A única coisa que a tela calcula é o que depende de meta editável em Ajustes:
takt, percentuais, ritmo. Ali ela está simulando, não medindo.

---

## O que os dados de 2026 mostram

- **WhatsApp fecha 2,4× mais acordo que e-mail** — 31,9% contra 13,5% — e mesmo
  assim o e-mail é usado 5× mais.
- **Pós-sentença converte 2× mais que pré.** O pré consome 70% do esforço da
  equipe e entrega 54% dos acordos.
- **48,4% do objetivo de R$ 6,5 mi**, com ritmo de caixa na metade do
  necessário para fechar o ano.
- **A divergência com o ADVBox tem nome.** Dos R$ 227 mil de diferença,
  R$ 82 mil são acordos trabalhistas que o sistema simplesmente não tem
  base para conhecer, e R$ 44 mil são levantamentos `MLE - ACORDO`, que a
  trava anti-duplicidade exclui de propósito e o ADVBox lança como MLE.
  Sobram R$ 101 mil realmente sem explicação.
- **Sete processos aparecem com o mesmo valor dos dois lados, sob números
  diferentes.** Um deles é `1006491-32.2017…` contra `1006491.32.2017…` —
  ponto no lugar do hífen. Não muda o total, mas é o tipo de coisa que
  vira pagamento em duplicidade.

---

## Ambiente

| Peça | Onde |
|---|---|
| Banco | Supabase · projeto `andon` (`nkodijlsftdlzcmgjahk`, sa-east-1) |
| Front | Vercel, servindo `public/` |
| Carga | Edge Function `carregar`, disparada pelo GitHub Actions a cada push |

A `service_role` **nunca** entra aqui.

Sobre a chave publicável que está nos arquivos de `public/`: ela sozinha não
abre mais nada. As políticas de leitura exigem `authenticated`, e o papel
dessa chave é `anon`. Quem encontrar o repositório tem a chave e continua sem
ver um único nome de cliente — a base só responde a quem entrou pelo login.

Fica registrado porque não foi sempre assim: até a tela de login existir, a
leitura era liberada para `anon` e o repositório é público, então a base
inteira estava exposta a quem achasse o repositório.

---

## Quem entra onde

| Papel | Onde cai ao entrar | O que alcança |
|---|---|---|
| Gestor | painel principal | tudo: Acordos, Execução, Financeiro, Equipe |
| Operador | Acordos | Acordos e os cadastros de réus e escritórios |

Papel é definido na tela de Equipe, não no login: mudar o papel de alguém não
exige recriar conta. Quem sai do escritório vira **inativo** — some dos
seletores e o histórico continua com dono.

## Próximos passos

1. Ligar a proteção contra senha vazada no Supabase (Authentication →
   Policies): um botão, e o Supabase passa a recusar senha que já apareceu em
   vazamento conhecido.
2. Carregar os acordos trabalhistas. É a maior parcela isolada da divergência
   com o ADVBox — R$ 82 mil — e é inteira por falta de base, não por erro.
3. Acertar os sete pares de processo com número divergente. A tela de
   Financeiro lista todos, lado a lado.
4. Cadastrar o piso da tabela OAB de 2026 (`config_parametro.piso_oab_2026`) —
   é o único número que falta para o repasse calcular sozinho.
5. Trocar os prazos estimados do funil (70 / 38 / 11 dias) pela mediana real,
   assim que houver histórico de expedição e recebimento no mesmo lugar.
