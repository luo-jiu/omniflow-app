import ReactDOM from 'react-dom/client';
import 'normalize.css';
import '@douyinfe/semi-ui/dist/css/semi.min.css';
import '@/assets/css/index.less';

import { OverlayThemeBridge } from './OverlayThemeBridge';
import { OverlayHost } from './OverlayHost';

// NOTE: Intentionally NOT wrapped in React.StrictMode.
// Semi UI's Modal uses an internal portal that gets torn down on the
// StrictMode dev-mode cleanup and does not always re-attach on remount,
// causing the modal to silently fail to render.
ReactDOM.createRoot(document.getElementById('root')!).render(
  <OverlayThemeBridge>
    <OverlayHost />
  </OverlayThemeBridge>,
);
