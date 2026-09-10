import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { pptxFixture } from './office-fixtures';
import { processAgentDocument } from './document-engine';

describe('presentation attachment processing', () => {
  it('preserves line breaks and rejects XML repaired by the parser', async () => {
    const zip = await JSZip.loadAsync(await pptxFixture());
    const name = 'ppt/slides/slide2.xml';
    const original = await zip.file(name)!.async('string');
    zip.file(name, original.replace('<a:t>SLIDE-SECOND</a:t>', '<a:t>BEFORE</a:t></a:r><a:br/><a:r><a:t>AFTER</a:t>'));
    const result = await processAgentDocument({ format: 'pptx', operation: 'read', page: 1, bytes: await zip.generateAsync({ type: 'nodebuffer' }) });
    expect(result.text).toContain('BEFORE\nAFTER');
    zip.file(name, original.replace('<p:sld ', '<p:sld broken=value '));
    await expect(processAgentDocument({ format: 'pptx', operation: 'read', page: 1, bytes: await zip.generateAsync({ type: 'nodebuffer' }) })).rejects.toThrow('XML 无效');
  });
  it('uses presentation order and the actual notes relationship instead of filename numbers', async () => {
    const bytes = await pptxFixture();
    expect(await processAgentDocument({ format: 'pptx', operation: 'inspect', bytes })).toMatchObject({ pageCount: 2, renderAllowed: true });
    const first = await processAgentDocument({ format: 'pptx', operation: 'read', bytes, page: 1 });
    expect(first.text).toContain('SLIDE-SECOND'); expect(first.text).toContain('NOTE-SECOND'); expect(first.text).not.toContain('NOTE-FIRST');
    const second = await processAgentDocument({ format: 'pptx', operation: 'read', bytes, page: 2 });
    expect(second.text).toContain('SLIDE-FIRST'); expect(second.text).toContain('NOTE-FIRST');
    await expect(processAgentDocument({ format: 'pptx', operation: 'read', bytes, page: 3 })).rejects.toThrow('页码');
  });
  it('marks linked external resources as unavailable for automatic rendering', async () => {
    const zip = await JSZip.loadAsync(await pptxFixture());
    const name = 'ppt/slides/_rels/slide1.xml.rels';
    zip.file(name, (await zip.file(name)!.async('string')).replace('</Relationships>', '<Relationship Id="remote" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="https://example.invalid/image.png" TargetMode="External"/></Relationships>'));
    const info = await processAgentDocument({ format: 'pptx', operation: 'inspect', bytes: await zip.generateAsync({ type: 'nodebuffer' }) });
    expect(info).toMatchObject({ renderAllowed: false });
    expect(info.warnings?.some(warning => warning.includes('外部资源'))).toBe(true);
  });
});
