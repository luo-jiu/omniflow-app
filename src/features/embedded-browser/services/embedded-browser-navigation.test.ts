import { afterEach, expect, it, vi } from 'vitest';
import { subscribeWebUrlRequests } from './embedded-browser-navigation';

afterEach(() => vi.unstubAllGlobals());

it('validates shell requests and releases the bridge subscription when the workspace leaves', () => {
  let receive!: (payload: { url: string }) => void;
  const unsubscribe = vi.fn();
  const onOpenWebUrl = vi.fn(listener => { receive = listener; return unsubscribe; });
  vi.stubGlobal('window', { electronEmbeddedBrowser: { onOpenWebUrl } });
  const open = vi.fn();
  const dispose = subscribeWebUrlRequests(open);
  receive({ url: 'http://localhost:8849/path' });
  receive({ url: 'javascript:alert(1)' });
  receive({ url: '/app-route' });
  expect(open).toHaveBeenCalledOnce();
  expect(open).toHaveBeenCalledWith('http://localhost:8849/path');
  dispose();
  expect(unsubscribe).toHaveBeenCalledOnce();
});
