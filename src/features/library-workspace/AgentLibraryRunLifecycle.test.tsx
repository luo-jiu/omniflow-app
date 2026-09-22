import { StrictMode, type DependencyList, type EffectCallback } from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { MemoryRouter, useNavigate, type NavigateFunction } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextType } from '@/contexts/auth.context';
import AgentLibraryRunLifecycle from './AgentLibraryRunLifecycle';

const mocks = vi.hoisted(() => ({ release: vi.fn(), warn: vi.fn(), replayEffects: false,
  api: { BASE_URL: 'https://backend.test/api' } }));
vi.mock('@/features/agent/services/agent.api', () => ({ releaseAgentOwnerRuns: mocks.release }));
vi.mock('@/utils/runtimeLogger', () => ({ runtimeLogger: { warn: mocks.warn } }));
vi.mock('@/config/api', () => ({ API_CONFIG: mocks.api }));
vi.mock('react', async importOriginal => {
  const react = await importOriginal<typeof import('react')>();
  return { ...react, useLayoutEffect: (setup: EffectCallback, deps?: DependencyList) => react.useLayoutEffect(() => {
    const cleanup = setup();
    if (!mocks.replayEffects) return cleanup;
    // react-test-renderer does not replay StrictMode effects itself; reproduce
    // setup -> cleanup -> setup with the same committed refs deterministically.
    cleanup?.();
    return setup();
  }, deps) };
});

const mounted: TestRenderer.ReactTestRenderer[] = [];
function harness(initialPath = '/libraries/3') {
  let navigate!: NavigateFunction;
  let userId: number | null = 7;
  let mode = 'agent';
  function Navigation() { navigate = useNavigate(); return <span>{mode}</span>; }
  const tree = () => {
    const context: AuthContextType = { user: userId ? { id: userId, username: 'test-user' } : null,
      isLoggedIn: userId !== null, loading: false, login: vi.fn(), logout: vi.fn(), register: vi.fn(), setUserInfo: vi.fn() };
    return <StrictMode><MemoryRouter initialEntries={[initialPath]}><AuthContext.Provider value={context}>
      <AgentLibraryRunLifecycle /><Navigation />
    </AuthContext.Provider></MemoryRouter></StrictMode>;
  };
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => { renderer = TestRenderer.create(tree()); });
  mounted.push(renderer);
  return {
    navigate(path: string) { act(() => { navigate(path); }); },
    changeUser(id: number | null) { userId = id; act(() => renderer.update(tree())); },
    changeMode(value: string) { mode = value; act(() => renderer.update(tree())); },
    rerender() { act(() => renderer.update(tree())); },
    unmount() { act(() => renderer.unmount()); },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.api.BASE_URL = 'https://backend.test/api';
  mocks.replayEffects = false;
  mocks.release.mockResolvedValue(true);
  vi.stubGlobal('window', { electronAgent: {} });
});
afterEach(() => {
  act(() => { for (const renderer of mounted.splice(0)) renderer.unmount(); });
  vi.unstubAllGlobals();
});

describe('library workspace Agent Run lifecycle', () => {
  it('does not stop on initial mount, StrictMode effect replay or same-scope remount', () => {
    mocks.replayEffects = true;
    const first = harness();
    first.rerender();
    first.unmount();
    const remount = harness();
    expect(mocks.release).not.toHaveBeenCalled();
    remount.navigate('/libraries/4');
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it('keeps main Runs alive through modes and query/hash changes inside the same workspace', () => {
    const view = harness();
    for (const mode of ['viewer', 'browser', 'tools', 'settings', 'agent']) view.changeMode(mode);
    view.navigate('/libraries/3?mode=viewer#tab');
    view.navigate('/libraries/3/');
    expect(mocks.release).not.toHaveBeenCalled();
  });

  it.each(['/libraries', '/settings', '/libraries/3/recycle-bin'])('stops the departing library owner on %s', path => {
    const view = harness();
    view.navigate(path);
    expect(mocks.release).toHaveBeenCalledOnce();
    view.navigate('/profile');
    view.navigate('/libraries/3');
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it('stops on a real library change while repeated renders do not resend the release', () => {
    const view = harness();
    view.navigate('/libraries/4');
    view.rerender();
    expect(mocks.release).toHaveBeenCalledOnce();
    view.navigate('/libraries/3');
    expect(mocks.release).toHaveBeenCalledTimes(2);
  });

  it('stops on account/backend changes and logout, without killing an initial login', () => {
    const view = harness();
    view.changeUser(8);
    expect(mocks.release).toHaveBeenCalledOnce();
    mocks.api.BASE_URL = 'https://other-backend.test/api';
    view.rerender();
    expect(mocks.release).toHaveBeenCalledTimes(2);
    view.changeUser(null);
    expect(mocks.release).toHaveBeenCalledTimes(3);
    view.changeUser(9);
    expect(mocks.release).toHaveBeenCalledTimes(3);
  });

  it('ignores initial routes outside the workspace and rejects invalid library identities', () => {
    const view = harness('/settings');
    for (const path of ['/libraries', '/libraries/not-a-number', '/libraries/0', '/libraries/3']) view.navigate(path);
    expect(mocks.release).not.toHaveBeenCalled();
    view.navigate('/libraries/4');
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it('records a release failure without retrying it after a new scope has started', async () => {
    const view = harness();
    mocks.release.mockRejectedValueOnce(new Error('IPC unavailable'));
    view.navigate('/libraries/4');
    await act(async () => undefined);
    expect(mocks.warn).toHaveBeenCalledOnce();
    view.rerender();
    expect(mocks.release).toHaveBeenCalledOnce();
  });
});
