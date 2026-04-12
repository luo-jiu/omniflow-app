import {useEffect} from 'react'
import MainLayout from "@/layouts/MainLayout";
import {useRoutes} from "react-router-dom";
import {Suspense} from "react";
import routes from "@/router";
import { AuthProvider } from "@/contexts/AuthContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import UserPreferencesBootstrap from '@/features/user/preferences/UserPreferencesBootstrap';
import { runtimeLogger } from '@/utils/runtimeLogger';
import './App.css'

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

  return (
    <ThemeProvider>
      <AuthProvider>
        <UserPreferencesBootstrap />
        <MainLayout>
          <Suspense fallback={'loading...'}>
            {useRoutes(routes)}
          </Suspense>
        </MainLayout>
      </AuthProvider>
    </ThemeProvider>
  )
}

export default App
