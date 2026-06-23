(() => {
  // Roda no contexto da página (mesma origem do ADO), então usa a REST API do
  // Azure DevOps com a sessão do usuário (credentials: 'include'). A API é a
  // fonte autoritativa: traz TODOS os threads com arquivo, linha, status e
  // comentários completos — independente do diff que o ADO renderiza de forma
  // lazy no DOM. Se a API falhar (auth/rede), cai pro scraping do DOM.
  //
  // Retorna uma Promise; o chrome.scripting.executeScript aguarda a resolução.
  return (async () => {
    const text = (el) => (el?.textContent ?? '').trim();

    // ---- parse da URL → org/project/repo/prId --------------------------
    const u = new URL(location.href);
    const prId = (u.pathname.match(/\/pullrequest\/(\d+)/) || [])[1] || '';
    if (!prId) {
      return { error: 'A aba ativa não é uma página de pull request do Azure DevOps (.../pullrequest/<n>).' };
    }

    let org = '', project = '', repo = '';
    let m = u.pathname.match(/^\/([^/]+)\/([^/]+)\/_git\/([^/]+)\//);
    if (m) {
      [, org, project, repo] = m;
    } else {
      m = u.pathname.match(/^\/([^/]+)\/_git\/([^/]+)\//); // org no host (*.visualstudio.com)
      if (m) { project = m[1]; repo = m[2]; }
    }

    // ---- work items vinculados (DOM, confiável) ------------------------
    const extractLinkedWorkItems = () => {
      const out = [];
      const seen = new Set();
      const scope = document.querySelector('.linked-wit-pr-details') || document;
      for (const a of scope.querySelectorAll('a[href*="/_workitems/edit/"]')) {
        const id = (a.getAttribute('href') || '').match(/\/_workitems\/edit\/(\d+)/)?.[1];
        if (!id || seen.has(id)) continue;
        seen.add(id);
        out.push({ id, title: text(a) });
      }
      return out;
    };
    const linkedWorkItems = extractLinkedWorkItems();

    // ---- caminho via REST API ------------------------------------------
    const apiBase = org
      ? `${u.origin}/${org}/${project}/_apis/git/repositories/${encodeURIComponent(repo)}`
      : `${u.origin}/${project}/_apis/git/repositories/${encodeURIComponent(repo)}`;

    const apiGetJson = async (path) => {
      const res = await fetch(`${apiBase}${path}`, {
        headers: { Accept: 'application/json' },
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`API ${res.status} em ${path}`);
      const ct = res.headers.get('content-type') || '';
      if (!/json/.test(ct)) throw new Error('API não retornou JSON (provável sessão expirada).');
      return res.json();
    };

    const fileCache = new Map();
    const fetchFileLines = async (filePath, commit) => {
      if (!filePath || !commit) return null;
      const key = `${commit}|${filePath}`;
      if (fileCache.has(key)) return fileCache.get(key);
      try {
        const url = `${apiBase}/items?path=${encodeURIComponent(filePath)}`
          + `&versionDescriptor.version=${commit}&versionDescriptor.versionType=commit`
          + `&resolveLfs=true&api-version=7.1`;
        const res = await fetch(url, { headers: { Accept: 'text/plain' }, credentials: 'include' });
        if (!res.ok) { fileCache.set(key, null); return null; }
        let body = await res.text();
        // se vier JSON com { content }, desembrulha
        if (/^\s*\{/.test(body) && /"content"/.test(body)) {
          try { body = JSON.parse(body).content ?? body; } catch { /* mantém texto */ }
        }
        const lines = body.split('\n');
        fileCache.set(key, lines);
        return lines;
      } catch {
        fileCache.set(key, null);
        return null;
      }
    };

    const buildSnippet = (lines, startLine, endLine) => {
      if (!lines || !startLine) return [];
      const from = Math.max(1, startLine - 3);
      const to = Math.min(lines.length, (endLine || startLine) + 3);
      const out = [];
      for (let n = from; n <= to; n++) {
        out.push({
          lineNo: n,
          code: (lines[n - 1] ?? '').replace(/\s+$/, ''),
          commented: n >= startLine && n <= (endLine || startLine),
        });
      }
      return out;
    };

    const tryApi = async () => {
      const pr = await apiGetJson(`/pullRequests/${prId}?api-version=7.1`);
      const threadsRes = await apiGetJson(`/pullRequests/${prId}/threads?api-version=7.1`);

      const sourceCommit = pr.lastMergeSourceCommit?.commitId || '';
      const targetCommit = pr.lastMergeTargetCommit?.commitId || '';
      const prTitle = pr.title || '';
      const sourceBranch = (pr.sourceRefName || '').replace(/^refs\/heads\//, '');
      const targetBranch = (pr.targetRefName || '').replace(/^refs\/heads\//, '');

      const threads = [];
      for (const t of threadsRes.value || []) {
        // só comentários humanos (descarta threads de sistema: políticas, votos…)
        const comments = (t.comments || [])
          .filter((c) => c.commentType !== 'system' && (c.content || '').trim())
          .map((c) => ({
            author: c.author?.displayName || '',
            date: c.publishedDate || '',
            markdown: (c.content || '').trim(),
          }));
        if (comments.length === 0) continue;

        const ctx = t.threadContext || null;
        const rightSide = !!ctx?.rightFileStart;
        const startLine = ctx?.rightFileStart?.line ?? ctx?.leftFileStart?.line ?? null;
        const endLine = ctx?.rightFileEnd?.line ?? ctx?.leftFileEnd?.line ?? startLine;
        const file = (ctx?.filePath || '').replace(/^\//, '');

        const rawStatus = t.status || '';
        const status = /fixed|closed|wontFix|byDesign/i.test(rawStatus) ? 'resolved' : 'active';

        let snippet = [];
        if (file && startLine) {
          const lines = await fetchFileLines(ctx.filePath, rightSide ? sourceCommit : targetCommit);
          snippet = buildSnippet(lines, startLine, endLine);
        }

        threads.push({
          threadId: String(t.id),
          file,
          line: startLine ? (endLine && endLine !== startLine ? `${startLine}-${endLine}` : String(startLine)) : '',
          startLine,
          endLine,
          status,
          rawStatus,
          snippet,
          comments,
        });
      }

      if (threads.length === 0) {
        return { error: 'Nenhum comentário de code review encontrado neste PR.' };
      }

      const activeThreads = threads.filter((t) => t.status === 'active').length;
      return {
        source: 'api',
        prId,
        prTitle,
        prUrl: `${u.origin}${u.pathname}`,
        sourceBranch,
        targetBranch,
        commit: sourceCommit,
        linkedWorkItems,
        threads,
        threadCount: threads.length,
        activeThreads,
        resolvedThreads: threads.length - activeThreads,
      };
    };

    // ---- fallback: scraping do DOM (melhor-esforço) --------------------
    const domScrape = () => {
      const renderChildren = (parent, ctx) => {
        let out = '';
        for (const child of parent.childNodes) out += renderNode(child, ctx);
        return out;
      };
      const renderNode = (node, ctx) => {
        if (node.nodeType === 3) return node.textContent.replace(/\s+/g, ' ');
        if (node.nodeType !== 1) return '';
        const tag = node.tagName.toLowerCase();
        if (tag === 'br') return '\n';
        if (tag === 'b' || tag === 'strong') return '**' + renderChildren(node, ctx).trim() + '**';
        if (tag === 'i' || tag === 'em') return '*' + renderChildren(node, ctx).trim() + '*';
        if (tag === 'code') return '`' + renderChildren(node, ctx) + '`';
        if (tag === 'pre') return '\n```\n' + renderChildren(node, ctx).trim() + '\n```\n';
        if (tag === 'a') {
          const href = node.getAttribute('href') || '';
          const t = renderChildren(node, ctx).trim();
          return href ? `[${t}](${href})` : t;
        }
        if (['div', 'p', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tag)) {
          const inner = renderChildren(node, ctx);
          return inner.endsWith('\n') ? inner : inner + '\n';
        }
        return renderChildren(node, ctx);
      };
      const htmlToMarkdown = (rootEl) =>
        renderChildren(rootEl, {}).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

      const threads = [];
      const seen = new Set();
      for (const threadEl of document.querySelectorAll('.repos-discussion-thread')) {
        const card = threadEl.closest('.bolt-card') || threadEl;
        const comments = [];
        for (const c of card.querySelectorAll('.repos-discussion-comment')) {
          const author = c.querySelector('.repos-comment-header-persona[aria-label]')?.getAttribute('aria-label')?.trim() || '';
          const timeEl = c.querySelector('time');
          const date = (timeEl?.closest('[aria-label]')?.getAttribute('aria-label') || text(timeEl) || '').trim();
          const body = c.querySelector('.markdown-content');
          const markdown = body ? htmlToMarkdown(body) : '';
          if (markdown) comments.push({ author, date, markdown });
        }
        if (comments.length === 0) continue;

        const fileLink = card.querySelector('.comment-file-header-link');
        let file = text(fileLink);
        const fileHref = fileLink?.getAttribute('href') || '';
        const pathMatch = fileHref.match(/[?&]path=([^&]+)/);
        if (pathMatch) file = decodeURIComponent(pathMatch[1]).replace(/^\//, '');
        const threadId =
          (card.querySelector('[class*="threadId-"]')?.className.match(/threadId-(\d+)/) || [])[1] ||
          (fileHref.match(/discussionId=(\d+)/) || [])[1] || '';
        if (threadId && seen.has(threadId)) continue;
        if (threadId) seen.add(threadId);

        const statusText = Array.from(card.querySelectorAll('button, .bolt-pill, [class*="status"]'))
          .map(text).find((x) => /^(Active|Resolved|Closed|Won.?t fix|Pending|Fixed)$/i.test(x)) || '';
        const status = /resolv|closed|won.?t fix|fixed/i.test(statusText) ? 'resolved' : 'active';

        // diff renderizado (quando presente)
        const snippet = [];
        let anchor = '';
        const container = card.querySelector('.repos-summary-diff-container');
        if (container) {
          for (const row of container.querySelectorAll('.repos-diff-contents-row')) {
            const nums = Array.from(row.querySelectorAll('.repos-line-number[data-line]'))
              .map((n) => n.getAttribute('data-line')).filter(Boolean);
            const content = row.querySelector('.repos-line-content');
            if (!content) continue;
            const clone = content.cloneNode(true);
            clone.querySelectorAll('.screen-reader-only, .line-icon').forEach((n) => n.remove());
            clone.querySelectorAll('[aria-hidden="true"]').forEach((n) => { if (!text(n)) n.remove(); });
            const lineNo = nums[nums.length - 1] || '';
            if (lineNo) anchor = lineNo;
            snippet.push({ lineNo, code: (clone.textContent || '').replace(/\s+$/, ''), commented: false });
          }
        }

        threads.push({ threadId, file, line: anchor, status, snippet, comments });
      }

      if (threads.length === 0) {
        return { error: 'Nenhum comentário de code review encontrado na página. Carregue a aba Overview/Files com os comentários visíveis.' };
      }
      const activeThreads = threads.filter((t) => t.status === 'active').length;
      return {
        source: 'dom',
        prId, prTitle: (document.title || '').replace(/^Pull request \d+:\s*/i, '').replace(/\s*-\s*Repos\s*$/i, '').trim(),
        prUrl: `${u.origin}${u.pathname}`, sourceBranch: '', targetBranch: '', commit: '',
        linkedWorkItems, threads, threadCount: threads.length,
        activeThreads, resolvedThreads: threads.length - activeThreads,
      };
    };

    try {
      return await tryApi();
    } catch (e) {
      const dom = domScrape();
      if (dom && !dom.error) { dom.apiError = String(e?.message || e); return dom; }
      return { error: `Falha na API do ADO (${e?.message || e}) e nenhum comentário encontrado no DOM.` };
    }
  })();
})();
