import { renderToStaticMarkup } from 'react-dom/server';
import { ServerStyleSheet } from 'styled-components';
import { describe, expect, it } from 'vitest';
import OutlineIcon from './outline-icon';

describe('Workspace outline icons', () => {
  it.each(['copy', 'history', 'bookmark', 'plus', 'home', 'upload', 'trash', 'settings', 'star', 'activity', 'wrench', 'agent', 'folder', 'tools', 'browser', 'refresh', 'back', 'forward'] as const)(
    'renders %s as a decorative 16px outline with stable physical stroke width', name => {
      const sheet = new ServerStyleSheet();
      try {
        const html = renderToStaticMarkup(sheet.collectStyles(<OutlineIcon name={name} />));
        expect(html).toContain('width="16"');
        expect(html).toContain('height="16"');
        expect(html).toContain('stroke-width="1.25"');
        expect(html).toContain('fill="none"');
        expect(html).toContain('aria-hidden="true"');
        expect(html).toContain('focusable="false"');
        const css = sheet.getStyleTags();
        expect(css).toContain('vector-effect:non-scaling-stroke');
        expect(css).toContain('color:inherit;fill:none');
        expect(css).toContain('transition:none');
        expect(css).toContain('button:has(');
        expect(css).not.toContain('scale(');
      } finally { sheet.seal(); }
    },
  );
});
