import TestRenderer, { act } from 'react-test-renderer';
import { renderToStaticMarkup } from 'react-dom/server';
import { ServerStyleSheet } from 'styled-components';
import { describe, expect, it, vi } from 'vitest';
import { AgentAttachmentStrip, AgentMessageAttachments } from './AgentAttachmentStrip';
import type { AgentAttachmentDraft } from '../hooks/useAgentAttachments';
vi.mock('./AgentAttachmentPreview', () => ({ default: ({ onClose }: { onClose: () => void }) => <button aria-label="关闭图片预览" onClick={onClose} /> }));

const entries: AgentAttachmentDraft[] = [
  { key: 'image', name: '截图.png', size: 1, attachment: { id: 'image', name: '截图.png', kind: 'image', mimeType: 'image/png', sizeBytes: 1, thumbnail: 'data:image/png;base64,test' } },
  { key: 'file', name: '非常长的文件名称用于检查省略效果.txt', size: 1, attachment: { id: 'file', name: '非常长的文件名称用于检查省略效果.txt', kind: 'text', mimeType: 'text/plain', sizeBytes: 1 } },
];

describe('Agent attachment presentation', () => {
  it('opens a ready image preview and keeps removal separate from preview', () => {
    const remove = vi.fn();
    const renderer = TestRenderer.create(<AgentAttachmentStrip entries={entries} onRemove={remove}
      scope={{ ownerScope: { accountScope: 'user:7', backendScope: 'https://test.invalid' }, libraryId: 3 }} />);
    act(() => renderer.root.findByProps({ 'aria-label': '预览 截图.png' }).props.onClick());
    expect(renderer.root.findByProps({ 'aria-label': '关闭图片预览' })).toBeTruthy();
    expect(remove).not.toHaveBeenCalled();
    act(() => renderer.root.findByProps({ 'aria-label': '关闭图片预览' }).props.onClick());
    expect(renderer.root.findAllByProps({ 'aria-label': '关闭图片预览' })).toHaveLength(0);
    renderer.unmount();
  });
  it('omits image captions, places filenames in the file row, and retains removal', () => {
    const remove = vi.fn();
    const renderer = TestRenderer.create(<AgentAttachmentStrip entries={entries} onRemove={remove} />);
    const cards = renderer.root.findAllByProps({ className: 'attachment' });
    expect(cards[0].props['data-kind']).toBe('image');
    expect(cards[0].findAllByProps({ className: 'attachment-name' })).toHaveLength(0);
    expect(cards[1].findByProps({ className: 'attachment-visual' }).findByProps({ className: 'attachment-name' }).children).toEqual([entries[1].name]);
    act(() => renderer.root.findByProps({ 'aria-label': `移除 ${entries[1].name}` }).props.onClick());
    expect(remove).toHaveBeenCalledWith('file');
    renderer.unmount();
  });
  it('reserves image geometry while importing and leaves errors visible', () => {
    const renderer = TestRenderer.create(<AgentAttachmentStrip entries={[{ key: 'pending', name: 'a.png', size: 1, previewKind: 'image', error: '准备失败' }]} onRemove={vi.fn()} />);
    expect(renderer.root.findByProps({ className: 'attachment' }).props['data-kind']).toBe('image');
    expect(renderer.root.findByProps({ role: 'alert' }).children).toEqual(['准备失败']);
    renderer.unmount();
    const history = TestRenderer.create(<AgentMessageAttachments attachments={entries.map(entry => entry.attachment!)} />);
    expect(history.root.findAllByType('button')).toHaveLength(0);
    history.unmount();
  });
  it('uses a single horizontal row, shared scrollbars and a two-to-one width ratio', () => {
    const sheet = new ServerStyleSheet();
    try {
      renderToStaticMarkup(sheet.collectStyles(<AgentAttachmentStrip entries={entries} onRemove={vi.fn()} />));
      const css = sheet.getStyleTags();
      expect(css).toContain('padding:10px 10px 0');
      expect(css).toContain('gap:10px');
      expect(css).toContain('flex-wrap:nowrap');
      expect(css).toContain('flex:0 0 164px');
      expect(css).toContain('flex-basis:82px');
      expect(css).toContain('overflow-x:auto');
      expect(css).toContain('text-overflow:ellipsis');
      expect(css).toContain('--app-scrollbar-thumb');
    } finally { sheet.seal(); }
  });
});
