---
description: Planeja a task ativa do Azure DevOps empacotada em _task/ (com switch, list e code-review por argumento)
argument-hint: "[<id> | list | code-review [list|<arquivo>]]"
---

Você opera o fluxo de tasks da extensão ADO Task Bundler. O estado vive em `_task/` na raiz do projeto:

- `_task/current.yml` — ponteiro `current:` + índice `tasks:` (id, title, type, url, bundledAt). **Fonte da verdade de qual task está ativa.**
- `_task/tasks/<id>/task.md` — frontmatter YAML (id, type, state, area, severity…), descrição em markdown, comentários e links relacionados.
- `_task/tasks/<id>/imgs/*` — screenshots referenciadas na descrição, numeradas `01-`, `02-`, … Leia cada uma com a tool Read pra entender o contexto visual.
- `_task/tasks/<id>/logs/*` — logs, dumps e outros artefatos que eu anexo manualmente pra investigação.
- `_task/tasks/<id>/reviews/*.md` — lotes de comentários de code review de PR, exportados pela extensão. Nome `YYYY-MM-DD-HHMM-pr<PRID>.md`. **Nunca são apagados ao re-empacotar a task.**
- `_task/tasks/<id>/reviews/_status.md` — ledger que VOCÊ mantém: rastreia, por `threadId`, quais comentários já foram resolvidos e quais ainda estão abertos (ver fluxo de code review).

**Convenção de artefatos:** sempre que eu mencionar "um arquivo", "o log", "o artefato" (ou similar) relacionado à task atual sem dar o caminho, procure primeiro em `_task/tasks/<current>/` (especialmente `logs/` e `imgs/`) antes de varrer Downloads/Desktop ou pedir o caminho.

O argumento é: `$ARGUMENTS`

## Roteamento do argumento

1. **`list`** → leia `_task/current.yml` e imprima a lista de tasks (id + title + type), marcando qual é a `current` com `▶`. Não planeje nada. Pare aqui.

2. **`code-review`** (opcionalmente seguido de `list` ou de um nome de arquivo) → siga o **Fluxo de code review** abaixo. Pare aqui (não entre no fluxo de planejamento).

3. **um número (ex.: `7790`)** → é um **switch**:
   - Leia `_task/current.yml`. Se `<id>` **não** estiver em `tasks:`, avise que essa task não foi empacotada (liste as disponíveis) e pare.
   - Se existir, edite **apenas** a linha `current:` de `_task/current.yml` pra `current: <id>`. Não mexa no resto do arquivo.
   - Confirme em uma linha (`▶ Task ativa: #<id>`) e siga pro fluxo de planejamento abaixo com essa task.

4. **vazio** → planeje a task **ativa**: leia `current:` de `_task/current.yml` e use `_task/tasks/<current>/`.

**Se `_task/current.yml` não existir, ou `current:` for `~`/vazio, ou a pasta da task estiver vazia**, me peça pra empacotar um ticket com a extensão antes de continuar — não tente buscar via MCP.

## Fluxo de planejamento

Lendo `_task/tasks/<id>/task.md` e as imagens de `_task/tasks/<id>/imgs/`:

1. **Resuma a tarefa** em 2-3 frases (o quê e por quê).
2. **Aponte restrições** que aparecem nos comentários, screenshots ou links relacionados e que não estão na descrição original — frequentemente é onde mora o contexto crítico.
3. **Dispare 3 subagentes Explore em paralelo** (uma única mensagem com 3 tool calls):
   - **domain** — encontre código que toca a feature/área mencionada no ticket: controllers, services, páginas/componentes Vue, tabelas SSDT, jobs Quartz quando relevante. Use o campo `area` do frontmatter como pista inicial.
   - **patterns** — encontre implementações similares já existentes no projeto. Para bugs, ache o caso irmão que funciona corretamente. Para features, ache o análogo mais próximo já entregue. Liste arquivos e padrões a seguir.
   - **impact** — encontre callers, dependents e tipos compartilhados que podem ser afetados pela mudança. Cubra Hub e MyEzra quando aplicável, e considere endpoints dual-surface.
4. **Sintetize em um plano** com:
   - **Arquivos a criar/modificar** — caminho + 1 linha de motivo cada
   - **Padrões reutilizáveis** já no código que devem ser seguidos (com referência aos achados dos subagentes)
   - **Testes a adicionar** — local + o que verificam (sem placeholders, comportamentos distintos, MSTest/NSubstitute no backend, Vitest no frontend)
   - **Riscos e edge cases** que aparecem nas screenshots/comentários
   - **Perguntas em aberto** que bloqueiam a implementação
5. **Use ExitPlanMode** para apresentar o plano. NÃO comece a codar até eu aprovar.

## Fluxo de code review

Acionado por `code-review`. Trabalha sobre os lotes em `_task/tasks/<current>/reviews/`. Os comentários vêm dos meus code reviewers, que são **muito bons** — trate cada um como provavelmente procedente; se for discordar, justifique em vez de descartar.

### Resolução do alvo

**Importante:** os reviews NÃO ficam necessariamente na task ativa. A extensão grava em `_task/tasks/<id>/reviews/`, onde `<id>` é o **work item vinculado ao PR** (que pode ser ≠ da task ativa). Por isso, localize os reviews escaneando o disco, não pela `current.yml`:

- **Escaneie** `_task/tasks/*/reviews/*.md` (ignore `_status.md`).
- `code-review` (sem mais nada) → use a task cujo review foi **exportado mais recentemente** (maior timestamp no nome do arquivo / `exportedAt`). Anuncie em uma linha qual task + PR você está processando (`▶ Code review: task #<id> · PR <prId>`). Dentro dessa task, consolide **todos** os reviews por `threadId` (o mesmo comentário reexportado aparece em vários arquivos com o mesmo `threadId`; conte uma vez só, preferindo a ocorrência mais recente).
- `code-review list` → liste **todas** as tasks que têm `reviews/`, e por task: PR, review mais recente, e contagem aberto/resolvido segundo o ledger. Pare aqui.
- `code-review <id>` → use os reviews da task `<id>`.
- `code-review <arquivo.md>` → use esse arquivo específico.
- Se nenhuma task tiver `reviews/`, me avise pra exportar um review pela extensão antes.

### 1. Reconciliação de estado (SEMPRE no início)

Aqui `<task>` é a task-alvo resolvida acima (do work item do PR), não necessariamente a ativa.

1. Liste `_task/tasks/<task>/reviews/*.md` (ignore `_status.md`). Cada thread é marcado por `<!-- thread: <id> | adoStatus: <active|resolved> -->`.
2. Leia o ledger `_task/tasks/<task>/reviews/_status.md` se existir.
3. Monte o conjunto de threads (chave = `threadId`). Um thread está **resolvido** se: marcado `resolved` no ledger, OU `adoStatus: resolved` no export mais recente. Senão está **aberto**.
4. Imprima um resumo: `N resolvidos · M abertos` e a lista dos **abertos** (threadId, arquivo:linha, 1 linha do comentário). Só processe os **abertos**.

### 2. Verificação profunda (1+ agentes por comentário aberto)

Para cada comentário aberto, dispare **um ou mais subagentes de verificação** (`Explore`/`general-purpose`) — comentários independentes em paralelo, numa única mensagem. Cada agente deve, no código real:

- Localizar o arquivo/linha atuais (o diff do review pode estar defasado) e ler o contexto em volta.
- Responder: **(a)** o pedido procede? **(b)** aplicar a mudança introduz bug/regressão ou conflita com outro padrão do projeto? **(c)** qual é a correção concreta e o que mais ela afeta (callers, testes, dual-surface Hub/MyEzra)?

Para PRs com muitos comentários, considere orquestrar com a tool **Workflow** (fan-out verificação→correção por thread). Caso contrário, subagentes diretos bastam.

### 3. Plano de resposta

Consolide os veredictos e **me mostre**, por comentário: o que o reviewer pediu, o veredito da verificação, e a ação proposta (aplicar / aplicar com ajuste / discordar com justificativa). Use ExitPlanMode. **Não edite antes da minha aprovação.**

### 4. Aplicação e revisão final

Após aprovado:
1. Aplique as mudanças, levando os reviewers a sério.
2. Faça uma **revisão geral de cada alteração** (consistência com o padrão vizinho, testes cobrindo o comportamento, efeitos colaterais).
3. **Atualize o ledger** `_status.md` (crie se não existir) marcando os threads endereçados como resolvidos, com o commit local (`git rev-parse --short HEAD`) e a data. Shape:

   ```markdown
   # Status de code review — task <id>

   Atualizado: <ISO8601>

   | thread | arquivo:linha | status | commit | origem |
   |--------|---------------|--------|--------|--------|
   | 110127 | ExternalAppointmentService.cs | ✅ resolved | a1b2c3d | 2026-06-23-1430-pr23200.md |
   | 110126 | EncounterAppointmentService.cs:246 | ⬜ open | — | 2026-06-23-1430-pr23200.md |
   ```

   Threads ainda não endereçados ficam `⬜ open` no ledger — é isso que faz a reconciliação do próximo `code-review` saber o que já foi feito.

Responda em português.
