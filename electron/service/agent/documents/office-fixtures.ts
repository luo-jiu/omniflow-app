import ExcelJS from 'exceljs';
import PptxGenJS from 'pptxgenjs';
import JSZip from 'jszip';

export async function xlsxFixture(): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('销售');
  sheet.addRow(['Item', 'Units', 'Revenue']);
  sheet.addRow(['Alpha', 2, { formula: 'B2*10', result: 20 }]);
  sheet.addRow(['Beta', 3, 30]);
  sheet.addRow(['Gamma', 4, { formula: 'B4*10' }]);
  sheet.addRow(['Zero', 0, { formula: 'B5*10', result: 0 }]);
  sheet.getCell('D2').value = new Date('2026-09-10T00:00:00Z');
  const hidden = book.addWorksheet('Hidden', { state: 'hidden' }); hidden.getCell('A1').value = 'hidden value';
  return Buffer.from(await book.xlsx.writeBuffer());
}

export async function pptxFixture(): Promise<Buffer> {
  const presentation = new PptxGenJS(); presentation.layout = 'LAYOUT_WIDE';
  const first = presentation.addSlide();
  first.addText('SLIDE-FIRST', { x: 1, y: 1, w: 8, h: 1, fontSize: 24, fontFace: 'Arial' }); first.addNotes('NOTE-FIRST');
  const second = presentation.addSlide();
  second.addText('SLIDE-SECOND', { x: 1, y: 1, w: 8, h: 1, fontSize: 24, fontFace: 'Arial' });
  second.addShape(presentation.ShapeType.rect, { x: 3, y: 2.5, w: 2, h: 2, fill: { color: '009D40' }, line: { color: '009D40' } });
  second.addNotes('NOTE-SECOND');
  const bytes = await presentation.write({ outputType: 'nodebuffer' }) as Buffer;
  const zip = await JSZip.loadAsync(bytes);
  const structure = await zip.file('ppt/presentation.xml')!.async('string');
  const ids = structure.match(/<p:sldId\b[^>]*\/>/gu)!;
  let index = ids.length;
  zip.file('ppt/presentation.xml', structure.replace(/<p:sldId\b[^>]*\/>/gu, () => ids[--index]));
  for (const suffix of ['.xml', '.xml.rels']) {
    const from = suffix === '.xml' ? 'ppt/notesSlides/notesSlide2.xml' : 'ppt/notesSlides/_rels/notesSlide2.xml.rels';
    const to = from.replace('notesSlide2', 'notesSlide9');
    zip.file(to, await zip.file(from)!.async('nodebuffer')); zip.remove(from);
  }
  const relations = 'ppt/slides/_rels/slide2.xml.rels';
  zip.file(relations, (await zip.file(relations)!.async('string')).replace(/notesSlide2\.xml/gu, 'notesSlide9.xml'));
  zip.file('[Content_Types].xml', (await zip.file('[Content_Types].xml')!.async('string')).replace(/notesSlide2\.xml/gu, 'notesSlide9.xml'));
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
