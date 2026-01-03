import {useEffect} from 'react'
import MainLayout from "@/layouts/MainLayout";
import {useRoutes} from "react-router-dom";
import {Suspense} from "react";
import routes from "@/router";
import { AuthProvider } from "@/contexts/AuthContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import './App.css'

function App() {
  useEffect(() => {
    const fetchData = async () => {
      try {
        // 注释掉自动登录，改为手动登录
        // await loginService.autoLogin();
        
        const data = await window.electronAPI.getStaticData()
        console.log('totalStorage:', data.totalStorage)
        console.log('cpuModel:', data.cpuModel)
        console.log('totalMemoryGB:', data.totalMemoryGB)
      } catch (error) {
        console.error('Error:', error)
      }
    }
    void fetchData()
  }, [])

  return (
    <ThemeProvider>
      <AuthProvider>
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
