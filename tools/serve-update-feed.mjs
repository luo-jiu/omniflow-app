import { createReadStream, realpathSync, statSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const sourceDirectory = process.argv[2];
const port = Number(process.argv[3] || 8899);

if (!sourceDirectory) {
  throw new Error('Usage: npm run update:serve -- <release-directory> [port]');
}
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error(`Invalid port: ${process.argv[3] || ''}`);
}

const root = realpathSync(path.resolve(sourceDirectory));

function resolveFilePath(requestUrl) {
  const requestPath = decodeURIComponent(new URL(requestUrl || '/', 'http://127.0.0.1').pathname);
  const relativePath = requestPath.replace(/^\/+/, '');
  if (!relativePath) return null;
  const resolved = path.resolve(root, relativePath);
  return resolved.startsWith(`${root}${path.sep}`) ? resolved : null;
}

function contentType(filePath) {
  if (filePath.endsWith('.yml') || filePath.endsWith('.yaml')) return 'text/yaml; charset=utf-8';
  if (filePath.endsWith('.zip')) return 'application/zip';
  if (filePath.endsWith('.dmg')) return 'application/x-apple-diskimage';
  return 'application/octet-stream';
}

const server = http.createServer((request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' });
    response.end();
    return;
  }

  try {
    const filePath = resolveFilePath(request.url);
    if (!filePath) {
      response.writeHead(404);
      response.end();
      return;
    }
    const stat = statSync(filePath);
    if (!stat.isFile()) {
      response.writeHead(404);
      response.end();
      return;
    }

    const headers = {
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
      'Content-Type': contentType(filePath),
    };
    const range = /^bytes=(\d+)-(\d*)$/.exec(String(request.headers.range || ''));
    if (range) {
      const start = Number(range[1]);
      const requestedEnd = range[2] ? Number(range[2]) : stat.size - 1;
      const end = Math.min(requestedEnd, stat.size - 1);
      if (!Number.isFinite(start) || start < 0 || start > end) {
        response.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
        response.end();
        return;
      }
      response.writeHead(206, {
        ...headers,
        'Content-Length': end - start + 1,
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      });
      if (request.method === 'HEAD') {
        response.end();
        return;
      }
      createReadStream(filePath, { start, end }).pipe(response);
      return;
    }

    response.writeHead(200, { ...headers, 'Content-Length': stat.size });
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    createReadStream(filePath).pipe(response);
  } catch {
    response.writeHead(404);
    response.end();
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Omniflow update feed: http://127.0.0.1:${port}/`);
  console.log(`Serving: ${root}`);
});
