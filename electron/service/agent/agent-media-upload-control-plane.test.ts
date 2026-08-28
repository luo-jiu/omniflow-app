import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import {
  AgentMediaUploadControlPlaneError,
  createAgentMediaUploadControlPlane,
} from './agent-media-upload-control-plane';

interface RecordedRequest {
  body: unknown;
  headers: http.IncomingHttpHeaders;
  method: string;
  url: string;
}

const CREDENTIALS = {
  token: 'control-plane-token',
  username: 'loyce',
};

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  if (chunks.length === 0) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function sendJson(response: ServerResponse, body: unknown, status = 200): void {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}

describe('Agent media upload control plane', () => {
  const servers: http.Server[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => {
      server.close(error => (error ? reject(error) : resolve()));
    })));
  });

  async function startServer(
    handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>,
  ): Promise<string> {
    const server = http.createServer((request, response) => {
      Promise.resolve(handler(request, response)).catch(() => {
        if (!response.headersSent) response.writeHead(500);
        response.end();
      });
    });
    servers.push(server);
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address() as AddressInfo;
    return `http://127.0.0.1:${address.port}/api/`;
  }

  it('uses fixed API paths, credentials, request bodies, and normalized responses', async () => {
    const requests: RecordedRequest[] = [];
    const apiBaseUrl = await startServer(async (request, response) => {
      const recorded = {
        body: await readJson(request),
        headers: request.headers,
        method: request.method || '',
        url: request.url || '',
      };
      requests.push(recorded);
      const path = new URL(recorded.url, 'http://localhost').pathname;
      if (path === '/api/v1/user/me') {
        sendJson(response, { code: '0', data: { id: 7 } });
      } else if (path === '/api/v1/upload/init') {
        sendJson(response, {
          code: 0,
          data: { mode: 'multipart', partSize: 5, totalParts: 2, uploadId: 'upload/one' },
        });
      } else if (path === '/api/v1/upload/parts/sign') {
        sendJson(response, {
          data: {
            parts: [
              { partNumber: 1, url: 'http://storage.test/part-1' },
              { partNumber: 2, url: 'http://storage.test/part-2' },
            ],
          },
        });
      } else if (path === '/api/v1/upload/complete') {
        sendJson(response, { code: '0', data: { id: 19, name: 'audio.m4a' } });
      } else if (path === '/api/v1/upload/complete/status') {
        sendJson(response, {
          code: '0',
          data: { node: { id: 19 }, state: 'committed' },
        });
      } else if (path === '/api/v1/upload/upload%2Fone') {
        response.writeHead(204);
        response.end();
      } else {
        sendJson(response, { code: 'unexpected' }, 404);
      }
    });
    const controlPlane = createAgentMediaUploadControlPlane({ apiBaseUrl });
    const signal = new AbortController().signal;
    const initInput = {
      contentType: 'audio/mp4',
      fileName: 'audio.m4a',
      fileSize: 9,
      libraryId: 3,
      parentId: 10,
      storageProvider: 'local-minio',
    };

    expect(controlPlane.apiBaseUrl).toMatch(/\/api$/u);
    await expect(controlPlane.verifyAccount(CREDENTIALS, 7, signal)).resolves.toBeUndefined();
    await expect(controlPlane.init(CREDENTIALS, initInput, signal)).resolves.toEqual({
      mode: 'multipart',
      partSize: 5,
      totalParts: 2,
      uploadId: 'upload/one',
    });
    await expect(controlPlane.sign(CREDENTIALS, 'upload/one', [1, 2], signal)).resolves.toEqual([
      { partNumber: 1, url: 'http://storage.test/part-1' },
      { partNumber: 2, url: 'http://storage.test/part-2' },
    ]);
    await expect(controlPlane.complete(CREDENTIALS, {
      clientOperationId: 'operation / one',
      conflictPolicy: 'auto_rename',
      parts: [
        { etag: 'etag-1', partNumber: 1 },
        { etag: 'etag-2', partNumber: 2 },
      ],
      uploadId: 'upload/one',
    }, signal)).resolves.toEqual({ id: 19, name: 'audio.m4a' });
    await expect(controlPlane.reconcile(CREDENTIALS, 'operation / one', signal)).resolves.toEqual({
      node: { id: 19 },
      state: 'committed',
    });
    await expect(controlPlane.abort(CREDENTIALS, 'upload/one', signal)).resolves.toBeUndefined();

    expect(requests.map(request => `${request.method} ${request.url}`)).toEqual([
      'GET /api/v1/user/me',
      'POST /api/v1/upload/init',
      'POST /api/v1/upload/parts/sign',
      'POST /api/v1/upload/complete',
      'GET /api/v1/upload/complete/status?clientOperationId=operation+%2F+one',
      'DELETE /api/v1/upload/upload%2Fone',
    ]);
    for (const request of requests) {
      expect(request.headers.authorization).toBe('Bearer control-plane-token');
      expect(request.headers.username).toBe('loyce');
      expect(request.headers.accept).toBe('application/json');
    }
    expect(requests[0]?.body).toBeUndefined();
    expect(requests[1]?.body).toEqual(initInput);
    expect(requests[2]?.body).toEqual({ partNumbers: [1, 2], uploadId: 'upload/one' });
    expect(requests[3]?.body).toEqual({
      clientOperationId: 'operation / one',
      conflictPolicy: 'auto_rename',
      parts: [
        { etag: 'etag-1', partNumber: 1 },
        { etag: 'etag-2', partNumber: 2 },
      ],
      uploadId: 'upload/one',
    });
  });

  it.each([
    [401, 'auth_expired'],
    [403, 'forbidden'],
    [408, 'request_timeout'],
    [410, 'session_expired'],
    [429, 'rate_limited'],
    [422, 'invalid_request'],
    [503, 'server_error'],
  ] as const)('maps HTTP %i to %s without exposing the response body', async (status, reason) => {
    const apiBaseUrl = await startServer((_request, response) => {
      sendJson(response, { message: 'sensitive upstream detail' }, status);
    });
    const controlPlane = createAgentMediaUploadControlPlane({ apiBaseUrl });

    const promise = controlPlane.complete(CREDENTIALS, {
      clientOperationId: 'operation-1',
      conflictPolicy: 'error',
      parts: [],
      uploadId: 'upload-1',
    }, new AbortController().signal);
    await expect(promise).rejects.toMatchObject({
      message: `Agent 上传控制面请求失败：${reason}`,
      reason,
      status,
    });
  });

  it('maps envelope errors and malformed JSON to stable reasons', async () => {
    let requestCount = 0;
    const apiBaseUrl = await startServer((_request, response) => {
      requestCount += 1;
      if (requestCount === 1) {
        sendJson(response, { code: 'A00200', message: 'expired detail' });
      } else if (requestCount === 2) {
        sendJson(response, { code: 'BUSINESS_ERROR', message: 'private detail' });
      } else {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end('{not-json');
      }
    });
    const controlPlane = createAgentMediaUploadControlPlane({ apiBaseUrl });
    const complete = () => controlPlane.complete(CREDENTIALS, {
      clientOperationId: 'operation-1',
      conflictPolicy: 'error',
      parts: [],
      uploadId: 'upload-1',
    }, new AbortController().signal);

    await expect(complete()).rejects.toMatchObject({ reason: 'auth_expired' });
    await expect(complete()).rejects.toMatchObject({ reason: 'invalid_request' });
    await expect(complete()).rejects.toMatchObject({ reason: 'invalid_response' });
  });

  it('treats abort not-found as success but preserves other abort errors', async () => {
    let requestCount = 0;
    const apiBaseUrl = await startServer((_request, response) => {
      requestCount += 1;
      sendJson(response, {}, requestCount === 1 ? 404 : 403);
    });
    const controlPlane = createAgentMediaUploadControlPlane({ apiBaseUrl });

    await expect(controlPlane.abort(CREDENTIALS, 'missing-upload')).resolves.toBeUndefined();
    await expect(controlPlane.abort(CREDENTIALS, 'forbidden-upload')).rejects.toMatchObject({
      reason: 'forbidden',
      status: 403,
    });
  });

  it('rejects invalid init, sign, reconcile, and account responses', async () => {
    let requestCount = 0;
    const apiBaseUrl = await startServer((_request, response) => {
      requestCount += 1;
      const responses = [
        { data: { mode: 'multipart', partSize: 5, totalParts: 1, uploadId: 'upload-1' } },
        { data: { parts: [{ partNumber: 3, url: 'http://storage.test/part-3' }] } },
        { data: { state: 'pending' } },
        { data: { id: 8 } },
      ];
      sendJson(response, responses[requestCount - 1]);
    });
    const controlPlane = createAgentMediaUploadControlPlane({ apiBaseUrl });
    const signal = new AbortController().signal;

    await expect(controlPlane.init(CREDENTIALS, {
      fileName: 'audio.m4a',
      fileSize: 9,
      libraryId: 3,
      parentId: 10,
      storageProvider: 'local-minio',
    }, signal)).rejects.toMatchObject({ reason: 'invalid_response' });
    await expect(controlPlane.sign(CREDENTIALS, 'upload-1', [1, 2], signal))
      .rejects.toMatchObject({ reason: 'invalid_response' });
    await expect(controlPlane.reconcile(CREDENTIALS, 'operation-1', signal))
      .rejects.toMatchObject({ reason: 'invalid_response' });
    await expect(controlPlane.verifyAccount(CREDENTIALS, 7, signal)).rejects.toMatchObject({
      reason: 'forbidden',
      status: 403,
    });
  });

  it('rejects invalid credentials before issuing a request', async () => {
    let requestCount = 0;
    const apiBaseUrl = await startServer((_request, response) => {
      requestCount += 1;
      sendJson(response, { data: { id: 7 } });
    });
    const controlPlane = createAgentMediaUploadControlPlane({ apiBaseUrl });

    const promise = controlPlane.verifyAccount(
      { token: 'token\nheader-injection', username: 'loyce' },
      7,
      new AbortController().signal,
    );
    await expect(promise).rejects.toBeInstanceOf(AgentMediaUploadControlPlaneError);
    await expect(promise).rejects.toMatchObject({ reason: 'auth_expired' });
    expect(requestCount).toBe(0);
  });

  it('observes cancellation that races with control request listener registration', async () => {
    let abortedReads = 0;
    const signal = {
      get aborted() {
        abortedReads += 1;
        return abortedReads >= 2;
      },
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    } as unknown as AbortSignal;
    const controlPlane = createAgentMediaUploadControlPlane({
      apiBaseUrl: 'http://127.0.0.1:1/api',
    });

    await expect(controlPlane.verifyAccount(CREDENTIALS, 7, signal))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(abortedReads).toBeGreaterThanOrEqual(2);
  });
});
