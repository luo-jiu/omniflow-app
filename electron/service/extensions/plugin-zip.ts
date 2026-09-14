import type { Readable } from 'node:stream';
import yauzl from 'yauzl';
import { lstat, open, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { constants } from 'node:fs';
const CRC_TABLE = Uint32Array.from({length:256},(_,value)=>{let crc=value;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);return crc>>>0;});
import { isPackagePath } from './manifest';
import { LIMITS } from '../../../packages/plugin-sdk/index.js';

/** 只向宿主新建的私有 staging 解包；不执行包脚本。 */
export async function extractPluginZip(source: string, target: string): Promise<void> {
  const stat = await lstat(source);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > LIMITS.packageBytes) throw new Error('PACKAGE_LIMIT');
  const handle = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW);
  let sourceBytes: Buffer;
  try {
    const before = await handle.stat(); const buffer = Buffer.alloc(LIMITS.packageBytes + 1); let offset = 0;
    while(offset<buffer.length){const result=await handle.read(buffer,offset,buffer.length-offset,offset);if(!result.bytesRead)break;offset+=result.bytesRead;}
    const after=await handle.stat();if(offset>LIMITS.packageBytes||offset!==before.size||before.mtimeMs!==after.mtimeMs)throw new Error('PACKAGE_CHANGED');
    sourceBytes=Buffer.from(buffer.subarray(0,offset));
  } finally { await handle.close(); }
  const zip = await new Promise<yauzl.ZipFile>((resolve, reject) => yauzl.fromBuffer(sourceBytes, { lazyEntries: true, autoClose: true, validateEntrySizes: true, strictFileNames: true }, (error, value) => error || !value ? reject(new Error('INVALID_ZIP')) : resolve(value)));
  let total = 0; let count = 0; const names = new Set<string>(); const spellings = new Map<string,string>();
  let currentTask: Promise<void> = Promise.resolve(); let active: Readable | undefined;
  const deadline = setTimeout(() => zip.emit('error', new Error('ZIP_TIMEOUT')), 10000);
  try {
    await new Promise<void>((resolve, reject) => {
      let failed = false;
      const fail = () => { if (failed) return; failed = true; active?.destroy(); zip.close(); void currentTask.then(() => reject(new Error('INVALID_PACKAGE')), () => reject(new Error('INVALID_PACKAGE'))); };
      zip.on('error', fail); zip.on('end', () => { if (!failed) resolve(); });
      zip.on('entry', (entry: yauzl.Entry) => {
        currentTask = (async () => {
          const directory = entry.fileName.endsWith('/');
          const name = directory ? entry.fileName.slice(0, -1) : entry.fileName;
          const mode = (entry.externalFileAttributes >>> 16) & 0xf000;
          if (++count > 128 || !isPackagePath(name) || name.split('/').length > 9 || names.has(name.toLowerCase())
            || (entry.generalPurposeBitFlag & 1) || (mode !== 0 && mode !== (directory ? 0x4000 : 0x8000))
            || entry.uncompressedSize > LIMITS.packageFileBytes || entry.uncompressedSize > Math.max(1024, entry.compressedSize * 100)) throw new Error('INVALID_ENTRY');
          names.add(name.toLowerCase());
          const segments = name.split('/');
          for(let index=1;index<=segments.length;index++){const prefix=segments.slice(0,index).join('/');const old=spellings.get(prefix.toLowerCase());if(old&&old!==prefix)throw new Error('CASE_COLLISION');spellings.set(prefix.toLowerCase(),prefix);}
          const file = path.join(target, ...name.split('/'));
          if (directory) { await mkdir(file, { recursive: true, mode: 0o700 }); return; }
          const stream = await new Promise<Readable>((done, rejectStream) => zip.openReadStream(entry, (error, value) => error || !value ? rejectStream(error) : done(value)));
          active = stream;
          const chunks: Buffer[] = []; let size = 0; let crc = 0xffffffff;
          for await (const value of stream) {
            const bytes = typeof value === 'string' ? Buffer.from(value) : Buffer.from(value as Uint8Array); size += bytes.length; total += bytes.length;
            if (failed || size > LIMITS.packageFileBytes || total > LIMITS.packageBytes) throw new Error('PACKAGE_LIMIT');
            for(const byte of bytes)crc=CRC_TABLE[(crc^byte)&255]^(crc>>>8);
            chunks.push(bytes);
          }
          active = undefined;
          if (size !== entry.uncompressedSize || ((crc ^ 0xffffffff) >>> 0) !== entry.crc32) throw new Error('INVALID_SIZE');
          await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
          if(failed)throw new Error('CANCELLED');
          await writeFile(file, Buffer.concat(chunks), { flag: 'wx', mode: 0o600 });
        })();
        void currentTask.then(() => { if (!failed) zip.readEntry(); }, fail);
      });
      zip.readEntry();
    });
  } finally { clearTimeout(deadline); zip.close(); }
}
