import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreateFileOverlayProps, OverlayStorageProvider } from '@/service/overlay/types';

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

import CreateNodeModal from '@/features/file-explorer/components/directory-tree/modals/CreateNodeModal';
import { CreateFileOverlayAdapter } from './CreateFileOverlayAdapter';

function provider(alias: string, healthStatus?: OverlayStorageProvider['healthStatus']): OverlayStorageProvider {
  return { alias, healthStatus, type: 'minio', endpoint: '', bucket: '', label: alias, useSSL: false };
}

describe('create file overlay form', () => {
  let renderer: TestRenderer.ReactTestRenderer;
  let props: CreateFileOverlayProps;
  let onResolve: ReturnType<typeof vi.fn>;
  let onCancel: ReturnType<typeof vi.fn>;
  let windowEvents: EventTarget;

  beforeEach(() => {
    windowEvents = new EventTarget();
    vi.stubGlobal('window', windowEvents);
    props = {
      initialName: 'notes.txt',
      initialStorageProvider: '',
      defaultProvider: 'default',
      providers: [provider('default', 'ok'), provider('other', 'unknown')],
      providerLoading: false,
    };
    onResolve = vi.fn();
    onCancel = vi.fn();
  });

  afterEach(() => {
    act(() => renderer?.unmount());
    vi.unstubAllGlobals();
  });

  function render() {
    act(() => {
      renderer = TestRenderer.create(<CreateFileOverlayAdapter props={props} onResolve={onResolve} onCancel={onCancel} />);
    });
  }

  function update(nextProps: Partial<CreateFileOverlayProps>) {
    props = { ...props, ...nextProps };
    act(() => renderer.update(<CreateFileOverlayAdapter props={props} onResolve={onResolve} onCancel={onCancel} />));
  }

  function confirmButton() {
    return renderer.root.findAllByType('button').find(button => button.children.includes('确定'))!;
  }

  function pressEnter(isComposing = false) {
    const event = { key: 'Enter', nativeEvent: { isComposing }, preventDefault: vi.fn() };
    act(() => renderer.root.findByType('input').props.onKeyDown(event));
  }

  it.each([
    { providers: [provider('other', 'ok'), provider('default', 'ok')], expected: 'default' },
    { providers: [provider('default', 'error'), provider('other', 'ok')], expected: 'other' },
    { providers: [provider('unknown', 'unknown'), provider('default', 'error')], expected: 'default' },
    { providers: [provider('failed', 'error'), provider('unknown')], expected: 'unknown' },
    { providers: [provider('failed', 'error'), provider('also-failed', 'error')], expected: 'failed' },
  ])('selects $expected using health and default preference', ({ providers, expected }) => {
    props.providers = providers;
    render();
    expect(renderer.root.findByType('select').props.value).toBe(expected);
  });

  it('updates automatic provider selection without resetting the edited name', () => {
    props.providers = [provider('default', 'unknown'), provider('other', 'unknown')];
    render();
    act(() => renderer.root.findByType('input').props.onChange('edited.md'));
    update({
      initialName: 'stale snapshot.txt',
      providers: [provider('default', 'error'), provider('other', 'ok')],
    });
    expect(renderer.root.findByType('input').props.value).toBe('edited.md');
    expect(renderer.root.findByType('select').props.value).toBe('other');

    update({ providers: [provider('default', 'ok'), provider('other', 'ok')] });
    expect(renderer.root.findByType('select').props.value).toBe('other');
  });

  it('preserves a manual provider choice even when a different provider becomes healthy', () => {
    render();
    act(() => renderer.root.findByType('select').props.onChange('other'));
    update({ providers: [provider('default', 'ok'), provider('other', 'error')] });
    expect(renderer.root.findByType('select').props.value).toBe('other');
    expect(confirmButton().props.disabled).toBe(true);
    pressEnter();
    expect(onResolve).not.toHaveBeenCalled();
  });

  it('retains retry drafts and displays the creation error while health updates arrive', () => {
    props.initialName = 'retry.txt';
    props.initialStorageProvider = 'other';
    props.errorMessage = '写入失败，请重试';
    props.providers = [provider('default', 'ok'), provider('other', 'error')];
    render();
    expect(renderer.root.findByProps({ role: 'alert' }).children).toEqual(['写入失败，请重试']);
    expect(renderer.root.findByType('select').props.value).toBe('other');
    expect(confirmButton().props.disabled).toBe(true);
    act(() => renderer.root.findByType('input').props.onChange('retry-edited.txt'));
    update({
      initialName: 'old.txt',
      initialStorageProvider: 'default',
      providers: [provider('default', 'ok'), provider('other', 'ok')],
    });
    pressEnter();
    expect(onResolve).toHaveBeenCalledWith({ type: 'confirm', name: 'retry-edited.txt', storageProvider: 'other' });
  });

  it.each([
    { label: 'empty name', initialName: '  ' },
    { label: 'provider loading', providerLoading: true },
    { label: 'unknown provider', providers: [provider('default', 'unknown')] },
    { label: 'failed provider', providers: [provider('default', 'error')] },
    { label: 'missing providers', providers: [] },
    { label: 'empty provider alias', providers: [provider('', 'ok')] },
    { label: 'removed retry provider', initialStorageProvider: 'removed' },
  ])('blocks both Enter and confirm with $label', (overrides) => {
    Object.assign(props, overrides);
    render();
    expect(confirmButton().props.disabled).toBe(true);
    pressEnter();
    act(() => confirmButton().props.onClick());
    expect(onResolve).not.toHaveBeenCalled();
  });

  it('blocks both submission routes while the controlled form is loading', () => {
    act(() => {
      renderer = TestRenderer.create(
        <CreateNodeModal
          visible
          loading
          name="notes.txt"
          providers={props.providers}
          selectedProvider="default"
          onNameChange={vi.fn()}
          onConfirm={onResolve}
          onCancel={onCancel}
        />,
      );
    });
    expect(confirmButton().props.disabled).toBe(true);
    pressEnter();
    act(() => confirmButton().props.onClick());
    expect(onResolve).not.toHaveBeenCalled();
  });

  it('ignores IME confirmation and settles only once across repeated submit and cancel events', () => {
    render();
    pressEnter(true);
    expect(onResolve).not.toHaveBeenCalled();
    pressEnter();
    act(() => {
      confirmButton().props.onClick();
      renderer.root.findByProps({ 'aria-label': '关闭' }).props.onClick();
    });
    expect(onResolve).toHaveBeenCalledTimes(1);
    expect(onResolve).toHaveBeenCalledWith({ type: 'confirm', name: 'notes.txt', storageProvider: 'default' });
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('cancels on Escape once and removes the listener when the form unmounts', () => {
    render();
    const event = Object.assign(new Event('keydown', { cancelable: true }), { key: 'Escape' });
    act(() => { windowEvents.dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(true);
    act(() => renderer.root.findByProps({ 'aria-label': '关闭' }).props.onClick());
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onResolve).not.toHaveBeenCalled();

    onCancel.mockClear();
    act(() => renderer.unmount());
    const afterUnmount = Object.assign(new Event('keydown', { cancelable: true }), { key: 'Escape' });
    windowEvents.dispatchEvent(afterUnmount);
    expect(afterUnmount.defaultPrevented).toBe(false);
    expect(onCancel).not.toHaveBeenCalled();
  });
});
