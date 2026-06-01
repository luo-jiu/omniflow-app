import { app } from 'electron';
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { downloadUrlToFile } from '../service/fileTransfer';

const execFileAsync = promisify(execFile);
const CACHE_DIR_NAME = 'gallery-preview-cache';
const HEIC_EXTENSIONS = new Set(['heic', 'heif', 'heics', 'heifs']);
const FFMPEG_CANDIDATES = [
  process.env.FFMPEG_PATH || '',
  'ffmpeg',
  '/opt/homebrew/bin/ffmpeg',
  '/usr/local/bin/ffmpeg',
].filter(Boolean);
const SIPS_PATH = '/usr/bin/sips';

interface ImagePreviewRequest {
  nodeId?: number;
  libraryId?: number;
  url: string;
  fileName?: string;
  ext?: string;
  mimeType?: string;
  fileSize?: number;
  sourceVersion?: string;
}

interface ImagePreviewMetadataRow {
  label: string;
  value: string;
}

interface ImagePreviewResult {
  ok: boolean;
  cacheKey?: string;
  error?: string;
  metadataRows: ImagePreviewMetadataRow[];
  originalSize?: number;
  previewDataUrl?: string;
  previewPath?: string;
  previewUrl?: string;
}

function normalizeExt(ext?: string): string {
  return String(ext || '').trim().toLowerCase().replace(/^\./, '');
}

function isHeicRequest(payload: ImagePreviewRequest): boolean {
  const mimeType = String(payload.mimeType || '').toLowerCase();
  return HEIC_EXTENSIONS.has(normalizeExt(payload.ext))
    || mimeType === 'image/heic'
    || mimeType === 'image/heif'
    || mimeType === 'image/heic-sequence'
    || mimeType === 'image/heif-sequence';
}

function buildCacheKey(payload: ImagePreviewRequest): string {
  const libraryId = Number(payload.libraryId || 0);
  const nodeId = Number(payload.nodeId || 0);
  const sourceVersion = String(payload.sourceVersion || '').trim();
  let sourcePath = '';
  try {
    const parsedUrl = new URL(payload.url);
    sourcePath = `${parsedUrl.origin}${parsedUrl.pathname}`;
  } catch {
    sourcePath = payload.url || '';
  }
  const sourceSignature = `${payload.fileName || ''}|${payload.ext || ''}|${payload.fileSize || ''}|${sourceVersion || sourcePath}`;
  if (libraryId > 0 && nodeId > 0) {
    const sourceHash = crypto
      .createHash('sha256')
      .update(sourceSignature)
      .digest('hex')
      .slice(0, 12);
    return `${libraryId}-${nodeId}-${sourceHash}`;
  }
  if (nodeId > 0) {
    const fileHash = crypto
      .createHash('sha256')
      .update(sourceSignature)
      .digest('hex')
      .slice(0, 12);
    return `node-${nodeId}-${fileHash}`;
  }
  const hash = crypto
    .createHash('sha256')
    .update(sourceSignature)
    .digest('hex')
    .slice(0, 24);
  return `url-${hash}`;
}

function getCacheRoot() {
  return path.join(app.getPath('userData'), CACHE_DIR_NAME);
}

function getCachePaths(cacheKey: string) {
  const root = getCacheRoot();
  return {
    inputPath: path.join(root, `${cacheKey}.source.heic`),
    metadataPath: path.join(root, `${cacheKey}.json`),
    previewPath: path.join(root, `${cacheKey}.png`),
  };
}

async function readCachedResult(cacheKey: string): Promise<ImagePreviewResult | null> {
  const { metadataPath, previewPath } = getCachePaths(cacheKey);
  const [metadataRaw, hasPreview] = await Promise.all([
    fs.readFile(metadataPath, 'utf-8').catch(() => ''),
    fs.access(previewPath).then(() => true).catch(() => false),
  ]);
  if (!metadataRaw || !hasPreview) return null;
  const metadata = JSON.parse(metadataRaw) as Partial<ImagePreviewResult>;
  return {
    ok: true,
    cacheKey,
    metadataRows: Array.isArray(metadata.metadataRows) ? metadata.metadataRows : [],
    originalSize: Number(metadata.originalSize || 0) || undefined,
    previewPath,
    previewUrl: pathToFileURL(previewPath).toString(),
  };
}

async function resolveExecutable(candidates: string[]): Promise<string | null> {
  for (const candidate of candidates) {
    try {
      await execFileAsync(candidate, ['-version'], { timeout: 5000 });
      return candidate;
    } catch {
      // try next
    }
  }
  return null;
}

function parseSipsRows(output: string): ImagePreviewMetadataRow[] {
  const rows: ImagePreviewMetadataRow[] = [];
  const map = new Map<string, string>();
  output.split(/\r?\n/).forEach((line) => {
    const match = /^\s*([A-Za-z][A-Za-z0-9]+):\s*(.*?)\s*$/.exec(line);
    if (match) map.set(match[1], match[2]);
  });
  const width = map.get('pixelWidth');
  const height = map.get('pixelHeight');
  if (width && height) rows.push({ label: '尺寸', value: `${width} × ${height}` });
  const creation = map.get('creation');
  if (creation) rows.push({ label: '拍摄时间', value: creation.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3') });
  const make = map.get('make');
  if (make) rows.push({ label: '相机品牌', value: make });
  const model = map.get('model');
  if (model) rows.push({ label: '相机型号', value: model });
  const software = map.get('software');
  if (software) rows.push({ label: '软件', value: software });
  const profile = map.get('profile');
  if (profile) rows.push({ label: '色彩配置', value: profile });
  const space = map.get('space');
  if (space) rows.push({ label: '色彩空间', value: space });
  const dpiWidth = map.get('dpiWidth');
  const dpiHeight = map.get('dpiHeight');
  if (dpiWidth && dpiHeight) rows.push({ label: 'DPI', value: `${dpiWidth} × ${dpiHeight}` });
  const bitsPerSample = map.get('bitsPerSample');
  if (bitsPerSample) rows.push({ label: '位深', value: bitsPerSample });
  return rows;
}

async function readSipsMetadata(inputPath: string): Promise<ImagePreviewMetadataRow[]> {
  try {
    const { stdout } = await execFileAsync(SIPS_PATH, ['-g', 'all', inputPath], { timeout: 15000 });
    return parseSipsRows(stdout);
  } catch {
    return [];
  }
}

async function convertHeicToPng(inputPath: string, outputPath: string) {
  const ffmpegPath = await resolveExecutable(FFMPEG_CANDIDATES);
  if (!ffmpegPath) {
    throw new Error('未找到 ffmpeg，无法生成 HEIC 预览');
  }
  await execFileAsync(ffmpegPath, [
    '-v',
    'error',
    '-y',
    '-i',
    inputPath,
    '-frames:v',
    '1',
    '-update',
    '1',
    outputPath,
  ], {
    timeout: 60_000,
    maxBuffer: 1024 * 1024 * 8,
  });
}

export function registerImagePreviewIpc(ipcMain: Electron.IpcMain) {
  ipcMain.handle('image-preview:prepare', async (_event, payload: ImagePreviewRequest): Promise<ImagePreviewResult> => {
    const url = String(payload?.url || '').trim();
    if (!url) {
      return { ok: false, error: '缺少图片访问链接', metadataRows: [] };
    }
    if (!isHeicRequest(payload)) {
      return { ok: false, error: '当前只支持 HEIC / HEIF 预览代理', metadataRows: [] };
    }

    const cacheKey = buildCacheKey(payload);
    const cached = await readCachedResult(cacheKey).catch(() => null);
    if (cached) return cached;

    const paths = getCachePaths(cacheKey);
    await fs.mkdir(path.dirname(paths.previewPath), { recursive: true });
    try {
      await downloadUrlToFile(url, paths.inputPath);
      const inputStat = await fs.stat(paths.inputPath).catch(() => null);
      const metadataRows = await readSipsMetadata(paths.inputPath);
      await convertHeicToPng(paths.inputPath, paths.previewPath);
      const result: ImagePreviewResult = {
        ok: true,
        cacheKey,
        metadataRows,
        originalSize: inputStat?.size,
        previewPath: paths.previewPath,
        previewUrl: pathToFileURL(paths.previewPath).toString(),
      };
      await fs.writeFile(paths.metadataPath, JSON.stringify({
        cacheKey,
        generatedAt: new Date().toISOString(),
        metadataRows,
        originalExt: normalizeExt(payload.ext),
        originalSize: inputStat?.size,
        previewPath: paths.previewPath,
      }), 'utf-8');
      return result;
    } catch (error: any) {
      return {
        ok: false,
        error: error?.message || '生成 HEIC 预览失败',
        metadataRows: [],
      };
    } finally {
      await fs.rm(paths.inputPath, { force: true }).catch(() => undefined);
    }
  });
}
