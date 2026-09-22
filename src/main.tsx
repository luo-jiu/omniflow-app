import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import 'normalize.css'

import '@douyinfe/semi-ui/dist/css/semi.min.css';
import '@/assets/css/index.less' // 重置 css
import {HashRouter} from "react-router-dom";
import { installDesktopPlatformDomState } from '@/platform';
import { installAppInputModalityTracking } from '@/components/ui/input-modality';

const disposePlatformDomState = installDesktopPlatformDomState();
import.meta.hot?.dispose(disposePlatformDomState);
installAppInputModalityTracking();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
      <HashRouter>
        <App />
      </HashRouter>
  </React.StrictMode>,
)
