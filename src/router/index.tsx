import type { RouteObject } from 'react-router-dom'
import { lazy } from 'react'
import { RequireAuth, RootRedirect } from './require-auth'

// 懒加载
const Libraries = lazy(() => import('@/views/library'))
const LibraryDetail = lazy(() => import('@/views/library/detail')) // 仓库选择页
const Settings = lazy(() => import('@/views/settings'))
const TagManagement = lazy(() => import('@/views/tag-management'))
const BrowserFileMappings = lazy(() => import('@/views/browser-file-mappings'))
const StorageSettings = lazy(() => import('@/views/storage-settings'))
const UploadCenter = lazy(() => import('@/views/upload-center'))
const TransferCenter = lazy(() => import('@/views/transfer-center'))
const RecycleBin = lazy(() => import('@/views/recycle-bin'))
const Profile = lazy(() => import('@/views/profile'))
const Login = lazy(() => import('@/views/login'))

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


export default routes
