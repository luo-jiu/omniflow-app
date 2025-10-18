import {useEffect} from 'react'

import AppHeader from "@/components/app-header";
import AppMain from "@/components/app-main";
import './App.css'
import AppSidebar from "@/components/app-sidebar";
import DirectorySidebar from "@/components/app-directory-sidebar";

function App() {
  useEffect(() => {
    const fetchData = async () => {
      try {
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
        <AppSidebar />
        <DirectorySidebar />
        <AppMain />
      </div>
    </div>
  )
}

export default App
