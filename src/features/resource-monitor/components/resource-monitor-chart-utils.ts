export interface ResourceMonitorChartItem {
  accent: string;
  key: string;
  label: string;
  meta?: string;
  percent: number;
  value: number;
}

const CHAMPION_MIN_PERCENT = 60;

export function splitChampionItem(items: ResourceMonitorChartItem[]): {
  champion: ResourceMonitorChartItem;
  rest: ResourceMonitorChartItem[];
} | null {
  const visible = items.filter((item) => item.value > 0);
  if (visible.length < 3) return null;

  const champion = visible.reduce((top, item) => (item.value > top.value ? item : top), visible[0]);
  if (champion.percent < CHAMPION_MIN_PERCENT) return null;

  const rest = items.filter((item) => item !== champion);
  return { champion, rest };
}

export function formatPercentLabel(percent: number): string {
  if (!Number.isFinite(percent) || percent <= 0) return '0%';
  if (percent < 0.1) return '<0.1%';
  return `${percent.toFixed(1)}%`;
}
