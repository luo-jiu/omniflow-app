export const CSV_LIMITS = Object.freeze({ bytes: 4194304, rows: 10000, columns: 128, cells: 100000, cellChars: 16384 });
export function createCsvParser(limits = CSV_LIMITS) {
  const rows = []; let row = []; let field = ''; let state = 'start'; let first = true; let skipLF = false; let touched = false; let cells = 0; let finished = false;
  function pushField() { if (row.length >= limits.columns || ++cells > limits.cells) throw new Error('CSV 列数或单元格总数超过限制'); row.push(field); field = ''; state = 'start'; }
  function pushRow() { pushField(); if (rows.length >= limits.rows) throw new Error('CSV 行数超过限制'); rows.push(row); row = []; touched = false; }
  return {
    write(text) {
      if (finished) throw new Error('CSV 解析已结束');
      for (const char of text) {
        if (first) { first = false; if (char === '\uFEFF') continue; }
        if (skipLF) { skipLF = false; if (char === '\n') continue; }
        touched = true;
        if (state === 'quoted') { if (char === '"') state = 'afterQuote'; else field += char; }
        else if (state === 'afterQuote' && char === '"') { field += '"'; state = 'quoted'; }
        else if (char === ',') pushField();
        else if (char === '\r' || char === '\n') { pushRow(); skipLF = char === '\r'; }
        else if (char === '"' && state === 'start') state = 'quoted';
        else if (state === 'afterQuote' || char === '"') throw new Error('CSV 引号格式错误');
        else { field += char; state = 'plain'; }
        if (field.length > limits.cellChars) throw new Error('CSV 单元格长度超过限制');
      }
    },
    finish() { if (finished) throw new Error('CSV 解析已结束'); finished = true; if (state === 'quoted') throw new Error('CSV 引号未闭合'); if (touched || row.length || field) pushRow(); return rows; },
  };
}
