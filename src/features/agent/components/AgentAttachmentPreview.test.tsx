import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ImagePreview } from '@douyinfe/semi-ui';
import AgentAttachmentPreview from './AgentAttachmentPreview';
import { previewAgentAttachment } from '../services/agent.api';

vi.mock('@douyinfe/semi-ui', () => ({ ImagePreview: () => null }));
vi.mock('../services/agent.api', () => ({ previewAgentAttachment: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('Attachment image preview', () => {
  it('loads managed image content, supports closing and restores focus', async () => {
    const focus = vi.fn();
    vi.stubGlobal('document', { activeElement: { isConnected: true, focus } });
    vi.mocked(previewAgentAttachment).mockResolvedValue('data:image/png;base64,full-image');
    const onClose = vi.fn();
    const scope = { ownerScope: { accountScope: 'user:7', backendScope: 'https://test.invalid' }, libraryId: 3 };
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(<AgentAttachmentPreview
      attachment={{ id: 'img', name: 'a.png', kind: 'image', sizeBytes: 3, mimeType: 'image/png', thumbnail: 'data:image/png;base64,small' }}
      scope={scope} sessionId="session" onClose={onClose} />); });
    expect(previewAgentAttachment).toHaveBeenCalledWith({ ...scope, id: 'img', sessionId: 'session' });
    const preview = renderer.root.findByType(ImagePreview);
    expect(preview.props.src).toEqual(['data:image/png;base64,full-image']);
    expect(preview.props.closeOnEsc).toBe(true);
    expect(preview.props.maskClosable).toBe(true);
    expect(preview.props.previewStyle.backdropFilter).toBe('blur(10px)');
    expect(preview.props.previewStyle.backgroundColor).toBe('rgba(0, 0, 0, 0.7)');
    expect(preview.props.previewStyle.filter).toBeUndefined();
    act(() => preview.props.onClose());
    expect(onClose).toHaveBeenCalledOnce();
    act(() => renderer.unmount());
    expect(focus).toHaveBeenCalledOnce();
  });
});
