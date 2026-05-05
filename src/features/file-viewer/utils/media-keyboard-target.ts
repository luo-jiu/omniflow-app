const VIEWER_INTERACTIVE_SELECTOR = [
  'button',
  'a[href]',
  'input',
  'textarea',
  'select',
  'summary',
  '[contenteditable="true"]',
  '[role="button"]',
  '[role="checkbox"]',
  '[role="menuitem"]',
  '[role="radio"]',
  '[role="slider"]',
  '[role="switch"]',
  '[tabindex]',
].join(',');

export function isTextEditingKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return (
    target.isContentEditable
    || tagName === 'input'
    || tagName === 'textarea'
    || tagName === 'select'
  );
}

export function isViewerInteractiveKeyboardTarget(
  target: EventTarget | null,
  viewerRoot: HTMLElement | null,
): boolean {
  if (!(target instanceof HTMLElement) || !viewerRoot?.contains(target)) {
    return false;
  }
  const interactiveTarget = target.closest(VIEWER_INTERACTIVE_SELECTOR);
  return Boolean(
    interactiveTarget
    && viewerRoot.contains(interactiveTarget)
    && interactiveTarget.getAttribute('tabindex') !== '-1',
  );
}

export function releaseExternalKeyboardFocus(
  target: EventTarget | null,
  viewerRoot: HTMLElement | null,
) {
  if (!(target instanceof HTMLElement)) return;
  if (viewerRoot?.contains(target)) return;
  target.blur();
}
