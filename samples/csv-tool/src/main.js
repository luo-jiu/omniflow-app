import { createPluginClient, LIMITS } from '@omniflow/plugin-sdk';
import { readCsvResource } from './csv-resource.js';
const client = createPluginClient();
const status = document.getElementById('status');
const table = document.getElementById('table');
const compact = document.getElementById('compact');
let settingRevision = 0;
let controller;
let themeRevision = -1;
let restoring = false;
let rows = []; let page = 0; let stateRevision = 0; let saving = false; let dirty = false; let active = true;
const scroller = document.querySelector('main');
const pageLabel = document.getElementById('page');
function render() {
  table.replaceChildren();
  for (const row of rows.slice(page * 100, (page + 1) * 100)) {
    const tr = document.createElement('tr');
    for (const cell of row) { const td = document.createElement('td'); td.textContent = cell; tr.append(td); }
    table.append(tr);
  }
  pageLabel.textContent = `${rows.length ? page + 1 : 0} / ${Math.ceil(rows.length / 100)} 页`;
  document.getElementById('previous').disabled = page === 0;
  document.getElementById('next').disabled = (page + 1) * 100 >= rows.length;
}
async function saveState() {
  if (restoring) return;
  dirty = true; if (saving) return; saving = true;
  try { while (dirty) { dirty = false; const next = await client.setState({ page, scrollTop: scroller.scrollTop }, stateRevision); stateRevision = next.revision; } }
  catch { const current = await client.getState().catch(() => null); stateRevision = current?.revision ?? 0; }
  finally { saving = false; }
}
let scrollTimer;
scroller.addEventListener('scroll', () => { clearTimeout(scrollTimer); if (!restoring) scrollTimer = setTimeout(() => void saveState(), 200); });
for (const [id, delta] of [['previous', -1], ['next', 1]]) document.getElementById(id).addEventListener('click', () => { restoring = false; page += delta; scroller.scrollTop = 0; render(); void saveState(); });
const themeDefaults = new WeakMap();
const themeProperties = [
  ['--background', 'surface.app'], ['--surface', 'surface.panel'],
  ['--foreground', 'text.primary'], ['--secondary', 'text.secondary'],
  ['--disabled', 'text.disabled'], ['--border', 'border.default'],
  ['--accent', 'accent.default'], ['--focus', 'focus.border'],
  ['--error', 'status.danger.text'], ['--button-background', 'fill.default'],
  ['--button-hover', 'fill.strong'], ['--button-active', 'fill.pressed'],
  ['--button-disabled', 'fill.subtle'], ['--hover', 'interaction.hover'],
  ['--active', 'interaction.active'], ['--selection', 'selection.background'],
  ['--selection-text', 'selection.text'], ['--scrollbar-thumb', 'scrollbar.thumb'],
  ['--scrollbar-track', 'scrollbar.track'],
];
function theme(snapshot) {
  if (snapshot.revision <= themeRevision) return;
  document.documentElement.dataset.theme = snapshot.mode;
  // Only mutate this package's external stylesheet; no host styles or inline CSS.
  const sheet = [...document.styleSheets].find(item => item.href?.endsWith('/style.css'));
  const rules = sheet && [...sheet.cssRules].filter(item => [':root', ':root[data-theme="dark"]'].includes(item.selectorText));
  const rule = rules?.find(item => item.selectorText === (snapshot.mode === 'dark' ? ':root[data-theme="dark"]' : ':root'));
  if (!rule) return;
  // Reset both variants so partial snapshots never retain a previous host color.
  for (const themeRule of rules) {
    if (!themeDefaults.has(themeRule)) themeDefaults.set(themeRule, new Map(themeProperties.map(([property]) => [property, themeRule.style.getPropertyValue(property)])));
    for (const [property, fallback] of themeDefaults.get(themeRule)) {
      if (fallback) themeRule.style.setProperty(property, fallback);
      else themeRule.style.removeProperty(property);
    }
  }
  for (const [property, key] of themeProperties) {
    if (snapshot.colors[key]) rule.style.setProperty(property, snapshot.colors[key]);
  }
  themeRevision = snapshot.revision;
}
async function refresh() {
  restoring = true; clearTimeout(scrollTimer);
  controller?.abort();
  const current = new AbortController(); controller = current;
  rows = []; page = 0; render(); status.dataset.error = 'false'; status.textContent = '正在读取';
  try {
    const context = await client.context();
    if (current.signal.aborted) return;
    theme(context.theme);
    if (!context.resource || !context.readGranted) { status.textContent = '等待宿主授权当前资源'; return; }
    const nextRows = await readCsvResource(client, context.resource, LIMITS.readChunkBytes, { signal: current.signal });
    if (current.signal.aborted) return;
    rows = nextRows;
    const saved = await client.getState();
    if (current.signal.aborted) return;
    stateRevision = saved?.revision ?? 0;
    page = Number.isSafeInteger(saved?.value?.page) ? Math.max(0, Math.min(saved.value.page, Math.ceil(rows.length / 100) - 1)) : 0;
    render(); scroller.scrollTop = Number.isFinite(saved?.value?.scrollTop) ? Math.max(0, saved.value.scrollTop) : 0;
    document.getElementById('name').textContent = context.resource.name;
    status.textContent = `只读预览：${rows.length} 行`;
    setTimeout(() => { if (!current.signal.aborted) restoring = false; }, 0);
  } catch (error) {
    if (current.signal.aborted) return;
    status.dataset.error = 'true'; status.textContent = ({ FORBIDDEN: '当前文件读取授权已失效。', CONTENT_CHANGED: '文件内容已变化，请重新打开。', TIMEOUT: '读取超时，请重试。', UNAVAILABLE: '资源或查看器不可用，请重新打开。', LIMIT: '读取超过限制。' })[error.code] ?? error.message;
  }
}
client.subscribe(event => {
  if (event.type === 'theme') theme(event.theme);
  if (event.type === 'activity') { active = event.active; if (active) void refresh(); else { controller?.abort(); void saveState(); status.textContent = '已暂停'; } }
});
document.getElementById('reload').addEventListener('click', () => { if (active) void refresh(); });
compact.addEventListener('change', async () => {
  try {
    const next = await client.setSetting('display', { compact: compact.checked }, settingRevision);
    settingRevision = next.revision; document.body.dataset.compact = String(compact.checked);
  } catch (error) { status.textContent = error.message; }
});
await client.ready();
const display = await client.getSetting('display');
if (display) { settingRevision = display.revision; compact.checked = display.value.compact === true; document.body.dataset.compact = String(compact.checked); }
await refresh();
