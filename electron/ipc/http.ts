import { net } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { runtimeLogger } from '../runtimeLogger';

const SENSITIVE_QUERY_PARAM = /(?:authorization|credential|password|secret|signature|token|api[-_]?key)/i;

function sanitizeUrlForLog(value: string): string {
  try {
    const parsed = new URL(value);
    for (const key of Array.from(parsed.searchParams.keys())) {
      if (SENSITIVE_QUERY_PARAM.test(key)) {
        parsed.searchParams.set(key, '<redacted>');
      }
    }
    return parsed.toString();
  } catch {
    return '<invalid-url>';
  }
}

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
  type PresignedPutRuntime = {
    uploadId: string;
    partNumber: number;
    request: ClientRequest;
    fileStream: fs.ReadStream;
    sender: Electron.WebContents;
    totalBytes: number;
    uploadedBytes: number;
    startedAt: number;
    lastProgressAt: number;
    aborted: boolean;
  };

  // 同一 uploadId 下的多个 part 共享 runtime 列表，abort 时统一杀掉所有 in-flight part 请求。
  const activeUploads = new Map<string, Set<PresignedPutRuntime>>();

  const registerRuntime = (runtime: PresignedPutRuntime) => {
    let bucket = activeUploads.get(runtime.uploadId);
    if (!bucket) {
      bucket = new Set();
      activeUploads.set(runtime.uploadId, bucket);
    }
    bucket.add(runtime);
  };

  const unregisterRuntime = (runtime: PresignedPutRuntime) => {
    const bucket = activeUploads.get(runtime.uploadId);
    if (!bucket) return;
    bucket.delete(runtime);
    if (bucket.size === 0) activeUploads.delete(runtime.uploadId);
  };

  const sendUploadProgress = (runtime: PresignedPutRuntime, force = false) => {
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
      partNumber: runtime.partNumber,
      uploadedBytes: runtime.uploadedBytes,
      totalBytes: runtime.totalBytes,
      percentage,
      speedBps,
    });
  };

  ipcMain.handle("http:fetch", async (_event, url: string, options: any = {}) => {
    runtimeLogger.debug("http:fetch start");
    runtimeLogger.debug("http:fetch request:", {
      method: options.method || "GET",
      url: sanitizeUrlForLog(url),
      headerNames: Object.keys(options.headers || {}),
      hasBody: Boolean(options.body),
    });
    return new Promise((resolve, reject) => {
      const request = net.request({ url, method: options.method || "GET" });

      if (options.headers) {
        Object.entries(options.headers).forEach(([key, value]) => {
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
          runtimeLogger.debug("http:fetch body bytes:", Buffer.byteLength(body));
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
    runtimeLogger.debug("http:fetch-binary request:", {
      method: options.method || "GET",
      url: sanitizeUrlForLog(url),
      headerNames: Object.keys(options.headers || {}),
    });
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

  // 单 multipart/form-data POST：仅服务于头像这类小文件、走后端代理保存的旧链路。
  // 文件节点上传已迁移到 http:upload:presigned-put。
  type FormDataUploadRuntime = {
    request: ClientRequest;
    fileStream: fs.ReadStream;
    aborted: boolean;
  };
  const activeFormDataUploads = new Map<string, FormDataUploadRuntime>();

  ipcMain.handle("http:upload:formdata:abort", async (_event, uploadId: string) => {
    const runtime = activeFormDataUploads.get(uploadId);
    if (!runtime) return false;
    runtime.aborted = true;
    activeFormDataUploads.delete(uploadId);
    try { runtime.fileStream.destroy(new Error('UPLOAD_ABORTED')); } catch { /* ignore */ }
    try { runtime.request.destroy(new Error('UPLOAD_ABORTED')); } catch { /* ignore */ }
    return true;
  });

  ipcMain.handle("http:upload:formdata", async (
    _event,
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

      const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
      const currentUploadId = uploadId || `formdata-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
      const contentLength =
        Buffer.byteLength(fieldsPrefix) + Buffer.byteLength(filePrefix) + stat.size + Buffer.byteLength(fileSuffix);

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

      const fileStream = fs.createReadStream(filePath, { highWaterMark: 1024 * 1024 });
      const runtime: FormDataUploadRuntime = { request, fileStream, aborted: false };
      activeFormDataUploads.set(currentUploadId, runtime);

      let settled = false;
      const safeResolve = (payload: unknown) => {
        if (settled) return;
        settled = true;
        activeFormDataUploads.delete(currentUploadId);
        resolve(payload);
      };
      const safeReject = (error: unknown) => {
        if (settled) return;
        settled = true;
        activeFormDataUploads.delete(currentUploadId);
        reject(error);
      };

      let responseBody = '';
      request.on('response', (response: IncomingMessage) => {
        response.on('data', (chunk: Buffer) => { responseBody += chunk.toString(); });
        response.on('end', () => {
          let parsedBody: any;
          try { parsedBody = JSON.parse(responseBody); } catch { parsedBody = responseBody; }
          safeResolve({ status: response.statusCode, body: parsedBody });
        });
      });

      request.on('error', (err: Error) => {
        if (runtime.aborted) {
          safeReject(new Error('UPLOAD_ABORTED'));
          return;
        }
        try { fileStream.destroy(err); } catch { /* ignore */ }
        safeReject(err);
      });

      request.write(fieldsPrefix);
      request.write(filePrefix);

      fileStream.on('end', () => {
        if (runtime.aborted) return;
        request.write(fileSuffix);
        request.end();
      });

      fileStream.on('error', (err) => {
        if (runtime.aborted) {
          safeReject(new Error('UPLOAD_ABORTED'));
          return;
        }
        try { request.destroy(err as Error); } catch { /* ignore */ }
        safeReject(err);
      });

      fileStream.pipe(request, { end: false });
    });
  });

  // 取消整个 upload 会话：杀掉所有还在飞的 part 请求。usecase 层再自行调 /upload/:id DELETE 收尾 MinIO + session 行。
  ipcMain.handle("http:upload:abort", async (_event, uploadId: string) => {
    const bucket = activeUploads.get(uploadId);
    if (!bucket || bucket.size === 0) return false;

    for (const runtime of bucket) {
      runtime.aborted = true;
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
    }
    activeUploads.delete(uploadId);
    return true;
  });

  // 直传 MinIO：对 presigned PUT URL 流式 PUT 单个 part 的字节区间。返回 {status, etag, body}。
  ipcMain.handle("http:upload:presigned-put", async (
    event,
    args: {
      uploadId: string;
      partNumber: number;
      presignedUrl: string;
      filePath: string;
      byteOffset: number;
      byteLength: number;
      contentType?: string;
    },
  ) => {
    const { uploadId, partNumber, presignedUrl, filePath, byteOffset, byteLength, contentType } = args;

    if (!uploadId || !presignedUrl || !filePath) {
      throw new Error('uploadId / presignedUrl / filePath 必填');
    }
    if (!Number.isFinite(partNumber) || partNumber < 1) {
      throw new Error(`非法 partNumber: ${partNumber}`);
    }
    if (!Number.isFinite(byteOffset) || byteOffset < 0) {
      throw new Error(`非法 byteOffset: ${byteOffset}`);
    }
    if (!Number.isFinite(byteLength) || byteLength <= 0) {
      throw new Error(`非法 byteLength: ${byteLength}`);
    }

    let stat: fs.Stats;
    try {
      stat = fs.statSync(filePath);
    } catch (error) {
      throw new Error(`读取上传文件失败: ${filePath} (${String(error)})`);
    }
    if (!stat.isFile()) {
      throw new Error(`上传目标不是文件: ${filePath}`);
    }
    if (byteOffset + byteLength > stat.size) {
      throw new Error(`分片越界: offset=${byteOffset}, length=${byteLength}, fileSize=${stat.size}`);
    }

    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(presignedUrl);
      const transport = parsedUrl.protocol === 'https:' ? https : http;

      const headers: Record<string, string> = {
        'Content-Length': String(byteLength),
      };
      if (contentType) {
        headers['Content-Type'] = contentType;
      }

      const request = transport.request({
        protocol: parsedUrl.protocol,
        hostname: parsedUrl.hostname,
        port: parsedUrl.port ? Number(parsedUrl.port) : undefined,
        path: `${parsedUrl.pathname}${parsedUrl.search}`,
        method: 'PUT',
        headers,
      });

      const fileStream = fs.createReadStream(filePath, {
        start: byteOffset,
        end: byteOffset + byteLength - 1,
        highWaterMark: 1024 * 1024,
      });

      const runtime: PresignedPutRuntime = {
        uploadId,
        partNumber,
        request,
        fileStream,
        sender: event.sender,
        totalBytes: byteLength,
        uploadedBytes: 0,
        startedAt: Date.now(),
        lastProgressAt: 0,
        aborted: false,
      };
      registerRuntime(runtime);

      let settled = false;
      const safeResolve = (payload: unknown) => {
        if (settled) return;
        settled = true;
        unregisterRuntime(runtime);
        resolve(payload);
      };
      const safeReject = (error: unknown) => {
        if (settled) return;
        settled = true;
        unregisterRuntime(runtime);
        reject(error);
      };

      let responseBody = '';
      request.on('response', (response: IncomingMessage) => {
        response.on('data', (chunk: Buffer) => {
          responseBody += chunk.toString();
        });
        response.on('end', () => {
          const status = response.statusCode || 0;
          // S3 协议 ETag 在响应头返回，去引号；single 模式有时 body 也会返回 XML，忽略即可。
          const rawEtag = (response.headers.etag || response.headers.ETag || '') as string;
          const etag = String(rawEtag).replace(/^"+|"+$/g, '');

          if (status >= 400) {
            safeReject(new Error(`分片上传失败: HTTP ${status} ${responseBody.slice(0, 200)}`));
            return;
          }

          // 强制最终 progress=100% 让 renderer 合并字节计数收敛。
          runtime.uploadedBytes = runtime.totalBytes;
          sendUploadProgress(runtime, true);

          safeResolve({ status, etag, body: responseBody });
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

      fileStream.on('data', (chunk) => {
        if (runtime.aborted) return;
        runtime.uploadedBytes += chunk.length;
        sendUploadProgress(runtime);
      });

      fileStream.on('error', (err) => {
        if (runtime.aborted) {
          safeReject(new Error('UPLOAD_ABORTED'));
          return;
        }
        try {
          request.destroy(err as Error);
        } catch {
          // ignore
        }
        safeReject(err);
      });

      fileStream.pipe(request);
    });
  });
}
