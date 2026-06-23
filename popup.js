const $ = (id) => document.getElementById(id);
const targetEl = $('target');
const bundleBtn = $('bundle');
const reviewBtn = $('review');
const setFolderBtn = $('setFolder');
const statusEl = $('status');
const tasksSection = $('tasks');
const taskSelect = $('taskSelect');
const removeTaskBtn = $('removeTask');
const wiPickerSection = $('wiPicker');
const wiSelect = $('wiSelect');
const wiConfirm = $('wiConfirm');

const TASK_DIR = '_task';
const REVIEWS_DIR = 'reviews';

const DB_NAME = 'ado-task-bundler';
const STORE = 'handles';
const HANDLE_KEY = 'target';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveHandle(handle) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(handle, HANDLE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function loadHandle() {
  try {
    const db = await openDb();
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(HANDLE_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

function setStatus(msg, kind = 'info') {
  statusEl.textContent = msg;
  statusEl.className = `status ${kind}`;
  statusEl.style.display = 'block';
}

async function ensurePermission(handle) {
  const opts = { mode: 'readwrite' };
  if ((await handle.queryPermission(opts)) === 'granted') return true;
  return (await handle.requestPermission(opts)) === 'granted';
}

async function refreshTarget() {
  const handle = await loadHandle();
  if (handle) {
    targetEl.textContent = handle.name;
    bundleBtn.disabled = false;
  } else {
    targetEl.textContent = 'nenhuma pasta selecionada';
    bundleBtn.disabled = true;
  }
}

setFolderBtn.addEventListener('click', async () => {
  try {
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    await saveHandle(handle);
    await refreshTarget();
    await refreshTasks();
    await refreshReviewBtn();
    setStatus(`Pasta destino definida: ${handle.name}`, 'ok');
  } catch (e) {
    if (e.name !== 'AbortError') setStatus(`Erro: ${e.message}`, 'err');
  }
});

bundleBtn.addEventListener('click', async () => {
  bundleBtn.disabled = true;
  setStatus('Extraindo dados do ticket…', 'info');

  try {
    const handle = await loadHandle();
    if (!handle) throw new Error('Nenhuma pasta destino configurada.');
    if (!(await ensurePermission(handle))) throw new Error('Permissão negada para a pasta destino.');

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !/^https:\/\/dev\.azure\.com\//.test(tab.url || '')) {
      throw new Error('A aba ativa não é dev.azure.com.');
    }

    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js']
    });

    if (!result || result.error) throw new Error(result?.error || 'Falha ao extrair dados.');

    setStatus(`Baixando ${result.imageRefs.length} imagem(ns)…`, 'info');
    const images = await fetchImages(result.imageRefs);

    setStatus('Escrevendo bundle…', 'info');
    const md = renderMarkdown(result);
    const id = await writeBundle(handle, result, md, images);
    await refreshTasks();

    setStatus(`✅ Task #${id} empacotada e ativada\n   ${handle.name}/_task/tasks/${id}/ (${images.length} imagem(ns))`, 'ok');
  } catch (e) {
    console.error(e);
    setStatus(`❌ ${e.message}`, 'err');
  } finally {
    bundleBtn.disabled = false;
  }
});

reviewBtn.addEventListener('click', async () => {
  reviewBtn.disabled = true;
  setStatus('Extraindo comentários do code review…', 'info');

  try {
    const handle = await loadHandle();
    if (!handle) throw new Error('Nenhuma pasta destino configurada.');
    if (!(await ensurePermission(handle))) throw new Error('Permissão negada para a pasta destino.');

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !/\/pullrequest\/\d+/.test(tab.url || '')) {
      throw new Error('A aba ativa não é um pull request do Azure DevOps.');
    }

    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['review-content.js']
    });

    if (!result || result.error) throw new Error(result?.error || 'Falha ao extrair o review.');

    const taskId = await resolveReviewTaskId(handle, result);
    if (!taskId) { setStatus('Exportação cancelada.', 'info'); return; }

    setStatus('Escrevendo review…', 'info');
    const md = renderReviewMarkdown(result, taskId);
    const filename = reviewFilename(result.prId);
    await writeReview(handle, taskId, filename, md);
    await refreshTasks();

    const via = result.source === 'api'
      ? 'via API'
      : `⚠ via DOM (API falhou${result.apiError ? `: ${result.apiError}` : ''}; pode faltar diff)`;
    setStatus(
      `✅ Review do PR #${result.prId} exportado (${result.threadCount} comentário(s)) ${via}\n` +
      `   _task/tasks/${taskId}/reviews/${filename}`,
      'ok'
    );
  } catch (e) {
    console.error(e);
    setStatus(`❌ ${e.message}`, 'err');
  } finally {
    reviewBtn.disabled = false;
  }
});

taskSelect.addEventListener('change', async () => {
  const id = taskSelect.value;
  try {
    const handle = await loadHandle();
    if (!handle || !(await ensurePermission(handle))) return;
    await setCurrent(handle, id);
    setStatus(`▶ Task ativa: #${id}`, 'ok');
  } catch (e) {
    setStatus(`❌ ${e.message}`, 'err');
  }
});

removeTaskBtn.addEventListener('click', async () => {
  const id = taskSelect.value;
  if (!id) return;
  try {
    const handle = await loadHandle();
    if (!handle || !(await ensurePermission(handle))) return;
    await removeTask(handle, id);
    await refreshTasks();
    setStatus(`🗑 Task #${id} removida`, 'ok');
  } catch (e) {
    setStatus(`❌ ${e.message}`, 'err');
  }
});

async function fetchImages(refs) {
  const results = [];
  for (const ref of refs) {
    const res = await fetch(ref.src, { credentials: 'include' });
    if (!res.ok) throw new Error(`Falha ao baixar imagem (HTTP ${res.status}): ${ref.filename}`);
    const blob = await res.blob();
    results.push({ filename: ref.filename, blob });
  }
  return results;
}

// --- task store (multi-task, filesystem-backed) -------------------------
//
// Layout:
//   _task/
//     current.yml          ← gerado pela extensão; ponteiro + índice (consumido por /ezra)
//     tasks/<id>/
//       task.md
//       meta.json          ← {id,title,type,url,bundledAt} (durável, por task)
//       imgs/*
//
// A extensão NUNCA parseia YAML: lê `current` de current.yml via 1 regex e
// regenera o índice a partir do listing de tasks/ + meta.json a cada operação.

async function writeBundle(rootHandle, data, taskMd, images) {
  const taskRoot = await rootHandle.getDirectoryHandle(TASK_DIR, { create: true });
  const tasksDir = await taskRoot.getDirectoryHandle('tasks', { create: true });
  const id = String(data.id);

  // re-empacotar o mesmo ticket sobrescreve só os artefatos do bundle, NUNCA a
  // pasta inteira: reviews/ e logs/ são adicionados pelo usuário e devem
  // sobreviver a um re-empacotamento. Removemos task.md, meta.json e imgs/ e
  // deixamos o resto intacto.
  const dir = await tasksDir.getDirectoryHandle(id, { create: true });
  for (const stale of ['task.md', 'meta.json']) {
    try { await dir.removeEntry(stale); } catch (e) { if (e.name !== 'NotFoundError') throw e; }
  }
  try { await dir.removeEntry('imgs', { recursive: true }); } catch (e) { if (e.name !== 'NotFoundError') throw e; }

  await writeFile(dir, 'task.md', taskMd);
  await writeFile(dir, 'meta.json', JSON.stringify({
    id,
    title: data.title,
    type: data.type || '',
    url: data.url,
    bundledAt: new Date().toISOString(),
  }, null, 2));
  if (images.length > 0) {
    const imgsDir = await dir.getDirectoryHandle('imgs', { create: true });
    for (const img of images) await writeFile(imgsDir, img.filename, img.blob);
  }

  await regenerateCurrentYml(rootHandle, id);
  return id;
}

async function listTasks(rootHandle) {
  let tasksDir;
  try {
    const taskRoot = await rootHandle.getDirectoryHandle(TASK_DIR);
    tasksDir = await taskRoot.getDirectoryHandle('tasks');
  } catch {
    return [];
  }
  const out = [];
  for await (const [name, h] of tasksDir.entries()) {
    if (h.kind !== 'directory') continue;
    try {
      const file = await (await h.getFileHandle('meta.json')).getFile();
      out.push(JSON.parse(await file.text()));
    } catch {
      out.push({ id: name, title: name, bundledAt: '' });
    }
  }
  out.sort((a, b) => String(b.bundledAt || '').localeCompare(String(a.bundledAt || '')));
  return out;
}

async function readCurrentId(rootHandle) {
  try {
    const taskRoot = await rootHandle.getDirectoryHandle(TASK_DIR);
    const file = await (await taskRoot.getFileHandle('current.yml')).getFile();
    const m = (await file.text()).match(/^current:\s*(.+)$/m);
    const v = m && m[1].trim();
    return v && v !== '~' ? v : null;
  } catch {
    return null;
  }
}

function renderCurrentYml(currentId, tasks) {
  const lines = [`current: ${currentId ?? '~'}`];
  if (tasks.length === 0) {
    lines.push('tasks: []');
  } else {
    lines.push('tasks:');
    for (const t of tasks) {
      const fields = [`id: ${t.id}`, `title: ${yamlString(t.title)}`];
      if (t.type) fields.push(`type: ${yamlString(t.type)}`);
      if (t.url) fields.push(`url: ${t.url}`);
      if (t.bundledAt) fields.push(`bundledAt: ${t.bundledAt}`);
      lines.push(`  - { ${fields.join(', ')} }`);
    }
  }
  return lines.join('\n') + '\n';
}

async function regenerateCurrentYml(rootHandle, currentId) {
  const taskRoot = await rootHandle.getDirectoryHandle(TASK_DIR, { create: true });
  const tasks = await listTasks(rootHandle);
  if (!tasks.find((t) => String(t.id) === String(currentId))) {
    currentId = tasks[0]?.id ?? null; // ponteiro inválido → cai pra mais recente
  }
  await writeFile(taskRoot, 'current.yml', renderCurrentYml(currentId, tasks));
  return currentId;
}

async function setCurrent(rootHandle, id) {
  return regenerateCurrentYml(rootHandle, id);
}

async function removeTask(rootHandle, id) {
  const taskRoot = await rootHandle.getDirectoryHandle(TASK_DIR);
  const tasksDir = await taskRoot.getDirectoryHandle('tasks');
  try {
    await tasksDir.removeEntry(String(id), { recursive: true });
  } catch (e) {
    if (e.name !== 'NotFoundError') throw e;
  }
  const current = await readCurrentId(rootHandle);
  const next = String(current) === String(id) ? null : current;
  await regenerateCurrentYml(rootHandle, next);
}

async function refreshTasks() {
  const handle = await loadHandle();
  if (!handle) {
    tasksSection.style.display = 'none';
    return;
  }
  tasksSection.style.display = 'block';

  // queryPermission não dispara prompt; só listamos se já houver acesso de leitura
  if ((await handle.queryPermission({ mode: 'readwrite' })) !== 'granted') {
    taskSelect.innerHTML = '<option disabled selected>— empacote pra liberar acesso —</option>';
    taskSelect.disabled = true;
    removeTaskBtn.disabled = true;
    return;
  }

  const [tasks, current] = await Promise.all([listTasks(handle), readCurrentId(handle)]);
  taskSelect.innerHTML = '';
  if (tasks.length === 0) {
    const o = document.createElement('option');
    o.textContent = 'nenhuma task empacotada';
    o.disabled = true;
    o.selected = true;
    taskSelect.appendChild(o);
    taskSelect.disabled = true;
    removeTaskBtn.disabled = true;
    return;
  }
  taskSelect.disabled = false;
  removeTaskBtn.disabled = false;
  for (const t of tasks) {
    const o = document.createElement('option');
    o.value = String(t.id);
    o.textContent = `#${t.id} — ${t.title}`;
    if (String(t.id) === String(current)) o.selected = true;
    taskSelect.appendChild(o);
  }
}

async function writeFile(dirHandle, name, contents) {
  const fileHandle = await dirHandle.getFileHandle(name, { create: true });
  const writer = await fileHandle.createWritable();
  await writer.write(contents);
  await writer.close();
}

function yamlString(s) {
  return JSON.stringify(s ?? '');
}

// --- code review export -------------------------------------------------
//
// Layout:
//   _task/tasks/<taskId>/reviews/<YYYY-MM-DD-HHMM>-pr<PRID>.md
//
// taskId é resolvido a partir do work item vinculado ao PR (cascata em
// resolveReviewTaskId). reviews/ NUNCA é apagado ao re-empacotar a task.

async function resolveReviewTaskId(rootHandle, data) {
  const linked = data.linkedWorkItems || [];
  if (linked.length === 1) return linked[0].id;
  if (linked.length > 1) return await pickWorkItem(linked);
  // sem work item vinculado → cai pra task ativa
  const current = await readCurrentId(rootHandle);
  if (current) return String(current);
  throw new Error('PR sem work item vinculado e sem task ativa. Empacote/ative uma task antes de exportar o review.');
}

function pickWorkItem(linked) {
  return new Promise((resolve) => {
    wiSelect.innerHTML = '';
    for (const wi of linked) {
      const o = document.createElement('option');
      o.value = String(wi.id);
      o.textContent = `#${wi.id}${wi.title ? ' — ' + wi.title : ''}`;
      wiSelect.appendChild(o);
    }
    wiPickerSection.style.display = 'block';
    setStatus('Este PR tem mais de um work item vinculado. Escolha qual recebe o review.', 'info');
    const onConfirm = () => {
      wiConfirm.removeEventListener('click', onConfirm);
      wiPickerSection.style.display = 'none';
      resolve(wiSelect.value);
    };
    wiConfirm.addEventListener('click', onConfirm);
  });
}

function reviewFilename(prId) {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const ts = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  return `${ts}-pr${prId}.md`;
}

async function writeReview(rootHandle, taskId, filename, md) {
  const taskRoot = await rootHandle.getDirectoryHandle(TASK_DIR, { create: true });
  const tasksDir = await taskRoot.getDirectoryHandle('tasks', { create: true });
  const taskDir = await tasksDir.getDirectoryHandle(String(taskId), { create: true });
  const reviewsDir = await taskDir.getDirectoryHandle(REVIEWS_DIR, { create: true });
  await writeFile(reviewsDir, filename, md);
}

function codeLang(file) {
  const ext = (file || '').split('.').pop()?.toLowerCase() || '';
  const map = { cs: 'csharp', ts: 'ts', tsx: 'tsx', js: 'js', jsx: 'jsx', vue: 'vue', sql: 'sql', json: 'json', py: 'python', html: 'html', css: 'css', sh: 'bash', yml: 'yaml', yaml: 'yaml' };
  return map[ext] || '';
}

function renderReviewMarkdown(data, taskId) {
  const fm = ['---', 'kind: code-review'];
  fm.push(`prId: ${data.prId}`);
  fm.push(`prTitle: ${yamlString(data.prTitle)}`);
  fm.push(`prUrl: ${data.prUrl}`);
  if (data.sourceBranch) fm.push(`sourceBranch: ${yamlString(data.sourceBranch)}`);
  if (data.targetBranch) fm.push(`targetBranch: ${yamlString(data.targetBranch)}`);
  fm.push(`commit: ${data.commit || ''}`);
  fm.push(`taskId: ${taskId}`);
  if (data.linkedWorkItems?.length) {
    fm.push('linkedWorkItems:');
    for (const wi of data.linkedWorkItems) {
      fm.push(`  - { id: ${wi.id}, title: ${yamlString(wi.title)} }`);
    }
  }
  fm.push(`exportedAt: ${new Date().toISOString()}`);
  fm.push(`threadCount: ${data.threadCount}`);
  fm.push(`activeThreads: ${data.activeThreads}`);
  fm.push(`resolvedThreads: ${data.resolvedThreads}`);
  fm.push('---');

  const parts = [fm.join('\n'), '', `# Code review — PR ${data.prId}`, ''];
  if (data.prTitle) parts.push(`> ${data.prTitle}`, '');

  data.threads.forEach((t, i) => {
    const badge = t.status === 'resolved' ? '🟢 resolved' : '🟡 active';
    const loc = t.line ? `${t.file}:${t.line}` : (t.file || '(comentário geral)');
    parts.push(`## ${i + 1}. ${loc} · ${badge}`, '');
    // âncora estável p/ o /ezra code-review rastrear resolução entre exports
    parts.push(`<!-- thread: ${t.threadId || `t${i + 1}`} | adoStatus: ${t.rawStatus || t.status} -->`, '');

    const snippet = t.snippet || [];
    if (snippet.length) {
      parts.push('```' + codeLang(t.file));
      for (const ln of snippet) {
        const gutter = ln.commented ? '►' : ' ';
        const num = ln.lineNo ? String(ln.lineNo).padStart(4, ' ') : '    ';
        parts.push(`${gutter} ${num}  ${ln.code}`);
      }
      parts.push('```', '');
    }

    for (const c of t.comments) {
      const header = [c.author, c.date].filter(Boolean).join(' — ');
      if (header) parts.push(`**${header}**`, '');
      // cita linha-a-linha, exceto quando o corpo já tem bloco de código
      // (citar quebraria a fence) — aí renderiza como está.
      const body = c.markdown.includes('```')
        ? c.markdown
        : c.markdown.split('\n').map((l) => (l ? `> ${l}` : '>')).join('\n');
      parts.push(body, '');
    }
  });

  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

async function refreshReviewBtn() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const isPr = /^https:\/\/dev\.azure\.com\/.*\/pullrequest\/\d+/.test(tab?.url || '');
    const handle = await loadHandle();
    reviewBtn.disabled = !isPr || !handle;
    reviewBtn.title = !handle
      ? 'Defina a pasta destino primeiro'
      : isPr ? 'Exportar comentários do code review' : 'Abra um pull request para exportar';
  } catch {
    reviewBtn.disabled = true;
  }
}

function renderMarkdown(data) {
  const fm = ['---'];
  fm.push(`id: ${data.id}`);
  if (data.type) fm.push(`type: ${yamlString(data.type)}`);
  fm.push(`title: ${yamlString(data.title)}`);
  for (const [k, v] of Object.entries(data.fields)) {
    fm.push(`${k}: ${yamlString(v)}`);
  }
  fm.push(`url: ${data.url}`);
  if (data.links.length > 0) {
    fm.push('related:');
    for (const l of data.links) {
      const rel = l.relation ? `, relation: ${yamlString(l.relation)}` : '';
      fm.push(`  - { id: ${l.id}, title: ${yamlString(l.title)}${rel} }`);
    }
  }
  fm.push('---');

  const parts = [fm.join('\n'), '', `# [${data.id}] ${data.title}`, ''];

  const sectionOrder = ['Description', 'Repro Steps', 'Expected Results', 'Actual Results', 'Acceptance Criteria', 'System Info'];
  for (const label of sectionOrder) {
    if (data.sections[label]) parts.push(`## ${label}`, '', data.sections[label], '');
  }

  if (data.comments.length > 0) {
    parts.push('## Comments', '');
    for (const c of data.comments) {
      const header = [c.author, c.date].filter(Boolean).join(' — ');
      if (header) parts.push(`**${header}**`, '');
      parts.push(c.markdown, '');
    }
  }

  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

refreshTarget();
refreshTasks();
refreshReviewBtn();
