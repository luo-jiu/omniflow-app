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

echarts.use([BarChart, GridComponent, TooltipComponent, CanvasRenderer]);

export interface ResourceMonitorChartItem {
  accent: string;
  key: string;
  label: string;
  meta?: string;
  percent: number;
  value: number;
}

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

function buildCompositionOption(items: ResourceMonitorChartItem[], theme: ChartThemeColors): ResourceChartOption {
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
            formatter: () => (item.percent >= 2 ? `${item.percent.toFixed(1)}%` : ''),
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
  const option = React.useMemo(() => buildCompositionOption(items, theme), [items, theme]);
  return (
    <ChartRoot ref={rootRef}>
      <EChartSurface ariaLabel="资源组成图表" className="echart-surface" option={option} />
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
`;
