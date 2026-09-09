import { describe, expect, it } from 'vitest';
import { highlightCodeText } from './highlight';
import { resolveCodeFenceLanguage, resolveTextEditorLanguage } from './language';

describe('Shared document/code highlighting', () => {
  it.each([
    ['cpp', 'C++', '#include <iostream>\n// 中文\nint main() { return 42; }\n'],
    ['json', 'JSON', '{"name":"中文", "value":42, "ok":true}\n'],
    ['sh', 'Shell', 'echo "中文"\n'],
  ])('highlights %s while preserving every original character', (info, label, code) => {
    const language = resolveCodeFenceLanguage(info);
    expect(language.label).toBe(label);
    const tokens = highlightCodeText(code, language);
    expect(tokens.map(token => token.text).join('')).toBe(code);
    expect(tokens.some(token => token.className?.startsWith('tok-'))).toBe(true);
  });
  it('uses the existing registry and falls back safely for unknown or oversized code', () => {
    expect(resolveCodeFenceLanguage('c++').key).toBe(resolveTextEditorLanguage('sample.cpp').key);
    expect(resolveCodeFenceLanguage('javascript').key).toBe(resolveTextEditorLanguage('sample.js').key);
    expect(resolveCodeFenceLanguage('').label).toBe('Text');
    const code = '<script>alert(1)</script>\n';
    expect(highlightCodeText(code, resolveCodeFenceLanguage('unknown'))).toEqual([{ text: code }]);
    const large = 'x'.repeat(64001);
    expect(highlightCodeText(large, resolveCodeFenceLanguage('json'))).toEqual([{ text: large }]);
  });
});
