import type { ReactNode } from 'react';
import ReactDOMActual from 'react-dom-actual';

type ReactDOMActualShape = {
  createPortal: typeof import('react-dom').createPortal;
  createRoot: typeof import('react-dom/client').createRoot;
  findDOMNode: typeof import('react-dom').findDOMNode;
  flushSync: typeof import('react-dom').flushSync;
  hydrate?: unknown;
  hydrateRoot: typeof import('react-dom/client').hydrateRoot;
  render?: unknown;
  unmountComponentAtNode?: unknown;
  unstable_batchedUpdates: typeof import('react-dom').unstable_batchedUpdates;
  unstable_renderSubtreeIntoContainer?: unknown;
  version: string;
  __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED?: unknown;
};

type ReactDOMInternals = {
  usingClientEntryPoint?: boolean;
};

const actual = ReactDOMActual as ReactDOMActualShape;
type LegacyRoot = ReturnType<ReactDOMActualShape['createRoot']>;
const legacyRoots = new WeakMap<Element | DocumentFragment, LegacyRoot>();

function withClientEntryPoint<T>(operation: () => T): T {
  const internals =
    actual.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED as ReactDOMInternals | undefined;
  if (!internals) return operation();

  const previous = internals.usingClientEntryPoint;
  internals.usingClientEntryPoint = true;
  try {
    return operation();
  } finally {
    internals.usingClientEntryPoint = previous;
  }
}

const createRoot: ReactDOMActualShape['createRoot'] = (container, options) =>
  withClientEntryPoint(() => actual.createRoot(container, options));

const hydrateRoot: ReactDOMActualShape['hydrateRoot'] = (container, initialChildren, options) =>
  withClientEntryPoint(() => actual.hydrateRoot(container, initialChildren, options));

function render(
  node: ReactNode,
  container: Element | DocumentFragment,
  callback?: () => void,
) {
  let root = legacyRoots.get(container);
  if (!root) {
    root = createRoot(container);
    legacyRoots.set(container, root);
  }
  actual.flushSync(() => {
    root.render(node);
  });
  callback?.();
  return null;
}

function unmountComponentAtNode(container: Element | DocumentFragment): boolean {
  const root = legacyRoots.get(container);
  if (!root) return false;
  actual.flushSync(() => {
    root.unmount();
  });
  legacyRoots.delete(container);
  return true;
}

export const createPortal = actual.createPortal;
export const findDOMNode = actual.findDOMNode;
export const flushSync = actual.flushSync;
export const unstable_batchedUpdates = actual.unstable_batchedUpdates;
export const version = actual.version;
export const hydrate = actual.hydrate;
export const unstable_renderSubtreeIntoContainer = actual.unstable_renderSubtreeIntoContainer;
export const __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED =
  actual.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;

const ReactDOMCompat = {
  ...actual,
  createRoot,
  hydrateRoot,
  render,
  unmountComponentAtNode,
};

export { createRoot, hydrateRoot };
export default ReactDOMCompat;
