import { afterEach, describe, expect, it, vi } from 'vitest';
import { openOverlay, openOverlaySession } from './overlay.api';

describe('overlay api', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps the one-shot overlay API unchanged', async () => {
    const open = vi.fn().mockResolvedValue({ type: 'cancel' });
    vi.stubGlobal('window', {
      electronOverlay: { open, update: vi.fn() },
    });

    await expect(openOverlay('delete-confirm', {
      deleteCount: 1,
      isFolder: false,
      nodeName: 'demo.txt',
    })).resolves.toEqual({ type: 'cancel' });
    expect(open).toHaveBeenCalledWith('delete-confirm', {
      deleteCount: 1,
      isFolder: false,
      nodeName: 'demo.txt',
    });
  });

  it('uses one request id for a controlled overlay result and prop updates', async () => {
    const open = vi.fn().mockResolvedValue({ type: 'close' });
    const update = vi.fn().mockResolvedValue(true);
    vi.stubGlobal('window', {
      electronOverlay: { open, update },
    });

    const initialProps = {
      fullName: 'demo',
      icon: {
        archiveMode: 0,
        builtInType: 'DEF',
        ext: '',
        fileName: 'demo',
        mimeType: '',
        nodeType: 'dir' as const,
        parentArchiveMode: 0,
        parentBuiltInType: 'DEF',
      },
      sections: [],
      title: '文件夹属性',
    };
    const session = openOverlaySession('node-properties', initialProps);
    const requestId = open.mock.calls[0]?.[2];

    expect(requestId).toMatch(/^[0-9a-f-]{36}$/i);
    await expect(session.updateProps({
      ...initialProps,
      sections: [{ title: '基本信息', items: [{ label: '大小', value: '1 KB' }] }],
    })).resolves.toBe(true);
    expect(update).toHaveBeenCalledWith(requestId, expect.objectContaining({
      sections: [{ title: '基本信息', items: [{ label: '大小', value: '1 KB' }] }],
    }));
    await expect(session.result).resolves.toEqual({ type: 'close' });
  });
});
