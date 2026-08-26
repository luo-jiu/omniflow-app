import { describe, expect, it } from 'vitest';
import { resolveFolderStatisticsValues } from './node-properties-statistics';

describe('node properties folder statistics', () => {
  it('distinguishes loading and failed calculations', () => {
    expect(resolveFolderStatisticsValues(1, { status: 'loading' })).toEqual({
      count: '正在计算...',
      size: '正在计算...',
    });
    expect(resolveFolderStatisticsValues(1, { status: 'error' })).toEqual({
      count: '计算失败',
      size: '计算失败',
    });
  });

  it('does not treat a missing file size as zero bytes', () => {
    expect(resolveFolderStatisticsValues(1, {
      status: 'ready',
      descendants: [
        { id: 1, type: 'dir' },
        { id: 2, type: 'file' },
      ],
    })).toEqual({
      count: '1 个',
      size: '无法计算',
    });
  });

  it('sums files across the complete descendant list', () => {
    expect(resolveFolderStatisticsValues(1, {
      status: 'ready',
      descendants: [
        { id: 1, type: 'dir' },
        { id: 2, type: 'dir' },
        { id: 3, type: 'file', fileSize: 1024 },
        { id: 4, type: 'file', file_size: 2048 },
      ],
    })).toEqual({
      count: '2 个',
      size: '3 KB',
    });
  });
});
