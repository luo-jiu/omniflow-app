import { renderToStaticMarkup } from 'react-dom/server';
import { ServerStyleSheet } from 'styled-components';
import { describe, expect, it } from 'vitest';
import AgentActivityText from './AgentActivityText';

describe('Agent activity text', () => {
  it('paints a left-to-right text sweep with reduced-motion and forced-color fallbacks', () => {
    const sheet = new ServerStyleSheet();
    try {
      const html = renderToStaticMarkup(sheet.collectStyles(<AgentActivityText $active>正在读取 a.txt</AgentActivityText>));
      const css = sheet.getStyleTags();
      expect(html).toContain('正在读取 a.txt');
      expect(html).not.toContain('$active');
      expect(css).toContain('background-color:var(--app-text-muted)');
      expect(css).toContain('background-position:100% 0');
      expect(css).toContain('background-position:-100% 0');
      expect(css).toMatch(/prefers-reduced-motion:\s*reduce/);
      expect(css).toMatch(/forced-colors:\s*active/);
      expect(css).toContain('-webkit-text-fill-color:currentColor');
    } finally { sheet.seal(); }
  });
  it('does not animate completed text', () => {
    const sheet = new ServerStyleSheet();
    try {
      renderToStaticMarkup(sheet.collectStyles(<AgentActivityText>已读取 a.txt</AgentActivityText>));
      const css = sheet.getStyleTags();
      expect(css).not.toContain('@keyframes');
      expect(css).not.toContain('linear-gradient');
    } finally { sheet.seal(); }
  });
});
