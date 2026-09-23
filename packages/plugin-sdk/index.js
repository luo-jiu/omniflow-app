export const PROTOCOL_VERSION = 1;
export const LIMITS = Object.freeze({
  requestBytes: 16384, responseBytes: 131072, concurrentRequests: 8,
  requestsPerSecond: 64, requestsPerInstance: 4096, readChunkBytes: 65536,
  directoryEntries: 512, directoryPageSize: 64, directoryHandles: 4, directoryReadTotalBytes: 536870912, directoryRequests: 16384,
  readTotalBytes: 33554432, requestTimeoutMs: 4000, clientTimeoutMs: 5000,
  settingBytes: 65536, settingsTotalBytes: 262144, settingsKeys: 32,
  packageBytes: 4194304, packageFiles: 64, packageFileBytes: 1048576,
  snapshotBytes: 32768, snapshotsTotalBytes: 262144, snapshots: 64,
  instances: 4, startupTimeoutMs: 5000, heartbeatMs: 1000, heartbeatTimeoutMs: 4000,
  toolResultBytes: 32768, toolRequestBytes: 34816, toolTimeoutMs: 30000,
  fileOutputBytes: 1048576, fileOutputRequestBytes: 1400152,
});
export class PluginError extends Error {
  constructor(code, message) { super(message); this.name = 'PluginError'; this.code = code; }
}
export function createPluginClient(transport = globalThis.omniflowTransport) {
  if (!transport) throw new PluginError('UNAVAILABLE', 'Host transport unavailable');
  let disposed = false;
  let active = 0;
  const events = new Set();
  const pending = new Map();
  async function request(method, params = {}, options = {}) {
    if (disposed) throw new PluginError('UNAVAILABLE', 'Client disposed');
    if (options.signal?.aborted) throw new PluginError('CANCELLED', 'Request cancelled');
    if (active >= LIMITS.concurrentRequests) throw new PluginError('LIMIT', 'Too many requests');
    const id = crypto.randomUUID();
    const wire = JSON.stringify({ version: PROTOCOL_VERSION, id, method, params });
    if (new TextEncoder().encode(wire).length > (method === 'tool.output.complete' ? LIMITS.fileOutputRequestBytes : method === 'tool.complete' ? LIMITS.toolRequestBytes : LIMITS.requestBytes)) throw new PluginError('LIMIT', 'Request too large');
    active += 1;
    let timer;
    let abort;
    try {
      const interrupted = new Promise((_, reject) => {
        const interrupt = (code, message) => {
          void transport.exchange(JSON.stringify({ version: 1, id: crypto.randomUUID(), method: 'request.cancel', params: { requestId: id } })).catch(() => undefined);
          reject(new PluginError(code, message));
        };
        abort = () => interrupt('CANCELLED', 'Request cancelled');
        pending.set(id, abort);
        options.signal?.addEventListener('abort', abort, { once: true });
        timer = setTimeout(() => interrupt('TIMEOUT', 'Host did not respond'), LIMITS.clientTimeoutMs);
      });
      const raw = await Promise.race([transport.exchange(wire), interrupted]);
      if (typeof raw !== 'string' || new TextEncoder().encode(raw).length > LIMITS.responseBytes) throw new PluginError('BAD_RESPONSE', 'Invalid response');
      let response;
      try { response = JSON.parse(raw); } catch { throw new PluginError('BAD_RESPONSE', 'Invalid response'); }
      if (!response || response.version !== 1 || response.id !== id || typeof response.ok !== 'boolean') throw new PluginError('BAD_RESPONSE', 'Invalid response identity');
      if (!response.ok) throw new PluginError(response.error?.code ?? 'INTERNAL', response.error?.message ?? 'Host request failed');
      return response.value;
    } finally {
      active -= 1; pending.delete(id); clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
    }
  }
  const unsubscribe = transport.subscribe(raw => {
    if (disposed || typeof raw !== 'string' || raw.length > LIMITS.responseBytes) return;
    let event;
    try { event = JSON.parse(raw); } catch { return; }
    if (!event || event.version !== 1 || typeof event.type !== 'string') return;
    if (event.type === 'heartbeat') { void transport.exchange(JSON.stringify({ version: 1, id: crypto.randomUUID(), method: 'lifecycle.pong', params: { nonce: event.nonce } })).catch(() => undefined); return; }
    for (const listener of events) { try { listener(event); } catch { /* A subscriber cannot break SDK delivery. */ } }
  });
  return Object.freeze({
    context: () => request('context.get'),
    ready: () => request('lifecycle.ready'),
    prepareWorkspaceCommand: async parameters => {
      const result = await request('workspace.prepare', { parameters });
      if (!result || typeof result !== 'object' || Array.isArray(result) || Object.keys(result).length !== 1
        || typeof result.requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(result.requestId)) throw new PluginError('BAD_RESPONSE', 'Invalid workspace preparation response');
      return { requestId: result.requestId };
    },
    toolInvocation: () => request('tool.invocation'),
    completeTool: (invocationId, output) => request('tool.complete', { invocationId, output }),
    completeFileOutput: async (invocationId, output) => {
      if (!output || typeof output !== 'object' || Array.isArray(output) || Object.keys(output).length !== 2
        || !['text/csv', 'application/json'].includes(output.mediaType) || typeof output.text !== 'string'
        || !output.text.length || output.text.length > LIMITS.fileOutputBytes || /[\uD800-\uDFFF]/u.test(output.text)) throw new PluginError('BAD_REQUEST', 'Invalid file output');
      const bytes = new TextEncoder().encode(output.text);
      if (bytes.byteLength > LIMITS.fileOutputBytes) throw new PluginError('LIMIT', 'File output is too large');
      const context = await request('context.get');
      if (context?.kind !== 'tool' || !context.capabilities?.includes('resource.output.propose') || !context.output?.mediaTypes?.includes(output.mediaType)) throw new PluginError('FORBIDDEN', 'File output is unavailable');
      if (!Number.isSafeInteger(context.output.maxBytes) || context.output.maxBytes < 1 || context.output.maxBytes > LIMITS.fileOutputBytes
        || bytes.byteLength > context.output.maxBytes) throw new PluginError('LIMIT', 'File output is too large');
      let binary = '';
      for (let index = 0; index < bytes.length; index += 8192) binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
      return request('tool.output.complete', { invocationId, mediaType: output.mediaType, base64: btoa(binary) });
    },
    failTool: (invocationId, code) => request('tool.fail', { invocationId, code }),
    read: async (handle, offset, length, options) => {
      const result = await request('resource.read', { handle, offset, length }, options);
      if (!result || typeof result.base64 !== 'string' || !Number.isSafeInteger(result.nextOffset) || result.nextOffset < offset || typeof result.eof !== 'boolean' || typeof result.revision !== 'string') throw new PluginError('BAD_RESPONSE', 'Invalid read response');
      let bytes;
      try { bytes = Uint8Array.from(atob(result.base64), char => char.charCodeAt(0)); } catch { throw new PluginError('BAD_RESPONSE', 'Invalid read encoding'); }
      if (bytes.length !== result.nextOffset - offset || bytes.length > length) throw new PluginError('BAD_RESPONSE', 'Invalid read range');
      if (bytes.length > LIMITS.readChunkBytes) throw new PluginError('BAD_RESPONSE', 'Oversized read');
      return { bytes, nextOffset: result.nextOffset, eof: result.eof, revision: result.revision };
    },
    listDirectory: (handle, offset = 0, options) => request('directory.list', { handle, offset }, options),
    openDirectoryEntry: (handle, entryId, options) => request('directory.open', { handle, entryId }, options),
    releaseResource: handle => request('resource.release', { handle }),
    getState: () => request('state.get'),
    setState: (value, expectedRevision, schemaVersion = 1) => request('state.set', { value, expectedRevision, schemaVersion }),
    getSetting: key => request('settings.get', { key }),
    setSetting: (key, value, expectedRevision, schemaVersion = 1) => request('settings.set', { key, value, expectedRevision, schemaVersion }),
    subscribe: listener => { events.add(listener); return () => events.delete(listener); },
    dispose: () => { if (disposed) return; disposed = true; for (const abort of pending.values()) abort(); events.clear(); unsubscribe(); },
  });
}
