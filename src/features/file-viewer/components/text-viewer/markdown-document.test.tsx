import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LibraryWorkspaceControlsContext } from '@/contexts/library-workspace-controls.context';
import MarkdownDocument from './markdown-document';

let renderer: TestRenderer.ReactTestRenderer | undefined;
afterEach(() => { act(() => renderer?.unmount()); });

function renderLink(markdown: string) {
  const openWebUrl = vi.fn();
  act(() => {
    renderer = TestRenderer.create(
      <LibraryWorkspaceControlsContext.Provider value={{ openWebUrl }}>
        <MarkdownDocument>{markdown}</MarkdownDocument>
      </LibraryWorkspaceControlsContext.Provider>,
    );
  });
  return { link: renderer!.root.findByType('a'), openWebUrl };
}

describe('Markdown document navigation', () => {
  it.each([
    '[site](https://example.test/page?q=1#section)',
    'https://example.test/page?q=1#section',
    '<https://example.test/page?q=1#section>',
  ])('opens a rendered link in the workspace browser and cancels shell navigation: %s', markdown => {
    const { link, openWebUrl } = renderLink(markdown);
    const preventDefault = vi.fn();
    link.props.onClick({ button: 0, preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(openWebUrl).toHaveBeenCalledOnce();
    expect(openWebUrl).toHaveBeenCalledWith('https://example.test/page?q=1#section');
    expect(link.props).not.toHaveProperty('node');
  });

  it.each([
    { name: 'keyboard activation', handler: 'onClick', button: 0, detail: 0 },
    { name: 'Cmd click', handler: 'onClick', button: 0, metaKey: true },
    { name: 'Ctrl click', handler: 'onClick', button: 0, ctrlKey: true },
    { name: 'middle click', handler: 'onAuxClick', button: 1 },
  ])('uses the same browser route for $name', ({ handler, ...event }) => {
    const { link, openWebUrl } = renderLink('[**nested label**](//example.test/page)');
    const preventDefault = vi.fn();
    link.props[handler]({ ...event, preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(openWebUrl).toHaveBeenCalledOnce();
    expect(openWebUrl).toHaveBeenCalledWith('https://example.test/page');
  });

  it.each(['#heading', './other.md', '/local/path', 'mailto:test@example.test', 'javascript:alert(1)', 'file:///tmp/file'])(
    'blocks unsupported links without changing the HashRouter or opening native capabilities: %s', href => {
      const { link, openWebUrl } = renderLink(`[link](${href})`);
      const preventDefault = vi.fn();
      link.props.onClick({ button: 0, preventDefault });
      expect(preventDefault).toHaveBeenCalledOnce();
      expect(openWebUrl).not.toHaveBeenCalled();
    });

  it('preserves the right click context menu without creating a tab', () => {
    const { link, openWebUrl } = renderLink('[link](https://example.test)');
    const preventDefault = vi.fn();
    link.props.onAuxClick({ button: 2, preventDefault });
    expect(preventDefault).not.toHaveBeenCalled();
    expect(openWebUrl).not.toHaveBeenCalled();
  });
});
