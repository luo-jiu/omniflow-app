import { describe, expect, it } from 'vitest';
import { createCsvParser, CSV_LIMITS } from './csv-parser.js';
function parse(text, split = text.length || 1) { const parser = createCsvParser(); for (let i=0;i<text.length;i+=split) parser.write(text.slice(i,i+split)); return parser.finish(); }
describe('independent streaming CSV parser', () => {
  it.each([1,2,3,7,100])('preserves BOM, CRLF, escaped quotes, multiline and empty fields at chunk size %i', split => {
    expect(parse('\uFEFFa,"b\r\nc","d""e",\r\n1,,3,',split)).toEqual([['a','b\r\nc','d"e',''],['1','','3','']]);
  });
  it('does not add a phantom final row and distinguishes empty input', () => { expect(parse('')).toEqual([]); expect(parse('\n')).toEqual([['']]); expect(parse('""')).toEqual([['']]); expect(parse('a\r\n')).toEqual([['a']]); });
  it.each(['a"b', '"a"b', '"unterminated'])('rejects malformed CSV %s', text => { expect(()=>parse(text,1)).toThrow(); });
  it('enforces limits on final rows/columns/fields and across chunks', () => {
    for (const text of ['x'.repeat(CSV_LIMITS.cellChars+1), ','.repeat(CSV_LIMITS.columns), '\n'.repeat(CSV_LIMITS.rows+1)]) expect(()=>parse(text,7)).toThrow();
    const parser=createCsvParser({...CSV_LIMITS,cells:2}); parser.write('a,b'); expect(()=>{parser.write('\nc');parser.finish()}).toThrow();
  });
  it('preserves formulas and HTML as uninterpreted strings',()=>{expect(parse('=1+1,<script>x</script>')).toEqual([['=1+1','<script>x</script>']]);});
});
