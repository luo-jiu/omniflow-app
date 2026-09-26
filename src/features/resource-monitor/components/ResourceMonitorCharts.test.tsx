import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppearanceViewContext } from '@/features/appearance/appearance.context';
import { defaultSelection } from '@/features/appearance/appearance-storage';
import { findBuiltInColorTheme } from '@/features/appearance/built-in-themes';
import { createThemeSnapshot, createThemeState } from '@/features/appearance/theme-state';
import { themeViewVariables, toThemeView, type ThemeView } from '@/features/appearance/theme-view';
import { ResourceCompositionChart } from './ResourceMonitorCharts';
import type { ResourceMonitorChartItem } from './resource-monitor-chart-utils';

const { chart, initChart } = vi.hoisted(() => {
  const chart = { setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn() };
  return { chart, initChart: vi.fn(() => chart) };
});
vi.mock('echarts/core', () => ({ use: vi.fn(), init: initChart }));
vi.mock('echarts/charts', () => ({ BarChart: {} }));
vi.mock('echarts/components', () => ({ GridComponent: {}, TooltipComponent: {} }));
vi.mock('echarts/renderers', () => ({ CanvasRenderer: {} }));

const items: ResourceMonitorChartItem[] = [
  { key: 'image', label: '图片', value: 500, percent: 50, accent: '#3585d4' },
  { key: 'video', label: '视频', value: 300, percent: 30, accent: '#ab78d6' },
  { key: 'audio', label: '音频', value: 200, percent: 20, accent: '#269d75' },
];
let renderer: TestRenderer.ReactTestRenderer | undefined;

function view(mode: 'light' | 'dark', colorThemeId = 'omniflow.default'): ThemeView {
  return toThemeView(createThemeSnapshot(createThemeState({
    ownerEpoch: 'chart-theme-test', accountScope: 'anonymous', systemMode: mode,
    selection: { ...defaultSelection(mode), colorThemeId },
  }), findBuiltInColorTheme));
}

function screen(appearance: ThemeView | null) {
  return <AppearanceViewContext.Provider value={appearance}>
    <ResourceCompositionChart items={items} />
  </AppearanceViewContext.Provider>;
}

function environment(computed: ThemeView) {
  let variables = themeViewVariables(computed);
  const mutations: Array<() => void> = [];
  let resize = () => {};
  const disconnectResize = vi.fn();
  vi.stubGlobal('window', { getComputedStyle: () => ({ getPropertyValue: (key: string) => variables[key] || '' }) });
  vi.stubGlobal('document', { body: {}, documentElement: {} });
  vi.stubGlobal('MutationObserver', class {
    constructor(callback: () => void) { mutations.push(callback); }
    observe() {}
    disconnect() {}
  });
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resize = callback; }
    observe() {}
    disconnect = disconnectResize;
  });
  return {
    // During the host's WAAPI transition getComputedStyle can still expose the
    // outgoing frame; completion changes computed values without a style mutation.
    notifyStyleMutation: () => mutations.forEach(callback => callback()),
    finishAnimation: (target: ThemeView) => { variables = themeViewVariables(target); },
    resize: () => resize(),
    disconnectResize,
  };
}

function option() {
  return chart.setOption.mock.calls.at(-1)![0] as {
    xAxis: { axisLabel: { color: string }; splitLine: { lineStyle: { color: string } } };
    yAxis: { axisLabel: { color: string } };
    tooltip: { backgroundColor: string; borderColor: string; textStyle: { color: string } };
    series: Array<{ data: Array<{ value: number; itemStyle: { color: string }; label: { color: string } }> }>;
  };
}

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('resource composition chart theme projection', () => {
  it('uses the latest appearance snapshot while computed CSS still exposes an outgoing animation frame', () => {
    const saved = view('light');
    const preview = view('dark', 'omniflow.violet');
    const env = environment(saved);
    act(() => { renderer = TestRenderer.create(screen(saved), { createNodeMock: () => ({}) }); });
    expect(option().yAxis.axisLabel.color).toBe(saved.colors['text.primary']);

    act(() => { renderer!.update(screen(preview)); env.notifyStyleMutation(); });
    expect(option()).toMatchObject({
      xAxis: { axisLabel: { color: preview.colors['text.muted'] }, splitLine: { lineStyle: { color: preview.colors['border.default'] } } },
      yAxis: { axisLabel: { color: preview.colors['text.primary'] } },
      tooltip: { backgroundColor: preview.colors['surface.elevated'], borderColor: preview.colors['border.default'], textStyle: { color: preview.colors['text.primary'] } },
    });
    env.finishAnimation(preview);
    expect(option().series[0].data.every(row => row.label.color === preview.colors['text.primary'])).toBe(true);

    // Cancelling preview can reverse the theme before a new DOM mutation arrives.
    act(() => { renderer!.update(screen(saved)); });
    expect(option().yAxis.axisLabel.color).toBe(saved.colors['text.primary']);
    expect(option().series[0].data.map(row => [row.value, row.itemStyle.color]))
      .toEqual(items.map(item => [item.value, item.accent]));
    expect(initChart).toHaveBeenCalledTimes(1);
  });

  it('receives a late appearance snapshot without remounting and still releases resize and chart resources', () => {
    const initial = view('light');
    const target = view('light', 'omniflow.violet');
    const env = environment(initial);
    act(() => { renderer = TestRenderer.create(screen(null), { createNodeMock: () => ({}) }); });
    act(() => { renderer!.update(screen(target)); });
    expect(option().yAxis.axisLabel.color).toBe(target.colors['text.primary']);
    act(() => env.resize());
    expect(chart.resize).toHaveBeenCalledTimes(1);
    act(() => renderer!.unmount());
    renderer = undefined;
    expect(env.disconnectResize).toHaveBeenCalledTimes(1);
    expect(chart.dispose).toHaveBeenCalledTimes(1);
  });
});
