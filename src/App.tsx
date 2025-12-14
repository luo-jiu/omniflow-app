import {useEffect} from 'react'
import { loginService } from "@/service/authService";

import AppHeader from "@/components/app-header";
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
    <div className="app">
      <AppHeader />
      <div className="content">
        {/*<AppSidebar />*/}
        <Suspense fallback={'loading...'}>
          <div className='main'>{useRoutes(routes)}</div>
        </Suspense>
        {/*<DirectorySidebar />*/}
        {/*<AppMain />*/}
      </div>
    </div>
  )
}

export default App
