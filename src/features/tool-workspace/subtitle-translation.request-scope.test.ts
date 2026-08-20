import { describe, expect, it } from 'vitest';

import { createSubtitleTranslationRequestScope } from './subtitle-translation.request-scope';

describe('subtitle translation request scope', () => {
  it('invalidates an older single-row request when a newer request starts', () => {
    const scope = createSubtitleTranslationRequestScope();
    const first = scope.begin();
    const second = scope.begin();

    expect(scope.isCurrent(first)).toBe(false);
    expect(scope.isCurrent(second)).toBe(true);
  });

  it('invalidates in-flight requests when the subtitle dataset changes', () => {
    const scope = createSubtitleTranslationRequestScope();
    const previousDatasetRequest = scope.begin();

    scope.replaceDataset();
    const currentDatasetRequest = scope.begin();

    expect(scope.isCurrent(previousDatasetRequest)).toBe(false);
    expect(scope.isCurrent(currentDatasetRequest)).toBe(true);
  });
});
