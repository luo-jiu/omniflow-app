export type TagColorTone = '1' | '2' | '3' | '4' | '5';

export const DEFAULT_TAG_COLOR_TONE: TagColorTone = '3';

export const TAG_COLOR_TONE_OPTIONS: Array<{
  value: TagColorTone;
  label: string;
  color: string;
}> = [
  { value: '1', label: '1', color: '#EAFBF0' },
  { value: '2', label: '2', color: '#B9F3CC' },
  { value: '3', label: '3', color: '#76D98B' },
  { value: '4', label: '4', color: '#4DC96B' },
  { value: '5', label: '5', color: '#2FB853' },
];

export const TAG_PRIMARY_COLOR_TONE_PALETTES: Record<TagColorTone, string[]> = {
  '1': [
    '#FEE2E2',
    '#FFEDD5',
    '#FEF3C7',
    '#DCFCE7',
    '#CCFBF1',
    '#DBEAFE',
    '#E0E7FF',
    '#F3E8FF',
    '#FCE7F3',
    '#E5E7EB',
  ],
  '2': [
    '#FCA5A5',
    '#FDBA74',
    '#FDE68A',
    '#86EFAC',
    '#5EEAD4',
    '#93C5FD',
    '#A5B4FC',
    '#D8B4FE',
    '#F9A8D4',
    '#CBD5E1',
  ],
  '3': [
    '#F87171',
    '#FB923C',
    '#FBBF24',
    '#4ADE80',
    '#2DD4BF',
    '#60A5FA',
    '#818CF8',
    '#C084FC',
    '#F472B6',
    '#94A3B8',
  ],
  '4': [
    '#EF4444',
    '#F97316',
    '#F59E0B',
    '#22C55E',
    '#14B8A6',
    '#3B82F6',
    '#6366F1',
    '#A855F7',
    '#EC4899',
    '#64748B',
  ],
  '5': [
    '#B91C1C',
    '#C2410C',
    '#B45309',
    '#15803D',
    '#0F766E',
    '#1D4ED8',
    '#4338CA',
    '#7E22CE',
    '#BE185D',
    '#334155',
  ],
};

export const TAG_PRIMARY_COLOR_PRESETS: string[] = TAG_PRIMARY_COLOR_TONE_PALETTES[DEFAULT_TAG_COLOR_TONE];

export function normalizeTagColorTone(value: string | null | undefined): TagColorTone {
  return value === '1' || value === '2' || value === '3' || value === '4' || value === '5'
    ? value
    : DEFAULT_TAG_COLOR_TONE;
}

export function getTagPrimaryColorPresets(tone: TagColorTone): string[] {
  return TAG_PRIMARY_COLOR_TONE_PALETTES[tone] || TAG_PRIMARY_COLOR_PRESETS;
}

export const TAG_TEXT_COLOR_PRESETS: string[] = [
  '#FFFFFF',
  '#F5F5F5',
  '#E5E6EB',
  '#1D2129',
  '#4B5969',
  '#000000',
];
