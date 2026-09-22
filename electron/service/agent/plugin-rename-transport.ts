import { net } from 'electron';

export interface PluginRenameCredentials { token: string; username: string }
export interface ConditionalRenameState { name: string; ext: string; updatedAt: string }
export interface ConditionalRenameRequest {
  libraryId: number;
  operationId: string;
  items: Array<{ nodeId: number; name: string; expected: ConditionalRenameState & { parentId: number } }>;
}
export interface ConditionalRenameReceipt {
  operationId: string;
  libraryId: number;
  atomic: true;
  state: 'committed' | 'validated';
  replayed: boolean;
  items: Array<{ nodeId: number; parentId: number; previous: ConditionalRenameState;
    current: ConditionalRenameState; status: 'committed' | 'validated' }>;
  affectedParentIds: number[];
}
export type RenameCommitState = 'uncommitted' | 'commit_unknown';
export class RenameTransportError extends Error {
  readonly status?: number;
  readonly code: string;
  readonly commitState: RenameCommitState;
  constructor(code: string, commitState: RenameCommitState, status?: number) {
    super(`Plugin rename request failed (${code})`);
    this.name = 'RenameTransportError'; this.code = code; this.commitState = commitState; this.status = status;
  }
}

const MAX_BYTES = 256 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const positive = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
const hasOwn = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
function fail(code: string, state: RenameCommitState = 'uncommitted', status?: number): never {
  throw new RenameTransportError(code, state, status);
}

/** 只用整数秒处理时区，保留全部九位小数；Date.parse 会丢失 PostgreSQL 的微秒版本。 */
function timestamp(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 40) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|([+-])(\d{2}):(\d{2}))$/u.exec(value);
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  if (year < 1970 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return null;
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  const zoneHour = Number(match[10] ?? 0); const zoneMinute = Number(match[11] ?? 0);
  if (zoneHour > 23 || zoneMinute > 59) return null;
  const offset = (zoneHour * 60 + zoneMinute) * 60 * (match[9] === '-' ? -1 : 1);
  return `${date.getTime() / 1000 - offset}:${(match[7] ?? '').padEnd(9, '0')}`;
}

function snapshot(input: ConditionalRenameRequest): ConditionalRenameRequest {
  if (!object(input) || !positive(input.libraryId) || typeof input.operationId !== 'string' || !UUID.test(input.operationId)
    || input.operationId === '00000000-0000-0000-0000-000000000000' || !Array.isArray(input.items)
    || input.items.length < 1 || input.items.length > 50) fail('INVALID_REQUEST');
  const seen = new Set<number>();
  const items = input.items.map(item => {
    if (!object(item) || !positive(item.nodeId) || seen.has(item.nodeId) || !object(item.expected)
      || !positive(item.expected.parentId) || typeof item.expected.name !== 'string' || !item.expected.name
      || [...item.expected.name].length > 255 || typeof item.expected.ext !== 'string' || [...item.expected.ext].length > 32
      || !timestamp(item.expected.updatedAt) || typeof item.name !== 'string' || !item.name || item.name !== item.name.trim()
      || item.name === '.' || item.name === '..' || [...item.name].length > 255 || /[\p{Cc}/\\]/u.test(item.name)) fail('INVALID_REQUEST');
    seen.add(item.nodeId);
    return { nodeId: item.nodeId, name: item.name, expected: { name: item.expected.name, ext: item.expected.ext,
      parentId: item.expected.parentId, updatedAt: item.expected.updatedAt } };
  });
  return { libraryId: input.libraryId, operationId: input.operationId, items };
}

function validateReceipt(value: unknown, request: ConditionalRenameRequest, state: 'committed' | 'validated'): ConditionalRenameReceipt {
  if (!object(value) || value.operationId !== request.operationId || value.libraryId !== request.libraryId || value.atomic !== true
    || value.state !== state || typeof value.replayed !== 'boolean' || (state === 'validated' && value.replayed)
    || !Array.isArray(value.items) || value.items.length !== request.items.length || !Array.isArray(value.affectedParentIds)) {
    fail('INVALID_RECEIPT');
  }
  const expected = new Map(request.items.map(item => [item.nodeId, item]));
  const parents = new Set(request.items.map(item => item.expected.parentId));
  const items = value.items.map((item: unknown) => {
    if (!object(item) || !positive(item.nodeId)) fail('INVALID_RECEIPT');
    const source = expected.get(item.nodeId);
    if (!source || item.parentId !== source.expected.parentId || item.status !== state || !object(item.previous) || !object(item.current)
      || item.previous.name !== source.expected.name || item.previous.ext !== source.expected.ext
      || timestamp(item.previous.updatedAt) !== timestamp(source.expected.updatedAt)
      || item.current.name !== source.name || item.current.ext !== source.expected.ext || !timestamp(item.current.updatedAt)
      || (state === 'validated' && timestamp(item.current.updatedAt) !== timestamp(source.expected.updatedAt))) fail('INVALID_RECEIPT');
    expected.delete(item.nodeId);
    return { nodeId: item.nodeId, parentId: source.expected.parentId, status: state,
      previous: { name: source.expected.name, ext: source.expected.ext, updatedAt: item.previous.updatedAt as string },
      current: { name: source.name, ext: source.expected.ext, updatedAt: item.current.updatedAt as string } };
  });
  if (expected.size || value.affectedParentIds.length !== parents.size) fail('INVALID_RECEIPT');
  for (const id of value.affectedParentIds) {
    if (!positive(id) || !parents.delete(id)) fail('INVALID_RECEIPT');
  }
  return { operationId: request.operationId, libraryId: request.libraryId, atomic: true, state,
    replayed: value.replayed, items, affectedParentIds: [...value.affectedParentIds] as number[] };
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal, late?: (value: T) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const abort = () => { settled = true; signal.removeEventListener('abort', abort); reject(new Error('cancelled')); };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    promise.then(value => {
      signal.removeEventListener('abort', abort);
      if (settled) { late?.(value); return; }
      settled = true; resolve(value);
    }, () => {
      signal.removeEventListener('abort', abort);
      if (settled) return;
      settled = true; reject(new Error('unavailable'));
    });
  });
}

const cancelBody = (response: Response) => { void response.body?.cancel().catch(() => undefined); };
async function boundedBody(response: Response, signal: AbortSignal): Promise<unknown> {
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > MAX_BYTES)) {
    cancelBody(response); fail('RESPONSE_LIMIT');
  }
  if (!response.body) fail('INVALID_RESPONSE');
  const reader = response.body.getReader(); const bytes = new Uint8Array(MAX_BYTES); let size = 0;
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    for (;;) {
      signal.throwIfAborted();
      const chunk = await abortable(reader.read(), signal);
      signal.throwIfAborted();
      if (chunk.done) break;
      if (chunk.value.byteLength > MAX_BYTES - size) fail('RESPONSE_LIMIT');
      bytes.set(chunk.value, size); size += chunk.value.byteLength;
    }
    if (declared !== null && Number(declared) !== size) fail('INVALID_RESPONSE');
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, size))); }
    catch { fail('INVALID_RESPONSE'); }
  } finally {
    signal.removeEventListener('abort', cancel); cancel(); reader.releaseLock();
  }
}

/** main-only 固定 API 客户端；不持有批准状态、不重试，也不接受插件提供的地址。 */
export function createPluginRenameTransport(options: { apiBaseUrl: string; fetch?: typeof net.fetch }) {
  let base: URL;
  try { base = new URL(options.apiBaseUrl.replace(/\/+$/u, '') + '/'); } catch { fail('INVALID_API'); }
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) fail('INVALID_API');
  const fetchApi = options.fetch ?? net.fetch;

  async function invoke(route: string, credentials: PluginRenameCredentials, signal: AbortSignal,
    input?: ConditionalRenameRequest, commit = false): Promise<unknown> {
    if (signal.aborted) fail('CANCELLED');
    if (!object(credentials) || typeof credentials.token !== 'string' || !credentials.token || credentials.token.length > 32768
      || typeof credentials.username !== 'string' || credentials.username.length > 512 || /[\p{Cc}]/u.test(credentials.token + credentials.username)) fail('INVALID_CREDENTIALS');
    const url = new URL(route, base); const uncertain: RenameCommitState = commit ? 'commit_unknown' : 'uncommitted';
    let response: Response | undefined;
    try {
      response = await abortable(fetchApi(url.href, { method: input ? 'POST' : 'GET', signal, redirect: 'error',
        credentials: 'omit', cache: 'no-store', headers: { Authorization: `Bearer ${credentials.token}`, username: credentials.username,
          ...(input ? { 'Content-Type': 'application/json' } : {}) }, ...(input ? { body: JSON.stringify(input) } : {}) }), signal, cancelBody);
      if (response.redirected || (response.url && response.url !== url.href)) fail('UNEXPECTED_REDIRECT', uncertain);
      if (response.status !== 200) {
        const known = [400, 401, 403, 404, 409].includes(response.status);
        fail(`HTTP_${response.status}`, known ? 'uncommitted' : uncertain, response.status);
      }
      const envelope = await boundedBody(response, signal);
      if (!object(envelope) || envelope.code !== '0' || typeof envelope.message !== 'string'
        || typeof envelope.request_id !== 'string' || !hasOwn(envelope, 'data')) fail('INVALID_RESPONSE', uncertain);
      return envelope.data;
    } catch (error) {
      if (error instanceof RenameTransportError) {
        // 成功 HTTP 后的损坏/超限回执不能证明 COMMIT 没有发生。
        if (commit && ['INVALID_RESPONSE', 'RESPONSE_LIMIT'].includes(error.code)) fail(error.code, 'commit_unknown', error.status);
        throw error;
      }
      fail(signal.aborted ? 'CANCELLED' : 'NETWORK', uncertain);
    } finally { if (response) cancelBody(response); }
  }

  async function mutation(input: ConditionalRenameRequest, credentials: PluginRenameCredentials, signal: AbortSignal, dryRun: boolean) {
    const request = snapshot(input);
    const data = await invoke(`v1/nodes/rename/batch/conditional${dryRun ? '?dryRun=true' : ''}`, credentials, signal, request, !dryRun);
    try {
      if (dryRun) {
        if (!object(data) || data.dryRun !== true || !hasOwn(data, 'result')) fail('INVALID_RECEIPT');
        return validateReceipt(data.result, request, 'validated');
      }
      return validateReceipt(data, request, 'committed');
    } catch { fail('INVALID_RECEIPT', dryRun ? 'uncommitted' : 'commit_unknown'); }
  }

  return {
    async verifyActor(credentials: PluginRenameCredentials, owner: { accountScope: string }, signal: AbortSignal): Promise<void> {
      const accountScope = owner.accountScope;
      if (!/^user:[1-9]\d*$/u.test(accountScope)) fail('ACTOR_MISMATCH');
      const user = await invoke('v1/user/me', credentials, signal);
      if (!object(user) || !positive(user.id) || accountScope !== `user:${user.id}`) fail('ACTOR_MISMATCH');
    },
    dryRun: (request: ConditionalRenameRequest, credentials: PluginRenameCredentials, signal: AbortSignal) => mutation(request, credentials, signal, true),
    commit: (request: ConditionalRenameRequest, credentials: PluginRenameCredentials, signal: AbortSignal) => mutation(request, credentials, signal, false),
    async status(input: ConditionalRenameRequest, credentials: PluginRenameCredentials, signal: AbortSignal): Promise<ConditionalRenameReceipt | null> {
      const request = snapshot(input);
      const query = new URLSearchParams({ libraryId: String(request.libraryId), operationId: request.operationId });
      let data: unknown;
      try { data = await invoke(`v1/nodes/rename/batch/status?${query}`, credentials, signal); }
      catch (error) {
        if (error instanceof RenameTransportError) fail(error.code, 'commit_unknown', error.status);
        fail('NETWORK', 'commit_unknown');
      }
      if (!object(data) || data.operationId !== request.operationId || data.libraryId !== request.libraryId) fail('INVALID_RECEIPT', 'commit_unknown');
      if (data.state === 'not_found' && !hasOwn(data, 'result')) return null;
      if (data.state !== 'committed') fail('INVALID_RECEIPT', 'commit_unknown');
      try { return validateReceipt(data.result, request, 'committed'); }
      catch { fail('INVALID_RECEIPT', 'commit_unknown'); }
    },
  };
}
