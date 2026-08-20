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
  entrar.*         tela de login
  guarda.js        sem sessão válida, nada é desenhado
  tema.js          cor do sistema, por pessoa — escuro, grafite, claro, pastel
  index.*          painel principal (gestão)
  acordos.*        painel de gestão, esteira, tratativas e o formulário
  cadastros.*      equipe, réus, escritórios e contatos
  andon.css        paletas e estilos compartilhados por todas as telas
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

E o relógio só corre para quem ainda pode andar: fase marcada como
`finalizada` — acordo fechado, recusado, sem retorno, improcedente, e o
recebido na execução — não mostra tempo parado nem entra no filtro
"parado há". Um acordo fechado há trezentos dias não está atrasado; ele
acabou. `finalizada` e `conta_no_denominador` são colunas separadas de
propósito: uma diz o que entra na taxa, a outra diz o que parou de correr, e
nada garante que continuem coincidindo.

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
| Operador | Acordos | Acordos, e curadoria completa de réus e escritórios |

Réus, escritórios e contatos são **curadoria da equipe de acordos**: elas
criam, editam e apagam. `dados/contato.psv` fica no repositório como registro
da importação inicial, mas a carga não o lê mais — enquanto lesse, apagar um
e-mail errado não adiantaria nada, porque ele voltaria no push seguinte.

Papel é definido na tela de Equipe, não no login: mudar o papel de alguém não
exige recriar conta. Quem sai do escritório vira **inativo** — some dos
seletores e o histórico continua com dono.

## Quando a rede falha

`fetch` só rejeita quando a requisição não completou — o wi-fi caiu, o antivírus
cortou a conexão, o notebook dormiu. Não há resposta nenhuma: nem código, nem
corpo. O navegador diz só **"Failed to fetch"**, e era isso que chegava na tela
da equipe, em inglês, sobre gravações que muitas vezes tinham dado certo.

Três regras agora:

**Repetir antes de desistir.** Toda chamada é tentada três vezes, com intervalo
crescente. Uma piscada de meio segundo deixou de virar trabalho perdido.

**Repetir não pode duplicar.** Tratativa nova sorteia uma `chave_cliente` antes
de qualquer digitação e manda junto. Se a conexão cair *depois* de a gravação
ter chegado, a segunda tentativa esbarra no índice único — e a tela lê isso como
prova de que salvou, não como erro.

**Gravou é gravado.** O que vem depois da gravação — reler, redesenhar — não
pode transformar sucesso em erro vermelho. Antes, salvar disparava a releitura
do banco inteiro: nove chamadas, mais de um mega. Uma falha ali mostrava
"Failed to fetch" sobre uma tratativa que estava salva, e a operadora salvava de
novo. Agora a linha gravada é aplicada na tela direto, e só as parcelas são
relidas — duas chamadas pequenas, e falhar nelas não desfaz nada.

De quebra, o que está sendo digitado numa tratativa nova fica guardado no
navegador até ser salvo. Fechar sem querer, F5, queda de energia: ao voltar, o
sistema oferece o trabalho de volta.

## Sessão

Não acaba por inatividade. O Supabase vence o token de acesso em uma hora —
isso é do desenho dele e não se desliga — então o `guarda.js` renova antes de
vencer, sozinho, por quatro caminhos: um relógio que dispara cinco minutos
antes; a volta para a aba, porque relógio não corre com a máquina suspensa; a
volta da internet; e a própria chamada ao banco, que pede o token antes de sair
e tenta de novo uma vez se ainda assim voltar recusada.

Quem deixa a tela aberta o dia inteiro continua trabalhando. Sai quem clica em
**Sair**.

## Cores

Quatro temas: **escuro** (padrão), **grafite**, **claro** e **pastel**. Cada
pessoa escolhe o seu no botão *Tema*, no alto da tela. A escolha vale na hora
no navegador e é gravada na pessoa, para acompanhar quem troca de máquina.

Escrever em `pessoa` é coisa de gestor e continua sendo: quem grava o tema é a
função `definir_tema`, que só toca na coluna do tema da própria pessoa. Uma
política de RLS aberta na linha inteira deixaria a operadora se promover a
gestora mexendo em `papeis`.

Não existe cor solta numa regra de CSS — toda cor sai de uma variável declarada
nos quatro temas. Regra nova com cor escrita à mão volta a quebrar o tema claro.

A sinalização continua: verde, amarelo e vermelho dizem a mesma coisa de antes.
O que saiu foi o brilho difuso — a equipe reprovou o "neon" por unanimidade, e o
significado não dependia dele.

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
