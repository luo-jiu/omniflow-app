import JSZip from 'jszip';
import { deflateSync } from 'node:zlib';

export function pdfFixture(): Buffer {
  const stream = (content: string) => `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 120] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>',
    stream('BT /F1 12 Tf 15 75 Td (REFERENCE ORBIT-7351) Tj ET'),
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 120] /Resources << >> /Contents 6 0 R >>',
    stream('0 0.65 0.2 rg 55 15 90 90 re f'),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const start = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(pdf);
}

export async function docxFixture(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('word/document.xml', '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>DOCX 中文检查</w:t></w:r></w:p><w:p><w:r><w:t>QUANTITY 23</w:t></w:r></w:p></w:body></w:document>');
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

export function oversizedScanPdfFixture(): Buffer {
  const image = deflateSync(Buffer.alloc(4096 * 4096));
  const paint = Buffer.from('q 200 0 0 120 0 0 cm /Scan Do Q');
  const objects = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 120] /Resources << /XObject << /Scan 5 0 R >> >> /Contents 4 0 R >>'),
    Buffer.concat([Buffer.from(`<< /Length ${paint.length} >>\nstream\n`), paint, Buffer.from('\nendstream')]),
    Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width 4096 /Height 4096 /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ${image.length} >>\nstream\n`), image, Buffer.from('\nendstream')]),
  ];
  const parts = [Buffer.from('%PDF-1.4\n')], offsets: number[] = [];
  let length = parts[0].length;
  objects.forEach((object, index) => {
    offsets.push(length);
    const part = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`), object, Buffer.from('\nendobj\n')]);
    parts.push(part); length += part.length;
  });
  parts.push(Buffer.from(`xref\n0 6\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`));
  return Buffer.concat(parts);
}
