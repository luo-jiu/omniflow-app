import { DOMParser } from '@xmldom/xmldom';

const ELEMENTS = new Set(['svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'defs', 'linearGradient', 'radialGradient', 'stop', 'title', 'desc']);
const ATTRIBUTES = new Set(['xmlns', 'viewBox', 'width', 'height', 'x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'd', 'points', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'fill-rule', 'clip-rule', 'opacity', 'fill-opacity', 'stroke-opacity', 'transform', 'id', 'offset', 'stop-color', 'stop-opacity', 'gradientUnits', 'gradientTransform', 'preserveAspectRatio']);
// Restricted declarative SVG subset, never a repair-and-execute sanitizer.
export function validateIconSvg(source: string): boolean {
  if (new TextEncoder().encode(source).byteLength > 256 * 1024 || source.includes('\0') || /<!DOCTYPE|<!ENTITY|<\?/i.test(source)) return false;
  let failed = false;
  const doc = new DOMParser({ errorHandler: { warning: () => { failed = true; }, error: () => { failed = true; }, fatalError: () => { failed = true; } } }).parseFromString(source, 'image/svg+xml');
  if (failed || doc.documentElement?.tagName !== 'svg') return false;
  const nodes = doc.getElementsByTagName('*');
  if (nodes.length > 2048) return false;
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes.item(i)!;
    if (!ELEMENTS.has(node.tagName) || (node.namespaceURI && node.namespaceURI !== 'http://www.w3.org/2000/svg')) return false;
    for (let j = 0; j < node.attributes.length; j += 1) {
      const attribute = node.attributes.item(j)!;
      if (!ATTRIBUTES.has(attribute.name) || attribute.value.length > 32000) return false;
      if (attribute.name === 'xmlns') { if (attribute.value !== 'http://www.w3.org/2000/svg') return false; continue; }
      if (/[<>;\\]|(?:https?|data|javascript|file):|@import|expression\s*\(/i.test(attribute.value)) return false;
      if (/url\s*\(/i.test(attribute.value) && !/^url\(#[A-Za-z_][A-Za-z0-9_-]*\)$/.test(attribute.value)) return false;
    }
  }
  return true;
}
