import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ThemeButton, ThemeInput, ThemeSelectableButton, ThemeSurface, ThemeText } from './theme-foundation';

describe('theme foundation native element contracts', () => {
  it('avoids accidental form submission and allows intentional submit buttons', () => {
    const html = renderToStaticMarkup(
      <form>
        <ThemeButton $variant="quiet">取消</ThemeButton>
        <ThemeSelectableButton data-selected="true">目录</ThemeSelectableButton>
        <ThemeButton $variant="primary" type="submit" name="action" value="save">保存</ThemeButton>
      </form>,
    );

    expect(html.match(/type="button"/g)).toHaveLength(2);
    expect(html).toContain('type="submit"');
    expect(html).toContain('name="action"');
    expect(html).toContain('value="save"');
    expect(html).not.toContain('$variant');
  });

  it('keeps visual selection separate from consumer-owned accessibility semantics', () => {
    const undecorated = renderToStaticMarkup(<ThemeSelectableButton data-selected="true">目录</ThemeSelectableButton>);
    expect(undecorated).toContain('data-selected="true"');
    expect(undecorated).not.toContain('aria-pressed');
    expect(undecorated).not.toContain('aria-selected');
    expect(undecorated).not.toContain('role=');

    const html = renderToStaticMarkup(
      <ThemeSelectableButton data-selected="true" aria-pressed="true" disabled>目录</ThemeSelectableButton>,
    );
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('disabled=""');
  });

  it('preserves native input labels, validation and disabled behavior', () => {
    const html = renderToStaticMarkup(
      <ThemeInput id="folder-name" name="folderName" aria-label="目录名称" aria-invalid="true" aria-describedby="folder-error" required disabled />,
    );
    for (const attribute of ['id="folder-name"', 'name="folderName"', 'aria-label="目录名称"', 'aria-invalid="true"', 'aria-describedby="folder-error"', 'required=""', 'disabled=""']) {
      expect(html).toContain(attribute);
    }
  });

  it('lets consumers choose document semantics without leaking style-only props', () => {
    const html = renderToStaticMarkup(
      <ThemeSurface as="section" $surface="raised" aria-labelledby="sample-title">
        <ThemeText as="h2" id="sample-title" $tone="secondary">主题样板</ThemeText>
      </ThemeSurface>,
    );
    expect(html).toContain('<section');
    expect(html).toContain('aria-labelledby="sample-title"');
    expect(html).toContain('<h2 id="sample-title"');
    expect(html).not.toContain('$surface');
    expect(html).not.toContain('$tone');
  });
});
