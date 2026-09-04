# Testes

Testes de navegador, sem framework. Cada arquivo sobe um Chromium, finge ser o
Supabase e mexe na tela como a equipe mexe.

Eles moram aqui, no repositório, e não num diretório temporário — já se perderam
uma vez, e teste que se perde não protege de nada.

## Como rodar

```bash
node testes/servidor.mjs &          # serve public/ em 127.0.0.1:8898
node testes/fumaca.mjs              # varredura larga
node testes/sem-data.mjs            # um defeito específico
```

Cada teste imprime o que mediu em JSON e termina com `ok` ou `FALHOU` — e sai
com código diferente de zero quando falha, para servir de portão em automação.

O Chromium já vem instalado em `/opt/pw-browsers/chromium`. Se o `playwright`
não for encontrado, aponte para a instalação global:

```bash
ln -sfn /opt/node22/lib/node_modules node_modules
```

## O que tem aqui

| arquivo | o que garante |
|---|---|
| `base.mjs` | o Supabase de mentira e a sessão; é onde os outros começam |
| `fumaca.mjs` | as cinco abas abrem, a busca acha, salvar salva, clicar fora não fecha, a discriminação não some, a Identificação é cobrada |
| `sem-data.mjs` | registro sem data nenhuma não entra em recorte por período, e a lista avisa que ele existe |

## Como escrever um novo

Comece pelo `base.mjs`:

```js
import { abre, relata, fases, COMPLETA, CADASTROS } from './base.mjs';
const banco = { ...CADASTROS, config_fase: fases(), tratativa: [ /* … */ ] };
const { navegador, pg, erros } = await abre(banco);
const out = {};
// … mexa na tela, guarde o que mediu em `out`
relata('nome-do-teste', out, erros);
await navegador.close();
```

Duas regras que já custaram caro aqui:

**O teste roda contra o código quebrado primeiro.** Se ele passa antes da
correção, ele não está medindo o que você pensa que está.

**O Supabase de mentira imita os filtros de verdade.** Um mock que ignorava
`chave_cliente=eq.` devolvia a tabela inteira e "encontrava" uma linha que não
existia: a asserção passava por acaso.
