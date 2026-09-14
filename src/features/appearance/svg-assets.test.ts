import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateIconSvg } from './svg-assets';

describe('declarative SVG assets', () => {
  it('validates both built-in directory packs', () => {
    for (const dir of ['outline-folders', 'material']) {
      const directory = new URL(`../../assets/icons/${dir}/`, import.meta.url);
      const files = readdirSync(directory).filter(name => dir === 'outline-folders' || /^folder-(base|comic|asmr|video|audio|gallery)(-archive)?(-open)?\.svg$/.test(name));
      expect(files.length).toBeGreaterThanOrEqual(22);
      for (const file of files) expect(validateIconSvg(readFileSync(new URL(file, directory), 'utf8')), file).toBe(true);
    }
  });
  it.each([
    '<svg><script>alert(1)</script></svg>', '<svg onload="alert(1)"/>', '<svg><image href="https://example.invalid/x"/></svg>',
    '<svg><foreignObject/></svg>', '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///private">]><svg/>',
    '<svg><path fill="url(https://example.invalid/x)"/></svg>', '<svg><path style="fill:red"/></svg>',
    '<svg xmlns="https://example.invalid"/>', '<svg><use href="#x"/></svg>',
  ])('rejects active or external SVG content', source => { expect(validateIconSvg(source)).toBe(false); });
});
