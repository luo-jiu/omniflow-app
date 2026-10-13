import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ImagePreview } from '@douyinfe/semi-ui';
import { WorkspaceVisibilityContext } from '@/components/ui/workspace-visibility';
import AgentAttachmentPreview from './AgentAttachmentPreview';
import { previewAgentAttachment } from '../services/agent.api';
import { createAgentComputerPointerPreview } from '../agent-computer-pointer-preview';
import type { AgentComputerPointerPlan } from '../agent-computer-pointer-plan';

vi.mock('@douyinfe/semi-ui', () => ({ ImagePreview: () => null }));
vi.mock('../services/agent.api', () => ({ previewAgentAttachment: vi.fn() }));
vi.mock('../agent-computer-pointer-preview', () => ({ createAgentComputerPointerPreview: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('Attachment image preview', () => {
  const pointerPlan: AgentComputerPointerPlan = { attachmentId: 'img', observationToolRunId: 'observe', actionToolRunId: 'action',
    width: 673, height: 439, operation: 'click', point: { x: 9, y: 53 } };
  const attachment = { id: 'img', name: 'QA.png', kind: 'image' as const, sizeBytes: 1, mimeType: 'image/png', thumbnail: 'data:image/png;base64,small' };
  const scope = { ownerScope: { accountScope: 'user:7', backendScope: 'https://test.invalid' }, libraryId: 3 };
  it('uses a display-only composite in the existing viewer without changing the original attachment', async () => {
    vi.stubGlobal('document', { activeElement: null });
    vi.mocked(previewAgentAttachment).mockResolvedValue('data:image/png;base64,original');
    vi.mocked(createAgentComputerPointerPreview).mockResolvedValue('data:image/png;base64,marked');
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(<AgentAttachmentPreview attachment={attachment}
      scope={scope} sessionId="session" pointerPlan={pointerPlan} onClose={vi.fn()} />); });
    expect(renderer.root.findByType(ImagePreview).props.src).toEqual(['data:image/png;base64,marked']);
    expect(createAgentComputerPointerPreview).toHaveBeenCalledWith('data:image/png;base64,original', pointerPlan, expect.any(AbortSignal));
    expect(attachment.thumbnail).toBe('data:image/png;base64,small');
    act(() => renderer.unmount());
  });
  it('keeps the original image when the bounded display compositor fails', async () => {
    vi.stubGlobal('document', { activeElement: null });
    vi.mocked(previewAgentAttachment).mockResolvedValue('data:image/png;base64,original');
    vi.mocked(createAgentComputerPointerPreview).mockRejectedValue(new Error('unavailable'));
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(<AgentAttachmentPreview attachment={attachment}
      scope={scope} sessionId="session" pointerPlan={pointerPlan} onClose={vi.fn()} />); });
    expect(renderer.root.findByType(ImagePreview).props.src).toEqual(['data:image/png;base64,original']);
    act(() => renderer.unmount());
  });
  it.each(['image', 'account', 'backend', 'library', 'session', 'plan', 'hidden', 'unmount'] as const)('aborts and ignores a late composite after changing %s', async boundary => {
    vi.stubGlobal('document', { activeElement: null });
    vi.mocked(previewAgentAttachment).mockResolvedValue('data:image/png;base64,original');
    let finish!: (src: string) => void;
    vi.mocked(createAgentComputerPointerPreview).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }))
      .mockResolvedValue('data:image/png;base64,new-marked');
    const onClose = vi.fn();
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(<AgentAttachmentPreview attachment={attachment}
      scope={scope} sessionId="session" pointerPlan={pointerPlan} onClose={onClose} />); });
    const signal = vi.mocked(createAgentComputerPointerPreview).mock.calls[0][2];
    const nextScope = { ...scope, ownerScope: { ...scope.ownerScope } };
    const nextAttachment = { ...attachment };
    const nextPlan = { ...pointerPlan };
    if (boundary === 'image') { nextAttachment.id = 'new-image'; nextPlan.attachmentId = 'new-image'; }
    if (boundary === 'account') nextScope.ownerScope.accountScope = 'user:8';
    if (boundary === 'backend') nextScope.ownerScope.backendScope = 'https://other.invalid';
    if (boundary === 'library') nextScope.libraryId = 4;
    if (boundary === 'plan') { nextPlan.actionToolRunId = 'new-plan'; nextPlan.point = { x: 10, y: 53 }; }
    act(() => {
      if (boundary === 'unmount') renderer.unmount();
      else if (boundary === 'hidden') renderer.update(<WorkspaceVisibilityContext.Provider value={false}>
        <AgentAttachmentPreview attachment={attachment} scope={scope} sessionId="session" pointerPlan={pointerPlan} onClose={onClose} />
      </WorkspaceVisibilityContext.Provider>);
      else renderer.update(<AgentAttachmentPreview attachment={nextAttachment} scope={nextScope}
        sessionId={boundary === 'session' ? 'other-session' : 'session'} pointerPlan={nextPlan} onClose={onClose} />);
    });
    expect(signal.aborted).toBe(true);
    await act(async () => { finish('data:image/png;base64,old-marked'); });
    if (boundary !== 'unmount') {
      expect(renderer.root.findByType(ImagePreview).props.src).toEqual([boundary === 'hidden' ? attachment.thumbnail : 'data:image/png;base64,new-marked']);
      if (boundary === 'hidden') {
        expect(onClose).toHaveBeenCalledOnce();
        expect(vi.mocked(createAgentComputerPointerPreview)).toHaveBeenCalledOnce();
      }
      act(() => renderer.unmount());
    }
  });
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
    expect(createAgentComputerPointerPreview).not.toHaveBeenCalled();
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

  it('closes when the retained agent workspace becomes inactive', async () => {
    const onClose = vi.fn();
    vi.stubGlobal('document', { activeElement: null });
    vi.mocked(previewAgentAttachment).mockResolvedValue('');
    const scope = { ownerScope: { accountScope: 'user:7', backendScope: 'https://test.invalid' }, libraryId: 3 };
    await act(async () => { TestRenderer.create(
      <WorkspaceVisibilityContext.Provider value={false}>
        <AgentAttachmentPreview
          attachment={{ id: 'img', name: 'a.png', kind: 'image', sizeBytes: 3, mimeType: 'image/png', thumbnail: 'data:image/png;base64,small' }}
          scope={scope} onClose={onClose}
        />
      </WorkspaceVisibilityContext.Provider>,
    ); });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
