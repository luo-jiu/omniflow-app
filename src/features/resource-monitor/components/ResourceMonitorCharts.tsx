import React from 'react';
import { BarChart } from 'echarts/charts';
import {
  GridComponent,
  TooltipComponent,
  type GridComponentOption,
  type TooltipComponentOption,
} from 'echarts/components';
import * as echarts from 'echarts/core';
import type { BarSeriesOption } from 'echarts/charts';
import type { ComposeOption, ECharts } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import styled from 'styled-components';
import {
  formatPercentLabel,
  type ResourceMonitorChartItem,
  splitChampionItem,
} from './resource-monitor-chart-utils';

echarts.use([BarChart, GridComponent, TooltipComponent, CanvasRenderer]);

interface ResourceCompositionChartProps {
  items: ResourceMonitorChartItem[];
}

interface ChartThemeColors {
  axis: string;
  grid: string;
  muted: string;
  text: string;
  tooltipBackground: string;
  tooltipBorder: string;
  tooltipText: string;
}

type ResourceChartOption = ComposeOption<
  BarSeriesOption | GridComponentOption | TooltipComponentOption
>;

const FALLBACK_THEME: ChartThemeColors = {
  axis: '#64748b',
  grid: 'rgba(148, 163, 184, 0.22)',
  muted: '#94a3b8',
  text: '#e5e7eb',
  tooltipBackground: '#252525',
  tooltipBorder: '#3f3f46',
  tooltipText: '#e5e7eb',
};

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  const digits = value >= 100 || index === 0 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[index]}`;
}

function readColorVariable(source: HTMLElement | null, name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const sourceStyle = source ? window.getComputedStyle(source) : null;
  const bodyStyle = window.getComputedStyle(document.body);
  const rootStyle = window.getComputedStyle(document.documentElement);
  return sourceStyle?.getPropertyValue(name).trim()
    || bodyStyle.getPropertyValue(name).trim()
    || rootStyle.getPropertyValue(name).trim()
    || fallback;
}

function readChartTheme(source: HTMLElement | null): ChartThemeColors {
  return {
    axis: readColorVariable(source, '--app-text-muted', FALLBACK_THEME.axis),
    grid: readColorVariable(source, '--app-border', FALLBACK_THEME.grid),
    muted: readColorVariable(source, '--app-text-muted', FALLBACK_THEME.muted),
    text: readColorVariable(source, '--app-text', FALLBACK_THEME.text),
    tooltipBackground: readColorVariable(source, '--app-bg-elevated', FALLBACK_THEME.tooltipBackground),
    tooltipBorder: readColorVariable(source, '--app-border', FALLBACK_THEME.tooltipBorder),
    tooltipText: readColorVariable(source, '--app-text', FALLBACK_THEME.tooltipText),
  };
}

function useChartThemeColors(sourceRef: React.RefObject<HTMLElement>): ChartThemeColors {
  const [theme, setTheme] = React.useState<ChartThemeColors>(() => readChartTheme(null));

  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const refreshTheme = () => setTheme(readChartTheme(sourceRef.current));
    const observer = new MutationObserver(refreshTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] });
    observer.observe(document.body, { attributes: true, attributeFilter: ['class', 'style'] });
    refreshTheme();
    return () => observer.disconnect();
  }, [sourceRef]);

  return theme;
}

function toChartRows(items: ResourceMonitorChartItem[]) {
  return items
    .filter((item) => item.value > 0)
    .map((item) => ({
      accent: item.accent,
      bytes: formatBytes(item.value),
      id: item.key,
      meta: item.meta || '',
      name: item.label,
      percent: item.percent,
      value: item.value,
    }));
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&#39;';
      default:
        return char;
    }
  });
}

function tooltipFormatter(rows: unknown): string {
  const row = Array.isArray(rows) ? rows[0]?.data : (rows as { data?: unknown })?.data;
  const item = row as { bytes?: string; meta?: string; name?: string; percent?: number; value?: number };
  if (!item) return '';
  const meta = item.meta ? `<br/><span style="opacity:.72">${escapeHtml(item.meta)}</span>` : '';
  return [
    `<strong>${escapeHtml(item.name || '')}</strong>`,
    `<br/>${escapeHtml(item.bytes || formatBytes(item.value || 0))} · ${Number(item.percent || 0).toFixed(1)}%`,
    meta,
  ].join('');
}

interface CompositionChartOptions {
  // 长尾放大模式下的坐标上限（通常取剩余项最大值），不传则按 ECharts 默认自适应。
  maxValue?: number;
  // 长尾放大模式下所有条都展示占比标签；默认模式下小于 2% 的标签省略。
  showAllLabels?: boolean;
}

function buildCompositionOption(
  items: ResourceMonitorChartItem[],
  theme: ChartThemeColors,
  options: CompositionChartOptions = {},
): ResourceChartOption {
  const values = toChartRows(items);
  return {
    animationDuration: 280,
    backgroundColor: 'transparent',
    grid: {
      bottom: 18,
      containLabel: true,
      left: 6,
      right: 56,
      top: 8,
    },
    tooltip: {
      backgroundColor: theme.tooltipBackground,
      borderColor: theme.tooltipBorder,
      borderWidth: 1,
      confine: true,
      extraCssText: 'box-shadow: 0 8px 24px rgba(0, 0, 0, .22); border-radius: 6px;',
      formatter: tooltipFormatter,
      textStyle: { color: theme.tooltipText, fontSize: 11 },
      trigger: 'axis',
    },
    xAxis: {
      axisLabel: {
        color: theme.axis,
        fontSize: 10,
        formatter: (value: number) => formatBytes(Number(value)),
      },
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: {
        lineStyle: { color: theme.grid, type: 'dashed' },
        show: true,
      },
      type: 'value',
      ...(options.maxValue && options.maxValue > 0 ? { max: options.maxValue } : {}),
    },
    yAxis: {
      axisLabel: {
        color: theme.text,
        fontSize: 10,
        overflow: 'truncate',
        width: 92,
      },
      axisLine: { show: false },
      axisTick: { show: false },
      data: values.map((item) => item.name),
      type: 'category',
    },
    series: [
      {
        barMaxWidth: 16,
        data: values.map((item) => ({
          bytes: item.bytes,
          id: item.id,
          itemStyle: {
            borderRadius: [0, 7, 7, 0],
            color: item.accent,
          },
          label: {
            color: theme.text,
            formatter: () => (
              options.showAllLabels || item.percent >= 2 ? formatPercentLabel(item.percent) : ''
            ),
            fontSize: 10,
            position: 'right',
            show: true,
          },
          meta: item.meta,
          name: item.name,
          percent: item.percent,
          value: item.value,
        })),
        emphasis: { focus: 'series' },
        type: 'bar',
      },
    ],
  };
}

const EChartSurface: React.FC<{
  ariaLabel: string;
  className?: string;
  option: ResourceChartOption;
}> = ({ ariaLabel, className, option }) => {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const chartRef = React.useRef<ECharts | null>(null);

  React.useEffect(() => {
    if (!containerRef.current) return undefined;
    const chart = echarts.init(containerRef.current, undefined, { renderer: 'canvas' });
    chartRef.current = chart;
    const resizeObserver = new ResizeObserver(() => chart.resize());
    resizeObserver.observe(containerRef.current);
    return () => {
      resizeObserver.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  React.useEffect(() => {
    chartRef.current?.setOption(option, true);
  }, [option]);

  return <div aria-label={ariaLabel} className={className} ref={containerRef} role="img" />;
};

export const ResourceCompositionChart: React.FC<ResourceCompositionChartProps> = ({ items }) => {
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const theme = useChartThemeColors(rootRef);
  const split = React.useMemo(() => splitChampionItem(items), [items]);
  const tailMax = React.useMemo(() => {
    if (!split) return undefined;
    const max = Math.max(...split.rest.map((item) => item.value));
    return Number.isFinite(max) && max > 0 ? max * 1.12 : undefined;
  }, [split]);
  const option = React.useMemo(
    () => buildCompositionOption(split ? split.rest : items, theme, {
      maxValue: tailMax,
      showAllLabels: Boolean(split),
    }),
    [items, split, tailMax, theme],
  );
  const tailCount = split ? split.rest.filter((item) => item.value > 0).length : 0;
  const championDescription = split
    ? [
      `${split.champion.label}：${formatBytes(split.champion.value)}，占 ${formatPercentLabel(split.champion.percent)}。`,
      split.champion.meta,
    ].filter(Boolean).join(' ')
    : '';
  return (
    <ChartRoot ref={rootRef}>
      {split ? (
        <div
          aria-label={championDescription}
          className="champion-strip"
          role="img"
          style={{ '--accent': split.champion.accent } as React.CSSProperties}
          title={championDescription}
        >
          <div className="champion-head">
            <span className="champion-name">{split.champion.label}</span>
            <strong>{formatBytes(split.champion.value)} · {formatPercentLabel(split.champion.percent)}</strong>
          </div>
          <div className="champion-track">
            <div className="champion-fill" />
          </div>
          <div className="champion-tail-note">其余 {tailCount} 项已放大显示，标签仍为真实占比</div>
        </div>
      ) : null}
      <EChartSurface
        ariaLabel="资源组成图表"
        className={split ? 'echart-surface echart-surface-tail' : 'echart-surface'}
        option={option}
      />
    </ChartRoot>
  );
};

const ChartRoot = styled.div`
  position: relative;
  z-index: 1;
  min-height: 212px;

  .echart-surface {
    width: 100%;
    height: 212px;
  }

  .echart-surface-tail {
    height: 172px;
  }

  .champion-strip {
    margin-bottom: 8px;
    padding-bottom: 9px;
    border-bottom: 1px dashed color-mix(in srgb, var(--app-border) 85%, transparent);
  }

  .champion-head {
    min-width: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    color: var(--app-text, currentColor);
    font-size: 11px;
    line-height: 1.35;
  }

  .champion-head .champion-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
  }

  .champion-head strong {
    flex: 0 0 auto;
    font-weight: 600;
  }

  .champion-track {
    margin-top: 5px;
    height: 8px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--app-text-muted, currentColor) 16%, transparent);
    overflow: hidden;
  }

  .champion-fill {
    width: 100%;
    height: 100%;
    border-radius: inherit;
    background: var(--accent);
  }

  .champion-tail-note {
    margin-top: 5px;
    color: var(--app-text-muted, currentColor);
    font-size: 10px;
    line-height: 1.35;
  }
`;
