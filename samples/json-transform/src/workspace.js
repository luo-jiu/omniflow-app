import { createPluginClient, LIMITS } from '@omniflow/plugin-sdk';
import { JsonTransformError } from './json-transform.js';
import { readJsonResource } from './json-resource.js';
import { createWorkspacePreview, describeJsonSource, requestWorkspacePrepare, workspaceParameters } from './workspace-model.js';

const client = createPluginClient();
const element = id => document.getElementById(id);
const fields = element('fields');
const allFields = element('all-fields');
const pretty = element('pretty');
const prepare = element('prepare');
const status = element('status');
let source = null;
let sourceIdentity = null;
let active = true;
let loading = false;
let preparing = false;
let disposed = false;
let themeRevision = -1;
let loadController;
let generation = 0;
let previewValid = false;

function setStatus(message, error = false) {
  status.textContent = message;
  status.dataset.error = String(error);
}

function showError(error) {
  const messages = {
    FORBIDDEN: '当前文件读取或命令权限已失效，请在插件管理中检查授权后重新打开。',
    CONTENT_CHANGED: '源文件已变化，请重新打开工具页。',
    UNAVAILABLE: '工具页已停止或当前能力不可用，请重新打开。',
    TIMEOUT: '请求超时，请重新打开工具页后重试。',
    CANCELLED: '本次请求已取消。',
    BAD_REQUEST: '请在上方选择保存目录、填写新文件名，并检查处理选项后重试。',
    CONFLICT: '已有处理请求待确认，请先在宿主中完成或拒绝该提案。',
    LIMIT: '本次操作超过允许的大小或次数，请重新打开或选择较小的文件。',
  };
  setStatus(Object.prototype.hasOwnProperty.call(messages, error?.code) ? messages[error.code]
    : error instanceof JsonTransformError ? error.message : '工具页无法继续，请重新打开后重试。', true);
}

function applyTheme(snapshot) {
  if (snapshot.revision <= themeRevision) return;
  themeRevision = snapshot.revision;
  document.documentElement.dataset.theme = snapshot.mode;
  // Change the package's external stylesheet through CSSOM; never add inline styles.
  const selector = snapshot.mode === 'dark' ? ':root[data-theme="dark"]' : ':root';
  const sheet = [...document.styleSheets].find(item => item.href?.endsWith('/workspace.css'));
  const rule = sheet && [...sheet.cssRules].find(item => item.selectorText === selector);
  if (!rule) return;
  for (const [property, key] of [['--background', 'surface.app'], ['--foreground', 'text.primary'], ['--secondary', 'text.secondary']]) {
    if (snapshot.colors[key]) rule.style.setProperty(property, snapshot.colors[key]);
  }
}

function updateControls() {
  element('options').disabled = !source || !active || loading || preparing;
  prepare.disabled = !previewValid || !active || loading || preparing;
  prepare.textContent = preparing ? '正在准备…' : '准备另存';
  fields.dataset.disabled = String(allFields.checked);
  for (const checkbox of fields.querySelectorAll('input')) checkbox.disabled = allFields.checked || checkbox.dataset.selectable !== 'true';
}

function parameters() {
  const selected = [...fields.querySelectorAll('input:checked')].map(input => input.value);
  return workspaceParameters(allFields.checked, selected, pretty.checked);
}

function updatePreview() {
  previewValid = false;
  element('preview-size').textContent = '';
  element('preview-note').textContent = '';
  try {
    if (!source) return;
    const preview = createWorkspacePreview(source, parameters());
    element('preview').textContent = preview.text;
    element('preview-size').textContent = `${preview.bytes.toLocaleString()} 字节`;
    element('preview-note').textContent = preview.truncated
      ? '仅显示前 24,000 个字符以内的预览。另存产物包含完整转换结果，超过 1 MiB 会直接失败。'
      : '预览为完整转换结果。最终内容由宿主重新准备并核对。';
    previewValid = true;
    setStatus('预览已更新，可以准备另存。');
  } catch (error) {
    element('preview').textContent = '当前选项无法生成完整 JSON 结果。';
    showError(error);
  } finally { updateControls(); }
}

function renderFields(description) {
  fields.replaceChildren();
  for (const field of description.fields) {
    const label = document.createElement('label');
    label.className = field.selectable ? 'option' : 'option field-unavailable';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = field.name;
    checkbox.dataset.selectable = String(field.selectable);
    const title = document.createElement('span');
    title.className = 'field-label';
    title.textContent = field.name || '（空字段名）';
    if (!field.selectable) title.append(' · 仅完整保留支持');
    label.append(checkbox, title);
    fields.append(label);
  }
  element('field-note').textContent = description.hasMoreFields
    ? '字段较多，仅列出前 256 个。保留全部字段时仍包含所有字段。'
    : description.fields.length ? '字段名按原样匹配；不存在的字段会跳过，嵌套值保持完整。' : '没有可选择的顶层字段，可直接保留原结构。';
  element('source-summary').textContent = description.summary;
}

async function loadSource() {
  loadController?.abort();
  const controller = new AbortController();
  loadController = controller;
  const current = ++generation;
  loading = true;
  updateControls();
  setStatus('正在读取源 JSON…');
  try {
    const context = await client.context();
    if (controller.signal.aborted || disposed || current !== generation) return;
    applyTheme(context.theme);
    if (context.kind !== 'workspace' || context.workspaceId !== 'example.json-transform.workspace'
      || context.commandId !== 'example.json-transform.run') throw new JsonTransformError('FAILED', '当前工具页上下文不匹配，请重新打开。');
    if (!context.resource || !context.readGranted) throw new JsonTransformError('FAILED', '尚未获准读取源文件，请在宿主选择文件并检查插件读取授权。');
    const identity = `${context.resource.handle}:${context.resource.revision}`;
    element('source-name').textContent = context.resource.name;
    if (sourceIdentity !== identity || source === null) {
      source = null;
      previewValid = false;
      const text = await readJsonResource(client, context.resource, LIMITS.readChunkBytes, { signal: controller.signal });
      if (controller.signal.aborted || disposed || current !== generation) return;
      const description = describeJsonSource(text);
      source = text;
      sourceIdentity = identity;
      allFields.checked = true;
      pretty.checked = true;
      renderFields(description);
    }
    updatePreview();
  } catch (error) {
    if (controller.signal.aborted || disposed || current !== generation) return;
    source = null;
    sourceIdentity = null;
    previewValid = false;
    fields.replaceChildren();
    element('preview').textContent = '无法读取或转换当前源文件。';
    element('preview-size').textContent = '';
    element('preview-note').textContent = '';
    showError(error);
  } finally {
    if (!disposed && current === generation) { loading = false; updateControls(); }
  }
}

for (const input of [allFields, pretty, fields]) input.addEventListener('change', updatePreview);
prepare.addEventListener('click', async () => {
  if (!source || prepare.disabled) return;
  const current = generation;
  preparing = true;
  updateControls();
  setStatus('正在请求准备另存…');
  try {
    await requestWorkspacePrepare(client, source, parameters());
    if (!disposed && active && current === generation) setStatus('准备请求已交给宿主，请核对并确认保存提案。');
  } catch (error) {
    if (!disposed && active && current === generation) showError(error);
  } finally {
    if (!disposed) { preparing = false; updateControls(); }
  }
});

const unsubscribe = client.subscribe(event => {
  if (disposed) return;
  if (event.type === 'theme') applyTheme(event.theme);
  if (event.type === 'activity') {
    active = event.active;
    if (active) void loadSource();
    else { loadController?.abort(); setStatus('工具页已暂停，返回后将重新检查资源。'); updateControls(); }
  }
});
window.addEventListener('pagehide', () => {
  disposed = true;
  loadController?.abort();
  unsubscribe();
  client.dispose();
}, { once: true });

try { await client.ready(); if (!disposed && active) await loadSource(); }
catch (error) { if (!disposed) { showError(error); updateControls(); } }
