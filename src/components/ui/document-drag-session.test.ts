import { afterEach, describe, expect, it, vi } from 'vitest';

import { beginDocumentDragSession } from './document-drag-session';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('document drag session', () => {
  it('restores original styles only after every owner releases its token', () => {
    const style = { cursor: 'crosshair', userSelect: 'text' };
    vi.stubGlobal('document', { body: { style } });

    const releaseFirst = beginDocumentDragSession('col-resize');
    expect(style).toEqual({ cursor: 'col-resize', userSelect: 'none' });

    const releaseSecond = beginDocumentDragSession('row-resize');
    expect(style).toEqual({ cursor: 'row-resize', userSelect: 'none' });

    releaseFirst();
    expect(style).toEqual({ cursor: 'row-resize', userSelect: 'none' });

    releaseSecond();
    expect(style).toEqual({ cursor: 'crosshair', userSelect: 'text' });
  });

  it('allows an owner to release repeatedly without clearing another session', () => {
    const style = { cursor: '', userSelect: '' };
    vi.stubGlobal('document', { body: { style } });

    const releaseFirst = beginDocumentDragSession('col-resize');
    const releaseSecond = beginDocumentDragSession('grabbing');
    releaseFirst();
    releaseFirst();
    expect(style).toEqual({ cursor: 'grabbing', userSelect: 'none' });

    releaseSecond();
    expect(style).toEqual({ cursor: '', userSelect: '' });
  });
});
