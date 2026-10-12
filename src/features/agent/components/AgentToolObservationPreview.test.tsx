import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceVisibilityContext } from '@/components/ui/workspace-visibility';
import { previewAgentAttachment } from '../services/agent.api';
import AgentToolObservationPreview from './AgentToolObservationPreview';
import AgentAttachmentPreview from './AgentAttachmentPreview';

vi.mock('../services/agent.api', () => ({ previewAgentAttachment: vi.fn() }));
vi.mock('./AgentAttachmentPreview', () => ({ default: () => null }));

const props = {
  attachmentId: 'eddf85c3-f841-46a2-8016-2a061b58983e', alt: '内置屏幕的屏幕截图', libraryId: 3,
  ownerScope: { accountScope: 'account-7', backendScope: 'https://api.example.test' },
  sessionId: 'test-session', toolRunId: 'test-observe',
};
const renderers: TestRenderer.ReactTestRenderer[] = [];
const preview = vi.mocked(previewAgentAttachment);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => { resolve = onResolve; reject = onReject; });
  return { promise, resolve, reject };
}

function render(element = <AgentToolObservationPreview {...props} />) {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => { renderer = TestRenderer.create(element); });
  renderers.push(renderer);
  return renderer;
}

afterEach(() => {
  act(() => { renderers.splice(0).forEach(renderer => renderer.unmount()); });
  vi.resetAllMocks();
});

describe('managed Tool observation preview', () => {
  it('reads the session-bound managed PNG using the exact owner and library', async () => {
    preview.mockResolvedValue('data:image/png;base64,YQ==');
    const renderer = render();
    await act(async () => {});
    expect(preview).toHaveBeenCalledOnce();
    expect(preview).toHaveBeenCalledWith({ id: props.attachmentId, libraryId: 3, ownerScope: props.ownerScope, sessionId: 'test-session' });
    expect(renderer.root.findByType('img').props).toMatchObject({ src: 'data:image/png;base64,YQ==', alt: props.alt });
  });

  it('opens the same managed image preview used by chat attachments and can close it', async () => {
    preview.mockResolvedValue('data:image/png;base64,YQ==');
    const renderer = render();
    await act(async () => {});
    const trigger = renderer.root.findByType('button');
    expect(trigger.props['aria-label']).toBe(`预览 ${props.alt}`);
    act(() => trigger.props.onClick());
    const fullPreview = renderer.root.findByType(AgentAttachmentPreview);
    expect(fullPreview.props).toMatchObject({ attachment: {
      id: props.attachmentId, name: props.alt, kind: 'image', mimeType: 'image/png', sizeBytes: 1,
      thumbnail: 'data:image/png;base64,YQ==',
    }, scope: { ownerScope: props.ownerScope, libraryId: 3 }, sessionId: props.sessionId });
    act(() => fullPreview.props.onClose());
    expect(renderer.root.findAllByType(AgentAttachmentPreview)).toHaveLength(0);
  });

  it.each(['scope-change', 'hidden', 'unmount'] as const)('dismisses the full preview on %s without rebinding old bytes', async boundary => {
    preview.mockResolvedValue('data:image/png;base64,YQ==');
    const renderer = render(<WorkspaceVisibilityContext.Provider value><AgentToolObservationPreview {...props} /></WorkspaceVisibilityContext.Provider>);
    await act(async () => {});
    act(() => renderer.root.findByType('button').props.onClick());
    expect(renderer.root.findAllByType(AgentAttachmentPreview)).toHaveLength(1);
    if (boundary === 'unmount') {
      act(() => renderer.unmount());
      renderers.splice(renderers.indexOf(renderer), 1);
      return;
    }
    const next = boundary === 'scope-change' ? { ...props, sessionId: 'new-session' } : props;
    act(() => renderer.update(<WorkspaceVisibilityContext.Provider value={boundary !== 'hidden'}>
      <AgentToolObservationPreview {...next} />
    </WorkspaceVisibilityContext.Provider>));
    expect(renderer.root.findAllByType(AgentAttachmentPreview)).toHaveLength(0);
    await act(async () => {});
    if (boundary === 'hidden') {
      await act(async () => renderer.update(<WorkspaceVisibilityContext.Provider value><AgentToolObservationPreview {...props} /></WorkspaceVisibilityContext.Provider>));
      expect(renderer.root.findAllByType(AgentAttachmentPreview)).toHaveLength(0);
    }
  });

  it.each(['account', 'backend', 'library', 'session', 'ToolRun', 'image'])('drops the old image immediately and ignores late bytes after changing %s', async (part) => {
    const old = deferred<string>();
    const current = deferred<string>();
    preview.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    const renderer = render();
    const next = { ...props, ownerScope: { ...props.ownerScope } };
    if (part === 'account') next.ownerScope.accountScope = 'account-8';
    if (part === 'backend') next.ownerScope.backendScope = 'https://other.example.test';
    if (part === 'library') next.libraryId = 4;
    if (part === 'session') next.sessionId = 'other-session';
    if (part === 'ToolRun') next.toolRunId = 'other-tool';
    if (part === 'image') next.attachmentId = '548caa71-c24a-48d5-ad65-e93e8c348060';
    act(() => renderer.update(<AgentToolObservationPreview {...next} />));
    expect(renderer.root.findAllByType('img')).toHaveLength(0);
    await act(async () => { old.resolve('data:image/png;base64,YQ=='); });
    expect(renderer.root.findAllByType('img')).toHaveLength(0);
    await act(async () => { current.resolve('data:image/png;base64,Yg=='); });
    expect(renderer.root.findByType('img').props.src).toBe('data:image/png;base64,Yg==');
    expect(preview).toHaveBeenLastCalledWith({ id: next.attachmentId, libraryId: next.libraryId, ownerScope: next.ownerScope, sessionId: next.sessionId });
  });

  it('removes loaded bytes when owner access is lost without requesting unbound images', async () => {
    preview.mockResolvedValue('data:image/png;base64,YQ==');
    const renderer = render();
    await act(async () => {});
    expect(renderer.root.findAllByType('img')).toHaveLength(1);
    act(() => renderer.update(<AgentToolObservationPreview {...props} ownerScope={null} />));
    expect(renderer.root.findAllByType('img')).toHaveLength(0);
    expect(preview).toHaveBeenCalledOnce();
  });

  it.each([
    { ...props, ownerScope: null }, { ...props, sessionId: '' }, { ...props, libraryId: 0 },
    { ...props, attachmentId: 'https://untrusted.invalid/image.png' },
  ])('does not fetch without a valid bound image identity', (invalid) => {
    const renderer = render(<AgentToolObservationPreview {...invalid} />);
    expect(preview).not.toHaveBeenCalled();
    expect(renderer.root.findAllByType('img')).toHaveLength(0);
  });

  it('does not request or retain screenshots while the workspace is hidden', async () => {
    const pending = deferred<string>();
    preview.mockReturnValue(pending.promise);
    const renderer = render(<WorkspaceVisibilityContext.Provider value={false}><AgentToolObservationPreview {...props} /></WorkspaceVisibilityContext.Provider>);
    expect(preview).not.toHaveBeenCalled();
    act(() => renderer.update(<WorkspaceVisibilityContext.Provider value><AgentToolObservationPreview {...props} /></WorkspaceVisibilityContext.Provider>));
    expect(preview).toHaveBeenCalledOnce();
    act(() => renderer.update(<WorkspaceVisibilityContext.Provider value={false}><AgentToolObservationPreview {...props} /></WorkspaceVisibilityContext.Provider>));
    await act(async () => { pending.resolve('data:image/png;base64,YQ=='); });
    expect(renderer.toJSON()).toBeNull();
  });

  it.each(['https://untrusted.invalid/image.png', 'file:///private/screenshot.png', 'data:image/svg+xml;base64,YQ=='])('never renders a non-managed image source %s', async (url) => {
    preview.mockResolvedValue(url);
    const renderer = render();
    await act(async () => {});
    expect(renderer.root.findAllByType('img')).toHaveLength(0);
    expect(renderer.root.findByType('p').children).toEqual(['截图暂不可用']);
  });

  it('shows a bounded failure without exposing the upstream error', async () => {
    preview.mockRejectedValue(new Error('/private/path?token=secret'));
    const renderer = render();
    await act(async () => {});
    expect(renderer.root.findByType('p').children).toEqual(['截图暂不可用']);
    expect(JSON.stringify(renderer.toJSON())).not.toContain('secret');
  });
});
