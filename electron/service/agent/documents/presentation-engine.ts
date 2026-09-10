import path from 'node:path';
import { DOMParser } from '@xmldom/xmldom';
import { readOfficeArchive } from './office-archive';
import type { AgentDocumentJob, AgentDocumentResult } from './document.types';

const PRESENTATION = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const DRAWING = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const RELATIONSHIP = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PACKAGE_RELATIONSHIP = 'http://schemas.openxmlformats.org/package/2006/relationships';
const STRICT_PRESENTATION = 'http://purl.oclc.org/ooxml/presentationml/main';
const STRICT_DRAWING = 'http://purl.oclc.org/ooxml/drawingml/main';
const STRICT_RELATIONSHIP = 'http://purl.oclc.org/ooxml/officeDocument/relationships';

function xml(bytes: Buffer | undefined) {
  if (!bytes) throw new Error('PPTX 缺少引用的 XML 内容');
  const text = bytes.toString('utf8');
  if (/<!DOCTYPE|<!ENTITY/iu.test(text)) throw new Error('PPTX 包含不支持的 XML 声明');
  let invalid = false;
  const document = new DOMParser({ errorHandler: { warning: () => { invalid = true; }, error: () => { invalid = true; }, fatalError: () => { invalid = true; } } }).parseFromString(text, 'application/xml');
  if (invalid || !document.documentElement) throw new Error('PPTX XML 无效');
  return document;
}
function target(source: string, value: string) {
  const decoded = decodeURIComponent(value).replace(/\\/gu, '/');
  const normalized = path.posix.normalize(decoded.startsWith('/') ? decoded.slice(1) : path.posix.join(path.posix.dirname(source), decoded));
  if (normalized.startsWith('../') || normalized.includes(':')) throw new Error('PPTX 引用路径无效');
  return normalized;
}
function relationships(files: Map<string, Buffer>, source: string) {
  const location = path.posix.join(path.posix.dirname(source), '_rels', path.posix.basename(source) + '.rels');
  const bytes = files.get(location);
  if (!bytes) return [];
  return Array.from(xml(bytes).getElementsByTagNameNS(PACKAGE_RELATIONSHIP, 'Relationship')).map(item => ({
    id: item.getAttribute('Id') || '', type: item.getAttribute('Type') || '',
    external: item.getAttribute('TargetMode') === 'External', value: item.getAttribute('Target') || '',
  }));
}
function textOf(bytes: Buffer) {
  const document = xml(bytes);
  if (![PRESENTATION, STRICT_PRESENTATION].includes(document.documentElement.namespaceURI || '')) throw new Error('PPTX 幻灯片命名空间无效');
  const paragraphs = Array.from(document.getElementsByTagNameNS('*', 'p')).filter(node => [DRAWING, STRICT_DRAWING].includes(node.namespaceURI || ''));
  return paragraphs.map(paragraph => Array.from(paragraph.getElementsByTagNameNS('*', '*'))
    .filter(node => [DRAWING, STRICT_DRAWING].includes(node.namespaceURI || ''))
    .map(node => node.localName === 't' ? node.textContent || '' : node.localName === 'br' ? '\n' : node.localName === 'tab' ? '\t' : '').join('')).join('\n');
}

export async function inspectPresentationArchive(bytes: Uint8Array) {
  const files = await readOfficeArchive(bytes, 'ppt/presentation.xml', name => /\.(xml|rels)$/iu.test(name) || /vbaProject\.bin$/iu.test(name));
  const presentation = xml(files.get('ppt/presentation.xml'));
  if (![PRESENTATION, STRICT_PRESENTATION].includes(presentation.documentElement.namespaceURI || '')) throw new Error('PPTX 演示文稿命名空间无效');
  const refs = relationships(files, 'ppt/presentation.xml');
  const slides = Array.from(presentation.getElementsByTagNameNS('*', 'sldId')).filter(item => [PRESENTATION, STRICT_PRESENTATION].includes(item.namespaceURI || '')).map(item => {
    const relation = refs.find(ref => ref.id === (item.getAttributeNS(RELATIONSHIP, 'id') || item.getAttributeNS(STRICT_RELATIONSHIP, 'id')));
    if (!relation || relation.external || !relation.type.endsWith('/slide')) throw new Error('PPTX 幻灯片引用无效');
    const slidePath = target('ppt/presentation.xml', relation.value);
    if (!files.has(slidePath)) throw new Error('PPTX 引用的幻灯片不存在');
    return slidePath;
  });
  let externalResources = false;
  for (const [name, content] of files) if (name.endsWith('.rels')) {
    for (const relation of Array.from(xml(content).getElementsByTagNameNS(PACKAGE_RELATIONSHIP, 'Relationship'))) {
      if (relation.getAttribute('TargetMode') === 'External' && !relation.getAttribute('Type')?.endsWith('/hyperlink')) externalResources = true;
    }
  }
  const macros = Array.from(files.keys()).some(name => /vbaProject\.bin$/iu.test(name));
  return { files, slides, externalResources, macros };
}

export async function processAgentPresentation(job: AgentDocumentJob): Promise<AgentDocumentResult> {
  const { files, slides, externalResources, macros } = await inspectPresentationArchive(job.bytes);
  const warnings = ['按演示文稿引用顺序提取文字和备注，不代表已识别图像或全部图表内容。'];
  if (externalResources) warnings.push('包含外部资源引用，未访问外部文件或网络；页面渲染不可用。');
  if (macros) warnings.push('包含宏内容，不执行宏，页面渲染不可用。');
  if (job.operation === 'inspect') return { pageCount: slides.length, warnings, renderAllowed: !externalResources && !macros };
  if (job.operation !== 'read') throw new Error('PPTX 页面查看需要可用的 LibreOffice 渲染器');
  const page = job.page ?? 1;
  if (!Number.isSafeInteger(page) || page < 1 || page > slides.length) throw new Error('幻灯片页码超出范围');
  const slidePath = slides[page - 1];
  const notesRelation = relationships(files, slidePath).find(item => item.type.endsWith('/notesSlide'));
  let notes = '';
  if (notesRelation) {
    if (notesRelation.external) throw new Error('PPTX 备注引用不能指向外部资源');
    const noteBytes = files.get(target(slidePath, notesRelation.value));
    if (!noteBytes) throw new Error('PPTX 引用的备注不存在');
    notes = textOf(noteBytes);
  }
  const text = `幻灯片 ${page}\n${textOf(files.get(slidePath)!)}${notes ? `\n\n演讲者备注\n${notes}` : ''}`;
  if (text.length > 4 * 1024 * 1024) throw new Error('幻灯片文字超出处理上限');
  return { page, pageCount: slides.length, text, warnings };
}
