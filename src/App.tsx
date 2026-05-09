import {useEffect} from 'react'
import MainLayout from "@/layouts/MainLayout";
import {useRoutes} from "react-router-dom";
import {Suspense} from "react";
import routes from "@/router";
import { AuthProvider } from "@/contexts/AuthContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import UserPreferencesBootstrap from '@/features/user/preferences/UserPreferencesBootstrap';
import FloatingMiniVideoPlayer from '@/features/file-viewer/components/floating-mini-video-player';
import AppHeader from '@/components/business/app-header';
import { runtimeLogger } from '@/utils/runtimeLogger';
import './App.css'

function isBrowserHistoryMouseEvent(event: MouseEvent) {
  return event.button === 3 || event.button === 4
}

function App() {
  useEffect(() => {
    const fetchData = async () => {
      try {
        // 注释掉自动登录，改为手动登录
        // await loginService.autoLogin();
        
        const data = await window.electronAPI.getStaticData()
        runtimeLogger.debug('totalStorage:', data.totalStorage)
        runtimeLogger.debug('cpuModel:', data.cpuModel)
        runtimeLogger.debug('totalMemoryGB:', data.totalMemoryGB)
      } catch (error) {
        runtimeLogger.error('failed to get static data:', error)
      }
    }
    void fetchData()
  }, [])

  useEffect(() => {
    const preventBrowserHistoryMouseNavigation = (event: MouseEvent) => {
      if (!isBrowserHistoryMouseEvent(event)) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
    }

    const listenerOptions: AddEventListenerOptions = {
      capture: true,
      passive: false,
    }

    window.addEventListener('mousedown', preventBrowserHistoryMouseNavigation, listenerOptions)
    window.addEventListener('mouseup', preventBrowserHistoryMouseNavigation, listenerOptions)
    window.addEventListener('auxclick', preventBrowserHistoryMouseNavigation, listenerOptions)
    window.addEventListener('click', preventBrowserHistoryMouseNavigation, listenerOptions)

    return () => {
      window.removeEventListener('mousedown', preventBrowserHistoryMouseNavigation, listenerOptions)
      window.removeEventListener('mouseup', preventBrowserHistoryMouseNavigation, listenerOptions)
      window.removeEventListener('auxclick', preventBrowserHistoryMouseNavigation, listenerOptions)
      window.removeEventListener('click', preventBrowserHistoryMouseNavigation, listenerOptions)
    }
  }, [])

  return (
    <ThemeProvider>
      <AuthProvider>
        <UserPreferencesBootstrap />
        <MainLayout>
          <AppHeader />
          {/* flex:1 + min-height:0 让路由内容占满 header 之外的空间；display:flex 让 height:100% 的子页面能撑满 */}
          <div style={{ flex: 1, minHeight: 0, minWidth: 0, display: 'flex', position: 'relative' }}>
            <Suspense fallback={'loading...'}>
              {useRoutes(routes)}
            </Suspense>
          </div>
          <FloatingMiniVideoPlayer />
        </MainLayout>
      </AuthProvider>
    </ThemeProvider>
  )
}

export default App
