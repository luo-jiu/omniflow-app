import {useEffect} from 'react'
import MainLayout from "@/layouts/MainLayout";
import {useRoutes} from "react-router-dom";
import {Suspense} from "react";
import routes from "@/router";
import { AuthProvider } from "@/contexts/AuthContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import UserPreferencesBootstrap from '@/features/user/preferences/UserPreferencesBootstrap';
import SyncedUserPreferencesProvider from '@/features/user/preferences/SyncedUserPreferencesProvider';
import FloatingMiniVideoPlayer from '@/features/file-viewer/components/floating-mini-video-player';
import { runtimeLogger } from '@/utils/runtimeLogger';
import '@/features/resource-monitor/services/resource-monitor-runtime';
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
        <SyncedUserPreferencesProvider>
          <UserPreferencesBootstrap />
          <MainLayout>
            <Suspense fallback={'loading...'}>
              {useRoutes(routes)}
            </Suspense>
            <FloatingMiniVideoPlayer />
          </MainLayout>
        </SyncedUserPreferencesProvider>
      </AuthProvider>
    </ThemeProvider>
  )
}

export default App
