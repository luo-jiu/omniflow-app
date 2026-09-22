export class JsonTransformError extends Error {
  constructor(code, message) { super(message); this.name = 'JsonTransformError'; this.code = code; }
}

const MAX_FIELDS = 64;
const MAX_KEY_LENGTH = 128;
const MAX_OUTPUT_BYTES = 1048576;
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

export function validateTransformInput(input) {
  if (!isRecord(input) || Object.keys(input).some(key => !['resource', 'destination', 'select', 'pretty'].includes(key))) {
    throw new JsonTransformError('INVALID_INPUT', '只接受 resource、destination、select、pretty');
  }
  const resource = input.resource;
  const destination = input.destination;
  if (!isRecord(resource) || Object.keys(resource).length !== 1 || !Number.isSafeInteger(resource.nodeId) || resource.nodeId < 1
    || !isRecord(destination) || Object.keys(destination).length !== 2 || !Number.isSafeInteger(destination.parentId) || destination.parentId < 1
    || typeof destination.fileName !== 'string' || !destination.fileName || !destination.fileName.endsWith('.json')) {
    throw new JsonTransformError('INVALID_INPUT', 'resource、destination 或 JSON 文件名无效');
  }
  if (input.select !== undefined && (!Array.isArray(input.select) || input.select.length > MAX_FIELDS
    || new Set(input.select).size !== input.select.length || input.select.some(key => typeof key !== 'string' || !key || key.length > MAX_KEY_LENGTH))) {
    throw new JsonTransformError('INVALID_INPUT', 'select 字段列表无效');
  }
  if (input.pretty !== undefined && typeof input.pretty !== 'boolean') throw new JsonTransformError('INVALID_INPUT', 'pretty 必须是布尔值');
  return { select: input.select, pretty: input.pretty === true };
}

function project(value, select) {
  if (!select?.length) return value;
  if (Array.isArray(value)) return value.map(item => isRecord(item) ? project(item, select) : item);
  if (!isRecord(value)) throw new JsonTransformError('INVALID_INPUT', 'select 只支持对象或对象数组');
  return Object.fromEntries(select.filter(key => own(value, key)).map(key => [key, value[key]]));
}

export function transformJson(text, input, maxBytes = MAX_OUTPUT_BYTES) {
  const options = validateTransformInput(input);
  if (typeof text !== 'string' || !text.trim()) throw new JsonTransformError('UNSUPPORTED_FORMAT', 'JSON 文件不能为空');
  let value;
  try { value = JSON.parse(text); } catch { throw new JsonTransformError('UNSUPPORTED_FORMAT', 'JSON 格式无效'); }
  if (value === null || (typeof value !== 'object')) throw new JsonTransformError('UNSUPPORTED_FORMAT', 'JSON 根必须是对象或数组');
  const result = project(value, options.select);
  const output = JSON.stringify(result, null, options.pretty ? 2 : 0);
  const bytes = new TextEncoder().encode(output);
  if (!bytes.byteLength || bytes.byteLength > Math.min(maxBytes, MAX_OUTPUT_BYTES)) throw new JsonTransformError('FAILED', '完整 JSON 产物超过大小上限');
  return { mediaType: 'application/json', text: output };
}
