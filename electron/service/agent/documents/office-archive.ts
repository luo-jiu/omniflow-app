import { fromBuffer } from 'yauzl';

export async function readOfficeArchive(bytes: Uint8Array, required: string, collect: (name: string) => boolean = () => false): Promise<Map<string, Buffer>> {
  return new Promise((resolve, reject) => {
    fromBuffer(Buffer.from(bytes), { lazyEntries: true, validateEntrySizes: true }, (error, zip) => {
      if (error || !zip) { reject(new Error('Office 压缩结构无效')); return; }
      const output = new Map<string, Buffer>();
      const names = new Set<string>();
      let declared = 0, actual = 0, count = 0, found = false, failed = false;
      const fail = (reason: Error) => { if (failed) return; failed = true; zip.close(); reject(reason); };
      zip.on('error', fail);
      zip.on('entry', entry => {
        if (names.has(entry.fileName)) { fail(new Error('Office 包含重复条目，无法确定正文')); return; }
        names.add(entry.fileName);
        declared += entry.uncompressedSize; count++;
        if (declared > 32 * 1024 * 1024 || count > 4096 || (entry.generalPurposeBitFlag & 1)) {
          fail(new Error('Office 解压大小超限或文件已加密')); return;
        }
        if (entry.fileName === required) found = true;
        if (entry.fileName.endsWith('/')) { zip.readEntry(); return; }
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) { fail(new Error('Office 条目无法读取')); return; }
          const retain = collect(entry.fileName), chunks: Buffer[] = [];
          stream.on('error', fail);
          stream.on('data', (chunk: Buffer) => {
            actual += chunk.length;
            if (actual > 32 * 1024 * 1024) { stream.destroy(); fail(new Error('Office 实际解压大小超限')); return; }
            if (retain) chunks.push(chunk);
          });
          stream.on('end', () => { if (failed) return; if (retain) output.set(entry.fileName, Buffer.concat(chunks)); zip.readEntry(); });
        });
      });
      zip.on('end', () => { if (!failed) found ? resolve(output) : reject(new Error('文件不包含所声明的 Office 文档结构')); });
      zip.readEntry();
    });
  });
}
