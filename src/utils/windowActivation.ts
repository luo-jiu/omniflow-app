import { runtimeLogger } from './runtimeLogger';

export function requestDesktopWindowActivation(temporaryOnTop = true) {
  if (!window.electronWindow?.activate) return;
  void window.electronWindow.activate(temporaryOnTop).catch((error) => {
    runtimeLogger.warn('激活窗口失败，弹层可能被其他应用遮挡', error);
  });
}
