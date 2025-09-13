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
    // {/* 上侧工具栏 */}
    //   <AppHeader />
    //   {/* 下方内容区域：左侧菜单栏 + 右侧内容 */}
    //   <div className="app-content">
    //     <Index />
    //     <main className="app-main">
    //       {/* 右侧主要内容区域 */}
    //       <h2>主内容区域</h2>
    //       <p>这里是右侧的内容区域，占满剩余空间。</p>
    //     </main>
    //   </div>
export default App
