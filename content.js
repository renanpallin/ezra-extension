(() => {
  const text = (el) => (el?.textContent ?? '').trim();
  const slugify = (s) => (s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);

  const toRoman = (n) => {
    const map = [['m', 1000], ['cm', 900], ['d', 500], ['cd', 400], ['c', 100],
                 ['xc', 90], ['l', 50], ['xl', 40], ['x', 10], ['ix', 9],
                 ['v', 5], ['iv', 4], ['i', 1]];
    let s = '';
    for (const [r, v] of map) while (n >= v) { s += r; n -= v; }
    return s;
  };

  const renderChildren = (parent, ctx, imageRefs) => {
    let out = '';
    for (const child of parent.childNodes) out += renderNode(child, ctx, imageRefs);
    return out;
  };

  const renderNode = (node, ctx, imageRefs) => {
    if (node.nodeType === 3) return node.textContent.replace(/\s+/g, ' ');
    if (node.nodeType !== 1) return '';
    const tag = node.tagName.toLowerCase();

    if (tag === 'ol' || tag === 'ul') {
      const style = node.getAttribute('style') || '';
      const isAlpha = /lower-alpha/.test(style);
      const isRoman = /lower-roman/.test(style);
      const indent = '   '.repeat(ctx.depth);
      let counter = 1;
      let out = '\n';
      for (const child of node.children) {
        const childTag = child.tagName.toLowerCase();
        if (childTag === 'li') {
          let marker;
          if (tag === 'ul') marker = '-';
          else if (isAlpha) marker = String.fromCharCode(96 + counter) + '.';
          else if (isRoman) marker = toRoman(counter) + '.';
          else marker = counter + '.';
          const inner = renderChildren(child, { depth: ctx.depth + 1 }, imageRefs)
            .trim()
            .replace(/\n/g, '\n' + indent + '   ');
          out += `${indent}${marker} ${inner}\n`;
          counter++;
        } else if (childTag === 'ol' || childTag === 'ul') {
          out += renderNode(child, { depth: ctx.depth + 1 }, imageRefs);
        }
      }
      return out;
    }

    if (tag === 'img') {
      const alt = (node.getAttribute('alt') || '').trim();
      const src = node.getAttribute('src') || '';
      if (!src) return '';
      const index = imageRefs.length;
      const meaningful = alt && !/^image$/i.test(alt);
      const slug = meaningful ? slugify(alt) : 'screenshot';
      const ext = (src.match(/[?&]fileName=[^&]*?\.(\w+)/i) || src.match(/\.(\w{2,5})(\?|$)/))?.[1]?.toLowerCase() || 'png';
      const filename = `${String(index + 1).padStart(2, '0')}-${slug || 'screenshot'}.${ext}`;
      imageRefs.push({ filename, src, alt });
      return `\n![${alt || 'screenshot'}](imgs/${filename})\n`;
    }

    if (tag === 'br') return '\n';
    if (tag === 'b' || tag === 'strong') return '**' + renderChildren(node, ctx, imageRefs).trim() + '**';
    if (tag === 'i' || tag === 'em') return '*' + renderChildren(node, ctx, imageRefs).trim() + '*';
    if (tag === 'u') return renderChildren(node, ctx, imageRefs);
    if (tag === 'code') return '`' + renderChildren(node, ctx, imageRefs) + '`';
    if (tag === 'pre') return '\n```\n' + renderChildren(node, ctx, imageRefs).trim() + '\n```\n';
    if (tag === 'a') {
      const href = node.getAttribute('href') || '';
      const t = renderChildren(node, ctx, imageRefs).trim();
      return href ? `[${t}](${href})` : t;
    }
    if (['div', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'tr'].includes(tag)) {
      const inner = renderChildren(node, ctx, imageRefs);
      return inner.endsWith('\n') ? inner : inner + '\n';
    }
    if (tag === 'td' || tag === 'th') return renderChildren(node, ctx, imageRefs).trim() + '\t';

    return renderChildren(node, ctx, imageRefs);
  };

  const htmlToMarkdown = (rootEl, imageRefs) => {
    return renderChildren(rootEl, { depth: 0 }, imageRefs)
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  };

  const findSection = (label) => {
    const el = document.querySelector(`.rooster-editor[aria-label="${label}"]`)
      || document.querySelector(`[aria-label="${label}"][contenteditable="true"]`);
    return el && el.innerText.trim() ? el : null;
  };

  const extractIdAndTitle = () => {
    const titleInput = document.querySelector('input[aria-label="Title field"]');
    const title = titleInput?.value?.trim() ?? '';
    // O ID do item aberto vem da própria URL: ?workitem=XXXX (boards/sprints/backlogs)
    // ou /_workitems/edit/XXXX (página de edição direta). Nunca de um <a> avulso do DOM,
    // que pode apontar para itens relacionados/recentes.
    const id = new URL(location.href).searchParams.get('workitem')
      || (location.href.match(/\/_workitems\/edit\/(\d+)/)?.[1] ?? '');

    const typeAriaLabels = ['Bug', 'User Story', 'Task', 'Feature', 'Epic', 'Issue'];
    let type = '';
    for (const t of typeAriaLabels) {
      if (document.querySelector(`[aria-label="${t}"].fluent-icons-enabled, span[aria-label="${t}"][role="img"]`)) {
        type = t; break;
      }
    }
    return { id, title, type };
  };

  const extractFieldValue = (label) => {
    const input = document.querySelector(`input[aria-label="${label}"]`);
    if (input?.value) return input.value.trim();
    const textarea = document.querySelector(`textarea[aria-label="${label}"]`);
    if (textarea?.value) return textarea.value.trim();
    const widgets = document.querySelectorAll(`[aria-label="${label}"]`);
    for (const w of widgets) {
      if (w.classList.contains('rooster-editor')) continue;
      if (w.tagName.toLowerCase() === 'input' || w.tagName.toLowerCase() === 'textarea') continue;
      const v = text(w);
      if (v && v !== label && v.length < 200) return v;
    }
    return '';
  };

  const FIELD_LABELS = [
    ['State', 'state'],
    ['Reason', 'reason'],
    ['Area', 'area'],
    ['Iteration', 'iteration'],
    ['Severity', 'severity'],
    ['Priority', 'priority'],
    ['Environment', 'environment'],
    ['Application', 'application'],
    ['Found in Build', 'foundInBuild'],
    ['Sizing', 'sizing'],
    ['Sizing QA', 'sizingQA'],
    ['Company Priority', 'companyPriority'],
    ['Resolved Reason', 'resolvedReason']
  ];

  const extractFields = () => {
    const fields = {};
    for (const [label, key] of FIELD_LABELS) {
      const v = extractFieldValue(label);
      if (v) fields[key] = v;
    }
    return fields;
  };

  const SECTION_LABELS = ['Description', 'Repro Steps', 'Expected Results', 'Actual Results', 'Acceptance Criteria', 'System Info'];

  const extractDescriptionSections = (imageRefs) => {
    const sections = {};
    for (const label of SECTION_LABELS) {
      const el = findSection(label);
      if (el) sections[label] = htmlToMarkdown(el, imageRefs);
    }
    return sections;
  };

  const extractComments = (imageRefs) => {
    const comments = [];
    const candidates = Array.from(document.querySelectorAll(
      '.work-item-discussion-control [class*="comment-item"], [class*="comment-item"], [data-testid*="comment"]'
    ));
    // Os seletores se sobrepõem e o ADO aninha elementos comment-item, então o mesmo
    // comentário aparece num container externo e num filho interno. Mantemos só os
    // candidatos de nível mais alto (que não estão dentro de outro candidato) e ainda
    // deduplicamos por conteúdo para cobrir markup variável entre versões do ADO.
    const topLevel = candidates.filter((el) => !candidates.some((other) => other !== el && other.contains(el)));
    const seenContent = new Set();
    for (const el of topLevel) {
      const author = text(el.querySelector('[class*="author"], [class*="display-name"], [class*="user-name"]'));
      const date = text(el.querySelector('[class*="timestamp"], [class*="date"], time'));
      const body = el.querySelector('.rooster-editor, [contenteditable="true"], [class*="comment-body"], [class*="text-content"]');
      const markdown = body ? htmlToMarkdown(body, imageRefs) : text(el);
      if (!markdown || markdown === author || markdown === date) continue;
      const key = `${author}|${date}|${markdown}`;
      if (seenContent.has(key)) continue;
      seenContent.add(key);
      comments.push({ author, date, markdown });
    }
    return comments;
  };

  const extractLinks = () => {
    const links = [];
    const seen = new Set();
    const linkElements = document.querySelectorAll(
      '.work-item-form-relationships a[href*="/_workitems/edit/"], [class*="related-work"] a[href*="/_workitems/edit/"], [class*="link-list"] a[href*="/_workitems/edit/"]'
    );
    for (const a of linkElements) {
      const href = a.getAttribute('href') || '';
      const idMatch = href.match(/\/_workitems\/edit\/(\d+)/);
      if (!idMatch) continue;
      if (seen.has(idMatch[1])) continue;
      seen.add(idMatch[1]);
      let rel = '';
      const group = a.closest('[class*="group"], [class*="relationship-group"], [class*="link-list"]');
      if (group) {
        const header = group.querySelector('[class*="header"], [class*="title"], h3, h4');
        if (header) rel = text(header).replace(/\s*\(\d+\)\s*$/, '');
      }
      links.push({ id: idMatch[1], title: text(a), relation: rel });
    }
    return links;
  };

  const { id, title, type } = extractIdAndTitle();
  if (!id || !title) {
    return { error: 'Não foi possível identificar o work item. Verifique se está numa página de work item aberta.' };
  }

  const imageRefs = [];
  const fields = extractFields();
  const sections = extractDescriptionSections(imageRefs);
  const comments = extractComments(imageRefs);
  const links = extractLinks();
  const projectPath = location.pathname.split(/\/_/)[0];
  const url = `${location.origin}${projectPath}/_workitems/edit/${id}`;

  return { id, title, type, url, fields, sections, comments, links, imageRefs };
})();
