import ExcelJS from 'exceljs';
import { readOfficeArchive } from './office-archive';
import type { AgentDocumentJob, AgentDocumentResult } from './document.types';

function scalar(cell: ExcelJS.Cell): string | number | boolean | null {
  const value = cell.type === ExcelJS.ValueType.Formula ? cell.result : cell.value;
  if (value == null) return null;
  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object' && 'error' in value) return String(value.error);
  return cell.text;
}
function cellResult(cell: ExcelJS.Cell) {
  return { address: cell.address, value: scalar(cell),
    ...(cell.type === ExcelJS.ValueType.Formula ? { formula: cell.formula, hasCachedValue: cell.result !== undefined && cell.result !== null } : {}),
  };
}

export async function processAgentSpreadsheet(job: AgentDocumentJob): Promise<AgentDocumentResult> {
  if (job.operation === 'render') throw new Error('Excel 当前提供单元格读取和查询，不提供版式截图');
  await readOfficeArchive(job.bytes, 'xl/workbook.xml');
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(Buffer.from(job.bytes) as unknown as Parameters<typeof book.xlsx.load>[0]);
  const warnings = ['公式仅返回文件内缓存值，不重新计算；没有缓存值的公式不能当作零。'];
  if (job.operation === 'inspect') return { sheets: book.worksheets.map(sheet => ({ name: sheet.name,
    rowCount: sheet.rowCount, columnCount: sheet.columnCount, state: sheet.state })), warnings };
  const sheet = job.sheet === undefined ? book.worksheets[0] : book.getWorksheet(job.sheet);
  if (!sheet) throw new Error('工作表不存在，请先 attachment.inspect 查看名称');
  if ((!sheet.rowCount || !sheet.columnCount) && !job.range && !job.aggregate && !job.filters?.length) return { text: '', sheet: sheet.name, matchedRows: 0, warnings };
  const range = job.range?.trim().toUpperCase() || `A1:${sheet.getRow(Math.max(1, sheet.rowCount)).getCell(Math.max(1, sheet.columnCount)).address}`;
  if (!/^[A-Z]{1,3}[1-9]\d{0,6}(?::[A-Z]{1,3}[1-9]\d{0,6})?$/u.test(range)) throw new Error('range 必须是 A1 或 A1:H100 形式');
  const [start, end = start] = range.split(':');
  const a = sheet.getCell(start), b = sheet.getCell(end);
  const firstRow = Number(a.row), lastRow = Number(b.row), firstColumn = Number(a.col), lastColumn = Number(b.col);
  if (firstRow > lastRow || firstColumn > lastColumn || lastRow > 1048576 || lastColumn > 16384) throw new Error('单元格范围无效');
  if ((lastRow - firstRow + 1) * (lastColumn - firstColumn + 1) > 100000) throw new Error('本次范围超过 100000 个单元格，请缩小 range');
  const column = (value: string) => {
    if (!/^[A-Z]{1,3}$/u.test(value)) throw new Error('筛选和统计列必须使用 A、B、C 等列字母');
    const index = Number(sheet.getCell(`${value}1`).col);
    if (index < firstColumn || index > lastColumn) throw new Error('筛选或统计列不在 range 内');
    return index;
  };
  const filters = (job.filters || []).map(filter => ({ ...filter, index: column(filter.column.toUpperCase()) }));
  const aggregateColumn = job.aggregate ? column(job.aggregate.column.toUpperCase()) : undefined;
  const lines: string[] = [], numeric: number[] = [];
  let matchedRows = 0, missingCachedValues = 0, excludedValues = 0, textSize = 0, unknownFilterRows = 0;
  for (let rowNumber = firstRow; rowNumber <= lastRow; rowNumber++) {
    const row = sheet.getRow(rowNumber);
    if (filters.some(filter => { const cell = row.getCell(filter.index); return cell.type === ExcelJS.ValueType.Formula && (cell.result === undefined || cell.result === null); })) {
      unknownFilterRows++; continue;
    }
    const matches = filters.every(filter => {
      const value = scalar(row.getCell(filter.index));
      if (filter.operator === 'eq') return value === filter.value;
      if (filter.operator === 'contains') return typeof value === 'string' && value.includes(String(filter.value));
      if (typeof value !== 'number' || typeof filter.value !== 'number') return false;
      return filter.operator === 'gt' ? value > filter.value : filter.operator === 'gte' ? value >= filter.value
        : filter.operator === 'lt' ? value < filter.value : value <= filter.value;
    });
    if (!matches) continue;
    matchedRows++;
    if (aggregateColumn !== undefined) {
      const cell = row.getCell(aggregateColumn), value = scalar(cell);
      if (cell.type === ExcelJS.ValueType.Formula && (cell.result === undefined || cell.result === null)) missingCachedValues++;
      else if (typeof value === 'number' && Number.isFinite(value)) numeric.push(value);
      else excludedValues++;
      continue;
    }
    const cells = [];
    for (let col = firstColumn; col <= lastColumn; col++) cells.push(cellResult(row.getCell(col)));
    const line = JSON.stringify({ row: rowNumber, cells }); textSize += line.length;
    if (textSize > 4 * 1024 * 1024) throw new Error('选定单元格内容过大，请缩小 range');
    lines.push(line);
  }
  if (unknownFilterRows) warnings.push(`${unknownFilterRows} 行筛选条件依赖无缓存公式，未参与结果，筛选统计不完整。`);
  const base = { sheet: sheet.name, range, matchedRows, unknownFilterRows, warnings };
  if (!job.aggregate) return { ...base, text: lines.join('\n') };
  const operation = job.aggregate.operation;
  let value: number | null = null;
  if (operation === 'count') value = numeric.length;
  else if (numeric.length) {
    let sum = 0, compensation = 0;
    for (const number of numeric) { const next = number - compensation, total = sum + next; compensation = (total - sum) - next; sum = total; }
    value = operation === 'sum' ? sum : operation === 'average' ? sum / numeric.length
      : numeric.reduce((current, item) => operation === 'min' ? Math.min(current, item) : Math.max(current, item));
  }
  if (missingCachedValues) warnings.push('范围内存在无缓存公式，统计结果不完整。');
  if (value !== null && !Number.isFinite(value)) throw new Error('统计结果超出有限数值范围');
  return { ...base, statistics: { operation, value, numericCount: numeric.length, missingCachedValues, excludedValues,
    complete: missingCachedValues === 0 && unknownFilterRows === 0 } };
}
