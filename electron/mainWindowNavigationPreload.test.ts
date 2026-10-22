import { expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ expose: vi.fn(), invoke: vi.fn(), on: vi.fn(), removeListener: vi.fn() }));
vi.mock('electron', () => ({ contextBridge: { exposeInMainWorld: mocks.expose },
  ipcRenderer: { invoke: mocks.invoke, on: mocks.on, removeListener: mocks.removeListener } }));
import './preload';

it('projects shell web URLs without exposing Electron events and removes its listener', () => {
  const bridge = mocks.expose.mock.calls.find(call => call[0] === 'electronEmbeddedBrowser')![1];
  const listener = vi.fn();
  const unsubscribe = bridge.onOpenWebUrl(listener);
  const [channel, wrapped] = mocks.on.mock.calls.at(-1)!;
  expect(channel).toBe('app:open-web-url');
  wrapped({ sender: 'private-event' }, { url: 'https://example.test/' });
  expect(listener).toHaveBeenCalledOnce();
  expect(listener).toHaveBeenCalledWith({ url: 'https://example.test/' });
  unsubscribe();
  expect(mocks.removeListener).toHaveBeenCalledOnce();
  expect(mocks.removeListener).toHaveBeenCalledWith(channel, wrapped);
});
