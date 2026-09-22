import { CsvToolError } from './csv-resource.js';

export const QUERY_LIMITS = Object.freeze({ rows: 100, stringChars: 4096, resultBytes: 32768 });

export function validateQueryInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some(key => !['column', 'equals', 'limit'].includes(key))) {
    throw new CsvToolError('INVALID_INPUT', '只接受 column、equals、limit 业务参数');
  }
  const filtered = Object.hasOwn(input, 'column');
  if (filtered !== Object.hasOwn(input, 'equals')
    || (filtered && (!Number.isInteger(input.column) || input.column < 0 || input.column > 127
      || typeof input.equals !== 'string' || input.equals.length > 256))
    || (Object.hasOwn(input, 'limit') && (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > QUERY_LIMITS.rows))) {
    throw new CsvToolError('INVALID_INPUT', 'column 与 equals 必须成对提供；column 为 0–127，equals 最长 256 字符，limit 为 1–100');
  }
  return { filtered, column: input.column, equals: input.equals, limit: input.limit ?? QUERY_LIMITS.rows };
}

export function queryCsvRows(rows, input) {
  const query = validateQueryInput(input);
  if (!rows.length) throw new CsvToolError('UNSUPPORTED_FORMAT', 'CSV 必须包含第一行表头');
  const headers = rows[0];
  if (query.filtered && query.column >= headers.length) throw new CsvToolError('INVALID_INPUT', 'column 超出表头范围');
  if (rows.some(row => row.length !== headers.length)) {
    throw new CsvToolError('UNSUPPORTED_FORMAT', 'CSV 数据行必须与表头拥有相同列数');
  }
  const selected = [];
  let matchedRows = 0;
  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index];
    if (query.filtered && row[query.column] !== query.equals) continue;
    matchedRows += 1;
    if (selected.length < query.limit) selected.push(row);
  }
  if ([headers, ...selected].some(row => row.some(cell => cell.length > QUERY_LIMITS.stringChars))) {
    throw new CsvToolError('FAILED', '查询结果中的单个表头或单元格超过 4096 字符');
  }
  const result = { headers, totalRows: rows.length - 1, matchedRows, rows: selected, truncated: matchedRows > selected.length };
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > QUERY_LIMITS.resultBytes) {
    throw new CsvToolError('FAILED', '查询结果超过 32768 字节，请减小 limit 或缩小筛选范围');
  }
  return result;
}
