export const APP_OVERLAY_ROOT_ID = 'app-overlay-root';

export function getAppPopupContainer(): HTMLElement {
  return document.getElementById(APP_OVERLAY_ROOT_ID)
    ?? document.getElementById('root')
    ?? document.body;
}
