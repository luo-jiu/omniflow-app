import { net } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { runtimeLogger } from '../runtimeLogger';
import { MAX_SINGLE_UPLOAD_BYTES, MAX_SINGLE_UPLOAD_ERROR_MESSAGE } from '../../src/shared/upload-limits';

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
        `Content-Disposition: form-data; name="${key}"\r\n\r\n` +
        `${value}\r\n`
      )).join('');
      const filePrefix =
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n` +
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
}
