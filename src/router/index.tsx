import { Navigate } from 'react-router-dom'
import type { RouteObject } from 'react-router-dom'
import { lazy } from 'react'

// 懒加载
const Libraries = lazy(() => import('@/views/library'))
const LibraryDetail = lazy(() => import('@/views/library/detail')) // 仓库选择页
const Settings = lazy(() => import('@/views/settings'))


const routes: RouteObject[] = [
  // 默认路径，使用 Navigate可以跳转(重定向)
  {
    path: '/',
    element: <Navigate to={'/libraries'} />
  },
  {
    path: '/libraries',
    element: <Libraries />
  },
  {
    path: '/libraries/:id',
    element: <LibraryDetail />
  },
  {
    path: '/settings',
    element: <Settings />
  }
]


export default routes