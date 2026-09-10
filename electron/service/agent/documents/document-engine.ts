import path from 'node:path';
import { createRequire } from 'node:module';
import { readOfficeArchive } from './office-archive';
import type { AgentDocumentJob, AgentDocumentResult } from './document.types';

const require = createRequire(import.meta.url);
const MAX_EXTRACTED_CHARACTERS = 4 * 1024 * 1024;

export async function processAgentDocument(job: AgentDocumentJob): Promise<AgentDocumentResult> {
  if (job.format === 'xlsx') return (await import('./spreadsheet-engine')).processAgentSpreadsheet(job);
  if (job.format === 'pptx') return (await import('./presentation-engine')).processAgentPresentation(job);
  if (job.format === 'docx') {
    if (job.operation === 'render') throw new Error('DOCX 当前支持正文提取，尚未提供可靠的页面渲染');
    await readOfficeArchive(job.bytes, 'word/document.xml');
    if (job.operation === 'inspect') return { warnings: ['DOCX 不提供固定页码；使用按行正文读取，表格格式和版式可能丢失。'] };
    const mammoth = await import('mammoth');
    const extracted = await mammoth.extractRawText({ buffer: Buffer.from(job.bytes) });
    if (extracted.value.length > MAX_EXTRACTED_CHARACTERS) throw new Error('DOCX 提取正文超过处理上限');
    return { text: extracted.value, warnings: ['提取结果保留正文顺序，不保证版式、公式或表格结构。',
      ...extracted.messages.slice(0, 8).map(message => String(message.message).slice(0, 200))] };
  }

  const canvas = await import('@napi-rs/canvas');
  const globals = globalThis as unknown as Record<string, unknown>;
  globals.DOMMatrix ||= canvas.DOMMatrix;
  globals.ImageData ||= canvas.ImageData;
  globals.Path2D ||= canvas.Path2D;
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const root = path.dirname(require.resolve('pdfjs-dist/package.json'));
  // Each document runs in its own worker. PDF.js 4.x can resolve rendering after
  // dropping an image; its warning stream is the only reliable signal for that case.
  const warnings: string[] = [];
  let omittedImage = false;
  const originalLog = console.log;
  const originalWarn = console.warn;
  const capture = (args: unknown[]) => {
    const text = args.map(value => String(value)).join(' ');
    if (/Image exceeded maximum allowed size|Unable to decode image|Image dimensions are missing/iu.test(text)) omittedImage = true;
    if (warnings.length < 8) warnings.push(text.slice(0, 300));
  };
  console.log = (...args) => { if (String(args[0]).startsWith('Warning:')) capture(args); else originalLog(...args); };
  console.warn = (...args) => { capture(args); };
  let loading: ReturnType<typeof pdfjs.getDocument> | undefined;
  try {
    loading = pdfjs.getDocument({ data: Uint8Array.from(job.bytes), isEvalSupported: false, maxImageSize: 16_000_000,
      useSystemFonts: false, standardFontDataUrl: path.join(root, 'standard_fonts') + path.sep,
      cMapUrl: path.join(root, 'cmaps') + path.sep, cMapPacked: true });
    const document = await loading.promise;
    if (job.operation === 'inspect') return { pageCount: document.numPages, ...(warnings.length ? { warnings } : {}) };
    const pageNumber = job.page ?? 1;
    if (!Number.isSafeInteger(pageNumber) || pageNumber < 1 || pageNumber > document.numPages) throw new Error('PDF 页码超出范围');
    const page = await document.getPage(pageNumber);
    if (job.operation === 'read') {
      const content = await page.getTextContent();
      let text = '';
      for (const item of content.items) if ('str' in item) {
        text += item.str + (item.hasEOL ? '\n' : ' ');
        if (text.length > MAX_EXTRACTED_CHARACTERS) throw new Error('PDF 单页正文超过处理上限');
      }
      if (!text.trim()) warnings.push('此页没有可提取正文，可能是扫描页；请调用 attachment.view 查看页面。');
      return { pageCount: document.numPages, page: pageNumber, text, ...(warnings.length ? { warnings } : {}) };
    }
    const unscaled = page.getViewport({ scale: 1 });
    if (!Number.isFinite(unscaled.width) || !Number.isFinite(unscaled.height) || unscaled.width <= 0 || unscaled.height <= 0) throw new Error('PDF 页面尺寸无效');
    const viewport = page.getViewport({ scale: Math.min(2, 2048 / Math.max(unscaled.width, unscaled.height)) });
    const output = canvas.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    await page.render({ canvasContext: output.getContext('2d') as unknown as CanvasRenderingContext2D, viewport }).promise;
    if (omittedImage) throw new Error('PDF 页面图像超出像素限制或解码失败，未生成完整预览；请降低扫描分辨率后重试，不能将该页判断为空白。');
    const png = output.toBuffer('image/png');
    if (png.length > 8 * 1024 * 1024) throw new Error('渲染页面图片超过 8 MiB');
    return { pageCount: document.numPages, page: pageNumber, png, width: output.width, height: output.height,
      ...(warnings.length ? { warnings } : {}) };
  } finally {
    try { await loading?.destroy(); } finally { console.log = originalLog; console.warn = originalWarn; }
  }
}
