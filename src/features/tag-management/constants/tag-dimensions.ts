export const TAG_DIMENSION_OPTIONS = [
  { value: 'custom', label: '未分类' },
  { value: 'genre', label: '题材 / 风格' },
  { value: 'creator', label: '作者 / 创作者' },
  { value: 'character', label: '角色' },
  { value: 'series', label: '系列 / 作品' },
  { value: 'source', label: '来源' },
  { value: 'language', label: '语言' },
  { value: 'region', label: '地区' },
  { value: 'technical', label: '技术属性' },
  { value: 'status', label: '状态' },
];

export function tagDimensionLabel(dimension?: string): string {
  return TAG_DIMENSION_OPTIONS.find(option => option.value === (dimension || 'custom'))?.label || dimension || '未分类';
}
