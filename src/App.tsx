import {useEffect} from 'react'
import { loginService } from "@/service/authService";
import MainLayout from "@/layouts/MainLayout";
import {useRoutes} from "react-router-dom";
import {Suspense} from "react";
import routes from "@/router";
import './App.css'

function App() {
  useEffect(() => {
    const fetchData = async () => {
      try {
        // 自动登录
        await loginService.autoLogin();
        
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
    <MainLayout>
      <Suspense fallback={'loading...'}>
        {useRoutes(routes)}
      </Suspense>
    </MainLayout>
  )
}

export default App
