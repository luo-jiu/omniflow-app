import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreateFileOverlayProps } from '@/service/overlay/types';

vi.mock('@douyinfe/semi-icons', () => ({
  IconChevronDownStroked: () => null,
  IconCrossStroked: () => null,
}));
vi.mock('@douyinfe/semi-ui', () => ({
  Input: (props: any) => <input {...props} />,
  Select: Object.assign(
    (props: any) => <select {...props} />,
    { Option: (props: any) => <option {...props} /> },
  ),
}));
vi.mock('./registry', async () => {
  const { CreateFileOverlayAdapter } = await import('./components/CreateFileOverlayAdapter');
  return { overlayRegistry: { 'create-file': { component: CreateFileOverlayAdapter } } };
});

import { OverlayHost } from './OverlayHost';

type CreateSpec = { requestId: string; type: 'create-file'; props: CreateFileOverlayProps };

function spec(requestId: string, initialName = 'notes.txt'): CreateSpec {
  return {
    requestId,
    type: 'create-file',
    props: {
      initialName,
      initialStorageProvider: '',
      defaultProvider: 'default',
      providerLoading: false,
      providers: ['default', 'other'].map(alias => ({
        alias, healthStatus: 'ok', type: 'minio', endpoint: '', bucket: '', label: alias, useSSL: false,
      })),
    },
  };
}

describe('overlay host form request lifetime', () => {
  let renderer: TestRenderer.ReactTestRenderer;
  let show: (value: CreateSpec) => void;
  let update: (value: Pick<CreateSpec, 'requestId' | 'props'>) => void;
  let resolve: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resolve = vi.fn();
    vi.stubGlobal('window', Object.assign(new EventTarget(), {
      electronOverlayHost: {
        onShow: (callback: typeof show) => { show = callback; return vi.fn(); },
        onUpdate: (callback: typeof update) => { update = callback; return vi.fn(); },
        onDismissFromMain: () => vi.fn(),
        reportReady: vi.fn(),
        resolve,
      },
    }));
    act(() => { renderer = TestRenderer.create(<OverlayHost />); });
  });

  afterEach(() => {
    act(() => renderer.unmount());
    vi.unstubAllGlobals();
  });

  function confirmButton() {
    return renderer.root.findAllByType('button').find(button => button.children.includes('确定'))!;
  }

  it('keeps edits and manual selection when the active request receives new props', () => {
    const first = spec('request-a');
    act(() => show(first));
    act(() => {
      renderer.root.findByType('input').props.onChange('edited.md');
      renderer.root.findByType('select').props.onChange('other');
    });

    act(() => update({
      requestId: first.requestId,
      props: {
        ...first.props,
        initialName: 'stale snapshot.txt',
        providers: first.props.providers.map(provider => ({
          ...provider,
          healthStatus: provider.alias === 'other' ? 'error' : 'ok',
        })),
      },
    }));
    expect(renderer.root.findByType('input').props.value).toBe('edited.md');
    expect(renderer.root.findByType('select').props.value).toBe('other');
    expect(confirmButton().props.disabled).toBe(true);
    expect(resolve).not.toHaveBeenCalled();
  });

  it('starts a fresh form and submission guard for a consecutive request in the same React batch', () => {
    act(() => show(spec('request-a')));
    act(() => {
      renderer.root.findByType('input').props.onChange('old-draft.md');
      renderer.root.findByType('select').props.onChange('other');
    });

    act(() => {
      confirmButton().props.onClick();
      show(spec('request-b', 'fresh.txt'));
    });
    expect(renderer.root.findByType('input').props.value).toBe('fresh.txt');
    expect(renderer.root.findByType('select').props.value).toBe('default');
    act(() => confirmButton().props.onClick());
    expect(resolve.mock.calls).toEqual([
      ['request-a', { type: 'confirm', name: 'old-draft.md', storageProvider: 'other' }],
      ['request-b', { type: 'confirm', name: 'fresh.txt', storageProvider: 'default' }],
    ]);
  });
});
