import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextType } from '@/contexts/auth.context';
import { RequireAuth } from './require-auth';

function renderProtectedRoute(options: { isLoggedIn: boolean; loading: boolean }) {
  const context: AuthContextType = {
    user: options.isLoggedIn ? { username: 'viewer-user' } : null,
    isLoggedIn: options.isLoggedIn,
    loading: options.loading,
    login: vi.fn(),
    logout: vi.fn(),
    register: vi.fn(),
    setUserInfo: vi.fn(),
  };

  return renderToStaticMarkup(
    <AuthContext.Provider value={context}>
      <RequireAuth>
        <span>protected-viewer</span>
      </RequireAuth>
    </AuthContext.Provider>,
  );
}

describe('RequireAuth', () => {
  it('does not mount protected descendants while auth runtimes are bootstrapping', () => {
    expect(renderProtectedRoute({ isLoggedIn: false, loading: true }))
      .not.toContain('protected-viewer');
  });

  it('mounts protected descendants after authenticated bootstrap completes', () => {
    expect(renderProtectedRoute({ isLoggedIn: true, loading: false }))
      .toContain('protected-viewer');
  });
});
