# Ezra Task Bundler

Extensão Chrome que empacota work items do Azure DevOps (título, campos, descrição com imagens, comentários e links) em `_task/` dentro do projeto, pronto pra ser consumido pela slash command `/ezra` do Claude Code.

Suporta **múltiplas tasks ao mesmo tempo**: cada ticket vive em `_task/tasks/<id>/` e um `_task/current.yml` aponta qual está ativa. Trocar de task não apaga as outras.

## Instalação

1. `chrome://extensions` → liga **Modo de desenvolvedor**
2. **Carregar sem compactação** → seleciona esta pasta
3. (Opcional) fixa a extensão na barra do Chrome

## Setup (1 vez)

1. Clica no ícone → **Selecionar pasta destino…**
2. Escolhe a raiz do projeto (ex.: `Ezra-Platform-Unified/`)
3. O Chrome guarda o handle no IndexedDB — não precisa repetir

> A File System Access API só expõe o handle, não o caminho completo (segurança). O nome da pasta aparece no popup.

## Uso

1. Abre um work item no Azure DevOps
2. Clica no ícone → **Empacotar ticket** (na 1ª vez por sessão do Chrome, aceita a permissão de escrita)
3. A extensão grava `_task/tasks/<id>/` e marca esse ticket como ativo

### Trocar de task

- **Popup**: dropdown **Task ativa** troca na hora (só reescreve `current.yml`); 🗑 remove uma task.
- **Claude Code**:
  - `/ezra` — planeja a task ativa
  - `/ezra <id>` — troca a ativa e planeja
  - `/ezra list` — lista as tasks e qual está ativa

## Layout gerado

```
_task/
  current.yml          # current: <id>  +  índice das tasks
  tasks/
    7788/
      task.md          # frontmatter YAML + descrição/comentários/links
      meta.json        # {id,title,type,url,bundledAt}
      imgs/01-….png    # screenshots da descrição
```

A extensão **gera** o `current.yml` (lê de volta só a linha `current:` por regex) e reconstrói a lista a partir de `tasks/*/meta.json`. Apagar uma pasta de task na mão é seguro: o índice se corrige no próximo empacotamento/troca.

## Ignorar `_task/` no projeto-alvo

Como o resto do time não usa esse fluxo, evita commitar. Use o exclude local do repositório-alvo:

```bash
grep -qxF '_task/' .git/info/exclude || echo '_task/' >> .git/info/exclude
```

Idempotente e nunca vai pro repo.

## Limitações

- **Chromium-only**: usa File System Access API (Chrome, Edge, Arc, Brave). Não funciona em Firefox/Safari.
- **Permissão re-pedida ocasionalmente**: o Chrome às vezes invalida a permissão da pasta após reiniciar o navegador — o popup detecta e pede de novo.
- **Comentários e links**: seletores best-effort baseados no DOM do ADO. Se algum ticket não extrair direito, ajusta `extractComments`/`extractLinks` em `content.js`.
- **Uma pasta destino por vez**: pra trocar de projeto, clica em **Selecionar pasta destino…** de novo.
