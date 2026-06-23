# Ezra Task Bundler

Extensão Chrome que empacota work items do Azure DevOps (título, campos, descrição com imagens, comentários e links) em `_task/` dentro do projeto, pronto pra ser consumido pela slash command `/ezra` do Claude Code.

Suporta **múltiplas tasks ao mesmo tempo**: cada ticket vive em `_task/tasks/<id>/` e um `_task/current.yml` aponta qual está ativa. Trocar de task não apaga as outras.

Além de tasks, exporta **lotes de code review de PRs** (comentários do reviewer + arquivo/linha + trecho de código) para `_task/tasks/<id>/reviews/`, prontos pro fluxo `/ezra code-review`.

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
  - `/ezra code-review` — processa os comentários de review da task ativa

## Exportar code review de um PR

1. Abre um **pull request** no Azure DevOps (`.../pullrequest/<n>`)
2. Clica no ícone → **Exportar code review**
3. A extensão consulta a **REST API do Azure DevOps** (com a sua sessão) e grava um `.md` em `_task/tasks/<id>/reviews/` com **todos** os threads: autor, data, arquivo:linha, status, o comentário e um trecho do código com a(s) linha(s) comentada(s) marcada(s) com `►`

> Por que API e não só ler a tela: o ADO renderiza os diffs de forma **lazy** (só quando você rola até eles), então raspar o DOM perde threads que não foram exibidos. A API traz tudo de uma vez. Se a API falhar (sessão expirada, etc.), a extensão cai num **fallback de DOM** e avisa no status que o resultado pode estar incompleto.

O **id da task** vem do **work item vinculado ao PR** (cascata): 1 vinculado → usa direto; vários → o popup pede pra escolher; nenhum → cai na task ativa. O arquivo é nomeado `YYYY-MM-DD-HHMM-pr<PRID>.md`, então dá pra exportar várias vezes no mesmo dia sem sobrescrever.

Cada `.md` registra no frontmatter: `prId`, `prTitle`, `prUrl`, `commit` (best-effort), `taskId`, `linkedWorkItems`, `exportedAt` e a contagem de threads. Cada comentário carrega uma âncora `<!-- thread: <id> -->` estável — é o que permite o `/ezra code-review` saber, entre vários exports, quais já foram resolvidos e quais ainda estão abertos (ledger `reviews/_status.md`).

> `reviews/` (e `logs/`) **nunca** são apagados ao re-empacotar a task: o re-empacotamento só reescreve `task.md`, `meta.json` e `imgs/`.

## Layout gerado

```
_task/
  current.yml          # current: <id>  +  índice das tasks
  tasks/
    7788/
      task.md          # frontmatter YAML + descrição/comentários/links
      meta.json        # {id,title,type,url,bundledAt}
      imgs/01-….png    # screenshots da descrição
      logs/            # artefatos que você anexa manualmente (preservado)
      reviews/         # lotes de code review exportados (preservado)
        2026-06-23-1430-pr23200.md
        _status.md     # ledger de resolução, mantido pelo /ezra code-review
```

A extensão **gera** o `current.yml` (lê de volta só a linha `current:` por regex) e reconstrói a lista a partir de `tasks/*/meta.json`. Apagar uma pasta de task na mão é seguro: o índice se corrige no próximo empacotamento/troca.

## Ignorar `_task/` no projeto-alvo

Como o resto do time não usa esse fluxo, evita commitar. Use o exclude local do repositório-alvo:

```bash
grep -qxF '_task/' .git/info/exclude || echo '_task/' >> .git/info/exclude
```

Idempotente e nunca vai pro repo.

## Desenvolvimento

Guia para evoluir a extensão e os comandos.

### Arquitetura (2 camadas)

- **Extração** (`*-content.js`) — scripts injetados na aba via `chrome.scripting.executeScript`. Rodam no contexto da página e **retornam um objeto** (não escrevem nada).
  - `content.js` — work item (descrição, campos, comentários, links, imagens). Best-effort sobre o DOM do ADO (seletores defensivos).
  - `review-content.js` — pull request. **API-first**: chama a REST API do ADO (mesma origem, sessão do usuário) pra obter threads completos + conteúdo do arquivo pro trecho de código; cai pro scraping do DOM se a API falhar. Retorna Promise (o `executeScript` aguarda).
- **Escrita** (`popup.js`) — recebe o objeto extraído, renderiza markdown e grava no destino via File System Access API. É aqui que vive o layout do `_task/` e a regra de **nunca apagar `reviews/`/`logs/`** ao re-empacotar.

Para uma nova funcionalidade de captura: crie um `*-content.js` novo (ou estenda um existente), adicione um botão em `popup.html`, e um handler + `render*Markdown` + `write*` em `popup.js`. Valide a extração contra uma página salva com jsdom (`node` + `eval` do `*-content.js`) antes de testar no Chrome.

### Comandos `/ezra` (namespace local, versionado)

O `/ezra` é o **namespace** de tudo que o Claude Code faz com este fluxo — novas funcionalidades viram **subcomandos** dele (`/ezra code-review`, …), roteados pelo argumento, em vez de comandos soltos.

Slash commands são **pessoais** e o Claude Code os lê de `~/.claude/commands/` no seu PC — eles não moram no repositório-alvo. Para versioná-los mesmo assim:

- A **fonte canônica** fica em `commands/` **deste repo** (versionada no git).
- `./sync-commands.sh` faz **symlink** de `commands/*.md` → `~/.claude/commands/`. Editar no repo reflete na hora no Claude Code; o histórico fica no git. (`--copy` se preferir cópia a symlink. Backup automático `.bak` de qualquer arquivo real pré-existente.)

Rode `./sync-commands.sh` depois de clonar o repo ou ao adicionar/editar um comando.

## Limitações

- **Chromium-only**: usa File System Access API (Chrome, Edge, Arc, Brave). Não funciona em Firefox/Safari.
- **Permissão re-pedida ocasionalmente**: o Chrome às vezes invalida a permissão da pasta após reiniciar o navegador — o popup detecta e pede de novo.
- **Comentários e links**: seletores best-effort baseados no DOM do ADO. Se algum ticket não extrair direito, ajusta `extractComments`/`extractLinks` em `content.js`.
- **Code review**: usa a REST API do ADO (api-version 7.1) — traz threads, arquivo:linha, status, comentários, branches e commit de forma confiável e completa. O trecho de código vem do conteúdo do arquivo no commit-fonte do PR. Requer sessão ativa do ADO no navegador; sem ela, cai no fallback de DOM (que perde diffs não renderizados). Ajustes em `review-content.js`.
- **Uma pasta destino por vez**: pra trocar de projeto, clica em **Selecionar pasta destino…** de novo.
