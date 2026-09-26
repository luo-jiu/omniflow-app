import type { RouteObject } from 'react-router-dom'
import { lazy, type ComponentType } from 'react'
import { RequireAuth, RootRedirect } from './require-auth'

const CHUNK_RECOVERY_KEY = 'omniflow:chunk-load-recovery'
const CHUNK_RECOVERY_COOLDOWN_MS = 15_000;

function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /(?:dynamically imported module|importing a module script failed|loading chunk|chunk-[^/\s]+\.js)/iu.test(message);
}

function lazyWithChunkRecovery<T extends { default: ComponentType<any> }>(loader: () => Promise<T>) {
  return lazy(async () => {
    try {
      return await loader();
    } catch (error) {
      const lastRecoveryAt = Number(window.sessionStorage.getItem(CHUNK_RECOVERY_KEY));
      const canRecover = !Number.isFinite(lastRecoveryAt)
        || Date.now() - lastRecoveryAt > CHUNK_RECOVERY_COOLDOWN_MS;
      if (isChunkLoadError(error) && canRecover) {
        // Vite can leave an old optimized dependency URL in an already-open
        // renderer after the dependency cache is regenerated. Retry once so a
        // repository navigation does not end in a blank lazy route.
        window.sessionStorage.setItem(CHUNK_RECOVERY_KEY, String(Date.now()));
        window.location.reload();
        return new Promise<T>(() => {});
      }
      throw error;
    }
  });
}

// 懒加载
const Libraries = lazyWithChunkRecovery(() => import('@/views/library'))
const LibraryDetail = lazyWithChunkRecovery(() => import('@/views/library/detail')) // 仓库选择页
const Settings = lazyWithChunkRecovery(() => import('@/views/settings'))
const TagManagement = lazyWithChunkRecovery(() => import('@/views/tag-management'))
const BrowserFileMappings = lazyWithChunkRecovery(() => import('@/views/browser-file-mappings'))
const StorageSettings = lazyWithChunkRecovery(() => import('@/views/storage-settings'))
const UploadCenter = lazyWithChunkRecovery(() => import('@/views/upload-center'))
const TransferCenter = lazyWithChunkRecovery(() => import('@/views/transfer-center'))
const RecycleBin = lazyWithChunkRecovery(() => import('@/views/recycle-bin'))
const Profile = lazyWithChunkRecovery(() => import('@/views/profile'))
const Login = lazyWithChunkRecovery(() => import('@/views/login'))

const routes: RouteObject[] = [
  // 默认路径，使用 Navigate可以跳转(重定向)
  {
    path: '/',
    element: <RootRedirect />
  },
  {
    path: '/libraries',
    element: (
      <RequireAuth>
        <Libraries />
      </RequireAuth>
    )
  },
  {
    path: '/libraries/:id',
    element: (
      <RequireAuth>
        <LibraryDetail />
      </RequireAuth>
    )
  },
  {
    path: '/settings',
    element: (
      <RequireAuth>
        <Settings />
      </RequireAuth>
    )
  },
  {
    path: '/upload-center',
    element: (
      <RequireAuth>
        <UploadCenter />
      </RequireAuth>
    )
  },
  {
    path: '/transfer-center',
    element: (
      <RequireAuth>
        <TransferCenter />
      </RequireAuth>
    )
  },
  {
    path: '/profile',
    element: (
      <RequireAuth>
        <Profile />
      </RequireAuth>
    )
  },
  {
    path: '/settings/tags',
    element: (
      <RequireAuth>
        <TagManagement />
      </RequireAuth>
    )
  },
  {
    path: '/settings/browser-file-mappings',
    element: (
      <RequireAuth>
        <BrowserFileMappings />
      </RequireAuth>
    )
  },
  {
    path: '/settings/storage',
    element: (
      <RequireAuth>
        <StorageSettings />
      </RequireAuth>
    )
  },
  {
    path: '/libraries/:id/recycle-bin',
    element: (
      <RequireAuth>
        <RecycleBin />
      </RequireAuth>
    )
  },
  {
    path: '/login',
    element: <Login />
  }
]

// Development shortcut to the same preview available in appearance settings.
// Only this shortcut route is excluded from packaged application routes.
if (import.meta.env.DEV) {
  const ThemeFoundationPreview = lazyWithChunkRecovery(() => import('@/features/appearance/ThemeFoundationPreview'))
  routes.push({ path: '/dev/theme-foundation', element: <ThemeFoundationPreview /> })
}

export default routes
