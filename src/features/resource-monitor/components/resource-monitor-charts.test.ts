import { describe, expect, it } from 'vitest';
import {
  formatPercentLabel,
  type ResourceMonitorChartItem,
  splitChampionItem,
} from './resource-monitor-chart-utils';

function item(key: string, value: number, percent: number): ResourceMonitorChartItem {
  return {
    accent: '#fff',
    key,
    label: key,
    percent,
    value,
  };
}

describe('splitChampionItem', () => {
  it('只在占比达到 60% 时启用冠军分离', () => {
    expect(splitChampionItem([
      item('top', 599, 59.9),
      item('second', 251, 25.1),
      item('third', 150, 15),
    ])).toBeNull();

    expect(splitChampionItem([
      item('top', 600, 60),
      item('second', 250, 25),
      item('third', 150, 15),
    ])?.champion.key).toBe('top');
  });

  it('要求至少三个正值项并忽略零值项', () => {
    expect(splitChampionItem([
      item('top', 80, 80),
      item('second', 20, 20),
      item('zero', 0, 0),
    ])).toBeNull();

    expect(splitChampionItem([
      item('top', 80, 80),
      item('second', 15, 15),
      item('third', 5, 5),
      item('zero', 0, 0),
    ])?.rest.map(({ key }) => key)).toEqual(['second', 'third', 'zero']);
  });

  it('按值找到冠军，不依赖输入顺序', () => {
    const split = splitChampionItem([
      item('second', 25, 25),
      item('top', 65, 65),
      item('third', 10, 10),
    ]);

    expect(split?.champion.key).toBe('top');
    expect(split?.rest.map(({ key }) => key)).toEqual(['second', 'third']);
  });
});

describe('formatPercentLabel', () => {
  it('保留长尾占比的可读性', () => {
    expect(formatPercentLabel(0)).toBe('0%');
    expect(formatPercentLabel(0.04)).toBe('<0.1%');
    expect(formatPercentLabel(1.84)).toBe('1.8%');
  });
});
