import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { xlsxFixture } from './office-fixtures';
import { processAgentDocument } from './document-engine';

describe('spreadsheet attachment processing', () => {
  it('honors explicit ranges on empty sheets and counts only numeric values', async () => {
    const book = new ExcelJS.Workbook(); book.addWorksheet('Empty');
    const bytes = Buffer.from(await book.xlsx.writeBuffer());
    const result = await processAgentDocument({ format: 'xlsx', operation: 'query', bytes, range: 'A1:B2', aggregate: { column: 'B', operation: 'count' } });
    expect(result).toMatchObject({ range: 'A1:B2', matchedRows: 2, statistics: { value: 0, excludedValues: 2, complete: true } });
    await expect(processAgentDocument({ format: 'xlsx', operation: 'read', bytes, range: 'bad' })).rejects.toThrow('range');
  });
  it('lists sheets, preserves formulas, zero caches and missing caches', async () => {
    const bytes = await xlsxFixture();
    const info = await processAgentDocument({ format: 'xlsx', operation: 'inspect', bytes });
    expect(info.sheets).toEqual(expect.arrayContaining([expect.objectContaining({ name: '销售', rowCount: 5 }), expect.objectContaining({ name: 'Hidden', state: 'hidden' })]));
    const read = await processAgentDocument({ format: 'xlsx', operation: 'read', bytes, sheet: '销售', range: 'A2:C5' });
    const rows = read.text!.split('\n').map(line => JSON.parse(line));
    expect(rows[0].cells[2]).toMatchObject({ address: 'C2', formula: 'B2*10', value: 20, hasCachedValue: true });
    expect(rows[2].cells[2]).toMatchObject({ address: 'C4', value: null, hasCachedValue: false });
    expect(rows[3].cells[2]).toMatchObject({ address: 'C5', value: 0, hasCachedValue: true });
  });
  it('filters and aggregates exact numeric cells while marking incomplete caches', async () => {
    const bytes = await xlsxFixture();
    const result = await processAgentDocument({ format: 'xlsx', operation: 'query', bytes, sheet: '销售', range: 'A2:C3',
      filters: [{ column: 'B', operator: 'gte', value: 2 }], aggregate: { column: 'C', operation: 'sum' } });
    expect(result).toMatchObject({ matchedRows: 2, statistics: { value: 50, numericCount: 2, complete: true } });
    const incomplete = await processAgentDocument({ format: 'xlsx', operation: 'query', bytes, sheet: '销售', range: 'A2:C5', aggregate: { column: 'C', operation: 'sum' } });
    expect(incomplete.statistics).toMatchObject({ value: 50, numericCount: 3, missingCachedValues: 1, complete: false });
    const filter = await processAgentDocument({ format: 'xlsx', operation: 'query', bytes, sheet: '销售', range: 'A2:C5', filters: [{ column: 'C', operator: 'gt', value: 0 }] });
    expect(filter).toMatchObject({ matchedRows: 2, unknownFilterRows: 1 });
    await expect(processAgentDocument({ format: 'xlsx', operation: 'read', bytes, sheet: 'missing' })).rejects.toThrow('工作表不存在');
    await expect(processAgentDocument({ format: 'xlsx', operation: 'read', bytes, range: 'A1:XFD1048576' })).rejects.toThrow('100000');
  });
});
