import { describe, expect, it } from 'vitest';

import {
  parseTimedText,
  resolveFocusedTimedTextCueIndex,
  resolveTimedTextCueSweepPercent,
  type TimedTextCue,
} from './subtitle';

describe('parseTimedText QRC', () => {
  it('associates trailing word markers with the preceding text', () => {
    const cues = parseTimedText('[0,1513]WATER ((0,79)Feat.(80,79)Miku(159,80)');

    expect(cues).toHaveLength(1);
    expect(cues[0].lines).toEqual(['WATER (Feat.Miku']);
    expect(cues[0].segmentLines?.[0]).toEqual([
      { text: 'WATER (', start: 0, end: 0.079 },
      { text: 'Feat.', start: 0.08, end: 0.159 },
      { text: 'Miku', start: 0.159, end: 0.239 },
    ]);
  });

  it('keeps untimed trailing text inside the lyric line', () => {
    const cues = parseTimedText('[1000,1000]你(1000,200)好(1200,200)!');

    expect(cues[0].lines).toEqual(['你好!']);
    expect(cues[0].segmentLines?.[0]).toEqual([
      { text: '你', start: 1, end: 1.2 },
      { text: '好', start: 1.2, end: 1.4 },
      { text: '!', start: 1.4, end: 2 },
    ]);
  });

  it('keeps compatibility with word markers that precede their text', () => {
    const cues = parseTimedText('[0,1000](0,500)你(500,500)好');

    expect(cues[0].lines).toEqual(['你好']);
    expect(cues[0].segmentLines?.[0]).toEqual([
      { text: '你', start: 0, end: 0.5 },
      { text: '好', start: 0.5, end: 1 },
    ]);
  });
});

describe('timed text lyric presentation', () => {
  const cues: TimedTextCue[] = [{
    id: 'cue-1',
    start: 0,
    end: 2,
    lines: ['你好'],
    segmentLines: [[
      { text: '你', start: 0, end: 1 },
      { text: '好', start: 1, end: 2 },
    ]],
  }, {
    id: 'cue-2',
    start: 3,
    end: 5,
    lines: ['下一句'],
  }];

  it('keeps the upcoming line focused between lyric cues', () => {
    expect(resolveFocusedTimedTextCueIndex(cues, -1)).toBe(0);
    expect(resolveFocusedTimedTextCueIndex(cues, 1)).toBe(0);
    expect(resolveFocusedTimedTextCueIndex(cues, 2.5)).toBe(1);
    expect(resolveFocusedTimedTextCueIndex(cues, 6)).toBe(1);
  });

  it('sweeps continuously through word-level segments', () => {
    expect(resolveTimedTextCueSweepPercent(cues[0], 0, 0.5)).toBe(25);
    expect(resolveTimedTextCueSweepPercent(cues[0], 0, 1.5)).toBe(75);
  });

  it('falls back to line duration when no word-level timing exists', () => {
    expect(resolveTimedTextCueSweepPercent(cues[1], 0, 3.5)).toBe(25);
  });
});
