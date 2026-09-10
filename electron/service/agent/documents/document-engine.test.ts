import { describe, expect, it } from 'vitest';
import { processAgentDocument } from './document-engine';
import { pdfFixture, docxFixture, oversizedScanPdfFixture } from './document-fixtures';

describe('mature document parsers', () => {
  it('rejects an oversized scan instead of returning a successful blank page', async () => {
    const bytes = oversizedScanPdfFixture();
    expect(bytes.length).toBeLessThan(20000);
    await expect(processAgentDocument({ format: 'pdf', operation: 'render', bytes, page: 1 })).rejects.toThrow('不能将该页判断为空白');
  });
  it('inspects PDF pages, extracts only the requested page and renders a page without text', async () => {
    const bytes = pdfFixture();
    expect(await processAgentDocument({ format: 'pdf', operation: 'inspect', bytes })).toEqual({ pageCount: 2 });
    const text = await processAgentDocument({ format: 'pdf', operation: 'read', bytes, page: 1 });
    expect(text.text).toContain('ORBIT-7351');
    const scanned = await processAgentDocument({ format: 'pdf', operation: 'read', bytes, page: 2 });
    expect(scanned.text?.trim()).toBe('');
    expect(scanned.warnings?.[0]).toContain('attachment.view');
    const rendered = await processAgentDocument({ format: 'pdf', operation: 'render', bytes, page: 2 });
    expect(Buffer.from(rendered.png!).subarray(0, 8)).toEqual(Buffer.from([137,80,78,71,13,10,26,10]));
    expect(rendered).toMatchObject({ page: 2, pageCount: 2, width: 400, height: 240 });
    const canvas = await import('@napi-rs/canvas');
    const surface = canvas.createCanvas(400, 240);
    surface.getContext('2d').drawImage(await canvas.loadImage(Buffer.from(rendered.png!)), 0, 0);
    const pixel = surface.getContext('2d').getImageData(200, 120, 1, 1).data;
    expect(pixel[0]).toBeLessThan(40); expect(pixel[1]).toBeGreaterThan(100); expect(pixel[3]).toBe(255);
    await expect(processAgentDocument({ format: 'pdf', operation: 'read', bytes, page: 3 })).rejects.toThrow('页码');
  });
  it('extracts DOCX Chinese paragraphs and rejects unsupported rendering or invalid archives', async () => {
    const bytes = await docxFixture();
    const result = await processAgentDocument({ format: 'docx', operation: 'read', bytes });
    expect(result.text).toContain('DOCX 中文检查');
    expect(result.text).toContain('QUANTITY 23');
    await expect(processAgentDocument({ format: 'docx', operation: 'render', bytes })).rejects.toThrow('尚未');
    await expect(processAgentDocument({ format: 'docx', operation: 'inspect', bytes: Buffer.from('invalid') })).rejects.toThrow('无效');
  });
});
