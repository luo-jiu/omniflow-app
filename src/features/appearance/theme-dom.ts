import type { ThemeView } from './theme-view';
import { themeViewVariables } from './theme-view';
export function applyThemeView(view: ThemeView, target: HTMLElement = document.body) {
  target.setAttribute('theme-mode', view.mode);
  target.setAttribute('theme-source', view.source);
  for (const [key, value] of Object.entries(themeViewVariables(view))) target.style.setProperty(key, value);
}
