import { describe, expect, it } from 'vitest';
import { installAppInputModalityTracking } from './input-modality';

class TestDocument extends EventTarget {
  documentElement = { dataset: {} as Record<string, string> };
  listenerCount = 0;

  override addEventListener(...args: Parameters<EventTarget['addEventListener']>) {
    this.listenerCount += 1;
    super.addEventListener(...args);
  }
}

function dispatchKeyDown(documentRef: TestDocument, overrides: Record<string, boolean> = {}) {
  const event = new Event('keydown');
  Object.entries(overrides).forEach(([key, value]) => {
    Object.defineProperty(event, key, { value });
  });
  documentRef.dispatchEvent(event);
}

describe('installAppInputModalityTracking', () => {
  it('默认按指针输入处理，并在键盘与指针事件间切换', () => {
    const documentRef = new TestDocument();
    installAppInputModalityTracking(documentRef as unknown as Document);

    expect(documentRef.documentElement.dataset.appInputModality).toBe('pointer');

    dispatchKeyDown(documentRef);
    expect(documentRef.documentElement.dataset.appInputModality).toBe('keyboard');

    documentRef.dispatchEvent(new Event('pointerdown'));
    expect(documentRef.documentElement.dataset.appInputModality).toBe('pointer');
  });

  it('不把系统组合键误判为键盘导航', () => {
    const documentRef = new TestDocument();
    installAppInputModalityTracking(documentRef as unknown as Document);

    dispatchKeyDown(documentRef, { metaKey: true });
    dispatchKeyDown(documentRef, { ctrlKey: true });
    dispatchKeyDown(documentRef, { altKey: true });
    dispatchKeyDown(documentRef, { isComposing: true });

    expect(documentRef.documentElement.dataset.appInputModality).toBe('pointer');
  });

  it('同一 document 只安装一次监听器', () => {
    const documentRef = new TestDocument();
    const typedDocument = documentRef as unknown as Document;

    installAppInputModalityTracking(typedDocument);
    installAppInputModalityTracking(typedDocument);

    expect(documentRef.listenerCount).toBe(2);
  });
});
