import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { resolvePreviewFileType } from '../../src/utils/preview-file-type';

export async function readLocalFilePreview(input: string) {
  if (typeof input !== 'string' || input.length > 4096 || [...input].some(char => char.charCodeAt(0) < 32)) throw new Error('本机路径无效');
  const filePath = input.startsWith('~/') ? path.join(os.homedir(), input.slice(2)) : input;
  if (!path.isAbsolute(filePath)) throw new Error('需要本机绝对路径');
  const initial = await fs.stat(filePath);
  if (!initial.isFile()) throw new Error('只能预览普通文件');
  const handle = await fs.open(filePath, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error('只能预览普通文件');
    if (stat.size > 32 * 1024 * 1024) throw new Error('本机预览暂支持 32 MiB 以内文件');
    const name = path.basename(filePath);
    const ext = path.extname(name).slice(1).toLowerCase();
    const type = resolvePreviewFileType(undefined, ext, name);
    if (type === 'other') throw new Error('该本机文件格式暂不支持预览');
    const bytes = Buffer.alloc(stat.size + 1);
    let bytesRead = 0;
    while (bytesRead < bytes.length) {
      const chunk = await handle.read(bytes, bytesRead, bytes.length - bytesRead, bytesRead);
      if (!chunk.bytesRead) break;
      bytesRead += chunk.bytesRead;
    }
    const after = await handle.stat();
    if (after.mtimeMs !== stat.mtimeMs || after.size !== stat.size) throw new Error('文件读取期间发生变化，请重新打开');
    if (bytesRead !== stat.size) throw new Error('文件读取期间发生变化，请重新打开');
    const mime = type === 'text' ? 'text/plain;charset=utf-8' : type === 'pdf' ? 'application/pdf'
      : type === 'image' ? `image/${ext === 'jpg' ? 'jpeg' : ext === 'svg' ? 'svg+xml' : ext}`
        : `${type}/${ext}`;
    return { name, type, dataUrl: `data:${mime};base64,${bytes.subarray(0, bytesRead).toString('base64')}` };
  } finally { await handle.close(); }
}
