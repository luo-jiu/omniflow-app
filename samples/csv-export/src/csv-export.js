import { CsvToolError } from './csv-resource.js';

export const EXPORT_MAX_BYTES = 1048576;
export function validateExportInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some(key => !['format', 'column', 'equals'].includes(key))
    || !['csv', 'json'].includes(input.format)) throw new CsvToolError('INVALID_INPUT', '只接受format、column、equals业务参数');
  const filtered = Object.hasOwn(input, 'column');
  if (filtered !== Object.hasOwn(input, 'equals') || (filtered && (!Number.isInteger(input.column) || input.column < 0 || input.column > 127
    || typeof input.equals !== 'string' || input.equals.length > 256))) throw new CsvToolError('INVALID_INPUT', 'column与equals必须成对提供，column从0开始');
  return { format: input.format, filtered, column: input.column, equals: input.equals };
}

export function createCsvExport(rows, input, maxBytes = EXPORT_MAX_BYTES) {
  const query = validateExportInput(input);
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > EXPORT_MAX_BYTES) throw new CsvToolError('FAILED', '产物预算无效');
  if (!rows.length) throw new CsvToolError('UNSUPPORTED_FORMAT', 'CSV必须包含表头');
  const headers = rows[0];
  if (query.filtered && query.column >= headers.length) throw new CsvToolError('INVALID_INPUT', 'column超出表头范围');
  if (rows.some(row => row.length !== headers.length)) throw new CsvToolError('UNSUPPORTED_FORMAT', 'CSV数据行列数与表头不一致');
  const selected = rows.slice(1).filter(row => !query.filtered || row[query.column] === query.equals);
  const escapeCell = cell => /[",\r\n]/u.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell;
  const text = query.format === 'json' ? JSON.stringify({ headers, rows: selected })
    : [headers, ...selected].map(row => row.map(escapeCell).join(',')).join('\r\n') + '\r\n';
  if (!text || new TextEncoder().encode(text).byteLength > maxBytes) throw new CsvToolError('FAILED', '完整导出超过产物上限，未生成截断文件');
  return { mediaType: query.format === 'json' ? 'application/json' : 'text/csv', text };
}
