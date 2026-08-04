# COMEÇE POR AQUI

Danilo, são 3 passos. Depois deles, você nunca mais precisa abrir o Supabase.

---

## PASSO 1 — Colocar os arquivos no GitHub

Você baixou o arquivo `andon-repo.zip`. Descompacte numa pasta do seu
computador. Digamos que ficou em `C:\andon`.

Agora abra o **Prompt de Comando**:
tecla Windows → digite `cmd` → Enter. Vai abrir uma tela preta.

Cole estes comandos, **um de cada vez**, apertando Enter depois de cada um:

```
cd C:\andon
```
```
git init
```
```
git add .
```
```
git commit -m "ANDON"
```
```
git branch -M main
```
```
git remote add origin https://github.com/danilo-ferro/andon.git
```
```
git push -u origin main
```

No último comando o GitHub vai abrir o navegador pedindo para você entrar na
sua conta. Entre e autorize.

**Pronto.** Os arquivos estão no GitHub.

---

## PASSO 2 — Deixar o repositório público

Isso é obrigatório, senão o passo seguinte não funciona.

1. Abra `https://github.com/danilo-ferro/andon`
2. Clique em **Settings** (no menu de cima do repositório)
3. Role até o fim, na caixa vermelha **Danger Zone**
4. Clique em **Change visibility** → **Make public** → confirme

Não tem risco: não existe senha nem dado sigiloso dentro desses arquivos.

---

## PASSO 3 — Ligar a Vercel no GitHub

1. Abra `https://vercel.com` e entre com a conta do **GitHub**
2. Clique em **Add New…** → **Project**
3. Na lista, ache `andon` e clique em **Import**
4. **Não mexa em nada.** Clique em **Deploy**

Em um minuto ele te dá um link. Esse link é o sistema.

---

# ACABOU

A partir de agora funciona assim, sozinho:

```
você altera um arquivo no GitHub
            ↓
o site atualiza sozinho na Vercel
o banco atualiza sozinho no Supabase
```

Você não abre mais o Supabase. Não abre mais a Vercel.

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

---

## Se algo der errado

Copie a mensagem que aparecer na tela e me mande. Não precisa entender.

| O que você vê | O que é |
|---|---|
| Bolinha vermelha na aba Actions | Quase sempre o repositório ainda está privado (passo 2) |
| Site abre mas os números estão zerados | O passo 2 não foi feito, ou o Actions ainda está rodando |
| `git push` recusa | Use a janela do navegador que abre, não digite senha na tela preta |
| Vercel mostra página em branco | Confira se o arquivo `vercel.json` está na pasta principal |
