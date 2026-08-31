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
  01-esquema.sql   espelho do banco: recria tudo do zero, conferido contra produção
  functions/
    carregar/      Edge Function que lê /dados e popula o banco

ferramentas/
  extrai_base.py   transforma a planilha consolidada nos .psv de /dados

dados/             fonte da verdade dos dados, delimitado por |
  execucao.psv           946 valores em execução
  tratativa.psv          1.848 tratativas de acordo (um processo, uma linha)
  acordo_verba.psv       285 linhas de discriminação (DM, HS, …)
  acordo_recebimento.psv 315 lançamentos financeiros do ADVBox
  faturado.psv           187 acordos faturados (base antiga, só insumo)
  advbox.psv             592 lançamentos do ADVBox (extrato bruto)

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
não tem nada a ver com a qualidade da negociação. Vale igual para as fases de
formalização: um acordo esperando minuta está indo bem, e contá-lo como
decidido baixaria a taxa exatamente quando ela deveria subir.

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

Uma coisa só é do gestor dentro de Acordos: **excluir tratativa**. Todo o resto
— criar, editar, dar baixa, curar réus e escritórios — é de quem entra.

## O dinheiro depois do acordo fechado

Um acordo nunca foi um número só. R$ 5.300 pode ser R$ 3.000 de danos morais do
cliente e R$ 2.300 de honorário do escritório, pagos em datas diferentes, um já
em conta e outro em atraso. Até a base consolidada de 2026, o sistema só sabia o
total — e é do detalhe que saem comissão e previsão de caixa.

Duas tabelas, porque são duas perguntas:

| | responde |
|---|---|
| `acordo_verba` | **de que** o acordo é feito — DM, HS, TRABALHISTA, OUTROS |
| `acordo_recebimento` | **quando** cada pedaço entra, e se já entrou |

`DM+HS` existiu enquanto o acordo podia ser fechado sem separar as duas coisas.
Saiu de uso (`config_verba.ativo = false`): não aparece mais para escolher, mas
continua visível nas linhas antigas que já a usam — apagar da lista uma verba já
escolhida faria a linha do histórico trocar de verba sozinha ao ser aberta.

Os totais não viram coluna — são view (`vw_acordo_financeiro`, `vw_verba_mes`,
`vw_ranking_operador`). Se a tela somasse por fora, um dia divergiria do painel.

Existe **uma** lista de recebimentos, não duas. O que o ADVBox lançou entra como
`origem_registro = 'planilha'`; o que o sistema prevê ao fechar um acordo novo
entra como `'sistema'` e some assim que o lançamento real chega. Duas listas para
a mesma pergunta seria o caminho mais curto para dois números diferentes na tela.

A discriminação é **obrigatória ao fechar um acordo** e se preenche na própria
tratativa, na etapa de Faturamento. Não vem mais de fora: o ADVBox está sendo
substituído por este sistema.

A diferença entre o valor fechado e o valor discriminado aparece na tela, escrita.
Escondê-la faria um total menor parecer erro do sistema quando são acordos
antigos, importados antes de a discriminação virar obrigatória.

## Um processo, uma tratativa

O mesmo processo era lançado duas vezes, e a culpa nunca foi de desatenção: a
numeração chega com ponto, com hífen ou sem nada, e `5001234-56.2026.8.26.0100`
não é igual a `50012345620268260100` para nenhuma busca simples. A comparação
agora ignora tudo o que não é dígito, e ela é a mesma em três lugares:

**No banco**, `chave_processo(processo)` e um índice único parcial sobre ela.
É a única trava que não depende da tela estar certa.

**Enquanto a pessoa digita**, o campo do processo mostra o lançamento que já
existe — status, partes, operador, data — com um botão que abre aquela tratativa.
Avisar na hora vale mais do que deixar preencher a tela inteira para recusar no
fim.

**Ao salvar**, a gravação é barrada com o processo, o autor e o réu do registro
que já existe. Se alguém criou o mesmo processo em outra aba enquanto esta estava
aberta, quem barra é o índice — e o erro cru do Postgres vira frase em português.

Os duplicados que já existiam foram fundidos: **1964 → 1875 tratativas**, sem
verba nem recebimento órfão. Onde havia mais de uma linha para o mesmo processo,
ficou a **mais atualizada**. Isso mexeu em três casos que estavam como acordo
fechado e cuja linha mais recente dizia outra coisa (238 → 235 acordos), sem
mudar um centavo do valor fechado: nenhum dos três tinha valor.

## Quanto tempo leva uma tratativa

Na lista, tratativa encerrada mostra quanto levou da 1ª tentativa até a última
atualização, e o rodapé traz média, mediana e os extremos do filtro aplicado.

O rodapé mostra **duas médias**, de propósito. Boa parte do histórico da planilha
veio com uma data só, e essas linhas entram como "mesmo dia" — somadas, derrubam
a média de ~22 para ~4 dias. Isso não é o escritório fechando rápido, é dado que
faltou. Por isso aparecem a média cheia e a média sem as linhas de data única,
com a contagem de quantas foram.

A lista **classifica por qualquer coluna**: um clique ordena, outro inverte. A
ordenação é pelo valor, não pelo que está escrito — senão "R$ 1.000" viria antes
de "R$ 900", "20 dias" antes de "9 dias", e o status sairia em ordem alfabética
em vez da ordem do funil.

## A esteira ocupa a janela e rola por dentro

A altura das colunas era uma conta fixa — `100vh - 290px` — que supunha onde a
esteira começava. Errava: a barra de filtros muda de altura conforme a largura
da tela, e o total da esteira entrou depois. Media-se coluna passando **88px por
baixo da janela**, com a barra de rolagem horizontal fora do alcance, e descer a
página movia tudo de lugar.

Agora a altura é medida de verdade, quando a esteira é desenhada e a cada
redimensionamento: ela recebe o que sobra da janela e devolve o que ainda
transbordar. Com isso a página **não rola** na esteira — o que rola é o miolo de
cada coluna, a barra horizontal fica sempre visível, e não há mais nada para
sair do lugar quando se desce a tela.

## Entre acertar o acordo e fechar o acordo

Dizer "sim" não é fechar. Depois do acerto vem a minuta, confeccionada pela
parte contrária; depois a assinatura do advogado do caso; e só o protocolo
torna o acordo fechado para o financeiro. São três esperas, cada uma com a bola
no pé de outra pessoa — e enquanto tudo isso era "em tratativa", ninguém sabia
com quem o caso estava parado.

| fase | quem está devendo |
|---|---|
| Aguardando envio da minuta | a parte contrária, que a confecciona |
| Aguardando assinatura da minuta | o advogado responsável pelo caso |
| Aguardando protocolo | a parte contrária, que protocola |
| Acordo fechado | ninguém — protocolou, virou faturamento |

As três **não contam no denominador** da taxa de conversão e **não são
finalizadas**. Não são decididas porque o desfecho ainda não aconteceu; e o
relógio tem que correr nelas justamente porque é ali que o caso fica parado
esperando ato de terceiro. Ver isso parado é o motivo de o painel existir.

A tela acompanha o status. Enquanto o acordo está sendo formalizado, a etapa de
**Tratativa** abre os campos de dinheiro — discriminação, forma de pagamento,
prazo — e, em "Aguardando protocolo", também a data da minuta assinada. Aí o
acordo passa a aparecer no **Financeiro**, e o acompanhamento é de lá.

**Faturamento** só existe depois de fechado, e nele a previsão de recebimento
fica trancada até a data do protocolo ser preenchida: é dela que a conta sai.

Os mesmos campos aparecem numa etapa ou na outra, nunca nas duas, e por isso
usam os mesmos `id` no HTML. Dois campos com o mesmo `id` na página fariam a
tela ler o valor errado — a exclusividade não é detalhe de estilo, é o que
mantém a leitura correta.

O Financeiro mede **quanto tempo passa entre a minuta assinada e o protocolo** —
média, mediana e extremos — e lista o que está esperando, com quantos dias cada
um espera. É o pedaço do caminho que é do financeiro, e agora ele é visível.

## A tela não pode envelhecer sozinha

A sessão não expira mais por inatividade — foi pedido assim, e está certo. O
efeito colateral não estava previsto: a aba fica aberta dias a fio, e o que
aparece nela é a **fotografia do banco no instante em que ela abriu**. Duas
pessoas no mesmo caso viam bases diferentes.

**A tela busca o que mudou a cada 30 segundos**, e também quando a aba volta ao
foco — sair para o WhatsApp e voltar é o gesto mais comum da equipe. Busca só o
que mudou: `updated_at` maior que o maior que ela já viu, o que torna a chamada
pequena o bastante para caber nesse intervalo. O botão **Atualizar** no topo faz
o mesmo na hora e diz o que encontrou; "nada mudou" é uma resposta tão útil
quanto "3 registros mudaram".

Quem salva por último manda. Não há pergunta, não há confirmação: o que protege
o trabalho de todo mundo não é travar a gravação, é a tela não estar velha.

**Versão nova avisa.** Não há build, então `acordos.js` de hoje tem o mesmo nome
do de ontem e o navegador serve a cópia guardada. Os arquivos revalidam a cada
pedido (304 quando nada mudou, que é barato) e a tela avisa quando saiu versão
nova. Nunca recarrega sozinha: quem está digitando perderia o que digitou.

## "Salva" só com a linha na mão

Uma tratativa apareceu como salva e sumiu. Não foi o banco: o registro nunca
existiu, e não havia erro nenhum do lado do Postgres.

Era o aviso de sucesso. Ele ficava no fim da função de salvar, sem ninguém ter
conferido se a resposta trouxe a linha gravada. Resposta sem linha — por
qualquer motivo — passava por gravação boa: a tela dizia "Tratativa salva.",
apagava o rascunho de resgate, e não havia tratativa nenhuma.

Agora **sucesso é uma linha, não a ausência de erro**. Quando a resposta não
traz a linha, o sistema pergunta ao servidor se ela existe: pela chave própria
que foi junto na gravação, quando é tratativa nova; pelo id, quando é edição. Se
existe, salvou mesmo — a resposta é que se perdeu, e isso é sucesso. Se não
existe, é erro, o rascunho fica guardado e a tela diz isso.

Essa conferência antes dependia de o texto do erro conter certas palavras, e
bastou traduzir uma mensagem para português para ela parar de acontecer. Agora
não depende de texto nenhum.

## O tempo de uma tratativa é uma data só

Uma tratativa aparece no filtro de período por **uma** data, não por três.
Antes valia qualquer marco — 1ª tentativa, última atualização ou protocolo — e
o mesmo processo aparecia em julho pela abertura e em agosto pela atualização,
contando duas vezes.

A regra é a do escritório: a tratativa vive na **data da última atualização**, e
o acordo fechado vive na **data do protocolo**, que é o marco financeiro. Acordo
fechado sem protocolo lançado cai na atualização, senão sumiria de todos os
períodos.

## "O dinheiro entrou" é uma coisa só

Estava escrito em dois lugares que não se falavam: `tratativa.recebido`, que a
pessoa marca na aba de Faturamento, e `acordo_recebimento.situacao`, que é o que
a tela do Financeiro soma. Marcar **"Recebido? Sim"** não baixava o lançamento —
o acordo continuava aparecendo **EM ATRASO** e "Recebido até aqui: R$ 0,00".

A ligação vive no banco, não na tela, porque são várias telas escrevendo nas
mesmas duas tabelas. Dois gatilhos, um para cada sentido:

- marcar a tratativa como recebida **baixa os lançamentos dela**, usando a
  melhor data que existir — a que já estava no lançamento, a que a pessoa
  informou, o vencimento, hoje, nessa ordem;
- baixar os lançamentos **marca a tratativa**. Em acordo parcelado, só quando a
  última parcela cai; estornar uma baixa desmarca de volta.

O que impede o vaivém entre os dois é `is distinct from`: quando o valor já é
aquele, não há `UPDATE`, e o gatilho do outro lado não dispara de volta.

Junto veio uma correção que estava escondida: `gera_parcelas` rodava a **cada**
gravação da tratativa, mesmo quando o que mudou foi uma observação. Apagava e
recriava linha de financeiro sem ninguém ter mexido em dinheiro. Agora só roda
quando muda uma das cinco coisas de que ele depende — e foi isso que permitiu
ligar os dois lados sem laço infinito.

Cinco acordos já estavam marcados como recebidos com o lançamento em aberto,
R$ 31.723,68 no total. Todos com data de recebimento informada por pessoa e
valor do lançamento igual ao do acordo: recebimentos de verdade que ficaram sem
baixa. Foram acertados na mesma migração.

Na tela, cada lançamento passou a ter **dar baixa** e **desfazer**. Era o que
faltava para "lançar o pagamento": marcar a tratativa inteira só serve quando
tudo caiu de uma vez — em acordo parcelado, quem recebe é a parcela.

## Recusar não pode parecer não funcionar

"Em alguns casos a tratativa não salva" tinha uma causa concreta: **19
tratativas** estavam sem advogado ou sem réu, e **7** acordos fechados estão sem
discriminação. São campos obrigatórios, então a gravação era recusada — só que
a recusa não levava a lugar nenhum.

Quem abria uma dessas pela busca caía na etapa de **Tratativa**, clicava em
Salvar e lia "falta preencher: advogado". O campo do advogado fica na etapa de
**Identificação**. A pessoa olhava a tela em que estava, não achava campo
nenhum, e concluía — com razão — que o sistema não salvava.

Duas mudanças:

**A recusa leva ao campo.** Ao barrar, o sistema muda para a etapa certa, marca
em vermelho o que está vazio, rola até ele e põe o cursor lá.

**A resposta aparece onde o clique aconteceu.** A mensagem saiu do topo do
formulário e foi para o rodapé, que é grudado na base da gaveta, logo acima dos
botões. No topo, numa tratativa longa, ela ficava fora da vista de quem estava
com o Salvar embaixo — o sistema explicava e ninguém lia.

## Trabalhista é do Dr. Felipe Rodrigues

Das 19 tratativas travadas por campo obrigatório vazio, **13 eram todas o mesmo
caso**: processo trabalhista sem advogado. Não era esquecimento. O trabalhista
não passa pela equipe de acordos — quem responde pelo processo, pelas audiências
e pelos fechamentos é o **Dr. Felipe Rodrigues**; a equipe só metrifica e lança
o acordo depois de fechado. Quem preenchia a planilha anotava o time interno, e
nesses casos não havia time interno para anotar.

Duas leituras independentes concordam sobre quais são os 13: a coluna `tipo` e o
**14º dígito do número CNJ**, que é o ramo da Justiça — `5` é a do Trabalho.
Nenhum deles tinha advogado, então não houve nada para sobrescrever e nenhuma
escolha a fazer. O cadastro dele existia com o primeiro nome só, inativo; virou
`Felipe Rodrigues` e ativo — o sobrenome entrou porque o Danilo informou.

Daqui para a frente o campo se preenche sozinho: marcar o tipo **Trabalhista**,
ou digitar um número da Justiça do Trabalho, já traz o nome dele. Quem já estiver
no campo nunca é trocado, e dá para escolher outro se um dia houver exceção. A
mesma regra entrou no extrator, para a próxima carga da planilha não desfazer.

Os operadores continuam vazios nesses 13, e é o certo: o ranking por operador
ignora tratativa sem operador, então o trabalhista não entra na produtividade de
ninguém — mas continua contando no total de acordos fechados, que é justamente o
que a equipe metrifica.

Sobram **6 tratativas sem réu**, todas de Justiça estadual e todas já com Max
Canaverde ou Mariah Aguiar como advogado. Essas ficam esperando: quem é o réu de
cada uma é informação que ninguém passou, e chutar num sistema de registro é
inventar dado.

## A Identificação inteira é obrigatória

Os treze campos da primeira etapa passaram a ser exigidos — para lançar uma
tratativa nova e para salvar qualquer alteração numa que já existe:

| | |
|---|---|
| tipo · fase processual · estado (UF) | advogado · produto / tese · nº do processo |
| autor (cliente) · réu · escritório (adv. do réu) | forma de contato · operador responsável |
| data da 1ª tentativa · status | |

Não é burocracia: tratativa pela metade não mede nada. Sem operador ela some do
ranking; sem produto, do recorte por tese; sem fase, do funil. O número que
sobra no painel continua aparecendo — e passa por verdade.

**O tamanho do buraco.** Enquanto o preenchimento foi opcional, **1.646 das
1.933 tratativas** ficaram com pelo menos um campo em branco. Os dois maiores
são `tipo` (1.608 vazios) e `produto` (1.617). Procurei recuperá-los das outras
tabelas — faturado, recebimento, ADVBox — e não há de onde: essa informação
nunca entrou. Só 287 tratativas estão completas hoje.

Dessas 1.646, **1.208 já estão encerradas** e ninguém vai reabrir para preencher
a tese de um caso de 2024. As que importam são as **438 ainda em andamento**: a
próxima vez que alguém mexer em cada uma, vai ter que completá-la. É trabalho
real, e é o preço de a base voltar a fechar.

**Três coisas para isso não virar emboscada.** A recusa leva ao campo, como já
fazia — muda para a Identificação, marca em vermelho tudo o que está vazio e
rola até o primeiro. Tratativa incompleta agora **abre direto na Identificação**,
em vez de na etapa de Tratativa: é lá que está o trabalho, e mexer no resto não
adianta enquanto não salvar. E a aba **Tratativas** avisa quantas ainda faltam,
com um botão **ver lista** que abre quais são e o que falta em cada uma, com um
clique para abrir e completar.

A lista nasce fechada de propósito. Aberta, ela ocupava a tela inteira todo dia
— pelo aviso de uma dívida que vai ser paga aos poucos, conforme cada caso for
mexido. Fica a linha com o número, e a lista abre em quem quiser olhar; a
escolha fica guardada no navegador, então quem fechou não vê de novo a cada
atualização de 30 segundos.

**Processo repetido é checado antes.** Mandar completar treze campos para só
então dizer que a tratativa não podia existir seria fazer a pessoa trabalhar à
toa. Se o processo já tem tratativa, o sistema diz isso primeiro.

**Fase, forma de contato e status ganharam a opção vazia.** Sem ela, um registro
antigo com o campo em branco abria já mostrando a primeira opção da lista, e
salvar gravava essa escolha que ninguém fez. O campo parecia preenchido, e a
trava não teria o que travar.

## Excluir uma tratativa

Apagar tratativa não podia ser um `DELETE` e pronto, por dois motivos concretos.

**O primeiro é dinheiro.** `acordo_recebimento.tratativa_id` é `ON DELETE SET
NULL`. Um DELETE cru deixaria os lançamentos financeiros da tratativa soltos:
sumiriam da tela de Financeiro, que junta com `tratativa`, e continuariam
somando para sempre em `vw_verba_mes`, que não junta. Dinheiro contado sem dono
e sem tela que chegue nele é o pior erro que esta base pode ter.

**O segundo é registro.** Apagar sem rastro é perder histórico, e esta equipe já
viu tratativa sumir sem saber por quê.

Então a exclusão passa por uma porta só, a função `excluir_tratativa`: ela
guarda uma cópia inteira da linha e dos filhos dela em `tratativa_excluida`,
apaga os lançamentos junto e só então apaga a tratativa — tudo numa transação.
`tratativa` deixou de ter política de DELETE: mesmo quem souber montar a
chamada não consegue apagar por fora.

**É do gestor.** Não por hierarquia: é que aqui apagar leva junto o dinheiro
lançado. Quem não é gestor não vê o botão, e o banco recusa mesmo que veja — a
permissão vive na função, não só na tela.

**Um clique nunca apaga.** O botão abre uma confirmação que diz exatamente o
que vai embora: o processo, as partes, o valor, quantos lançamentos financeiros
(e quantos já baixados) e quantas linhas de discriminação. Tem campo de motivo,
opcional, e fica gravado quem excluiu e quando.

**A exclusão chega nas outras telas.** A atualização de 30 segundos só enxerga o
que mudou por `updated_at`, e linha apagada não tem `updated_at` — a tratativa
excluída ficaria na tela de todo mundo até alguém recarregar a página. A view
`vw_tratativa_excluida` expõe só o id e a hora (não o conteúdo, que é do gestor)
e é por ela que a remoção viaja. Se a gaveta estiver aberta justamente na que
sumiu, ela fecha explicando o que houve, e o que a pessoa tinha digitado fica
guardado no navegador.

De quebra: um `403` do banco não é mais traduzido para "sua sessão expirou". O
banco diz o motivo — "só um gestor pode excluir uma tratativa" — e mandar a
pessoa sair e entrar de novo para descobrir que continua sem poder é pior do que
não dizer nada.

## Gravação que não pode se perder no meio

Duas correções do mesmo tipo, achadas ao varrer o resto do sistema:

**A discriminação era apagada antes de a nova subir.** Uma queda de rede entre o
apagar e o gravar deixava o acordo sem discriminação nenhuma — e é dela que sai
a comissão. Agora grava primeiro e só então apaga a anterior. Linha repetida
aparece na tela e se conserta em dois cliques; dado apagado não volta.

**Cadastros também dizia "salvo" sem prova.** Réus, escritórios e equipe
anunciavam sucesso pela ausência de erro. Passam pela mesma regra dos acordos:
sem a linha gravada de volta, não há "salvo".

## Copiar o processo, classificar por qualquer coluna

O número do processo tem um botão de copiar em todo lugar onde aparece: lista,
esteira, financeiro, resultados da busca, pendências e no título da gaveta. O
clique é capturado antes de chegar na linha — senão copiar abriria a tratativa
junto, porque quase toda linha que mostra processo também abre.

A classificação por coluna virou uma implementação só, usada pela lista, pelas
duas tabelas do Financeiro e pela busca do painel. Cada tabela guarda a própria
escolha: uma ordem global faria o Financeiro herdar a coluna escolhida na lista,
que nem existe lá.

## A parte de cima da tela

A barra do topo é **uma linha só**, sempre. Antes ela envolvia quando não
cabia, e a segunda linha vinha colada à direita com um vazio grande à esquerda —
parecia quebrada, não compacta. Agora quem cede é o menu, que rola por dentro;
só abaixo de 920px ele ganha a própria faixa, e aí é decisão de layout, não
acidente.

Quem está logado aparece como um círculo com as iniciais mais o nome. Em tela
apertada o nome sai e ficam as iniciais: 90px a menos, e a barra continua tendo
dono — antes o nome simplesmente sumia.

Os filtros são uma **grade de colunas iguais**, não uma fila. Em fila cada
filtro tinha a largura do próprio conteúdo, as colunas não se alinhavam entre
as linhas, e o "Limpar" — empurrado para a direita — ficava sozinho depois de um
vazio enorme. Ele saiu da grade e foi para a linha do resumo, junto do número
que os filtros produziram, que é exatamente sobre o que ele age.

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
4. Dizer quem é o réu das seis tratativas que ainda estão sem ele —
   `0001623-82.2026.8.26.0198`, `0002178-96.2026.8.26.0005`,
   `0003955-80.2026.8.26.0405`, `0004807-48.2026.8.26.0068`,
   `1002155-82.2025.8.26.0001` e `1034655-35.2024.8.26.0003`. São as últimas
   travadas por campo obrigatório vazio, e é o único dado que falta nelas.
5. Cadastrar o piso da tabela OAB de 2026 (`config_parametro.piso_oab_2026`) —
   é o único número que falta para o repasse calcular sozinho.
6. Trocar os prazos estimados do funil (70 / 38 / 11 dias) pela mediana real,
   assim que houver histórico de expedição e recebimento no mesmo lugar.
