import type { RouteObject } from 'react-router-dom'
import { lazy } from 'react'
import { RequireAuth, RootRedirect } from './require-auth'

// 懒加载
const Libraries = lazy(() => import('@/views/library'))
const LibraryDetail = lazy(() => import('@/views/library/detail')) // 仓库选择页
const Settings = lazy(() => import('@/views/settings'))
const TagManagement = lazy(() => import('@/views/tag-management'))
const UploadCenter = lazy(() => import('@/views/upload-center'))
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
