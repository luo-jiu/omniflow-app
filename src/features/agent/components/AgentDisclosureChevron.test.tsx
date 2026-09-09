import { renderToStaticMarkup } from 'react-dom/server';
import { ServerStyleSheet } from 'styled-components';
import { describe, expect, it } from 'vitest';
import AgentDisclosureChevron from './AgentDisclosureChevron';

describe('Agent shared disclosure chevron', () => {
  it('uses one-pixel strokes centered on the text line and rotates without changing its box', () => {
    const sheet = new ServerStyleSheet();
    try {
      const markup = renderToStaticMarkup(sheet.collectStyles(<AgentDisclosureChevron expanded />));
      expect(markup).toContain('stroke-width="1"');
      expect(markup).toContain('points="4,4 8,8 4,12"');
      expect(markup).toContain('aria-hidden="true"');
      const css = sheet.getStyleTags();
      expect(css).toContain('transform-origin:6px 8px');
      expect(css).toContain('height:20px');
      expect(css).toContain('rotate(90deg)');
      expect(css).toContain('prefers-reduced-motion: reduce');
    } finally { sheet.seal(); }
  });
});
