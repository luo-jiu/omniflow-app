import type { ThemeView } from './theme-view';
import { themeViewVariables } from './theme-view';
import { isThemeColor } from './color-theme';

const MOTION_ATTRIBUTE = 'data-app-theme-transition';
const MOTION_DURATION = 200;
const appliedColors = new WeakMap<HTMLElement, Record<string, string>>();
const registeredColors = new WeakMap<object, Set<string>>();
const activeAnimations = new Map<HTMLElement, Animation>();

function registerColors(css: typeof CSS, colors: Record<string, string>) {
  if (typeof css.registerProperty !== 'function') return false;
  let registered = registeredColors.get(css);
  if (!registered) { registered = new Set(); registeredColors.set(css, registered); }
  for (const [name, initialValue] of Object.entries(colors)) {
    if (registered.has(name)) continue;
    try { css.registerProperty({ name, syntax: '<color>', inherits: true, initialValue }); }
    catch (error) {
      // Registrations live for the document, including across development HMR.
      if (!(error instanceof Error) || error.name !== 'InvalidModificationError') return false;
    }
    registered.add(name);
  }
  return true;
}

export function cancelThemeTransition(target: HTMLElement = document.body) {
  const animation = activeAnimations.get(target);
  activeAnimations.delete(target);
  animation?.cancel();
  target.removeAttribute(MOTION_ATTRIBUTE);
}

export function applyThemeView(view: ThemeView, target: HTMLElement = document.body) {
  const variables = themeViewVariables(view);
  const colors = Object.fromEntries(Object.entries(variables).filter(([, value]) => isThemeColor(value)));
  const previous = appliedColors.get(target);
  const changed = previous && Object.entries(colors).some(([key, value]) => previous[key] !== value);
  const write = () => {
    target.setAttribute('theme-mode', view.mode);
    target.setAttribute('theme-source', view.source);
    for (const [key, value] of Object.entries(variables)) target.style.setProperty(key, value);
    appliedColors.set(target, colors);
  };
  const win = target.ownerDocument?.defaultView;
  const css = win?.CSS;
  const supportsMotion = css && registerColors(css, colors) && typeof target.animate === 'function';

  // First paint is immediate. Source/revision alone must not interrupt motion.
  if (!previous) {
    target.setAttribute(MOTION_ATTRIBUTE, '');
    write();
    win?.getComputedStyle(target).getPropertyValue('color');
    target.removeAttribute(MOTION_ATTRIBUTE);
    return;
  }
  if (!changed) { write(); return; }

  target.setAttribute(MOTION_ATTRIBUTE, '');
  if (!win || !supportsMotion || win.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    cancelThemeTransition(target);
    target.setAttribute(MOTION_ATTRIBUTE, '');
    write();
    // Commit the immediate palette with component transitions suppressed.
    win?.getComputedStyle(target).getPropertyValue('color');
    target.removeAttribute(MOTION_ATTRIBUTE);
    return;
  }

  // Read one root style before writing. A reversal starts at the currently
  // displayed colors, rather than jumping to the previous animation's endpoint.
  const computed = win.getComputedStyle(target);
  const from = Object.fromEntries(Object.keys(colors).map(key => [key, computed.getPropertyValue(key)]));
  cancelThemeTransition(target);
  target.setAttribute(MOTION_ATTRIBUTE, '');
  write();
  let animation: Animation;
  try { animation = target.animate([from, colors], { duration: MOTION_DURATION, easing: 'ease-in-out' }); }
  catch {
    win.getComputedStyle(target).getPropertyValue('color');
    target.removeAttribute(MOTION_ATTRIBUTE);
    return;
  }
  activeAnimations.set(target, animation);
  const finish = () => {
    if (activeAnimations.get(target) !== animation) return;
    activeAnimations.delete(target);
    win.getComputedStyle(target).getPropertyValue('color');
    target.removeAttribute(MOTION_ATTRIBUTE);
  };
  void animation.finished.then(finish, finish);
}

if (import.meta.hot) import.meta.hot.dispose(() => {
  for (const target of activeAnimations.keys()) cancelThemeTransition(target);
});
