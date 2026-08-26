import { resolveNodeType } from '../components/directory-tree/utils/tree-node';

export type FolderStatistics =
  | { status: 'loading' }
  | { status: 'ready'; descendants: any[] | null }
  | { status: 'error' };

export function formatNodeFileSize(size: unknown): string {
  const bytes = Number(size);
  if (!Number.isFinite(bytes) || bytes < 0) return '-';
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / (1024 ** index);
  const precision = index <= 1 ? 0 : 2;
  return `${value.toFixed(precision)} ${units[index]}`;
}

export function resolveFolderStatisticsValues(
  detailId: number,
  folderStatistics: FolderStatistics | undefined,
): { count: string; size: string } {
  if (!folderStatistics || folderStatistics.status === 'loading') {
    return { count: '正在计算...', size: '正在计算...' };
  }
  if (folderStatistics.status === 'error') {
    return { count: '计算失败', size: '计算失败' };
  }
  if (!Array.isArray(folderStatistics.descendants)) {
    return { count: '无法计算', size: '无法计算' };
  }

  const descendantFiles = folderStatistics.descendants.filter((item) => (
    Number(item?.id) !== detailId && resolveNodeType(item) === 'file'
  ));
  const fileSizes = descendantFiles.map((item) => {
    const rawSize = item?.fileSize ?? item?.file_size;
    return rawSize == null || rawSize === '' ? Number.NaN : Number(rawSize);
  });
  const sizeReady = fileSizes.every((size) => Number.isFinite(size) && size >= 0);
  return {
    count: `${descendantFiles.length} 个`,
    size: sizeReady
      ? formatNodeFileSize(fileSizes.reduce((sum, size) => sum + size, 0))
      : '无法计算',
  };
}
