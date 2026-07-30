import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import 'normalize.css'

import '@douyinfe/semi-ui/dist/css/semi.min.css';
import '@/assets/css/index.less' // 重置 css
import {HashRouter} from "react-router-dom";
import {ThemeProvider} from "styled-components";
import theme from "./assets/theme";
import { installDesktopPlatformDomState } from '@/platform';

installDesktopPlatformDomState();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider theme={theme}>
      <HashRouter>
        <App />
      </HashRouter>
    </ThemeProvider>
  </React.StrictMode>,
)
