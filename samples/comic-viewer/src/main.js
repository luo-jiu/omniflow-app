import { createPluginClient, LIMITS } from '@omniflow/plugin-sdk';
const client = createPluginClient();
const element = id => document.getElementById(id);
const picture = element('page'), status = element('status'), position = element('position');
let context, entries = [], index = 0, stateRevision = 0, busy = false, stopped = false;
const controller = new AbortController();
let retryIndex = 0;
function theme(value) {
  document.documentElement.style.setProperty('--surface', value.colors['surface.app']);
  document.documentElement.style.setProperty('--text', value.colors['text.primary']);
  document.documentElement.style.colorScheme = value.mode;
}
function buttons() {
  element('previous').disabled = busy || index <= 0;
  element('next').disabled = busy || index >= entries.length - 1;
}
const errors = { LIMIT: '已达到读取或图片大小上限，可在宿主重新加载，或切回内置查看器。', FORBIDDEN: '图片权限已撤销或图片已移出此目录。', CONTENT_CHANGED: '图片或目录已变化，请在宿主重新加载。', TIMEOUT: '读取超时，请重试。' };
async function showPage(target) {
  if (busy || stopped || !entries[target]) return;
  retryIndex = target; busy = true; buttons(); element('retry').hidden = true;
  picture.hidden = true; picture.removeAttribute('src');
  const entry = entries[target]; let resource;
  try {
    status.textContent = `正在读取 ${entry.name}…`;
    resource = await client.openDirectoryEntry(context.resource.handle, entry.id, { signal: controller.signal });
    // 单张显示，不累计整本漫画的 base64 或解码对象。
    if (resource.size > 10 * 1024 * 1024) throw { code: 'LIMIT' };
    const chunks = []; let offset = 0;
    while (offset < resource.size) {
      const result = await client.read(resource.handle, offset, LIMITS.readChunkBytes, { signal: controller.signal });
      if (result.revision !== resource.revision || result.nextOffset <= offset) throw { code: 'CONTENT_CHANGED' };
      chunks.push(result.bytes); offset = result.nextOffset;
      // 快速本地存储也不突破宿主每秒请求预算。
      await new Promise(resolve => setTimeout(resolve, 25));
      controller.signal.throwIfAborted();
    }
    let binary = '';
    for (const chunk of chunks) binary += String.fromCharCode(...chunk);
    picture.src = `data:${entry.mimeType};base64,${btoa(binary)}`;
    status.textContent = `正在显示 ${entry.name}…`;
    let decodeTimer;
    try { await Promise.race([picture.decode(), new Promise((_, reject) => { decodeTimer = setTimeout(() => reject({ code: 'TIMEOUT' }), 8000); })]); }
    finally { clearTimeout(decodeTimer); }
    if (picture.naturalWidth * picture.naturalHeight > 24_000_000) throw { code: 'LIMIT' };
    controller.signal.throwIfAborted();
    index = target; picture.alt = entry.name; picture.hidden = false;
    position.textContent = `${index + 1} / ${entries.length} · ${entry.name}`;
    status.textContent = '';
    try { const state = await client.setState({ entryId: entry.id, index }, stateRevision); stateRevision = state.revision; }
    catch { status.textContent = '页面已显示，但阅读位置未能保存。'; }
  } catch (error) {
    picture.removeAttribute('src'); picture.hidden = true;
    if (!stopped) { status.textContent = errors[error.code] ?? '图片读取或解码失败，可重试或切回内置查看器。'; element('retry').hidden = false; }
  } finally {
    if (resource) await client.releaseResource(resource.handle).catch(() => undefined);
    busy = false; buttons();
  }
}
element('previous').onclick = () => void showPage(index - 1);
element('next').onclick = () => void showPage(index + 1);
element('retry').onclick = () => void showPage(retryIndex);
document.addEventListener('keydown', event => {
  if (event.target instanceof HTMLButtonElement) return;
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); void showPage(index + (event.key === 'ArrowLeft' ? -1 : 1)); }
});
client.subscribe(event => { if (event.type === 'theme') theme(event.theme); });
window.addEventListener('pagehide', () => { stopped = true; controller.abort(); picture.removeAttribute('src'); client.dispose(); });
try {
  context = await client.context(); theme(context.theme); await client.ready();
  if (!context.capabilities.includes('directory.read') || context.resource?.kind !== 'directory') throw { code: 'FORBIDDEN' };
  let offset = 0;
  do {
    const page = await client.listDirectory(context.resource.handle, offset, { signal: controller.signal });
    if (page.revision !== context.resource.revision || entries.length + page.entries.length > LIMITS.directoryEntries) throw { code: 'LIMIT' };
    entries.push(...page.entries); offset = page.nextOffset;
    if (page.eof) break;
  } while (true);
  const state = await client.getState(); stateRevision = state?.revision ?? 0;
  const saved = entries.findIndex(entry => entry.id === state?.value?.entryId);
  index = saved < 0 ? 0 : saved;
  if (!entries.length) status.textContent = '此目录没有支持的直属图片。';
  else await showPage(index);
} catch (error) { status.textContent = errors[error.code] ?? '无法打开漫画目录，请在宿主重新加载。'; }
