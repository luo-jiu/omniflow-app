import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import 'normalize.css'

// 重置 css
import '@/assets/css/index.less'
import {HashRouter} from "react-router-dom";
import {ThemeProvider} from "styled-components";
import theme from "./assets/theme";

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider theme={theme}>
      <HashRouter>
        <App />
      </HashRouter>
    </ThemeProvider>
  </React.StrictMode>,
)

// Use contextBridge
// window.ipcRenderer.on('statistics', (_event, message) => {
//   const { cpuUsage, ramUsage, storageData } = message
//   console.log('CPU:', cpuUsage)
//   console.log('RAM:', ramUsage)
//   console.log('totalStorage:', storageData.totalStorage)
//   console.log('cpuModel:', storageData.cpuModel)
//   console.log('totalMemoryGB:', storageData.totalMemoryGB)
// })
