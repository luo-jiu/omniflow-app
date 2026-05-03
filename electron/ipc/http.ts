import { net } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { runtimeLogger } from '../runtimeLogger';
import { MAX_SINGLE_UPLOAD_BYTES, MAX_SINGLE_UPLOAD_ERROR_MESSAGE } from '../../src/shared/upload-limits';

function escapeMultipartDispositionValue(value: string): string {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '')
    .replace(/\n/g, '');
}

function encodeRFC5987Value(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function buildFileContentDisposition(fileName: string): string {
  const escaped = escapeMultipartDispositionValue(fileName);
  const encoded = encodeRFC5987Value(fileName);
  return `Content-Disposition: form-data; name="file"; filename="${escaped}"; filename*=UTF-8''${encoded}\r\n`;
}

export function registerHttpIpc(ipcMain: Electron.IpcMain) {
  type UploadRuntime = {
    uploadId: string;
    request: ClientRequest;
    fileStream: fs.ReadStream;
    sender: Electron.WebContents;
    totalBytes: number;
    uploadedBytes: number;
    startedAt: number;
    lastProgressAt: number;
    aborted: boolean;
  };

  const activeUploads = new Map<string, UploadRuntime>();

  const sendUploadProgress = (runtime: UploadRuntime, force = false) => {
    const now = Date.now();
    if (!force && now - runtime.lastProgressAt < 80) return;
    runtime.lastProgressAt = now;

    const elapsedMs = Math.max(now - runtime.startedAt, 1);
    const speedBps = Math.floor((runtime.uploadedBytes * 1000) / elapsedMs);
    const percentage = runtime.totalBytes > 0
      ? Math.min((runtime.uploadedBytes / runtime.totalBytes) * 100, 100)
      : 0;

    runtime.sender.send('http:upload:progress', {
      uploadId: runtime.uploadId,
      uploadedBytes: runtime.uploadedBytes,
      totalBytes: runtime.totalBytes,
      percentage,
      speedBps,
    });
  };

  ipcMain.handle("http:fetch", async (_event, url: string, options: any = {}) => {
    runtimeLogger.debug("http:fetch start");
    runtimeLogger.debug("http:fetch URL:", url);
    runtimeLogger.debug("http:fetch options:", options);
    return new Promise((resolve, reject) => {
      const request = net.request({ url, method: options.method || "GET" });

      if (options.headers) {
        Object.entries(options.headers).forEach(([key, value]) => {
          runtimeLogger.debug(`http:fetch set header ${key}: ${String(value)}`);
          request.setHeader(key, value as string);
        });
      }
      let body = "";
      request.on("response", (response) => {
        runtimeLogger.debug("http:fetch response");
        runtimeLogger.debug("http:fetch status:", response.statusCode);
        runtimeLogger.debug("http:fetch headers:", response.headers);

        response.on("data", (chunk) => {
          runtimeLogger.debug(`http:fetch chunk length: ${chunk.length}`);
          body += chunk;
        });
        response.on("end", () => {
          runtimeLogger.debug("http:fetch body preview:", body.slice(0, 500)); // 只打印前 500 字符
          let parsedBody: any;
          try {
            parsedBody = JSON.parse(body);
          } catch {
            parsedBody = body;
          }
          resolve({
            status: response.statusCode,
            headers: response.headers,
            body: parsedBody,
          });
        });
      });
      request.on("error", (err) => {
        runtimeLogger.error("http:fetch error:", err);
        reject(err);
      });
      if (options.body) {
        request.write(options.body);
      }
      request.end();
    });
  });

  ipcMain.handle("http:fetch-binary", async (_event, url: string, options: any = {}) => {
    runtimeLogger.debug("http:fetch-binary start");
    runtimeLogger.debug("http:fetch-binary URL:", url);
    return new Promise((resolve, reject) => {
      const request = net.request({ url, method: options.method || "GET" });
      const maxBytes = Math.max(0, Number(options.maxBytes || 0));
      const chunks: Buffer[] = [];
      let receivedBytes = 0;
      let settled = false;

      const safeResolve = (payload: unknown) => {
        if (settled) return;
        settled = true;
        resolve(payload);
      };
      const safeReject = (error: unknown) => {
        if (settled) return;
        settled = true;
        reject(error);
      };

      if (options.headers) {
        Object.entries(options.headers).forEach(([key, value]) => {
          request.setHeader(key, value as string);
        });
      }
      request.on("response", (response) => {
        response.on("data", (chunk: Buffer) => {
          if (settled) {
            return;
          }
          let nextChunk = chunk;
          let truncated = false;
          if (maxBytes > 0 && receivedBytes + chunk.length > maxBytes) {
            nextChunk = chunk.subarray(0, Math.max(0, maxBytes - receivedBytes));
            truncated = true;
          }
          if (nextChunk.length > 0) {
            chunks.push(nextChunk);
            receivedBytes += nextChunk.length;
          }
          if (truncated) {
            try {
              request.abort();
            } catch {
              // ignore
            }
            safeResolve({
              base64: Buffer.concat(chunks).toString('base64'),
              headers: response.headers,
              receivedBytes,
              status: response.statusCode,
              truncated: true,
            });
          }
        });
        response.on("end", () => {
          safeResolve({
            base64: Buffer.concat(chunks).toString('base64'),
            headers: response.headers,
            receivedBytes,
            status: response.statusCode,
            truncated: false,
          });
        });
      });
      request.on("error", (err) => {
        if (settled) {
          return;
        }
        runtimeLogger.error("http:fetch-binary error:", err);
        safeReject(err);
      });
      if (options.body) {
        request.write(options.body);
      }
      request.end();
    });
  });

  ipcMain.handle("http:upload:abort", async (_event, uploadId: string) => {
    const runtime = activeUploads.get(uploadId);
    if (!runtime) return false;

    runtime.aborted = true;
    activeUploads.delete(uploadId);
    try {
      runtime.fileStream.destroy(new Error('UPLOAD_ABORTED'));
    } catch {
      // ignore
    }
    try {
      runtime.request.destroy(new Error('UPLOAD_ABORTED'));
    } catch {
      // ignore
    }
    return true;
  });

  ipcMain.handle("http:upload", async (
    event,
    url: string,
    filePath: string,
    formDataParams: Record<string, string> = {},
    headers: Record<string, string> = {},
    uploadId?: string,
  ) => {
    return new Promise((resolve, reject) => {
      let stat: fs.Stats;
      try {
        stat = fs.statSync(filePath);
      } catch (error) {
        reject(new Error(`读取上传文件失败: ${filePath} (${String(error)})`));
        return;
      }
      if (!stat.isFile()) {
        reject(new Error(`上传目标不是文件: ${filePath}`));
        return;
      }
      if (stat.size > MAX_SINGLE_UPLOAD_BYTES) {
        reject(new Error(MAX_SINGLE_UPLOAD_ERROR_MESSAGE));
        return;
      }

      const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
      const currentUploadId = uploadId || `upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const fileName = path.basename(filePath);
      const fieldsPrefix = Object.entries(formDataParams).map(([key, value]) => (
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="${escapeMultipartDispositionValue(key)}"\r\n\r\n` +
        `${value}\r\n`
      )).join('');
      const filePrefix =
        `--${boundary}\r\n` +
        buildFileContentDisposition(fileName) +
        `Content-Type: application/octet-stream\r\n\r\n`;
      const fileSuffix = `\r\n--${boundary}--\r\n`;
      const contentLength = Buffer.byteLength(fieldsPrefix) + Buffer.byteLength(filePrefix) + stat.size + Buffer.byteLength(fileSuffix);

      const finalHeaders = {
        ...headers,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': String(contentLength),
      };

      const parsedUrl = new URL(url);
      const transport = parsedUrl.protocol === 'https:' ? https : http;
      const request = transport.request({
        protocol: parsedUrl.protocol,
        hostname: parsedUrl.hostname,
        port: parsedUrl.port ? Number(parsedUrl.port) : undefined,
        path: `${parsedUrl.pathname}${parsedUrl.search}`,
        method: 'POST',
        headers: finalHeaders,
      });

      const fileStream = fs.createReadStream(filePath, {
        highWaterMark: 1024 * 1024,
      });
      const runtime: UploadRuntime = {
        uploadId: currentUploadId,
        request,
        fileStream,
        sender: event.sender,
        totalBytes: Math.max(0, stat.size),
        uploadedBytes: 0,
        startedAt: Date.now(),
        lastProgressAt: 0,
        aborted: false,
      };
      activeUploads.set(currentUploadId, runtime);

      let settled = false;
      const safeResolve = (payload: unknown) => {
        if (settled) return;
        settled = true;
        activeUploads.delete(currentUploadId);
        resolve(payload);
      };
      const safeReject = (error: unknown) => {
        if (settled) return;
        settled = true;
        activeUploads.delete(currentUploadId);
        reject(error);
      };

      let responseBody = '';
      request.on('response', (response: IncomingMessage) => {
        response.on('data', (chunk: Buffer) => {
          responseBody += chunk.toString();
        });
        response.on('end', () => {
          let parsedBody: any;
          try {
            parsedBody = JSON.parse(responseBody);
          } catch {
            parsedBody = responseBody;
          }
          safeResolve({
            status: response.statusCode,
            body: parsedBody,
          });
        });
      });

      request.on('error', (err: Error) => {
        if (runtime.aborted) {
          safeReject(new Error('UPLOAD_ABORTED'));
          return;
        }
        try {
          fileStream.destroy(err);
        } catch {
          // ignore
        }
        safeReject(err);
      });

      request.write(fieldsPrefix);
      request.write(filePrefix);

      fileStream.on('data', (chunk) => {
        if (runtime.aborted) return;
        runtime.uploadedBytes += chunk.length;
        sendUploadProgress(runtime);
      });

      fileStream.on('end', () => {
        if (runtime.aborted) return;
        sendUploadProgress(runtime, true);
        request.write(fileSuffix);
        request.end();
      });

      fileStream.on('error', (err) => {
        if (runtime.aborted) {
          safeReject(new Error('UPLOAD_ABORTED'));
          return;
        }
        safeReject(err);
        try {
          request.destroy(err as Error);
        } catch {
          // ignore
        }
      });

      fileStream.pipe(request, { end: false });
    });
  });

  // --- Chunked (multipart) upload ---

  type ChunkedUploadRuntime = {
    uploadId: string;
    serverUploadId: string;
    sender: Electron.WebContents;
    totalBytes: number;
    uploadedBytes: number;
    startedAt: number;
    lastProgressAt: number;
    aborted: boolean;
    activeRequests: Set<ClientRequest>;
    baseUrl: string;
    headers: Record<string, string>;
  };

  const activeChunkedUploads = new Map<string, ChunkedUploadRuntime>();

  const sendChunkedProgress = (runtime: ChunkedUploadRuntime, force = false) => {
    const now = Date.now();
    if (!force && now - runtime.lastProgressAt < 80) return;
    runtime.lastProgressAt = now;

    const elapsedMs = Math.max(now - runtime.startedAt, 1);
    const speedBps = Math.floor((runtime.uploadedBytes * 1000) / elapsedMs);
    const percentage = runtime.totalBytes > 0
      ? Math.min((runtime.uploadedBytes / runtime.totalBytes) * 100, 100)
      : 0;

    runtime.sender.send('http:upload:progress', {
      uploadId: runtime.uploadId,
      uploadedBytes: runtime.uploadedBytes,
      totalBytes: runtime.totalBytes,
      percentage,
      speedBps,
    });
  };

  const chunkedJsonRequest = (
    method: string,
    url: string,
    headers: Record<string, string>,
    body?: unknown,
  ): Promise<{ status: number; body: any }> => {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);
      const transport = parsedUrl.protocol === 'https:' ? https : http;
      const reqHeaders: Record<string, string> = {
        ...headers,
        'Content-Type': 'application/json',
      };
      const payload = body ? JSON.stringify(body) : undefined;
      if (payload) {
        reqHeaders['Content-Length'] = String(Buffer.byteLength(payload));
      }

      const req = transport.request({
        protocol: parsedUrl.protocol,
        hostname: parsedUrl.hostname,
        port: parsedUrl.port ? Number(parsedUrl.port) : undefined,
        path: `${parsedUrl.pathname}${parsedUrl.search}`,
        method,
        headers: reqHeaders,
      });

      let responseBody = '';
      req.on('response', (res: IncomingMessage) => {
        res.on('data', (chunk: Buffer) => { responseBody += chunk.toString(); });
        res.on('end', () => {
          let parsed: any;
          try { parsed = JSON.parse(responseBody); } catch { parsed = responseBody; }
          resolve({ status: res.statusCode || 0, body: parsed });
        });
      });
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  };

  const chunkedPartUpload = (
    url: string,
    headers: Record<string, string>,
    buffer: Buffer,
    size: number,
    runtime: ChunkedUploadRuntime,
  ): Promise<{ status: number; body: any }> => {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);
      const transport = parsedUrl.protocol === 'https:' ? https : http;
      const req = transport.request({
        protocol: parsedUrl.protocol,
        hostname: parsedUrl.hostname,
        port: parsedUrl.port ? Number(parsedUrl.port) : undefined,
        path: `${parsedUrl.pathname}${parsedUrl.search}`,
        method: 'PUT',
        headers: {
          ...headers,
          'Content-Type': 'application/octet-stream',
          'Content-Length': String(size),
        },
      });

      runtime.activeRequests.add(req);

      let responseBody = '';
      req.on('response', (res: IncomingMessage) => {
        res.on('data', (chunk: Buffer) => { responseBody += chunk.toString(); });
        res.on('end', () => {
          runtime.activeRequests.delete(req);
          let parsed: any;
          try { parsed = JSON.parse(responseBody); } catch { parsed = responseBody; }
          if ((res.statusCode || 0) >= 400) {
            reject(new Error(`分片上传失败: HTTP ${res.statusCode}`));
          } else {
            resolve({ status: res.statusCode || 0, body: parsed });
          }
        });
      });

      req.on('error', (err) => {
        runtime.activeRequests.delete(req);
        reject(err);
      });

      req.write(buffer.subarray(0, size));
      req.end();
    });
  };

  ipcMain.handle("http:chunked-upload", async (
    event,
    baseUrl: string,
    filePath: string,
    params: {
      libraryId: number;
      parentId: number;
      fileName: string;
      fileSize: number;
      conflictPolicy?: string;
      storageProvider?: string;
    },
    headers: Record<string, string> = {},
    uploadId?: string,
  ) => {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(filePath);
    } catch (error) {
      throw new Error(`读取上传文件失败: ${filePath} (${String(error)})`);
    }
    if (!stat.isFile()) {
      throw new Error(`上传目标不是文件: ${filePath}`);
    }

    const currentUploadId = uploadId || `chunked-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const runtime: ChunkedUploadRuntime = {
      uploadId: currentUploadId,
      serverUploadId: '',
      sender: event.sender,
      totalBytes: stat.size,
      uploadedBytes: 0,
      startedAt: Date.now(),
      lastProgressAt: 0,
      aborted: false,
      activeRequests: new Set(),
      baseUrl,
      headers,
    };
    activeChunkedUploads.set(currentUploadId, runtime);

    try {
      const initiateRes = await chunkedJsonRequest(
        'POST',
        `${baseUrl}/api/v1/directory/upload/multipart/initiate`,
        headers,
        {
          libraryId: params.libraryId,
          parentId: params.parentId,
          fileName: params.fileName,
          fileSize: params.fileSize,
          conflictPolicy: params.conflictPolicy,
          storageProvider: params.storageProvider,
        },
      );

      if (runtime.aborted) throw new Error('UPLOAD_ABORTED');
      if ((initiateRes.status || 0) >= 400) {
        throw new Error(`发起分片上传失败: HTTP ${initiateRes.status}`);
      }

      const initiateData = initiateRes.body?.data ?? initiateRes.body;
      runtime.serverUploadId = String(initiateData?.uploadId ?? '');
      const chunkSize = Number(initiateData?.chunkSize ?? 10485760);
      const totalParts = Number(initiateData?.totalParts ?? Math.ceil(stat.size / chunkSize));

      const collectedParts: Array<{ partNumber: number; etag: string }> = [];
      let nextPart = 1;
      const concurrency = 3;

      const fd = fs.openSync(filePath, 'r');
      try {
        const worker = async () => {
          while (!runtime.aborted) {
            const partNumber = nextPart++;
            if (partNumber > totalParts) break;

            const offset = (partNumber - 1) * chunkSize;
            const size = Math.min(chunkSize, stat.size - offset);
            const buffer = Buffer.alloc(size);
            fs.readSync(fd, buffer, 0, size, offset);

            const url = `${baseUrl}/api/v1/directory/upload/multipart/${runtime.serverUploadId}/part/${partNumber}`;
            let res: { status: number; body: any };
            try {
              res = await chunkedPartUpload(url, headers, buffer, size, runtime);
            } catch (err) {
              runtime.aborted = true;
              throw err;
            }

            if (runtime.aborted) break;

            const partData = res.body?.data ?? res.body;
            collectedParts.push({
              partNumber: partData?.partNumber ?? partNumber,
              etag: String(partData?.etag ?? ''),
            });

            runtime.uploadedBytes += size;
            sendChunkedProgress(runtime);
          }
        };

        await Promise.all(Array.from({ length: concurrency }, () => worker()));
      } finally {
        fs.closeSync(fd);
      }

      if (runtime.aborted) throw new Error('UPLOAD_ABORTED');

      sendChunkedProgress(runtime, true);
      const completeRes = await chunkedJsonRequest(
        'POST',
        `${baseUrl}/api/v1/directory/upload/multipart/${runtime.serverUploadId}/complete`,
        headers,
        { parts: collectedParts.map(p => ({ partNumber: p.partNumber, etag: p.etag })) },
      );

      if ((completeRes.status || 0) >= 400) {
        throw new Error(`完成分片上传失败: HTTP ${completeRes.status}`);
      }

      activeChunkedUploads.delete(currentUploadId);
      return { status: completeRes.status, body: completeRes.body };
    } catch (err) {
      activeChunkedUploads.delete(currentUploadId);

      if (runtime.serverUploadId) {
        try {
          await chunkedJsonRequest(
            'DELETE',
            `${baseUrl}/api/v1/directory/upload/multipart/${runtime.serverUploadId}`,
            headers,
          );
        } catch {
          // ignore abort cleanup errors
        }
      }

      throw runtime.aborted ? new Error('UPLOAD_ABORTED') : err;
    }
  });

  ipcMain.handle("http:chunked-upload:abort", async (_event, uploadId: string) => {
    const runtime = activeChunkedUploads.get(uploadId);
    if (!runtime) return false;

    runtime.aborted = true;
    activeChunkedUploads.delete(uploadId);

    for (const req of runtime.activeRequests) {
      try { req.destroy(new Error('UPLOAD_ABORTED')); } catch { /* ignore */ }
    }
    runtime.activeRequests.clear();

    if (runtime.serverUploadId) {
      try {
        await chunkedJsonRequest(
          'DELETE',
          `${runtime.baseUrl}/api/v1/directory/upload/multipart/${runtime.serverUploadId}`,
          runtime.headers,
        );
      } catch {
        // ignore
      }
    }

    return true;
  });
}
