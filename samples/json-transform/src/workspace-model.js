import { JsonTransformError, parseJsonSource, transformJson, validateTransformInput } from './json-transform.js';

const FIELD_CHOICES = 256;
const PREVIEW_CHARACTERS = 24000;
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function describeJsonSource(text) {
  const value = parseJsonSource(text);
  const keys = new Set();
  let hasMoreFields = false;
  for (const object of Array.isArray(value) ? value : [value]) {
    if (!isRecord(object)) continue;
    for (const key of Object.keys(object)) {
      if (keys.has(key)) continue;
      if (keys.size === FIELD_CHOICES) { hasMoreFields = true; break; }
      keys.add(key);
    }
    if (hasMoreFields) break;
  }
  return {
    summary: Array.isArray(value) ? `数组 · ${value.length} 项` : `对象 · ${Object.keys(value).length} 个顶层字段`,
    fields: [...keys].map(name => ({ name, selectable: name.length > 0 && name.length <= 128 })),
    hasMoreFields,
  };
}

export function workspaceParameters(allFields, selectedFields, pretty) {
  if (!allFields && !selectedFields.length) throw new JsonTransformError('INVALID_INPUT', '请至少勾选一个字段，或选择保留全部字段。');
  const parameters = allFields ? { pretty } : { select: [...selectedFields], pretty };
  validateTransformInput(parameters);
  return parameters;
}

export function createWorkspacePreview(source, parameters) {
  const output = transformJson(source, parameters);
  let end = Math.min(output.text.length, PREVIEW_CHARACTERS);
  if (end < output.text.length && /[\uD800-\uDBFF]/.test(output.text[end - 1])) end -= 1;
  return {
    text: output.text.slice(0, end),
    truncated: end < output.text.length,
    bytes: new TextEncoder().encode(output.text).byteLength,
  };
}

export async function requestWorkspacePrepare(client, source, parameters) {
  // Reuse the Tool transformation and size check; only business parameters leave this page.
  createWorkspacePreview(source, parameters);
  validateTransformInput(parameters);
  return client.prepareWorkspaceCommand(parameters);
}
