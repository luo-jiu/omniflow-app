import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { readOfficeArchive } from './office-archive';

describe('Office archive validation', () => {
  it('rejects expansion beyond the shared limit including unselected entries', async () => {
    const zip = new JSZip(); zip.file('xl/workbook.xml', '<workbook/>');
    zip.file('large.bin', Buffer.alloc(32 * 1024 * 1024));
    await expect(readOfficeArchive(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }), 'xl/workbook.xml')).rejects.toThrow('超限');
  });
  it('rejects missing structure and corrupted compressed streams', async () => {
    const zip = new JSZip(); zip.file('xl/workbook.xml', 'workbook'.repeat(500));
    const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    await expect(readOfficeArchive(bytes, 'ppt/presentation.xml')).rejects.toThrow('结构');
    const dataOffset = 30 + bytes.readUInt16LE(26) + bytes.readUInt16LE(28);
    bytes.fill(255, dataOffset, dataOffset + 8);
    await expect(readOfficeArchive(bytes, 'xl/workbook.xml')).rejects.toThrow();
  });
});
